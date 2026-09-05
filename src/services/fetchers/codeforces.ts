import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as undici from 'undici';
import { Problem } from '../../types';
import { resolveBaseDir } from '../../utils/paths';
import type { CfCookie } from '../cfSession';

const execFileAsync = promisify(execFile);
const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const CF_COOKIE_JAR = path.join(os.tmpdir(), 'acm-workflow', 'cf-cookies.txt');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ===== 代理（V0.17.2：VS Code 扩展的 fetch/curl 不跟随 Windows 系统代理，需显式配置）=====

/** 解析代理：配置 acmWorkflow.proxy 优先，其次环境变量 HTTPS_PROXY/HTTP_PROXY（大小写兼容） */
export function resolveProxyUrl(): string {
  try {
    const cfg = vscode.workspace.getConfiguration('acmWorkflow').get<string>('proxy', '');
    if (cfg && cfg.trim()) return cfg.trim();
  } catch { /* 无 VS Code 环境 */ }
  const env = process.env as Record<string, string | undefined>;
  // 注意：Node 22 中 process.env.X = undefined 会存成字符串 "undefined"，需过滤
  const pick = (name: string): string | undefined => {
    const x = env[name];
    return x && x !== 'undefined' ? x : undefined;
  };
  return pick('HTTPS_PROXY') || pick('https_proxy') || pick('HTTP_PROXY') || pick('http_proxy') || '';
}

/** curl 代理参数（未配置返回空数组，不改变现有行为） */
export function curlProxyArgs(): string[] {
  const proxy = resolveProxyUrl();
  return proxy ? ['--proxy', proxy] : [];
}

/** dispatcher 模块级缓存：代理配置变化时重建，避免每次请求都新建 undici Agent */
let cachedDispatcher: { proxy: string; dispatcher: unknown } | null = null;

/** 创建 Node fetch 的 undici dispatcher（V0.17.3：无代理也强制 IPv4，规避 IPv6 路由差） */
function createFetchDispatcher(): unknown {
  try {
    const proxy = resolveProxyUrl();
    if (proxy) {
      return new undici.ProxyAgent({ uri: proxy, connect: { family: 4 } });
    }
    // 本机/网络 IPv6 路由差时，getaddrinfo 返回的 AAAA 会让请求先试 IPv6 再回退，白白超时
    return new undici.Agent({ connect: { family: 4 } });
  } catch (e) {
    console.warn('[ACM-Workflow][网络] dispatcher 初始化失败，本次请求用默认：', e);
    return undefined;
  }
}

/** 统一获取 fetch dispatcher（模块级缓存；代理配置变化时自动重建） */
export function getFetchDispatcher(): unknown {
  const proxy = resolveProxyUrl();
  if (cachedDispatcher && cachedDispatcher.proxy === proxy) {
    return cachedDispatcher.dispatcher;
  }
  const dispatcher = createFetchDispatcher();
  cachedDispatcher = { proxy, dispatcher };
  return dispatcher;
}

/**
 * 把会话 Cookie 写入 curl Netscape 格式 cookie jar（V0.17.2）。
 * cfSession 登录成功后调用：此后所有 curl 抓取都带真实登录态，显著降低匿名限流。
 */
export function writeSessionCookiesToJar(cookies: CfCookie[]): void {
  try {
    fs.mkdirSync(path.dirname(CF_COOKIE_JAR), { recursive: true });
    const lines: string[] = ['# Netscape HTTP Cookie File'];
    for (const c of cookies) {
      if (!c.name || !c.value || c.value === 'deleted') continue;
      const domain = c.domain || '.codeforces.com';
      const pathPart = c.path || '/';
      const expires = c.expires && c.expires > 0 ? c.expires : 0; // 0 = 会话级
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      lines.push(
        [domain, 'TRUE', pathPart, includeSubdomains, String(expires), c.name, c.value].join('\t')
      );
    }
    fs.writeFileSync(CF_COOKIE_JAR, lines.join('\n'), 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow][网络] 会话 Cookie 写入 jar 失败：', e);
  }
}

/** 题集磁盘缓存：12 小时 TTL，避免每次冷启动都拉 2MB+ 的 problemset（实测首次 12s） */
const CF_PROBLEMS_TTL_MS = 12 * 3600 * 1000;

let cache: Problem[] | null = null;
let problemsLoading: Promise<Problem[]> | null = null;

function cfCacheDir(): string {
  return path.join(resolveBaseDir(), 'cache');
}
function cfProblemsCachePath(): string {
  return path.join(cfCacheDir(), 'cf-problems.json');
}

/** 读磁盘缓存（TTL 内有效；损坏/过期返回 null） */
function readCfProblemsDiskCache(): Problem[] | null {
  try {
    const raw = fs.readFileSync(cfProblemsCachePath(), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.problems) && typeof obj.ts === 'number' && Date.now() - obj.ts < CF_PROBLEMS_TTL_MS) {
      return obj.problems as Problem[];
    }
  } catch {
    /* 无缓存或损坏 */
  }
  return null;
}

/** 写磁盘缓存（失败不影响主流程） */
function writeCfProblemsDiskCache(problems: Problem[]): void {
  try {
    fs.mkdirSync(cfCacheDir(), { recursive: true });
    fs.writeFileSync(cfProblemsCachePath(), JSON.stringify({ ts: Date.now(), problems }), 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow] CF 题集缓存写入失败：', e);
  }
}

interface CFProblem {
  contestId: number;
  index: string;
  name: string;
  type: string;
  rating?: number;
  tags: string[];
}

interface CFResponse {
  status: string;
  result: {
    problems: CFProblem[];
  };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

async function fetchPage(url: string): Promise<string> {
  const dispatcher = getFetchDispatcher();
  const res = await fetch(url, {
    headers: {
      'User-Agent': CF_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    },
    signal: AbortSignal.timeout(12000),
    ...(dispatcher ? { dispatcher } : {})
  } as any);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

function curlBinCandidates(): string[] {
  // 优先用绝对路径：VS Code 扩展进程的 PATH 可能不完整（曾出现 spawn curl ENOENT），
  // 绝对路径不依赖 PATH，Windows 系统自带 curl 在 C:\Windows\System32\curl.exe
  return [
    'C:\\Windows\\System32\\curl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\curl.exe',
    '/usr/bin/curl',
    '/bin/curl',
    'curl.exe',
    'curl'
  ];
}

async function runCurl(args: string[]): Promise<string> {
  let lastError: unknown;
  for (const bin of curlBinCandidates()) {
    try {
      const { stdout } = await execFileAsync(bin, args, {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      });
      if (stdout && stdout.length > 0) {
        return stdout;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('curl 请求失败');
}

/** 裸 curl 抓取（带 UA + 代理 + 重试） */
async function fetchWithCurl(url: string): Promise<string> {
  return runCurl([
    '-L', '-s', '-4', '--compressed', '--max-time', '12',
    '--retry', '1', '--retry-delay', '1', '--retry-all-errors',
    ...curlProxyArgs(),
    '-A', CF_UA,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    url
  ]);
}

/** 按 URL 后缀猜图片 MIME（curl 取不到响应头时用） */
function guessImageMime(url: string): string {
  const ext = (url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  return ext === 'svg' ? 'image/svg+xml'
    : ext === 'gif' ? 'image/gif'
    : ext === 'webp' ? 'image/webp'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'bmp' ? 'image/bmp'
    : 'image/png';
}

/**
 * 二进制下载（题面配图等）：curl 优先（带 UA/重试，产出 Buffer），失败回退 Node fetch。
 * 返回 null 表示下载失败（调用方回退为在线链接）。
 * V0.17：题面配图获取走与页面抓取同一套 curl 通道，规避 Cloudflare 对 Node fetch 的拦截。
 */
export async function fetchBinary(url: string): Promise<{ mime: string; data: Buffer } | null> {
  for (const bin of curlBinCandidates()) {
    try {
      const { stdout } = await execFileAsync(bin, [
        '-L', '-s', '-4', '--compressed', '--max-time', '15',
        '--retry', '1', '--retry-delay', '1', '--retry-all-errors',
        ...curlProxyArgs(),
        '-A', CF_UA,
        '-H', 'Accept: image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8',
        '-H', 'Referer: https://codeforces.com/',
        url
      ], {
        encoding: 'buffer',
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      });
      if (stdout && stdout.length > 0) {
        return { mime: guessImageMime(url), data: stdout };
      }
    } catch {
      /* 换下一个 curl 候选 */
    }
  }
  try {
    const dispatcher = getFetchDispatcher();
    const res = await fetch(url, {
      headers: { 'User-Agent': CF_UA, 'Accept': 'image/*' },
      signal: AbortSignal.timeout(15000),
      ...(dispatcher ? { dispatcher } : {})
    } as any);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 0) {
        const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        return { mime: ct.startsWith('image/') ? ct : guessImageMime(url), data: buf };
      }
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/**
 * 带浏览器会话的 curl 抓取：优先复用已有 cookie jar（登录会话或匿名会话），
 * jar 缺失/为空时才先访问首页建会话；带 Referer + cookie 抓题目页，模拟真实浏览器。
 */
async function fetchWithCurlSession(url: string): Promise<string> {
  // V0.17.2：jar 已存在且非空 → 跳过首页建会话（省一次请求，登录会话由 cfSession 写入）
  let jarReady = false;
  try {
    jarReady = fs.existsSync(CF_COOKIE_JAR) && fs.readFileSync(CF_COOKIE_JAR, 'utf8').trim().length > 0;
  } catch { /* 按未就绪处理 */ }
  if (!jarReady) {
    await runCurl([
      '-sL', '-4', '--max-time', '10',
      ...curlProxyArgs(),
      '-A', CF_UA,
      '-c', CF_COOKIE_JAR,
      'https://codeforces.com/'
    ]);
  }
  return runCurl([
    '-L', '-s', '-4', '--compressed', '--max-time', '12',
    '--retry', '1', '--retry-delay', '1', '--retry-all-errors',
    ...curlProxyArgs(),
    '-A', CF_UA,
    '-H', 'Referer: https://codeforces.com/',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-b', CF_COOKIE_JAR, '-c', CF_COOKIE_JAR,
    url
  ]);
}

export async function getCodeforcesProblems(): Promise<Problem[]> {
  if (cache) return cache;

  // 磁盘缓存命中 → 直接返回（无需实时抓取，随机/薄弱推荐秒开）
  const disk = readCfProblemsDiskCache();
  if (disk) {
    cache = disk;
    return disk;
  }

  // 并发去重：薄弱推荐、难度补全、历史图表同时触发时只发一次网络请求
  if (problemsLoading) return problemsLoading;
  problemsLoading = loadCodeforcesProblems();
  try {
    return await problemsLoading;
  } finally {
    problemsLoading = null;
  }
}

async function loadCodeforcesProblems(): Promise<Problem[]> {
  let lastError: Error | null = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(attempt * 800);
      console.warn(`[ACM-Workflow][CF API] problemset.problems 第 ${attempt - 1} 次尝试失败，重试`);
    }
    try {
      const dispatcher = getFetchDispatcher();
      const res = await fetch('https://codeforces.com/api/problemset.problems', {
        headers: { 'User-Agent': CF_UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000),
        ...(dispatcher ? { dispatcher } : {})
      } as any);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const snippet = body.trim().slice(0, 200);
        const err = new Error(`Codeforces API 请求失败: ${res.status}${snippet ? '：' + snippet : ''}`);
        if (res.status < 500) throw err;
        lastError = err;
        continue;
      }

      const data = JSON.parse(await res.text()) as CFResponse;
      if (data.status !== 'OK') {
        throw new Error(`Codeforces API 返回异常：${(data as any).comment || 'unknown'}`);
      }

      cache = data.result.problems
        .filter(p => p.type === 'PROGRAMMING')
        .map(p => ({
          id: `${p.contestId}${p.index}`,
          platform: 'codeforces' as const,
          title: p.name,
          difficulty: p.rating,
          tags: p.tags || [],
          url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
        }));

      writeCfProblemsDiskCache(cache);
      return cache;
    } catch (e: any) {
      const err = e instanceof Error ? e : new Error(String(e));
      // 4xx 或 CF 返回业务错误时重试无意义；5xx/网络异常/非 JSON 继续重试
      if (/Codeforces API 请求失败: 4\d\d/.test(err.message) || /Codeforces API 返回异常/.test(err.message)) throw err;
      lastError = err;
    }
  }
  throw lastError || new Error(`Codeforces API 请求失败（已重试 ${maxAttempts} 次）`);
}

export async function pickCodeforcesProblem(options: {
  minRating: number;
  maxRating: number;
  tags: string[];
  exclude?: Set<string>;
}): Promise<Problem> {
  const all = await getCodeforcesProblems();

  const filtered = all.filter(p => {
    if (options.exclude?.has(p.id)) return false;
    const ratingOk = p.difficulty !== undefined
      && p.difficulty >= options.minRating
      && p.difficulty <= options.maxRating;
    if (!ratingOk) return false;
    if (options.tags.length === 0) return true;
    // Bug1 修复：p.tags 可能缺失/非数组，元素可能非字符串
    if (!Array.isArray(p.tags)) return false;
    return options.tags.some(tag => typeof tag === 'string' && p.tags.includes(tag));
  });

  if (filtered.length === 0) {
    throw new Error('没有找到符合条件的题目，请放宽难度或专题限制');
  }

  const picked = filtered[Math.floor(Math.random() * filtered.length)];
  return picked;
}

/** 从 problemset URL 构造 contest URL（如 .../problemset/problem/853/A → .../contest/853/problem/A） */
function contestUrlOf(problemUrl: string): string {
  const m = /problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/.exec(problemUrl);
  if (!m) return '';
  return `https://codeforces.com/contest/${m[1]}/problem/${m[2]}`;
}

export async function getCodeforcesProblemDetail(problem: Problem): Promise<{ tests: { input: string; output: string }[] }> {
  const contestUrl = contestUrlOf(problem.url);
  const urls = [
    problem.url,
    `${problem.url}?mobile=true`,
    contestUrl,
    contestUrl ? `${contestUrl}?mobile=true` : ''
  ].filter(Boolean);
  const errors: string[] = [];

  // 抓取策略：裸 curl → 带会话 cookie 的 curl → Node fetch，每个 URL 都试
  for (const url of urls) {
    for (const fetcher of [fetchWithCurlSession, fetchWithCurl, fetchPage]) {
      try {
        const html = await fetcher(url);
        const tests = parseTests(html);
        if (tests.length > 0) {
          return { tests };
        }
      } catch (e: any) {
        errors.push(`${url} (${fetcher.name}): ${e?.message || e}`);
      }
    }
    // 请求间稍作停顿，降低触发反爬限流的概率
    await sleep(400);
  }

  throw new Error(
    `获取测试数据失败（可能被 Codeforces 反爬拦截）。尝试了 ${urls.length * 3} 种组合均未成功：\n${errors.join('\n')}`
  );
}

/** 抓取 CF 题目页 HTML（题面渲染用；多策略 + 会话，降低反爬） */
export async function fetchProblemHtml(url: string): Promise<string> {
  const contestUrl = contestUrlOf(url);
  const urls = [
    url,
    `${url}?mobile=true`,
    contestUrl,
    contestUrl ? `${contestUrl}?mobile=true` : ''
  ].filter(Boolean);
  const errors: string[] = [];
  for (const u of urls) {
    for (const fetcher of [fetchWithCurlSession, fetchWithCurl, fetchPage]) {
      try {
        console.log(`[ACM-Workflow][题面] 尝试抓取: ${u} (${fetcher.name})`);
        const html = await fetcher(u);
        if (html.includes('problem-statement')) {
          console.log(`[ACM-Workflow][题面] 抓取成功: ${u} (${fetcher.name}), ${html.length} bytes`);
          return html;
        }
        errors.push(`${u} (${fetcher.name}): 页面不含题面区块`);
      } catch (e: any) {
        errors.push(`${u} (${fetcher.name}): ${e?.message || e}`);
      }
    }
    await sleep(400);
  }
  throw new Error(`题面抓取失败（可能被反爬拦截）：${errors.join(' | ').slice(0, 600)}`);
}

// ===== 测试数据解析 =====

const INPUT_BLOCK_RE = /<div class="input">[\s\S]*?<pre>([\s\S]*?)<\/pre>/g;
const OUTPUT_BLOCK_RE = /<div class="output">[\s\S]*?<pre>([\s\S]*?)<\/pre>/g;

/** 按空行把合并的多用例拆开（新版 CF 页面把所有样例合并在一个大 input/output 块里） */
function splitByBlankLines(s: string): string[] {
  return s
    .split(/\n[ \t]*\n+/)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

/** 尝试把合并的 input/output 拆成多个用例；拆不动时返回 null */
function splitMergedTests(input: string, output: string): { input: string; output: string }[] | null {
  const inBlocks = splitByBlankLines(input);
  const outBlocks = splitByBlankLines(output);

  // 用例间空行分隔，块数一致
  if (inBlocks.length === outBlocks.length && inBlocks.length > 1) {
    return inBlocks.map((inp, i) => ({ input: inp, output: outBlocks[i] }));
  }

  // 常见格式：第一块是单独一行的用例数 T（如 "3\n\n<用例1>\n\n<用例2>..."）
  if (inBlocks.length === outBlocks.length + 1 && /^\d+$/.test(inBlocks[0])) {
    const t = Number(inBlocks[0]);
    if (t === outBlocks.length && t > 1) {
      return inBlocks.slice(1).map((inp, i) => ({ input: inp, output: outBlocks[i] }));
    }
  }

  return null;
}

export function parseTests(html: string): { input: string; output: string }[] {
  const inputs: string[] = [];
  const outputs: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = INPUT_BLOCK_RE.exec(html)) !== null) {
    inputs.push(decodeHtmlEntities(m[1]).trim());
  }
  while ((m = OUTPUT_BLOCK_RE.exec(html)) !== null) {
    outputs.push(decodeHtmlEntities(m[1]).trim());
  }

  const count = Math.min(inputs.length, outputs.length);
  const tests: { input: string; output: string }[] = [];
  for (let i = 0; i < count; i++) {
    tests.push({ input: inputs[i], output: outputs[i] });
  }

  // 新版页面：只有一个 input 块 + 一个 output 块，内部用空行分隔多个用例
  if (tests.length === 1) {
    const split = splitMergedTests(tests[0].input, tests[0].output);
    if (split) {
      return split;
    }
  }

  return tests;
}
