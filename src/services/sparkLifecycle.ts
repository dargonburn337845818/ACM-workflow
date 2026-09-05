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
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { normalizePath } from '../utils/paths';
import { resolveLocalEndpoint } from '../utils/wsl';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080';
const DEFAULT_MODEL_NAME = 'spark:latest';
const DEFAULT_SERVER_PATH = 'D:\\llama-spark\\build\\bin\\llama-server.exe';
const DEFAULT_MODEL_PATH = 'D:\\llama\\Spark-X2.5-4B-Q8_0\\Spark-X2.5-4B-Q8_0.gguf';
const DEFAULT_CTX_SIZE = 131072;
const DEFAULT_BATCH_SIZE = 512;
const DEFAULT_THREADS = 16;
const DEFAULT_GPU_LAYERS = 99;
const DEFAULT_CACHE_TYPE = 'q4_0';
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_REQUEST_TIMEOUT_MS = 300000;
export const DEFAULT_IDLE_TIMEOUT_MS = 180000;

let sparkProcess: ChildProcess | null = null;
let sparkStarting: Promise<boolean> | null = null;
let sparkStopRequested = false;
let sparkStartedByUs = false;
let sparkIdleTimer: NodeJS.Timeout | null = null;

export function cfg<T>(key: string, def: T): T {
  try {
    const v = vscode.workspace.getConfiguration('acmWorkflow').get<T>(key, def);
    return v ?? def;
  } catch {
    return def;
  }
}

export function getEndpoint(): string {
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

export function getModelName(): string {
  return cfg('sparkModelName', DEFAULT_MODEL_NAME) || DEFAULT_MODEL_NAME;
}

function getServerPath(): string {
  return normalizePath(cfg('sparkServerPath', DEFAULT_SERVER_PATH));
}

function getModelPath(): string {
  return normalizePath(cfg('sparkModelPath', DEFAULT_MODEL_PATH));
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

export function llamaApiBase(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : base + '/v1';
}

export async function probeSparkServer(): Promise<boolean> {
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
    '--cache-type-k', cfg('sparkCacheTypeK', DEFAULT_CACHE_TYPE),
    '--cache-type-v', cfg('sparkCacheTypeV', DEFAULT_CACHE_TYPE),
    '--reasoning', 'off',
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
    SPARK_CACHE_TYPE: cfg('sparkCacheTypeK', DEFAULT_CACHE_TYPE),
    SPARK_LOG_FILE: getLogPath(),
    SPARK_PID_FILE: getPidFile()
  };
}

export async function ensureSparkServer(): Promise<boolean> {
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
export function scheduleSparkStop(): void {
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

