/**
 * ACM Workflow 工作流诊断服务。
 *
 * 职责：
 *  - 维护最近 100 条操作轨迹（命令 / 服务 / WebView 消息）；
 *  - 收集环境信息、Codeforces 直连网络探测；
 *  - 从操作轨迹中识别实际问题（重复事件、失败结果、超长耗时、重复启动未结束任务）；
 *  - 生成 Markdown + JSON 双份诊断报告，并做脱敏。
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { diagnoseEnv } from './runner';
import { getFetchDispatcher, curlProxyArgs, resolveProxyUrl } from './fetchers/codeforces';
import { resolveLocalEndpoint } from '../utils/wsl';

export type TraceSource = 'command' | 'service' | 'webview';

export interface TraceEntry {
  time: number;
  source: TraceSource;
  name: string;
  result: string;
}

export interface TraceIssue {
  id: string;
  title: string;
  detail: string;
  suggestion: string;
}

export interface DiagnosticMeta {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  nodeVersion: string;
  baseDir: string;
  dbPath: string;
  proxy: string;
  generatedAt: string;
}

export interface DiagnosticRuntime {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  nodeVersion: string;
  baseDir: string;
  dbPath: string;
  proxy: string;
}

export interface DiagnosticReportData {
  meta: DiagnosticMeta;
  environment: string[];
  network: string[];
  translation: string[];
  trace: TraceEntry[];
  issues: TraceIssue[];
}

const MAX_TRACE = 100;
const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const NETWORK_TIMEOUT_MS = 5000;
const DUPLICATE_WINDOW_MS = 1000;
const DUPLICATE_MIN_COUNT = 3;
const SLOW_THRESHOLD_MS = 10000;
const FAIL_PATTERN = /fail|error|超时|timeout/i;
const TASK_SOURCES: TraceSource[] = ['service', 'command'];

const CF_ENDPOINTS = [
  { name: 'Codeforces 主页', url: 'https://codeforces.com/' },
  { name: 'Codeforces API', url: 'https://codeforces.com/api/problemset.problems' }
];

const traceBuffer: TraceEntry[] = [];

/** 记录一条操作轨迹；超出 100 条时丢弃最旧条目。 */
export function trace(source: TraceSource, name: string, result = 'ok'): void {
  traceBuffer.push({ time: Date.now(), source, name, result });
  if (traceBuffer.length > MAX_TRACE) traceBuffer.shift();
}

/** 返回当前操作轨迹的副本。 */
export function getTrace(): TraceEntry[] {
  return traceBuffer.slice();
}

/** 清空操作轨迹（诊断开始时调用，现场记录从此刻起）。 */
export function clearTrace(): void {
  traceBuffer.length = 0;
}

/** 把常见敏感信息替换为占位符：主目录、邮箱、疑似 CF Token。 */
export function sanitizeText(text: string, homeDir = os.homedir()): string {
  let out = String(text ?? '');
  if (homeDir) out = out.split(homeDir).join('~');
  out = out.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '***@***');
  out = out.replace(/(?:cf_token|cfKey|api[_-]?key|key|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=***');
  return out;
}

function truncate(value: string, maxLength = 500): string {
  const s = String(value ?? '');
  return s.length > maxLength ? s.slice(0, maxLength) + '…' : s;
}

function truncateLines(lines: string[], maxLength = 500): string[] {
  return lines.map((l) => truncate(l, maxLength));
}

function nullDevice(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

interface NetworkProbeResult {
  target: string;
  method: 'fetch' | 'curl';
  ok: boolean;
  status?: number;
  timeMs: number;
  error?: string;
}

function probeWithFetch(url: string, timeoutMs: number, signal?: AbortSignal): Promise<NetworkProbeResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const t0 = Date.now();
    const dispatcher = getFetchDispatcher();
    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': CF_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      ...(dispatcher ? { dispatcher } : {})
    } as any)
      .then((res) => {
        if (res.body) void res.body.cancel().catch(() => {});
        resolve({ target: url, method: 'fetch', ok: res.ok, status: res.status, timeMs: Date.now() - t0 });
      })
      .catch((e: any) => {
        const message = e?.name === 'AbortError' ? `超时（>${timeoutMs}ms）` : String(e?.message || e);
        resolve({ target: url, method: 'fetch', ok: false, timeMs: Date.now() - t0, error: message });
      })
      .finally(() => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      });
  });
}

function probeWithCurl(url: string, timeoutMs: number, signal?: AbortSignal): Promise<NetworkProbeResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = [
      '-sS',
      '-4',
      '-o',
      nullDevice(),
      '-w',
      '%{http_code}',
      '-A',
      CF_UA,
      '--max-time',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      ...curlProxyArgs(),
      url
    ];
    const child = execFile('curl', args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const code = stdout.trim();
      const ok = !error && /^[23]\d\d$/.test(code);
      const errDetail = error
        ? `${error.message}${error.code ? ` (exit ${error.code})` : ''}${stderr ? ` stderr: ${stderr.trim().slice(0, 200)}` : ''}`
        : undefined;
      resolve({
        target: url,
        method: 'curl',
        ok,
        status: ok ? Number(code) : undefined,
        timeMs: Date.now() - t0,
        error: errDetail
      });
    });
    if (signal) {
      if (signal.aborted) child.kill();
      else signal.addEventListener('abort', () => child.kill(), { once: true });
    }
  });
}

/** 直连 Codeforces 主页与 API；fetch 失败时用 curl 兜底。 */
export async function diagnoseNetwork(signal?: AbortSignal): Promise<string[]> {
  const lines: string[] = ['网络诊断（Codeforces）:'];
  for (const ep of CF_ENDPOINTS) {
    if (signal?.aborted) {
      lines.push('  （用户取消）');
      break;
    }
    const fetchRes = await probeWithFetch(ep.url, NETWORK_TIMEOUT_MS, signal);
    if (fetchRes.ok) {
      lines.push(`  ${ep.name}: [OK] fetch ${fetchRes.status}（${fetchRes.timeMs}ms）`);
      continue;
    }
    if (signal?.aborted) {
      lines.push('  （用户取消）');
      break;
    }
    const curlRes = await probeWithCurl(ep.url, NETWORK_TIMEOUT_MS, signal);
    const fetchDesc = fetchRes.status !== undefined ? String(fetchRes.status) : (fetchRes.error || '失败');
    const curlDesc = curlRes.status !== undefined ? String(curlRes.status) : (curlRes.error || '失败');
    if (curlRes.ok) {
      lines.push(`  ${ep.name}: [OK] fetch ${fetchDesc}；curl OK ${curlDesc}`);
    } else {
      lines.push(`  ${ep.name}: [FAIL] fetch ${fetchDesc}；curl FAIL ${curlDesc}`);
    }
  }
  return lines;
}

/** 收集环境信息：扩展/VS Code/数据目录 + 原有环境探测。 */
export function collectEnvironment(meta: DiagnosticMeta): string[] {
  return [
    `ACM Workflow 版本: ${meta.extensionVersion}`,
    `VS Code 版本: ${meta.vscodeVersion}`,
    `生成时间: ${meta.generatedAt}`,
    `数据目录: ${sanitizeText(meta.baseDir)}`,
    `记录数据库: ${sanitizeText(meta.dbPath)}`,
    `代理: ${meta.proxy || '未配置（直连）'}`,
    ...diagnoseEnv()
  ];
}

function isTaskStart(entry: TraceEntry): boolean {
  return TASK_SOURCES.includes(entry.source) && (entry.result === 'start' || entry.result.startsWith('start '));
}

function isTaskEnd(entry: TraceEntry): boolean {
  return TASK_SOURCES.includes(entry.source) && entry.result !== 'start';
}

/** 重复事件：同一来源 + 事件名 + 结果在 1 秒内出现 ≥3 次。 */
export function findDuplicateEvents(trace: TraceEntry[]): TraceIssue[] {
  const issues: TraceIssue[] = [];
  const reported = new Set<string>();
  for (let i = 0; i < trace.length; i++) {
    const e = trace[i];
    const key = `${e.source}|${e.name}|${e.result}`;
    if (reported.has(key)) continue;
    let count = 0;
    for (let j = i; j < trace.length; j++) {
      const other = trace[j];
      if (other.source === e.source && other.name === e.name && other.result === e.result && other.time - e.time <= DUPLICATE_WINDOW_MS) {
        count++;
      }
    }
    if (count >= DUPLICATE_MIN_COUNT) {
      issues.push({
        id: 'DUP',
        title: '重复事件',
        detail: `${e.source} 事件「${e.name}」结果「${e.result}」在 1 秒内出现 ${count} 次（≥${DUPLICATE_MIN_COUNT}）。`,
        suggestion: '检查是否有重复点击、消息重复发送或事件未去重。'
      });
      reported.add(key);
    }
  }
  return issues;
}

/** 失败/错误结果：任何轨迹结果包含 fail/error/超时。 */
export function findFailureEvents(trace: TraceEntry[]): TraceIssue[] {
  const issues: TraceIssue[] = [];
  for (const e of trace) {
    if (FAIL_PATTERN.test(e.result)) {
      issues.push({
        id: 'FAIL',
        title: '失败/错误结果',
        detail: `${e.source} 事件「${e.name}」结果：${e.result}`,
        suggestion: '根据错误信息定位对应功能并重试。'
      });
    }
  }
  return issues;
}

/** 慢操作：service/command 从 start 到结束超过 10 秒。 */
export function findSlowOperations(trace: TraceEntry[], thresholdMs = SLOW_THRESHOLD_MS): TraceIssue[] {
  const issues: TraceIssue[] = [];
  const starts = new Map<string, number>();
  for (const e of trace) {
    const key = `${e.source}|${e.name}`;
    if (isTaskStart(e)) {
      starts.set(key, e.time);
    } else if (isTaskEnd(e)) {
      const startTime = starts.get(key);
      if (startTime !== undefined && e.time - startTime > thresholdMs) {
        issues.push({
          id: 'SLOW',
          title: '操作耗时过长',
          detail: `${e.source} 任务「${e.name}」耗时 ${((e.time - startTime) / 1000).toFixed(1)}s（>${thresholdMs / 1000}s）。`,
          suggestion: '检查网络、外部服务或是否存在阻塞。'
        });
      }
      starts.delete(key);
    }
  }
  return issues;
}

/** 重复启动未结束的任务：同一 service/command 任务在前一次未结束时再次 start。 */
export function findUnfinishedRepeatedTasks(trace: TraceEntry[]): TraceIssue[] {
  const issues: TraceIssue[] = [];
  const open = new Set<string>();
  for (const e of trace) {
    const key = `${e.source}|${e.name}`;
    if (isTaskStart(e)) {
      if (open.has(key)) {
        issues.push({
          id: 'UNFINISHED',
          title: '重复启动未结束的任务',
          detail: `${e.source} 任务「${e.name}」在前一次尚未结束时再次启动。`,
          suggestion: '检查是否重复触发同一命令/服务，或前一次是否卡住。'
        });
      } else {
        open.add(key);
      }
    } else if (isTaskEnd(e)) {
      open.delete(key);
    }
  }
  return issues;
}

/** 从操作轨迹中汇总所有实际异常。 */
export function analyzeTrace(trace: TraceEntry[]): TraceIssue[] {
  return [
    ...findDuplicateEvents(trace),
    ...findFailureEvents(trace),
    ...findSlowOperations(trace),
    ...findUnfinishedRepeatedTasks(trace)
  ];
}

/** 翻译配置/本地模型诊断：检查当前后端、本地服务与 en->zh 模型是否就绪。 */
export async function diagnoseTranslation(signal?: AbortSignal): Promise<string[]> {
  const lines: string[] = ['翻译配置诊断:'];
  let provider = 'auto';
  try {
    provider = vscode.workspace.getConfiguration('acmWorkflow').get<string>('translateProvider', 'auto') || 'auto';
  } catch { /* 单测环境用默认 */ }
  lines.push(`  当前后端: ${provider}`);

  if (provider === 'local') {
    let endpoint = 'http://127.0.0.1:5000/translate';
    try {
      endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('localEndpoint', endpoint) || endpoint;
    } catch { /* 单测环境用默认 */ }
    lines.push(`  本地端点: ${endpoint}`);
    const isOllama = !/\/translate\/?$/.test(endpoint);
    const effectiveEndpoint = resolveLocalEndpoint(endpoint);
    const probeUrl = isOllama
      ? effectiveEndpoint.replace(/\/+$/, '') + '/api/tags'
      : effectiveEndpoint.replace(/\/+$/, '').replace(/\/translate$/, '') + '/languages';
    const t0 = Date.now();
    try {
      const dispatcher = getFetchDispatcher();
      const res = await fetch(probeUrl, {
        headers: { 'User-Agent': 'ACM-Workflow-Diagnose' },
        signal: AbortSignal.timeout(2000),
        ...(dispatcher ? { dispatcher } : {})
      } as any);
      const ms = Date.now() - t0;
      if (res.ok) {
        lines.push(`  本地服务: [OK] HTTP ${res.status}（${ms}ms）`);
        const data: any = await res.json().catch(() => null);
        if (isOllama) {
          const models = data?.models || [];
          const has = models.some((m: any) => String(m?.name || '') === 'hy-mt2:latest');
          lines.push(`  本地模型: ${has ? '[OK] Ollama hy-mt2:latest en -> zh 已就绪' : '[WARN] 未找到 Ollama hy-mt2:latest（请运行 tools/setup_local_translate.sh）'}`);
        } else if (Array.isArray(data)) {
          const en = data.find((l: any) => String(l.code || '').toLowerCase() === 'en');
          const hasZh = en && Array.isArray(en.targets) && en.targets.some((t: any) => String(t).toLowerCase() === 'zh');
          lines.push(`  本地模型: ${hasZh ? '[OK] Ollama hy-mt2:latest en -> zh 已就绪' : '[WARN] 未找到 Ollama hy-mt2:latest（请运行 tools/setup_local_translate.sh）'}`);
        } else {
          lines.push('  本地模型: [WARN] /languages 返回格式异常');
        }
      } else {
        lines.push(`  本地服务: [FAIL] HTTP ${res.status}（${ms}ms）`);
        lines.push('  建议: 运行 tools/start_local_translate.sh 启动服务，或检查 acmWorkflow.localEndpoint');
      }
    } catch (e: any) {
      lines.push(`  本地服务: [FAIL] ${e?.name === 'AbortError' ? '连接超时' : String(e?.message || e)}`);
      lines.push('  建议: 本地服务未启动或端点配置错误；运行 tools/start_local_translate.sh');
    }
    const script = path.resolve(__dirname, '..', '..', 'tools', 'start_local_translate.sh');
    lines.push(`  启动脚本: ${fs.existsSync(script) ? '[OK] 存在' : '[MISSING] tools/start_local_translate.sh'}`);
  } else if (provider === 'auto') {
    lines.push('  说明: auto = MyMemory + Google 兜底；无需本地模型，但依赖外网和匿名免费额度');
  } else if (provider === 'libre') {
    let endpoint = 'https://libretranslate.com/translate';
    try {
      endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('libreEndpoint', endpoint) || endpoint;
    } catch { /* 单测环境用默认 */ }
    lines.push(`  LibreTranslate 端点: ${endpoint}`);
    lines.push('  说明: 需要自建/第三方 LibreTranslate 服务可用');
  } else if (provider === 'deepseek') {
    lines.push('  说明: deepseek 需要系统密钥链 acmWorkflow.deepseekKey 已保存');
  }
  if (signal?.aborted) lines.push('  （用户取消）');
  return lines;
}

/** 收集一次完整诊断报告。 */
export async function collectDiagnosticReport(
  runtime: DiagnosticRuntime,
  options: { signal?: AbortSignal } = {}
): Promise<DiagnosticReportData> {
  const meta: DiagnosticMeta = {
    extensionVersion: runtime.extensionVersion,
    vscodeVersion: runtime.vscodeVersion,
    platform: runtime.platform,
    nodeVersion: runtime.nodeVersion,
    baseDir: runtime.baseDir,
    dbPath: runtime.dbPath,
    proxy: runtime.proxy || resolveProxyUrl(),
    generatedAt: new Date().toISOString()
  };
  const traceEntries = getTrace();
  return {
    meta,
    environment: truncateLines(collectEnvironment(meta)),
    network: truncateLines(await diagnoseNetwork(options.signal)),
    translation: truncateLines(await diagnoseTranslation(options.signal)),
    trace: traceEntries.map((t) => ({ ...t, name: sanitizeText(truncate(t.name)), result: sanitizeText(truncate(t.result)) })),
    issues: analyzeTrace(traceEntries).map((i) => ({
      ...i,
      detail: sanitizeText(truncate(i.detail)),
      suggestion: sanitizeText(truncate(i.suggestion))
    }))
  };
}

/** 渲染 Markdown 诊断报告。 */
export function renderMarkdown(report: DiagnosticReportData): string {
  const lines: string[] = [];
  lines.push('# ACM Workflow 工作流诊断报告');
  lines.push('');
  lines.push(`- 扩展版本：${report.meta.extensionVersion}`);
  lines.push(`- VS Code 版本：${report.meta.vscodeVersion}`);
  lines.push(`- 平台：${report.meta.platform}`);
  lines.push(`- Node：${report.meta.nodeVersion}`);
  lines.push(`- 生成时间：${report.meta.generatedAt}`);
  lines.push('');

  lines.push('## 环境信息');
  lines.push('```text');
  lines.push(...report.environment);
  lines.push('```');
  lines.push('');

  lines.push('## 网络诊断');
  lines.push('```text');
  lines.push(...report.network);
  lines.push('```');
  lines.push('');

  lines.push('## 翻译配置诊断');
  lines.push('```text');
  lines.push(...(report.translation || []));
  lines.push('```');
  lines.push('');

  lines.push('## 操作轨迹');
  if (report.trace.length === 0) {
    lines.push('（无记录）');
  } else {
    lines.push('| 时间 | 来源 | 事件 | 结果 |');
    lines.push('| --- | --- | --- | --- |');
    for (const t of report.trace) {
      lines.push(`| ${new Date(t.time).toLocaleString('zh-CN')} | ${t.source} | ${t.name} | ${t.result} |`);
    }
  }
  lines.push('');

  lines.push('## 发现的问题');
  if (report.issues.length === 0) {
    lines.push('未发现轨迹异常。');
  } else {
    lines.push('| 类型 | 说明 | 建议 |');
    lines.push('| --- | --- | --- |');
    for (const issue of report.issues) {
      lines.push(`| ${issue.id} ${issue.title} | ${issue.detail} | ${issue.suggestion} |`);
    }
  }
  return lines.join('\n');
}

/** 渲染 JSON 诊断报告。 */
export function renderJson(report: DiagnosticReportData): string {
  return JSON.stringify(report, null, 2);
}

/** 把报告写入用户选择的目录，返回两个文件路径。 */
export async function writeDiagnosticFiles(dir: string, report: DiagnosticReportData): Promise<{ markdownPath: string; jsonPath: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `acm-workflow-diagnose-${stamp}`;
  const markdownPath = path.join(dir, base + '.md');
  const jsonPath = path.join(dir, base + '.json');
  await fs.promises.writeFile(markdownPath, renderMarkdown(report), 'utf8');
  await fs.promises.writeFile(jsonPath, renderJson(report), 'utf8');
  return { markdownPath, jsonPath };
}
