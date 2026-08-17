import * as fs from 'fs';
import * as path from 'path';
import { resolveBaseDir } from '../../utils/paths';
import puppeteer, { Browser } from 'puppeteer-core';
import { Problem } from '../../types';

const LUOGU_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/**
 * 洛谷抓取（V0.12：仅保留题面 / 样例 / 关键字搜索——洛谷选题已移除，专心 CF）。
 * 1. 轻量直连优先（HTTP + _contentOnly=1），失败快速回退浏览器（有头移屏，绕过 JS 挑战 WAF）。
 * 2. 磁盘缓存：样例 30 天、题面 30 天，命中时零网络零浏览器。
 * 3. 浏览器用完即关（try-finally + 日志），绝不驻留。
 */

const LUOGU_LIST_TTL_MS = 6 * 3600 * 1000;
const LUOGU_DETAIL_TTL_MS = 30 * 24 * 3600 * 1000;

function luoguCacheDir(): string {
  return path.join(resolveBaseDir(), 'cache');
}

// ===== 洛谷标签字典（id → 中文名；从列表 JSON currentData.tags 提取，历史兼容） =====
const luoguTagDict = new Map<number, string>();

/** 从列表 JSON 提取标签字典（兼容 currentData.tags / data.tags 两种形态；导出供测试） */
export function extractTagDict(json: any): void {
  const tags = json?.currentData?.tags ?? json?.data?.tags;
  if (!Array.isArray(tags)) return;
  for (const t of tags) {
    if (t && typeof t.id === 'number' && typeof t.name === 'string' && !luoguTagDict.has(t.id)) {
      luoguTagDict.set(t.id, t.name);
    }
  }
}

function detailCachePath(pid: string): string {
  return path.join(luoguCacheDir(), `luogu-problem-${pid}.json`);
}

/** 读磁盘缓存（TTL 内有效；损坏/过期返回 null） */
function readCache(p: string, ttl: number): any | null {
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (obj && typeof obj.ts === 'number' && Date.now() - obj.ts < ttl) {
      return obj.data;
    }
  } catch {
    /* 无缓存或损坏 */
  }
  return null;
}

/** 写磁盘缓存（失败不影响主流程） */
function writeCache(p: string, data: any): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ts: Date.now(), data }), 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow] 洛谷缓存写入失败：', e);
  }
}

/** 探测系统可用的浏览器（Edge/Chrome，供 puppeteer 兜底使用） */
export function getBrowserPath(): string | null {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 启动有头浏览器（隐藏模式，绕过洛谷 JS 挑战 WAF）。
 * 用完必须立即 close（try-finally 保证），绝不驻留。
 */
async function launchBrowser(): Promise<Browser> {
  const exe = getBrowserPath();
  if (!exe) {
    throw new Error('未找到 Edge/Chrome 浏览器，无法访问洛谷（请安装 Microsoft Edge）');
  }
  console.log('[ACM-Workflow] 洛谷抓取：启动有头浏览器（窗口移出屏幕）…');
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: false,
    args: [
      '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=zh-CN',
      '--window-position=-32000,-32000',
      '--window-size=1280,900'
    ]
  });
  console.log('[ACM-Workflow] 洛谷抓取：浏览器已启动');
  return browser;
}

/** 关闭浏览器（幂等，带日志；调用方必须 try-finally 保证执行） */
async function closeBrowser(browser: Browser, tag: string): Promise<void> {
  try {
    if (browser && browser.connected) {
      await browser.close();
      console.log(`[ACM-Workflow] 洛谷抓取：浏览器已关闭（${tag}）`);
    }
  } catch (e) {
    console.warn(`[ACM-Workflow] 洛谷抓取：浏览器关闭失败（${tag}）：`, e);
  }
}

// 浏览器请求节流：避免短时间连续访问触发风控挂起（轻量直连不受限）
let lastFetchTime = 0;
const FETCH_INTERVAL_MS = 3000;
async function throttle() {
  const wait = Math.max(0, FETCH_INTERVAL_MS - (Date.now() - lastFetchTime));
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastFetchTime = Date.now();
}

/**
 * 轻量直连：先访问洛谷首页建立 Cookie 会话，再带 Cookie + _contentOnly=1 请求目标页。
 * 成功返回页面文本（JSON 或含 lentille-context 的 HTML）；被 WAF 拦截抛错。
 */
async function lightFetch(url: string): Promise<string> {
  // 建立挑战 Cookie 会话（部分网络下首页 Set-Cookie 即足够）
  try {
    await fetch('https://www.luogu.com.cn/', {
      headers: { 'User-Agent': LUOGU_UA, 'Accept': 'text/html,*/*' },
      signal: AbortSignal.timeout(8000)
    }).catch(() => { /* 首页失败不阻断，直接试目标页 */ });
  } catch { /* ignore */ }

  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(url + sep + '_contentOnly=1', {
    headers: {
      'User-Agent': LUOGU_UA,
      'Accept': 'application/json, text/html, */*',
      'Referer': 'https://www.luogu.com.cn/',
      'x-luogu-type': 'content-only'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    throw new Error(`洛谷轻量请求失败 HTTP ${res.status}`);
  }
  return res.text();
}

/** 从轻量返回的文本里解析 JSON 数据（contentOnly JSON 或 lentille-context HTML 均可） */
function parseLightJson(text: string): any | null {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch { return null; }
  }
  const m = /<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/.exec(text);
  if (m) {
    try { return JSON.parse(m[1]); } catch { return null; }
  }
  return null;
}

/** 浏览器兜底：用有头（移屏）浏览器打开洛谷页面，返回 lentille-context JSON。
 *  V0.8：try-finally 保证 page 与 browser 都关闭，绝不驻留。 */
async function fetchLuoguDataBrowser(url: string): Promise<any> {
  await throttle();
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(LUOGU_UA);
    // 抹掉自动化标记（navigator.webdriver），伪装普通浏览器
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    let html = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => { /* 超时继续 */ });
      } catch {
        /* 导航失败，重试 */
      }
      await new Promise((r) => setTimeout(r, 1200));
      html = await page.content();
      if (html.includes('lentille-context')) {
        break;
      }
    }
    const m = /<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) {
      throw new Error('洛谷页面未找到题目数据（可能被风控拦截，请稍后重试）');
    }
    return JSON.parse(m[1]);
  } finally {
    try { await page.close(); } catch { /* ignore */ }
    await closeBrowser(browser, 'data');
  }
}

/**
 * 统一取数入口：磁盘缓存 → 轻量直连 → 浏览器兜底。
 * 命中缓存时零网络、零浏览器。返回前提取标签字典（Bug1）。
 */
async function fetchLuoguData(url: string, cachePath: string | null, ttl: number): Promise<any> {
  let data: any;
  if (cachePath) {
    const cached = readCache(cachePath, ttl);
    if (cached) {
      extractTagDict(cached);
      return cached;
    }
  }
  try {
    const text = await lightFetch(url);
    data = parseLightJson(text);
    if (!data) throw new Error('轻量直连未返回数据');
  } catch (e: any) {
    console.warn('[ACM-Workflow] 洛谷轻量直连失败，退回浏览器抓取：', e?.message || e);
    data = await fetchLuoguDataBrowser(url);
  }
  extractTagDict(data);
  if (cachePath) writeCache(cachePath, data);
  return data;
}

/** 抓取洛谷题目的测试样例（samples 为 [["输入","输出"], ...] 数组对；样例缓存 30 天） */
export async function getLuoguProblemDetail(problem: Problem): Promise<{ tests: { input: string; output: string }[] }> {
  const json = await fetchLuoguData(
    `https://www.luogu.com.cn/problem/${problem.id}`,
    detailCachePath(problem.id),
    LUOGU_DETAIL_TTL_MS
  );
  const tests = parseLuoguSamples(json);
  if (tests.length === 0) {
    throw new Error('洛谷页面没有解析出样例');
  }
  return { tests };
}

/**
 * 抓取洛谷题目页（题面渲染用）。
 * 轻量优先：contentOnly JSON → 拼装 <article> HTML（含题面/输入输出格式/提示/样例）；
 * 失败回退浏览器抓原始 HTML。
 */
export async function fetchProblemHtml(problemId: string): Promise<string> {
  const url = `https://www.luogu.com.cn/problem/${problemId}`;
  const cached = readCache(detailCachePath(problemId), LUOGU_DETAIL_TTL_MS);
  if (cached) {
    return typeof cached === 'object' && cached._html ? cached._html : luoguJsonToHtml(cached, problemId);
  }
  try {
    const text = await lightFetch(url);
    const json = parseLightJson(text);
    if (json) {
      writeCache(detailCachePath(problemId), json);
      return luoguJsonToHtml(json, problemId);
    }
    // 返回了原始 HTML（未走 contentOnly）→ 直接可用
    if (text.includes('problem-content') || text.includes('<article')) {
      writeCache(detailCachePath(problemId), { _html: text });
      return text;
    }
    throw new Error('轻量直连未返回题面');
  } catch (e: any) {
    console.warn('[ACM-Workflow] 洛谷题面轻量直连失败，退回浏览器：', e?.message || e);
  }
  return fetchLuoguHtmlBrowser(problemId);
}

/** contentOnly JSON → 近似洛谷题目页 HTML（供 statement.ts parseLuoguStatement 解析） */
function luoguJsonToHtml(json: any, pid: string): string {
  const problem = json?.data?.problem ?? json?.currentData?.problem ?? {};
  const title = problem.title || pid;
  const esc = (s: any) => String(s ?? '');
  const samples = (problem.samples || []).map((s: any) =>
    Array.isArray(s) ? { input: String(s[0]), output: String(s[1]) } : { input: String(s?.input ?? ''), output: String(s?.output ?? '') }
  );
  let html = `<article><h1>${esc(title)}</h1>`;
  const sections: [string, string][] = [
    [esc(problem.description), '题目描述'],
    [esc(problem.inputFormat), '输入格式'],
    [esc(problem.outputFormat), '输出格式'],
    [esc(problem.hint), '提示']
  ];
  for (const [body, heading] of sections) {
    if (!body.trim()) continue;
    html += `<h2>${heading}</h2>${body}`;
  }
  if (samples.length > 0) {
    html += '<h2>样例</h2>';
    samples.forEach((s: any, i: number) => {
      html += `<h3>样例输入 ${i + 1}</h3><pre>${esc(s.input)}</pre>`;
      html += `<h3>样例输出 ${i + 1}</h3><pre>${esc(s.output)}</pre>`;
    });
  }
  html += '</article>';
  return html;
}

/** 浏览器兜底抓原始 HTML（题面）。V0.8：try-finally 保证浏览器关闭。 */
async function fetchLuoguHtmlBrowser(problemId: string): Promise<string> {
  await throttle();
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(LUOGU_UA);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    let html = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(`https://www.luogu.com.cn/problem/${problemId}`, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => { /* 超时继续 */ });
      } catch {
        /* 重试 */
      }
      await new Promise((r) => setTimeout(r, 1200));
      html = await page.content();
      if (html.includes('problem-content') || html.includes('lentille-context')) {
        break;
      }
    }
    if (!html.includes('problem-content')) {
      throw new Error('洛谷题面加载失败（可能被风控拦截，请稍后重试）');
    }
    return html;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
    await closeBrowser(browser, 'html');
  }
}

/**
 * 按关键字搜索洛谷题目（列表接口 keyword 参数）。
 * Bug3：USACO 等非标准命名文件（USACO10FEB_Chocolate_Buying_S.cpp）→ 用文件名搜索洛谷题号。
 */
export async function searchLuoguByKeyword(keyword: string): Promise<{ pid: string; name: string; difficulty: number } | null> {
  const kw = keyword.trim();
  if (!kw) return null;
  const json = await fetchLuoguData(
    `https://www.luogu.com.cn/problem/list?page=1&keyword=${encodeURIComponent(kw)}`,
    null, // 搜索结果不写磁盘缓存
    LUOGU_LIST_TTL_MS
  );
  const result = json?.data?.problems?.result ?? json?.currentData?.problems?.result ?? [];
  if (!Array.isArray(result) || result.length === 0) return null;
  const lower = kw.toLowerCase();
  // 优先题号精确匹配
  for (const p of result) {
    if (String(p.pid).toLowerCase() === lower) {
      return { pid: p.pid, name: p.name, difficulty: p.difficulty ?? 0 };
    }
  }
  // 其次标题包含匹配（双向）
  for (const p of result) {
    const name = String(p.name || '').toLowerCase();
    if (name && (name.includes(lower) || lower.includes(name))) {
      return { pid: p.pid, name: p.name, difficulty: p.difficulty ?? 0 };
    }
  }
  return null;
}

/** 解析洛谷题目列表 JSON（兼容 lentille-context 与 contentOnly 两种结构） */
export function parseLuoguList(json: any): { problems: { pid: string; name: string; difficulty: number }[]; count: number } {
  const data = json?.data?.problems ?? json?.currentData?.problems;
  return {
    problems: (data?.result ?? []).map((p: any) => ({
      pid: p.pid,
      name: p.name,
      difficulty: typeof p.difficulty === 'number' ? p.difficulty : 0
    })),
    count: typeof data?.count === 'number' ? data.count : 0
  };
}

/** 解析洛谷题目详情 JSON 里的样例（兼容两种结构；samples 为 [输入,输出] 数组对） */
export function parseLuoguSamples(json: any): { input: string; output: string }[] {
  const problem = json?.data?.problem ?? json?.currentData?.problem ?? {};
  const samples = problem.samples ?? [];
  return samples.map((s: any) => ({
    input: String(Array.isArray(s) ? s[0] : s?.input ?? ''),
    output: String(Array.isArray(s) ? s[1] : s?.output ?? '')
  }));
}
