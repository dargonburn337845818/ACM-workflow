/**
 * 题面沉浸式翻译（英 → 中）—— V0.20：先排版后翻译
 *
 * 主端点：MyMemory（国内可达、无需 key、匿名限流约 5000 字符/天，
 * 配合段落缓存足够个人刷题）；失败时回退 Google 非官方端点（海外可达）。
 *
 * 输入是排版后的题面 HTML（services/statementHtml.ts 产出）：
 *  1. 按 .st-block.st-p 段落切分（与 Webview 双语渲染同一对齐方式）；
 *  2. 段落内的 .acm-math 公式先掩码（公式不翻译），得到清晰纯文本；
 *  3. 翻译完成后按段落号还原，公式以 $..$ / $$..$$ 标记插回译文；
 *  4. 失败自动重试最多 3 次、间隔 1s；仍失败该段保留原文（zh=null）。
 *
 * 输出与原文段落一一对应的数组：null 表示该段不翻译/翻译失败（前端只渲染原文）。
 */

const MYMEMORY = 'https://api.mymemory.translated.net/get';
const GOOGLE = 'https://translate.googleapis.com/translate_a/single';
const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const DEFAULT_LIBRE = 'https://libretranslate.com/translate';
const DEFAULT_LOCAL = 'http://127.0.0.1:5000/translate';
const CONCURRENCY = 4;
const DEFAULT_MAX_PARAS = 200;    // 默认最多翻译段落数（可配置，防长题面超时/耗配额）
const DEFAULT_MAX_SEGMENTS = 50;  // 默认单段最多拆句数（可配置，长提示不再被截断）
const MAX_PARA_LEN = 480;         // MyMemory 免费版单请求长度限制（保守值）
const MAX_TRANSLATE_ATTEMPTS = 3; // 单段最多尝试次数（Bug1：失败自动重试）
const RETRY_DELAY_MS = 1000;      // 重试间隔（Bug1）
// Argos 会把 ☃ 改写成 XQ，导致公式占位符无法还原；ZZnZZ 在 Argos 实测能原样保留。
const MATH_PLACEHOLDER = 'ZZ';

const cache = new Map<string, string>();

/** 翻译后端（V0.22）：auto=MyMemory+Google 兜底 / libre=LibreTranslate（端点可配）/ deepseek=DeepSeek API（密钥存 SecretStorage）/ local=本地离线 Argos（端点可配） */
import * as vscode from 'vscode';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { spawn } from 'child_process';

export type TranslateProvider = 'auto' | 'libre' | 'deepseek' | 'local';

export const DEEPSEEK_SECRET_KEY = 'acmWorkflow.deepseekKey';

/** 读取可配置的最大翻译段落数（默认 200，<=0 时回退默认） */
function getMaxTranslateParagraphs(): number {
  try {
    const v = vscode.workspace.getConfiguration('acmWorkflow').get<number>('maxTranslateParagraphs', DEFAULT_MAX_PARAS);
    return Number.isFinite(v) && (v ?? 0) > 0 ? Math.floor(v ?? DEFAULT_MAX_PARAS) : DEFAULT_MAX_PARAS;
  } catch {
    return DEFAULT_MAX_PARAS;
  }
}

/** 读取可配置的单段最大拆句数（默认 50，<=0 时回退默认） */
function getMaxTranslateSegments(): number {
  try {
    const v = vscode.workspace.getConfiguration('acmWorkflow').get<number>('maxTranslateSegments', DEFAULT_MAX_SEGMENTS);
    return Number.isFinite(v) && (v ?? 0) > 0 ? Math.floor(v ?? DEFAULT_MAX_SEGMENTS) : DEFAULT_MAX_SEGMENTS;
  } catch {
    return DEFAULT_MAX_SEGMENTS;
  }
}

/** 判断一段纯文本是否需要翻译 */
function isTranslatable(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/^```/.test(t) || /^~~~/.test(t)) return false;          // 代码块
  if (/\$\$/.test(t)) return false;                            // 块级公式
  if (t.length > MAX_PARA_LEN * getMaxTranslateSegments()) return false;
  if (/^#{1,6}\s/.test(t)) return false;                       // 标题段落保留原文
  if (/^[\s\d\W_]+$/.test(t)) return false;                    // 纯符号/数字
  if (!/[A-Za-z]{3,}/.test(t)) return false;                   // 不含英文单词（中文题面）
  return true;
}

/** 统计排版 HTML 中可翻译的段落数（Bug1：区分「翻译失败」与「无可翻译内容」） */
export function countTranslatableParagraphs(html: string): number {
  try {
    const $ = loadHtml(html);
    return $('.st-block.st-p').toArray().filter((el) => {
      const t = $(el).find('.st-en').first().text().replace(/\s+/g, ' ').trim();
      return isTranslatable(t);
    }).length;
  } catch {
    return 0;
  }
}

/** 长段落按句子拆分（保留原顺序），每句 ≤ MAX_PARA_LEN */
function splitSentences(text: string): string[] {
  const maxSegments = getMaxTranslateSegments();
  if (text.length <= MAX_PARA_LEN) return [text];
  const parts = text.split(/(?<=[.!?])\s+|\n/);
  const segs: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > MAX_PARA_LEN && cur) {
      segs.push(cur.trim());
      cur = p;
    } else {
      cur = (cur + ' ' + p).trim();
    }
  }
  if (cur) segs.push(cur.trim());
  return segs.slice(0, maxSegments);
}

/**
 * 读取当前配置的翻译后端（V0.22）：acmWorkflow.translateProvider
 * auto（默认）/ libre / deepseek / local；deepseek 密钥从 SecretStorage 读取。
 */
export async function resolveProvider(context?: import('vscode').ExtensionContext): Promise<{ provider: TranslateProvider; apiKey?: string }> {
  let provider: TranslateProvider = 'auto';
  try {
    const p = vscode.workspace.getConfiguration('acmWorkflow').get<string>('translateProvider', 'auto');
    if (p === 'libre' || p === 'deepseek' || p === 'local') provider = p;
  } catch {
    /* 无 VS Code 环境（单测）时用 auto */
  }
  let apiKey: string | undefined;
  if (provider === 'deepseek' && context) {
    apiKey = (await context.secrets.get(DEEPSEEK_SECRET_KEY)) || undefined;
  }
  return { provider, apiKey };
}

/** 按当前后端翻译一个句子；失败返回 null */
async function translateSegment(seg: string, provider: TranslateProvider, apiKey?: string): Promise<string | null> {
  if (provider === 'libre') {
    return libreTranslate(seg) || await mymemoryTranslate(seg) || await googleTranslate(seg);
  }
  if (provider === 'local') {
    return localTranslate(seg);
  }
  if (provider === 'deepseek' && apiKey) {
    return deepseekTranslate(seg, apiKey) || await mymemoryTranslate(seg) || await googleTranslate(seg);
  }
  return mymemoryTranslate(seg) || await googleTranslate(seg);
}

/**
 * 翻译单段（按配置后端 → auto 兜底）。
 * Bug1：对 null / undefined / 空字符串一律视为失败，自动重试最多 3 次，间隔 1s；
 * 若部分句子成功，则保留成功译文、失败句子保留英文，避免整段丢失。
 * 全部失败返回 null（由上层给出「翻译暂不可用」降级提示与手动重试入口）。
 */
async function translateOne(text: string, provider: TranslateProvider = 'auto', apiKey?: string): Promise<string | null> {
  const key = text;
  if (cache.has(key)) return cache.get(key) || null;
  const segs = splitSentences(text);
  for (let attempt = 1; attempt <= MAX_TRANSLATE_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.warn(`[ACM-Workflow][翻译] 第 ${attempt - 1} 次尝试失败，${RETRY_DELAY_MS / 1000}s 后重试（段长 ${text.length}）`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    try {
      const parts: string[] = [];
      let okCount = 0;
      for (const seg of segs) {
        const zh = await translateSegment(seg, provider, apiKey);
        if (zh) {
          okCount++;
          parts.push(zh);
        } else {
          parts.push(seg);
        }
      }
      if (okCount > 0) {
        const joined = parts.join(' ').trim();
        if (joined) {
          cache.set(key, joined);
          return joined;
        }
      }
    } catch (e) {
      console.warn(`[ACM-Workflow][翻译] 第 ${attempt} 次尝试异常：`, e);
    }
  }
  console.warn(`[ACM-Workflow][翻译] 重试 ${MAX_TRANSLATE_ATTEMPTS} 次后仍失败，返回 null（段长 ${text.length}）`);
  return null;
}

async function mymemoryTranslate(text: string): Promise<string | null> {
  try {
    const url = `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data?.responseStatus !== 200 || data?.quotaFinished) return null;
    const zh = String(data?.responseData?.translatedText || '').trim();
    return zh || null;
  } catch {
    return null;
  }
}

async function googleTranslate(text: string): Promise<string | null> {
  try {
    const url = `${GOOGLE}?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const zh = (data?.[0] || [])
      .map((seg: any) => (Array.isArray(seg) ? seg[0] : ''))
      .join('')
      .trim();
    return zh || null;
  } catch {
    return null;
  }
}

/** LibreTranslate（V0.22，端点可配置 acmWorkflow.libreEndpoint，默认公共实例） */
async function libreTranslate(text: string): Promise<string | null> {
  try {
    let endpoint = DEFAULT_LIBRE;
    try {
      endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('libreEndpoint', DEFAULT_LIBRE) || DEFAULT_LIBRE;
    } catch { /* 单测环境用默认 */ }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target: 'zh', format: 'text' }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const t = String(data?.translatedText || '').trim();
    return t && t !== text ? t : null;
  } catch {
    return null;
  }
}

/** 本地离线翻译（V0.23，端点可配置 acmWorkflow.localEndpoint，默认本机 Argos/LibreTranslate 服务） */

let localServerStarting: Promise<boolean> | null = null;

function getLocalProbeUrl(endpoint: string): string {
  return endpoint.replace(/\/+$/, '').replace(/\/translate$/, '') + '/languages';
}

function getLocalPort(endpoint: string): number {
  try {
    const u = new URL(endpoint);
    return u.port ? Number(u.port) : 5000;
  } catch {
    return 5000;
  }
}

function getLocalServerScript(): string {
  return path.resolve(__dirname, '..', '..', 'tools', 'start_local_translate.sh');
}

async function probeLocalServer(probeUrl: string): Promise<boolean> {
  try {
    const res = await fetch(probeUrl, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureLocalServer(endpoint: string): Promise<boolean> {
  const probeUrl = getLocalProbeUrl(endpoint);
  if (await probeLocalServer(probeUrl)) return true;
  if (localServerStarting) return localServerStarting;

  let autoStart = true;
  try {
    autoStart = vscode.workspace.getConfiguration('acmWorkflow').get<boolean>('localAutoStart', true) !== false;
  } catch { /* 单测环境默认 true */ }
  if (!autoStart) return false;

  const p = (async () => {
    const script = getLocalServerScript();
    const port = getLocalPort(endpoint);
    console.log(`[ACM-Workflow][翻译] 本地翻译服务未启动，尝试自动拉起: ${script} --port ${port}`);
    let spawnFailed = false;
    const child = spawn('bash', [script, '--port', String(port)], {
      cwd: path.resolve(__dirname, '..', '..'),
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });
    child.stderr?.on('data', (d) => {
      console.warn(`[ACM-Workflow][翻译] 本地翻译服务 stderr: ${String(d).trim()}`);
    });
    child.on('error', (err) => {
      spawnFailed = true;
      console.warn(`[ACM-Workflow][翻译] 自动启动本地翻译服务失败：`, err);
    });
    for (let i = 0; i < 16; i++) {
      if (spawnFailed) return false;
      await new Promise((r) => setTimeout(r, 500));
      if (await probeLocalServer(probeUrl)) return true;
    }
    console.warn('[ACM-Workflow][翻译] 本地翻译服务自动启动超时，请手动运行 tools/start_local_translate.sh');
    return false;
  })();
  localServerStarting = p;
  try {
    return await p;
  } finally {
    // 启动结束后清除状态，下次失败/服务退出后允许重新尝试自动拉起。
    if (localServerStarting === p) localServerStarting = null;
  }
}

async function localTranslate(text: string): Promise<string | null> {
  try {
    let endpoint = DEFAULT_LOCAL;
    try {
      endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('localEndpoint', DEFAULT_LOCAL) || DEFAULT_LOCAL;
    } catch { /* 单测环境用默认 */ }
    if (!(await ensureLocalServer(endpoint))) return null;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target: 'zh', format: 'text' }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const t = String(data?.translatedText || '').trim();
    return t && t !== text ? t : null;
  } catch {
    return null;
  }
}

/** DeepSeek Chat API（V0.22，密钥来自 SecretStorage 键 acmWorkflow.deepseekKey） */
async function deepseekTranslate(text: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a professional competitive-programming translator. Translate the given English text into Simplified Chinese. Keep math expressions (like $x$, $a_i$), code identifiers, numbers and LaTeX unchanged. Output only the translation, no explanations.'
          },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const t = String(data?.choices?.[0]?.message?.content || '').trim();
    return t || null;
  } catch {
    return null;
  }
}

/** 并发受限的 map */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 翻译排版后的题面 HTML（V0.20）：
 * 段落按 .st-block.st-p 对齐（与 Webview 双语渲染一致）；
 * 段内 .acm-math 公式先掩码为占位符（公式不翻译），翻译完成后按段落还原，
 * 公式以 $..$ / $$..$$ 标记插回译文（Webview 用 KaTeX auto-render 渲染）。
 * 返回与段落一一对应的数组：null = 不翻译/翻译失败（保留原文）。
 */
export async function translateStatementHtml(html: string, opts?: { context?: import('vscode').ExtensionContext }): Promise<(string | null)[]> {
  const { provider, apiKey } = await resolveProvider(opts?.context);
  const $ = loadHtml(html);
  const blocks = $('.st-block.st-p').toArray();
  const out: (string | null)[] = new Array(blocks.length).fill(null);
  if (blocks.length === 0) {
    console.log('[ACM-Workflow][翻译] 无可翻译段落');
    return out;
  }

  // 每个段落：掩码公式 → 取清晰纯文本
  const jobs: { index: number; text: string; math: { src: string; block: boolean }[] }[] = [];
  blocks.forEach((el, i) => {
    const $el = $(el);
    const math: { src: string; block: boolean }[] = [];
    $el.find('.acm-math').each((_m, node) => {
      const $m = $(node);
      const src = $m.text();
      const block = $m.hasClass('acm-math-block');
      $m.replaceWith(`${MATH_PLACEHOLDER}${math.length}${MATH_PLACEHOLDER}`);
      math.push({ src, block });
    });
    const text = $el.find('.st-en').first().text().replace(/\s+/g, ' ').trim();
    if (isTranslatable(text)) {
      jobs.push({ index: i, text, math });
      if (jobs.length >= getMaxTranslateParagraphs()) return;
    }
  });

  if (jobs.length === 0) {
    console.log('[ACM-Workflow][翻译] 无可翻译段落（代码块/公式/标题/纯符号保留原文）');
    return out;
  }
  console.log(`[ACM-Workflow][翻译] 开始翻译：${jobs.length} 段（共 ${blocks.length} 段，并发 ${CONCURRENCY}，后端 ${provider}）`);
  const results = await mapLimit(jobs, CONCURRENCY, (j) => translateOne(j.text, provider, apiKey));
  const okCount = results.filter((r) => !!r).length;
  console.log(`[ACM-Workflow][翻译] 完成：成功 ${okCount}/${jobs.length} 段${okCount < jobs.length ? '，失败段落保留原文' : ''}`);

  jobs.forEach((j, k) => {
    if (!results[k]) { out[j.index] = null; return; }
    let zh = results[k];
    const used = new Set<number>();
    // V0.25：ZZnZZ 占位符在 Argos 下能原样保留；同时兼容旧版 MATH/☃ 占位符。
    zh = zh.replace(/\u0000?(?:MATH|ZZ|☃)\s*(\d+)\s*(?:MATH|ZZ|☃)\u0000?/g, (_m, n) => {
      const mi = Number(n);
      used.add(mi);
      const math = j.math[mi];
      if (!math) return _m;
      return (math.block ? '$$' : '$') + math.src + (math.block ? '$$' : '$');
    });
    // 翻译服务丢弃的公式占位符补回段尾（公式不应被翻译/丢失）
    for (let mi = 0; mi < j.math.length; mi++) {
      if (!used.has(mi)) {
        const math = j.math[mi];
        zh += ' ' + (math.block ? '$$' : '$') + math.src + (math.block ? '$$' : '$');
      }
    }
    out[j.index] = zh;
  });
  return out;
}

/** 仅供测试：清空翻译缓存 */
export function clearTranslateCache(): void {
  cache.clear();
}

function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html);
}

type CheerioAPI = import('cheerio').CheerioAPI;
