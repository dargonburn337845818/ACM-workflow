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
const DEFAULT_LOCAL = 'http://127.0.0.1:11434';
const DEFAULT_LOCAL_MODEL = 'hy-mt2:latest';
const CONCURRENCY = 4;
const MAX_PARAS = 30;          // 最多翻译段落数（防长题面超时/耗配额）
const MAX_PARA_LEN = 480;      // MyMemory 免费版单请求长度限制（保守值）
const MAX_SEGMENTS = 6;        // 单段最多拆句数（再长放弃，保留原文）
const MAX_TRANSLATE_ATTEMPTS = 3; // 单段最多尝试次数（Bug1：失败自动重试）
const RETRY_DELAY_MS = 1000;      // 重试间隔（Bug1）

const cache = new Map<string, string>();

/** 翻译后端（V0.22）：auto=MyMemory+Google 兜底 / libre=LibreTranslate（端点可配）/ deepseek=DeepSeek API（密钥存 SecretStorage）/ local=本地 Ollama hy-mt2:latest（端点可配） */
import * as vscode from 'vscode';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { applyGlossary } from './glossary';
import { resolveLocalEndpoint } from '../utils/wsl';

export type TranslateProvider = 'auto' | 'libre' | 'deepseek' | 'local';

export const DEEPSEEK_SECRET_KEY = 'acmWorkflow.deepseekKey';

/** 判断一段纯文本是否需要翻译 */
function isTranslatable(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/^```/.test(t) || /^~~~/.test(t)) return false;          // 代码块
  if (/\$\$/.test(t)) return false;                            // 块级公式
  if (t.length > MAX_PARA_LEN * MAX_SEGMENTS) return false;
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
  return segs.slice(0, MAX_SEGMENTS);
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

/**
 * 翻译单段（按配置后端 → auto 兜底）。
 * Bug1：对 null / undefined / 空字符串一律视为失败，自动重试最多 3 次，间隔 1s；
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
      let ok = true;
      for (const seg of segs) {
        let zh: string | null = null;
        if (provider === 'libre') {
          zh = await libreTranslate(seg) || await mymemoryTranslate(seg) || await googleTranslate(seg);
        } else if (provider === 'local') {
          zh = await localTranslate(seg);
        } else if (provider === 'deepseek' && apiKey) {
          zh = await deepseekTranslate(seg, apiKey) || await mymemoryTranslate(seg) || await googleTranslate(seg);
        } else {
          zh = await mymemoryTranslate(seg) || await googleTranslate(seg);
        }
        if (!zh) { ok = false; break; } // null/空串 → 失败，进入重试
        parts.push(zh);
      }
      if (ok) {
        const joined = parts.join(' ').trim();
        if (joined) {
          const withGlossary = applyGlossary(text, joined);
          cache.set(key, withGlossary);
          return withGlossary;
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
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const t = String(data?.translatedText || '').trim();
    return t && t !== text ? t : null;
  } catch {
    return null;
  }
}

/** 本地离线翻译（V0.23，端点可配置 acmWorkflow.localEndpoint，默认本机 Ollama hy-mt2:latest） */

let localServerStarting: Promise<boolean> | null = null;
let localServerProcess: ChildProcess | null = null;
let localServerStopRequested = false;

function isOllamaEndpoint(endpoint: string): boolean {
  return !/\/translate\/?$/.test(endpoint);
}

async function ollamaModelAvailable(endpoint: string): Promise<boolean> {
  try {
    const target = resolveLocalEndpoint(endpoint);
    const res = await fetch(target.replace(/\/+$/, '') + '/api/tags', {
      signal: AbortSignal.timeout(2000)
    });
    if (!res.ok) return false;
    const data: any = await res.json();
    const models = data?.models || [];
    return models.some((m: any) => String(m?.name || '') === DEFAULT_LOCAL_MODEL);
  } catch {
    return false;
  }
}

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

async function probeLocalServer(endpoint: string): Promise<boolean> {
  if (isOllamaEndpoint(endpoint)) {
    return ollamaModelAvailable(endpoint);
  }
  const probeUrl = getLocalProbeUrl(endpoint);
  try {
    const res = await fetch(probeUrl, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Windows 路径转 WSL 路径：支持 C:\a\b -> /mnt/c/a/b，以及 \\wsl.localhost\Distro\... -> /... */
function toWslPath(p: string): string | null {
  const drive = /^([A-Za-z]):\\(.*)$/.exec(p);
  if (drive) {
    return '/mnt/' + drive[1].toLowerCase() + '/' + drive[2].replace(/\\/g, '/');
  }
  const unc = /^\\\\wsl(?:\.localhost|\$)\\+[^\\]+\\(.*)$/i.exec(p);
  if (unc) {
    return '/' + unc[1].replace(/\\/g, '/');
  }
  return null;
}

async function ensureLocalServer(endpoint: string): Promise<boolean> {
  if (await probeLocalServer(endpoint)) return true;
  localServerStopRequested = false;
  if (localServerStarting) return localServerStarting;

  let autoStart = true;
  try {
    autoStart = vscode.workspace.getConfiguration('acmWorkflow').get<boolean>('localAutoStart', true) !== false;
  } catch { /* 单测环境默认 true */ }
  if (!autoStart) return false;

  localServerStarting = (async () => {
    const script = getLocalServerScript();
    const port = getLocalPort(endpoint);
    const root = path.resolve(__dirname, '..', '..');
    const baseArgs = isOllamaEndpoint(endpoint)
      ? [script, '--ollama-only']
      : [script, '--port', String(port)];
    const attempts: { cmd: string; args: string[] }[] = [];
    if (process.platform === 'win32') {
      // 原生 Windows：优先直接拉起 ollama.exe serve。
      // 之前通过 wsl.exe 调 bash 脚本，而脚本里的 cmd.exe start 在 WSL 互操作下会挂起，
      // 导致自动启动超时。这里直接用 Windows 进程启动，最稳。
      if (isOllamaEndpoint(endpoint)) {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const ollamaExe = process.env.OLLAMA_EXE || path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
        attempts.push(
          fs.existsSync(ollamaExe)
            ? { cmd: ollamaExe, args: ['serve'] }
            : { cmd: 'ollama.exe', args: ['serve'] }
        );
      }
      const wslScript = toWslPath(script);
      // WSL UNC 路径时只走 wsl.exe，避免 Windows 直接执行 UNC 路径报“找不到 \ 文件”
      if (wslScript) {
        attempts.push({ cmd: 'wsl.exe', args: ['bash', '-lc', `"${wslScript}" ${baseArgs.slice(1).map(a => `'${a}'`).join(' ')}`] });
      } else {
        attempts.push({ cmd: 'bash.exe', args: baseArgs });
      }
    } else {
      attempts.push({ cmd: 'bash', args: baseArgs });
    }

    for (const attempt of attempts) {
      if (localServerStopRequested) return false;
      console.log(`[ACM-Workflow][翻译] 本地翻译服务未启动，尝试自动拉起: ${attempt.cmd} ${attempt.args.join(' ')}`);
      let spawnFailed = false;
      const child = spawn(attempt.cmd, attempt.args, {
        cwd: root,
        stdio: 'ignore',
        detached: false,
      });
      localServerProcess = child;
      child.on('error', (err) => {
        spawnFailed = true;
        if (localServerProcess === child) localServerProcess = null;
        console.warn(`[ACM-Workflow][翻译] 自动启动本地翻译服务失败（${attempt.cmd}）：`, err);
      });
      child.on('exit', () => {
        if (localServerProcess === child) localServerProcess = null;
      });
      for (let i = 0; i < 80; i++) {
        if (spawnFailed || localServerStopRequested) break;
        await new Promise((r) => setTimeout(r, 500));
        if (await probeLocalServer(endpoint)) return true;
      }
      if (localServerStopRequested) return false;
      if (await probeLocalServer(endpoint)) return true;
    }

    console.warn('[ACM-Workflow][翻译] 本地翻译服务自动启动超时，请手动运行 tools/start_local_translate.sh');
    return false;
  })();
  localServerStarting.finally(() => { localServerStarting = null; }).catch(() => {});
  return localServerStarting;
}

/** 停止由扩展拉起的本地翻译服务（VS Code 关闭时调用）。 */
export function stopLocalServer(): void {
  localServerStopRequested = true;
  if (localServerProcess && !localServerProcess.killed) {
    console.log('[ACM-Workflow][翻译] 停止本地翻译服务');
    localServerProcess.kill();
  }
  localServerProcess = null;
  localServerStarting = null;
}

/** 直接调用本机 Ollama hy-mt2:latest 翻译（默认 local 后端）。 */
async function ollamaChatTranslate(text: string, endpoint: string, model: string): Promise<string | null> {
  try {
    const system = (
      'You are a professional competitive-programming translator. ' +
      'Translate the given English text into Simplified Chinese. ' +
      'Keep math expressions (like $x$, $a_i$), code identifiers, numbers, ' +
      'LaTeX and placeholder tokens (like MATH0, MATH1) unchanged. ' +
      'Output only the translation, no explanations.'
    );
    const payload = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text }
      ],
      stream: false,
      keep_alive: '3m',
      options: {
        temperature: 0.3,
        num_ctx: 2048,
        num_predict: 512,
        repeat_penalty: 1.1
      }
    };
    const target = resolveLocalEndpoint(endpoint);
    const res = await fetch(target.replace(/\/+$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[ACM-Workflow][翻译] Ollama 翻译请求失败 HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data: any = await res.json();
    const t = String(data?.message?.content || '').trim();
    return t && t !== text ? t : null;
  } catch (e: any) {
    console.warn('[ACM-Workflow][翻译] Ollama 翻译请求异常：', e?.message || e);
    return null;
  }
}

async function localTranslate(text: string): Promise<string | null> {
  try {
    let endpoint = DEFAULT_LOCAL;
    try {
      endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('localEndpoint', DEFAULT_LOCAL) || DEFAULT_LOCAL;
    } catch { /* 单测环境用默认 */ }
    if (!(await ensureLocalServer(endpoint))) return null;
    if (isOllamaEndpoint(endpoint)) {
      return await ollamaChatTranslate(text, endpoint, DEFAULT_LOCAL_MODEL);
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target: 'zh', format: 'text' }),
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[ACM-Workflow][翻译] 本地翻译请求失败 HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
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

/** 本地翻译服务是否可用：探测并尝试自动启动；不可用返回 false，避免逐段重试长时间卡顿。 */
async function isLocalServerReady(): Promise<boolean> {
  let endpoint = DEFAULT_LOCAL;
  try {
    endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('localEndpoint', DEFAULT_LOCAL) || DEFAULT_LOCAL;
  } catch { /* 单测环境用默认 */ }
  return ensureLocalServer(endpoint);
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
  if (provider === 'local') {
    const ready = await isLocalServerReady();
    if (!ready) {
      console.warn('[ACM-Workflow][翻译] 本地翻译服务不可用，跳过翻译（题面仍正常显示）');
      return new Array($('.st-block.st-p').length).fill(null);
    }
  }
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
      $m.replaceWith(`MATH${math.length}`);
      math.push({ src, block });
    });
    const text = $el.find('.st-en').first().text().replace(/\s+/g, ' ').trim();
    if (isTranslatable(text)) {
      jobs.push({ index: i, text, math });
      if (jobs.length >= MAX_PARAS) return;
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
    // V0.26：用 MATH{n} 占位符（Ollama hy-mt2:latest 实测可原样保留）；同时兼容旧 ☃、{n}}、XQn☃ 等被本地模型改写的形式
    const restoreMath = (_m: string, n: string) => {
      const mi = Number(n);
      used.add(mi);
      const math = j.math[mi];
      if (!math) return _m;
      return (math.block ? '$$' : '$') + math.src + (math.block ? '$$' : '$');
    };
    zh = zh
      .replace(/\bMATH\s*(\d+)\b/g, restoreMath)
      .replace(/\u0000?☃\s*(\d+)\s*☃\u0000?/g, restoreMath)
      .replace(/\{(\d+)\}\}/g, restoreMath)
      .replace(/\{(\d+)\}/g, restoreMath)
      .replace(/(?:XQ|QQ|☃)?\s*(\d+)\s*☃/g, restoreMath)
      .replace(/(?:XQ|QQ)\s*(\d+)\b/g, restoreMath);
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
