import { spawn, execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  timeMs: number;
}

const COMPILER_CANDIDATES = [
  'g++',
  'C:\\mingw64\\bin\\g++.exe',
  'C:\\msys64\\mingw64\\bin\\g++.exe',
  'C:\\Program Files\\mingw-w64\\x86_64-8.1.0-posix-seh-rt_v6-rev0\\mingw64\\bin\\g++.exe',
  '/usr/bin/g++',
  '/usr/local/bin/g++',
  '/opt/homebrew/bin/g++'
];

let cachedCompiler: string | null | undefined;

/** 探测可用的 g++（PATH 或常见安装位置），结果带缓存 */
export function findCompiler(): string | null {
  if (cachedCompiler !== undefined) return cachedCompiler;
  for (const c of COMPILER_CANDIDATES) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', windowsHide: true });
      cachedCompiler = c;
      return c;
    } catch {
      /* try next */
    }
  }
  cachedCompiler = null;
  return null;
}

interface CompileCacheEntry {
  srcPath: string;
  srcMtime: number;
  exePath: string;
}

let compileCache: CompileCacheEntry | null = null;

/**
 * 编译 cpp；exe 输出到系统临时目录，避免污染题目目录。
 * 同一源码（mtime 未变）复用上次编译结果，单用例/连续运行不再重复编译。
 */
export async function compileCpp(srcPath: string): Promise<{ ok: boolean; exePath?: string; message: string }> {
  const compiler = findCompiler();
  if (!compiler) {
    return { ok: false, message: process.platform === 'win32'
      ? '未找到 g++ 编译器。请安装 MinGW（如 C:\\mingw64）或把 g++ 加入 PATH。'
      : '未找到 g++ 编译器。请安装 g++（如 sudo apt install g++）或把 g++ 加入 PATH。' };
  }

  let srcMtime = 0;
  try {
    srcMtime = fs.statSync(srcPath).mtimeMs;
  } catch {
    return { ok: false, message: '无法读取源码文件：' + srcPath };
  }

  // 命中缓存：源码未变且 exe 仍在
  if (
    compileCache &&
    compileCache.srcPath === srcPath &&
    compileCache.srcMtime === srcMtime &&
    fs.existsSync(compileCache.exePath)
  ) {
    return { ok: true, exePath: compileCache.exePath, message: '编译成功（缓存）' };
  }

  const exeDir = path.join(os.tmpdir(), 'acm-workflow');
  fs.mkdirSync(exeDir, { recursive: true });
  const exePath = path.join(exeDir, path.parse(srcPath).name + '_' + Date.now() + (process.platform === 'win32' ? '.exe' : ''));
  try {
    await execFileAsync(compiler, ['-O2', '-std=c++17', srcPath, '-o', exePath], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true
    });
    compileCache = { srcPath, srcMtime, exePath };
    return { ok: true, exePath, message: '编译成功' };
  } catch (e: any) {
    return { ok: false, message: String(e?.stderr || e?.message || '编译失败').trim() };
  }
}

/** 运行一个用例：input 写入 stdin，捕获 stdout/stderr，超时强杀 */
export function runCase(exePath: string, input: string, timeoutMs = 5000): Promise<RunResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(exePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (r: RunResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(r);
      }
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ stdout, stderr, code: null, timedOut: true, timeMs: Date.now() - t0 });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => {
      finish({ stdout, stderr, code: null, timedOut: false, timeMs: Date.now() - t0 });
    });
    child.on('close', (code) => {
      finish({ stdout, stderr, code, timedOut: false, timeMs: Date.now() - t0 });
    });
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** 归一化输出：统一换行、去每行行尾空白、去首尾空行 */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n');
}

/** 比对实际输出与期望输出（忽略行尾空白与首尾空行，即 CPH 默认规则） */
export function judge(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

/** 输出当前环境诊断信息（平台 / PATH / curl / g++ 探测结果），用于排查环境问题 */
export function diagnoseEnv(): string[] {
  const lines: string[] = [];
  lines.push(`platform: ${process.platform}`);
  lines.push(`node: ${process.version}`);
  lines.push(`tmpdir: ${os.tmpdir()}`);
  lines.push('PATH:');
  (process.env.PATH || '').split(path.delimiter).filter((p) => p.length > 0).forEach((p) => lines.push('  ' + p));
  lines.push('curl:');
  for (const c of ['C:\\Windows\\System32\\curl.exe', '/usr/bin/curl', '/bin/curl', '/usr/local/bin/curl', 'curl.exe', 'curl']) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')[0];
      lines.push(`  [OK] ${c} -> ${v}`);
    } catch {
      lines.push(`  [NO] ${c}`);
    }
  }
  lines.push('python:');
  for (const c of ['python3', 'python']) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')[0];
      lines.push(`  [OK] ${c} -> ${v}`);
    } catch {
      lines.push(`  [NO] ${c}`);
    }
  }
  lines.push('g++:');
  for (const c of COMPILER_CANDIDATES) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', windowsHide: true });
      lines.push(`  [OK] ${c}`);
    } catch {
      lines.push(`  [NO] ${c}`);
    }
  }
  return lines;
}
