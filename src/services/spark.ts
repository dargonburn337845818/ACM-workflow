/**
 * Spark 本地模型服务（V0.22+）：
 * 与本地翻译服务（translate.ts）平行的第二套 llama.cpp 生命周期管理。
 *
 * 用途：在「造数据」页根据当前题目生成 Python 数据生成脚本。
 *
 * 设计要点：
 *  - 默认使用用户已验证的 Spark 构建 D:\llama-spark\build\bin\llama-server.exe；
 *  - 低占用调优：ctx 16384、单 slot、关闭 webui，GPU 全量加载保证生成速度；
 *  - 空闲 3 分钟自动停止并释放显存；下次点击生成自动拉起；
 *  - 不主动抢占翻译服务（翻译优先）；翻译与 Spark 能共存时保持并发。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { normalizePath } from '../utils/paths';
import { resolveLocalEndpoint } from '../utils/wsl';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080';
const DEFAULT_MODEL_NAME = 'spark:latest';
const DEFAULT_SERVER_PATH = 'D:\\llama-spark\\build\\bin\\llama-server.exe';
const DEFAULT_MODEL_PATH = 'D:\\llama\\Spark-X2.5-4B-Q8_0\\Spark-X2.5-4B-Q8_0.gguf';
const DEFAULT_SCRIPT_PATH = 'D:\\vscode_code\\code\\shell\\gen.py';
const DEFAULT_CTX_SIZE = 16384;
const DEFAULT_BATCH_SIZE = 512;
const DEFAULT_THREADS = 8;
const DEFAULT_GPU_LAYERS = 99;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_IDLE_TIMEOUT_MS = 180000;

let sparkProcess: ChildProcess | null = null;
let sparkStarting: Promise<boolean> | null = null;
let sparkStopRequested = false;
let sparkStartedByUs = false;
let sparkIdleTimer: NodeJS.Timeout | null = null;

function cfg<T>(key: string, def: T): T {
  try {
    const v = vscode.workspace.getConfiguration('acmWorkflow').get<T>(key, def);
    return v ?? def;
  } catch {
    return def;
  }
}

function getEndpoint(): string {
  return cfg('sparkEndpoint', DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT;
}

function getPort(): number {
  try {
    const u = new URL(getEndpoint());
    return u.port ? Number(u.port) : 8080;
  } catch {
    return 8080;
  }
}

function getModelName(): string {
  return cfg('sparkModelName', DEFAULT_MODEL_NAME) || DEFAULT_MODEL_NAME;
}

function getServerPath(): string {
  return normalizePath(cfg('sparkServerPath', DEFAULT_SERVER_PATH));
}

function getModelPath(): string {
  return normalizePath(cfg('sparkModelPath', DEFAULT_MODEL_PATH));
}

function getScriptPath(): string {
  return normalizePath(cfg('sparkScriptPath', DEFAULT_SCRIPT_PATH));
}

function getLogPath(): string {
  return path.resolve(__dirname, '..', '..', 'tools', 'spark-server.log');
}

function getPidFile(): string {
  return path.resolve(__dirname, '..', '..', 'tools', '.spark-server.pid');
}

function getSparkScript(): string {
  return path.resolve(__dirname, '..', '..', 'tools', 'start_spark.sh');
}

function llamaApiBase(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : base + '/v1';
}

async function probeSparkServer(): Promise<boolean> {
  const target = resolveLocalEndpoint(getEndpoint());
  try {
    const res = await fetch(target.replace(/\/+$/, '') + '/health', {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) return true;
  } catch {
    /* 继续探测 models */
  }
  try {
    const res = await fetch(llamaApiBase(target) + '/models', {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data: any = await res.json();
      const models = data?.data || [];
      if (models.some((m: any) => String(m?.id || '') === getModelName())) return true;
    }
  } catch {
    /* 服务未启动 */
  }
  return false;
}

function buildSparkArgs(port: number): string[] {
  const args = [
    '-m', getModelPath(),
    '--host', '0.0.0.0',
    '--port', String(port),
    '--ctx-size', String(cfg('sparkCtxSize', DEFAULT_CTX_SIZE)),
    '--batch-size', String(cfg('sparkBatchSize', DEFAULT_BATCH_SIZE)),
    '--ubatch-size', String(cfg('sparkBatchSize', DEFAULT_BATCH_SIZE)),
    '--threads', String(cfg('sparkThreads', DEFAULT_THREADS)),
    '--parallel', '1',
    '--no-webui',
    '--jinja',
    '--alias', getModelName(),
    '-ngl', String(cfg('sparkGpuLayers', DEFAULT_GPU_LAYERS)),
    '--flash-attn', 'on',
    '--log-file', getLogPath()
  ];
  return args;
}

function buildWslSparkEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SPARK_SERVER: getServerPath(),
    SPARK_MODEL: getModelPath(),
    SPARK_MODEL_ALIAS: getModelName(),
    SPARK_PORT: String(getPort()),
    SPARK_CTX: String(cfg('sparkCtxSize', DEFAULT_CTX_SIZE)),
    SPARK_BATCH: String(cfg('sparkBatchSize', DEFAULT_BATCH_SIZE)),
    SPARK_THREADS: String(cfg('sparkThreads', DEFAULT_THREADS)),
    SPARK_GPU_LAYERS: String(cfg('sparkGpuLayers', DEFAULT_GPU_LAYERS)),
    SPARK_LOG_FILE: getLogPath(),
    SPARK_PID_FILE: getPidFile()
  };
}

async function ensureSparkServer(): Promise<boolean> {
  if (await probeSparkServer()) return true;
  if (sparkStarting) return sparkStarting;
  sparkStopRequested = false;

  const autoStart = cfg<boolean>('sparkAutoStart', true) !== false;
  if (!autoStart) return false;

  sparkStarting = (async () => {
    const port = getPort();
    const root = path.resolve(__dirname, '..', '..');
    if (process.platform === 'win32') {
      const exe = getServerPath();
      if (!fs.existsSync(exe)) {
        console.warn(`[ACM-Workflow][Spark] 找不到 llama-server：${exe}`);
        return false;
      }
      const child = spawn(exe, buildSparkArgs(port), {
        cwd: path.dirname(exe),
        stdio: 'ignore',
        detached: false,
        windowsHide: true
      });
      sparkProcess = child;
      sparkStartedByUs = true;
      child.on('error', (err) => {
        if (sparkProcess === child) sparkProcess = null;
        console.warn('[ACM-Workflow][Spark] 启动 llama-server 失败：', err);
      });
      child.on('exit', () => {
        if (sparkProcess === child) sparkProcess = null;
        sparkStartedByUs = false;
      });
    } else {
      // WSL / Linux：通过 start_spark.sh 启动 Windows 侧 llama-server
      const script = getSparkScript();
      if (!fs.existsSync(script)) {
        console.warn(`[ACM-Workflow][Spark] 找不到启动脚本：${script}`);
        return false;
      }
      const child = spawn('bash', [script], {
        cwd: root,
        stdio: 'ignore',
        detached: false,
        env: buildWslSparkEnv()
      });
      sparkProcess = child;
      sparkStartedByUs = true;
      child.on('error', (err) => {
        if (sparkProcess === child) sparkProcess = null;
        console.warn('[ACM-Workflow][Spark] 启动脚本运行失败：', err);
      });
      child.on('exit', () => {
        if (sparkProcess === child) sparkProcess = null;
      });
    }

    for (let i = 0; i < 120; i++) {
      if (sparkStopRequested) return false;
      await new Promise((r) => setTimeout(r, 500));
      if (await probeSparkServer()) return true;
    }
    console.warn('[ACM-Workflow][Spark] 自动启动超时，请手动运行 tools/start_spark.sh');
    return false;
  })();

  sparkStarting.finally(() => { sparkStarting = null; }).catch(() => {});
  return sparkStarting;
}

/** 空闲自动停止：每次成功使用后重置 3 分钟计时器。 */
function scheduleSparkStop(): void {
  if (sparkIdleTimer) clearTimeout(sparkIdleTimer);
  const timeout = cfg('sparkIdleTimeoutMs', DEFAULT_IDLE_TIMEOUT_MS);
  if (!timeout || timeout <= 0) return;
  sparkIdleTimer = setTimeout(() => {
    sparkIdleTimer = null;
    if (sparkProcess || sparkStartedByUs) {
      console.log(`[ACM-Workflow][Spark] 空闲 ${Math.round(timeout / 1000)}s，自动停止并释放显存`);
      stopSparkServer();
    }
  }, timeout);
  if (typeof sparkIdleTimer.unref === 'function') sparkIdleTimer.unref();
}

function stopAutoStartedSparkWindows(): void {
  const pidFile = getPidFile();
  try {
    if (!fs.existsSync(pidFile)) return;
    const pid = fs.readFileSync(pidFile, 'utf8').trim();
    if (pid) {
      console.log(`[ACM-Workflow][Spark] 停止本次自动拉起的 llama-server (PID ${pid})`);
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force`], {
        stdio: 'ignore',
        detached: false
      });
      child.on('error', (e: any) => {
        console.warn('[ACM-Workflow][Spark] 停止 llama-server 的 powershell 调用失败：', e?.message || e);
      });
    }
    fs.unlinkSync(pidFile);
  } catch (e: any) {
    console.warn('[ACM-Workflow][Spark] 清理自动拉起的 llama-server 失败：', e?.message || e);
  }
}

export function stopSparkServer(): void {
  sparkStopRequested = true;
  if (sparkIdleTimer) {
    clearTimeout(sparkIdleTimer);
    sparkIdleTimer = null;
  }
  if (sparkProcess && !sparkProcess.killed) {
    console.log('[ACM-Workflow][Spark] 停止本地 Spark 服务');
    try { sparkProcess.kill(); } catch { /* 已退出 */ }
  }
  sparkProcess = null;
  sparkStarting = null;
  sparkStartedByUs = false;
  stopAutoStartedSparkWindows();
}

/** 从模型输出中提取 Python 代码（兼容 markdown 代码块和纯文本）。 */
export function extractPythonCode(raw: string): string {
  const text = String(raw || '');
  const fence = /```(?:python|py)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    const code = fence[1].trim();
    if (code) return code;
  }
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s*(import|from|def|class|#|if __name__)/.test(l));
  if (start >= 0) return lines.slice(start).join('\n').trim();
  return text.trim();
}

function pythonCommand(): string {
  const candidates = process.platform === 'win32' ? ['python'] : ['python3', 'python'];
  for (const c of candidates) {
    try {
      // 这里不实际执行 --version，避免每次都因杀毒/慢启动拖慢生成流程；
      // 直接交给后续 spawn 运行，失败时能给出明确错误。
      return c;
    } catch {
      /* 继续 */
    }
  }
  return candidates[0];
}

function runPythonCode(code: string, timeoutMs = 15000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), 'acm-workflow-spark', `gen_${Date.now()}.py`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, code, 'utf8');
    const cmd = pythonCommand();
    const child = spawn(cmd, [tmp], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (!settled) {
        settled = true;
        resolve({ ok: false, stdout, stderr: stderr || '生成脚本运行超时（>15s）' });
      }
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, stdout, stderr: `无法运行 Python：${e.message}` });
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0 && stdout.trim().length > 0, stdout, stderr });
    });
  });
}

export function buildDataGenPrompt(problem: { title: string; id?: string; url?: string; statement?: string }): string {
  return [
    '你是一名算法竞赛造数据专家。请根据下面的题目描述，编写一个 Python 3 脚本。',
    '脚本的任务：每次运行都输出一组**符合题面所有约束**的合法输入数据到 stdout。',
    '',
    '硬性要求：',
    '1. 只使用 Python 标准库（random、string 等），不要依赖第三方库。',
    '2. 必须严格满足题面给出的输入格式、数据范围、特殊约束。',
    '3. 输出只包含题目要求的输入数据，不要输出解释、提示或多余字符。',
    '4. 代码必须是完整可执行的 Python 脚本，不需要 Markdown 代码块。',
    '5. 如果题目有变量间依赖（如 n 和后面数组长度），请保证生成数据自洽。',
    '6. 在覆盖边界/特殊情况的前提下，生成的数据要尽可能多样化。',
    '',
    `题目：${problem.title || ''}${problem.id ? ` (${problem.id})` : ''}`,
    problem.url ? `链接：${problem.url}` : '',
    '',
    '===== 题面开始 =====',
    problem.statement || '',
    '===== 题面结束 =====',
    '',
    '请只输出 Python 代码本身。'
  ].join('\n');
}

export class SparkService {
  async isRunning(): Promise<boolean> {
    return probeSparkServer();
  }

  async ensureReady(): Promise<boolean> {
    const ok = await ensureSparkServer();
    if (ok) scheduleSparkStop();
    return ok;
  }

  /** 根据题目上下文生成 Python 造数据脚本并返回代码。 */
  async generateScriptForProblem(problem: { title: string; id?: string; url?: string; statement?: string }): Promise<string> {
    return this.generateScript(buildDataGenPrompt(problem));
  }

  /** 调用 Spark 生成 Python 造数据脚本并返回代码。 */
  async generateScript(prompt: string): Promise<string> {
    if (!(await ensureSparkServer())) {
      throw new Error('Spark 本地模型启动失败，请检查 tools/start_spark.sh 或设置中的 Spark 路径。');
    }
    scheduleSparkStop();

    const target = resolveLocalEndpoint(getEndpoint());
    const payload = {
      model: getModelName(),
      messages: [
        { role: 'system', content: '你是一名算法竞赛造数据专家，只输出可运行的 Python 3 代码。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: cfg('sparkMaxTokens', DEFAULT_MAX_TOKENS),
      stream: false
    };
    const res = await fetch(llamaApiBase(target) + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg('sparkRequestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS))
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Spark 生成请求失败 HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const content = String(data?.choices?.[0]?.message?.content || '');
    const code = extractPythonCode(content);
    if (!code) throw new Error('Spark 没有返回可用的 Python 代码');
    return code;
  }

  /** 验证并保存到固定脚本路径，返回保存后的路径与验证输出。 */
  async validateAndSave(code: string): Promise<{ path: string; stdout: string; stderr: string }> {
    const check = await runPythonCode(code);
    if (!check.ok) {
      throw new Error(`生成的脚本验证失败：${check.stderr || '无输出'}`);
    }
    const target = getScriptPath();
    if (!target) throw new Error('未配置 sparkScriptPath，无法保存生成脚本');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, code, 'utf8');
    scheduleSparkStop();
    return { path: target, stdout: check.stdout.slice(0, 200), stderr: check.stderr };
  }

  /** 暴露给 SupportService/扩展退出时调用。 */
  dispose(): void {
    stopSparkServer();
  }
}
