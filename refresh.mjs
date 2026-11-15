import {readFile, writeFile, rename} from 'node:fs/promises';

const fromRoot = name => new URL(name, import.meta.url);
const read = async name => JSON.parse(await readFile(fromRoot(name), 'utf8'));
const sources = await read('sources.json');
const profile = process.env.MATCH_PROFILE_JSON ? JSON.parse(process.env.MATCH_PROFILE_JSON) : await read('profile.json');
const host = 'https://www.nowcoder.com';
const target = 20;
const threshold = 70;
const titleFocus = /内容|新媒体|短剧|短视频|视频运营|编导|编辑|文案|本地化|市场|营销|商品|公关|品牌|企业文化|文化运营|海外运营/;
const technicalTitle = /算法工程师|研发工程师|开发工程师|测试工程师|数据工程师|架构师|软件工程师|视觉设计|结构设计|景观设计|建筑设计/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = new Date();

class AccessBlocked extends Error {}

async function get(url, rules = []) {
  const parsed = new URL(url);
  if (parsed.origin !== host || rules.some(prefix => parsed.pathname.startsWith(prefix))) {
    throw new AccessBlocked('来源不在允许读取的公开路径');
  }
  await sleep(300);
  const response = await fetch(parsed, {
    redirect: 'manual',
    signal: AbortSignal.timeout(16000),
    headers: {'User-Agent': 'JobMatchBoard/1.0 (public job listings; 20 JDs per run)'}
  });
  if ([401, 403, 429].includes(response.status)) {
    throw new AccessBlocked('牛客返回 HTTP ' + response.status + '，本轮停止');
  }
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const html = await response.text();
  if (/<title>[^<]*(安全验证|访问验证|人机验证|登录)/i.test(html)) {
    throw new AccessBlocked('遇到登录或安全验证，本轮停止');
  }
  return html;
}

function state(html) {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:\;?\(function|<\/script>)/);
  if (!match) throw new Error('公开页面缺少可读的职位数据');
  return JSON.parse(match[1]);
}

const rules = [
  ['中文与传媒', /中文|汉语言|新闻传播|传媒|广播电视|编导|文学/, 12],
  ['内容策划与采编', /选题|采编|内容策划|内容生产|内容创作|脚本|撰稿|内容策略|采访/, 19],
  ['文案与品牌传播', /文案|品牌|宣传|内容传播|企业文化/, 14],
  ['公众号与视频号', /公众号|微信|视频号|新媒体|自媒体/, 13],
  ['拍摄与剪辑', /剪辑|拍摄|短视频|视频制作|影视|premiere|剪映/i, 13],
  ['海外内容本地化', /本地化|跨文化|字幕|出海内容|海外传播/, 15],
  ['数据复盘', /复盘|数据分析|数据处理|数据跟踪|数据监控|数据洞察|效果评估/, 10],
  ['跨团队协作', /跨部门|沟通协调|团队协作|统筹|协同|项目推进/, 8],
  ['英语沟通', /英语|英文|雅思|CET-?[46]/i, 10],
  ['Office 办公', /excel|ppt|powerpoint|office/i, 7]
];
const gaps = [
  ['独立运营小红书', /小红书/], ['抖音账号实操', /抖音/], ['海外社媒运营', /tiktok|instagram|youtube|facebook/i],
  ['SQL／Python', /\bsql\b|python/i], ['AI／AIGC 工作流', /AIGC|AI工作流|AI工具|Prompt|AI生成|大模型/i],
  ['投放／转化增长', /投放|获客|转化率|GMV|ROI/i], ['电商与商品实操', /商品管理|货品|商家运营|库存|电商运营/],
  ['预算管理', /预算/], ['社区或创作者运营', /创作者运营|作者运营|社区运营|生态运营/],
  ['数据可视化工具', /tableau|power\s*bi/i], ['其他小语种', /日语|韩语|德语|西班牙语|阿拉伯语/],
  ['人力或员工关系实操', /员工关系|人力资源管理|组织发展/],
  ['行业或岗位年限', /[一二三四五六七八九1-9]\s*年(?:以上|及以上|相关|经验|工作)/]
];

function score(jobTitle, duties, requirements, graduationYear) {
  const jd = duties + '\n' + requirements;
  const relevant = rules.filter(([, pattern]) => pattern.test(jd));
  const matched = relevant.filter(([label]) => profile.skills.includes(label));
  const missing = [...relevant.filter(([label]) => !profile.skills.includes(label)).map(([label]) => label),
    ...gaps.filter(([, pattern]) => pattern.test(jd)).map(([label]) => label)];
  if (/硕士.*(?:毕业|及以上|以上)|研究生学历/.test(requirements)) missing.push('硕士毕业或学历要求');
  const years = [...new Set((jobTitle + ' ' + graduationYear + ' ' + requirements).match(/20\d{2}\s*届/g) || [])];
  if (years.length && !years.some(year => Number(year.slice(0, 4)) === profile.graduationYear)) {
    missing.push('核对毕业届别（' + years.join('、') + '）');
  }
  const technical = technicalTitle.test(jobTitle);
  const coreFit = titleFocus.test(jobTitle) && !technical;
  if (technical) missing.push('该方向的专业技术或设计经历');
  if (/作品集|作品链接/.test(requirements)) missing.push('按 JD 准备作品集');
  const covered = matched.reduce((sum, [, , weight]) => sum + weight, 0);
  const total = relevant.reduce((sum, [, , weight]) => sum + weight, 0);
  const score = Math.max(0, Math.min(technical ? 59 : 100, Math.round(
    (coreFit ? 22 : 0) + 56 * covered / Math.max(covered + 7 * Math.min(missing.length, 4), total, 33)
    + Math.min(22, 4 * matched.length)
  )));
  return {
    score,
    reasons: matched.map(([label]) => label),
    gaps: missing,
    resume: /营销|商品|市场|品牌|电商/.test(jobTitle) && !/内容运营|本地化|新媒体/.test(jobTitle)
      ? profile.versions.marketing : profile.versions.content
  };
}

function parseJob(html, id) {
  const info = state(html).store?.jobDetail;
  const job = info?.detail;
  if (!job?.jobName) throw new Error('无法确认岗位详情');
  if (![0, 'open'].includes(job.status) || (job.deliverEnd > 0 && job.deliverEnd <= +now)) return null;
  const ext = typeof job.ext === 'string' ? JSON.parse(job.ext) : job.ext || job;
  const description = job.description?.replace(/<[^>]+>/g, '\n') || '';
  const [overview, ...qualification] = description.split(/任职资格|职位要求|岗位要求/);
  const duties = ext.infos || job.jobDescription || job.jobDesc || overview;
  const requirements = ext.requirements || job.jobRequirement || qualification.join('\n');
  const company = info.jobCompany?.simpleName || info.jobCompany?.companyName || job.recommendInternCompany?.companyShortName;
  if (!company || typeof duties !== 'string' || typeof requirements !== 'string' || (duties + requirements).trim().length < 30) {
    throw new Error('公司或完整 JD 缺失');
  }
  const cities = job.jobCityList?.length ? job.jobCityList : [job.jobCity || job.jobName.match(/[（(]内容运营[-－]([^）)]+)[）)]/)?.[1] || '地点待核对'];
  return {
    id, title: job.jobName, company, cities,
    type: info.recruitTypeName?.[job.recruitType] || '招聘',
    url: host + '/jobs/detail/' + id,
    ...score(job.jobName, duties, requirements, job.graduationYear || ''),
  };
}

async function refresh() {
  const robots = await get(host + '/robots.txt');
  const blockedPaths = robots.split('\n').flatMap(line => {
    const match = line.match(/^Disallow\s*:\s*(\/[^\s#]*)/i);
    return match ? [match[1]] : [];
  });
  const candidates = new Map(sources.detailIds.map(id => [id, 4]));
  let sourcesRead = 0;
  for (const url of sources.listingPages) {
    try {
      const listing = await get(url, blockedPaths);
      const links = [...listing.matchAll(/<a\s+[^>]*href="(?:https:\/\/www\.nowcoder\.com)?\/jobs\/detail\/(\d+)"[^>]*>([^<]+)<\/a>/g)];
      if (!links.length) { console.warn('列表未返回可读职位链接'); continue; }
      sourcesRead++;
      for (const [, id, title] of links) {
        const rank = titleFocus.test(title) && !technicalTitle.test(title) ? 3 : 0;
        candidates.set(id, Math.max(candidates.get(id) ?? 0, rank));
      }
    } catch (error) {
      if (error instanceof AccessBlocked) throw error;
      console.warn('列表读取失败', error.message);
    }
  }
  const ranked = [...candidates].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || b[0].localeCompare(a[0]));
  const jobs = [];
  for (const [id] of ranked.slice(0, 46)) {
    if (jobs.length === target) break;
    if (!/^\d+$/.test(id)) continue;
    try {
      const job = parseJob(await get(host + '/jobs/detail/' + id, blockedPaths), id);
      if (job) jobs.push(job);
    } catch (error) {
      if (error instanceof AccessBlocked) throw error;
      console.warn('职位 ' + id + ' 读取失败', error.message);
    }
  }
  if (jobs.length === 0) throw new Error('本轮无有效岗位，保留上一批数据');
  const data = {
    updatedAt: now.toISOString(), target, threshold, sourcesRead,
    jobs: jobs.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  };
  await writeFile(fromRoot('jobs.json.tmp'), JSON.stringify(data, null, 2) + '\n');
  await rename(fromRoot('jobs.json.tmp'), fromRoot('jobs.json'));
  if (jobs.length < target) console.warn('来源可用岗位不足 ' + target + '，实际收录 ' + jobs.length);
  console.log('收录 ' + jobs.length + ' 个岗位，其中 ' + jobs.filter(job => job.score >= threshold).length + ' 个达到阈值');
}

await refresh().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
