import { compileCpp, runCase, judge, RunResult } from './runner';
import { generateInput, DataGenSpec } from './dataGen';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFileSync } from 'child_process';

/**
 * 通用对拍器（模块四）
 *
 * 流程：生成随机数据 → 编译正解/暴力 → 分别运行 → 比对输出。
 * 一致 → 下一组；不一致/出错 → 停止并回传差异数据。
 * 数据源：造数据机器（generateInput），内置规格、流水线或用户脚本均可。
 * 比对方式：exact / token / float / spj（外部 Special Judge）。
 */

export type CompareMode = 'exact' | 'token' | 'float' | 'spj';

export interface CheckerOptions {
  /** 比对方式，缺省 exact */
  mode?: CompareMode;
  /** float 模式下允许的误差（默认 1e-6） */
  eps?: number;
  /** spj 模式下的 checker 程序路径（.cpp/.py/.js/.exe） */
  checkerPath?: string;
}

export interface VerifierParams {
  solvePath: string;
  brutePath: string;
  /** 最大测试组数（默认 1000） */
  maxRounds: number;
  /** 数据生成规格（来自造数据面板） */
  spec: DataGenSpec;
  /** 单程序运行超时（毫秒，默认 5000） */
  timeoutMs?: number;
  /** 输出比对方式与 SPJ 配置 */
  checker?: CheckerOptions;
}

export interface VerifierMismatch {
  round: number;
  input: string;
  solveOut: string;
  bruteOut: string;
  solveResult?: RunResult;
  bruteResult?: RunResult;
  reason: string;
}

export interface VerifierProgress {
  round: number;
  passed: number;
  total: number;
  message: string;
}

export interface VerifierResult {
  stopped: boolean;
  cancelled: boolean;
  passed: number;
  rounds: number;
  reason: string;
}

export interface VerifierCallbacks {
  onProgress?: (p: VerifierProgress) => void;
  onMismatch?: (m: VerifierMismatch) => void;
  onDone?: (r: VerifierResult) => void;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_EPS = 1e-6;
const CHECKER_TIMEOUT_MS = 5000;

interface CheckerLauncher {
  cmd: string;
  args: string[];
}

function describeRun(r: RunResult): string {
  if (r.timedOut) return '超时';
  if (r.code !== 0) return `运行错误(退出码 ${r.code})`;
  return '正常';
}

// ===== 内置比对方式 =====

function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function compareToken(actual: string, expected: string): boolean {
  const a = tokenize(actual);
  const b = tokenize(expected);
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function compareFloat(actual: string, expected: string, eps: number): boolean {
  const a = tokenize(actual);
  const b = tokenize(expected);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = Number(a[i]);
    const nb = Number(b[i]);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      const err = Math.abs(na - nb);
      const tolerance = eps * Math.max(1, Math.abs(na), Math.abs(nb));
      if (err > tolerance) return false;
    } else if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

// ===== SPJ 运行器 =====

let cachedPythonCommand: string | null = null;

function pythonCommand(): string {
  if (cachedPythonCommand) return cachedPythonCommand;
  const candidates = process.platform === 'win32' ? ['python'] : ['python3', 'python'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', windowsHide: true });
      cachedPythonCommand = c;
      return c;
    } catch {
      /* try next */
    }
  }
  cachedPythonCommand = candidates[0];
  return cachedPythonCommand;
}

/**
 * 准备 SPJ 运行器：
 * - .cpp/.cc/.cxx 编译为临时 exe（每次对拍开始编译一次）
 * - .py 用 python 运行
 * - .js/.mjs/.cjs 用扩展宿主 Node 运行
 * - .exe 直接运行
 */
function prepareChecker(checkerPath: string): CheckerLauncher {
  if (!checkerPath || !fs.existsSync(checkerPath)) {
    throw new Error(`SPJ 程序不存在：${checkerPath || '(未填写)'}`);
  }
  const ext = path.extname(checkerPath).toLowerCase();
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx') {
    const c = compileCpp(checkerPath);
    if (!c.ok || !c.exePath) {
      throw new Error(`SPJ 编译失败：${c.message}`);
    }
    return { cmd: c.exePath, args: [] };
  }
  if (ext === '.py') {
    return { cmd: pythonCommand(), args: [checkerPath] };
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return { cmd: process.execPath, args: [checkerPath] };
  }
  if (ext === '.exe') {
    return { cmd: checkerPath, args: [] };
  }
  throw new Error(`不支持的 SPJ 类型：${ext}（支持 .cpp / .py / .js / .exe）`);
}

/**
 * 执行一次 SPJ：把 input / expected(暴力输出) / actual(正解输出) 写为临时文件，
 * 以 `checker input.txt expected.txt actual.txt` 方式调用；退出码 0 表示通过。
 */
async function runCheckerLauncher(
  launcher: CheckerLauncher,
  input: string,
  expected: string,
  actual: string
): Promise<{ ok: boolean; reason?: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-checker-'));
  try {
    const inputFile = path.join(dir, 'input.txt');
    const expectedFile = path.join(dir, 'expected.txt');
    const actualFile = path.join(dir, 'actual.txt');
    fs.writeFileSync(inputFile, input);
    fs.writeFileSync(expectedFile, expected);
    fs.writeFileSync(actualFile, actual);

    const args = [...launcher.args, inputFile, expectedFile, actualFile];
    return await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      let settled = false;
      const finish = (ok: boolean, reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, reason });
      };
      const child = spawn(launcher.cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        finish(false, 'SPJ 运行超时');
      }, CHECKER_TIMEOUT_MS);
      child.stdout.on('data', () => { /* checker 输出不作为判定依据 */ });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (e) => {
        finish(false, `SPJ 无法运行：${e.message}`);
      });
      child.on('close', (code) => {
        if (code === 0) {
          finish(true);
        } else {
          const detail = stderr.trim().slice(0, 200);
          finish(false, `SPJ 判定为 WA（退出码 ${code}）${detail ? '：' + detail : ''}`);
        }
      });
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function compareOutputs(
  actual: string,
  expected: string,
  input: string,
  checker: CheckerOptions | undefined,
  checkerLauncher: CheckerLauncher | null
): Promise<{ ok: boolean; reason?: string }> {
  const mode = checker?.mode || 'exact';
  if (mode === 'exact') return { ok: judge(actual, expected) };
  if (mode === 'token') return { ok: compareToken(actual, expected) };
  if (mode === 'float') return { ok: compareFloat(actual, expected, checker?.eps ?? DEFAULT_EPS) };
  if (mode === 'spj') {
    if (!checkerLauncher) return { ok: false, reason: '未配置 SPJ 程序' };
    return runCheckerLauncher(checkerLauncher, input, expected, actual);
  }
  return { ok: false, reason: `未知比对方式：${mode}` };
}

/**
 * 执行一轮对拍：编译（缓存）→ 循环生成数据并运行比对。
 * isCancelled 返回 true 时停止（外部置位）。
 */
export async function runVerifier(
  params: VerifierParams,
  callbacks: VerifierCallbacks = {},
  isCancelled: () => boolean = () => false
): Promise<VerifierResult> {
  const timeoutMs = params.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRounds = Math.max(1, Math.min(100000, Math.round(params.maxRounds) || 1000));

  // 编译两份代码（compileCpp 带缓存，同源码不重复编译）
  const compileSolve = compileCpp(params.solvePath);
  if (!compileSolve.ok || !compileSolve.exePath) {
    const r: VerifierResult = { stopped: true, cancelled: false, passed: 0, rounds: 0, reason: '正解编译失败：' + compileSolve.message };
    callbacks.onDone?.(r);
    return r;
  }
  const compileBrute = compileCpp(params.brutePath);
  if (!compileBrute.ok || !compileBrute.exePath) {
    const r: VerifierResult = { stopped: true, cancelled: false, passed: 0, rounds: 0, reason: '暴力编译失败：' + compileBrute.message };
    callbacks.onDone?.(r);
    return r;
  }

  // SPJ 程序先准备一次（C++ 只需编译一次，Python/JS 只在每轮生成临时文件）
  const compareMode = params.checker?.mode || 'exact';
  let checkerLauncher: CheckerLauncher | null = null;
  if (compareMode === 'spj') {
    try {
      checkerLauncher = prepareChecker(params.checker?.checkerPath || '');
    } catch (e: any) {
      const r: VerifierResult = { stopped: true, cancelled: false, passed: 0, rounds: 0, reason: `SPJ 准备失败：${e?.message || e}` };
      callbacks.onDone?.(r);
      return r;
    }
  }

  let passed = 0;
  for (let round = 1; round <= maxRounds; round++) {
    if (isCancelled()) {
      const r: VerifierResult = { stopped: false, cancelled: true, passed, rounds: round - 1, reason: '用户取消' };
      callbacks.onDone?.(r);
      return r;
    }

    // 造数据机器：生成随机输入
    let input: string;
    try {
      input = await generateInput(params.spec);
    } catch (e: any) {
      const r: VerifierResult = { stopped: true, cancelled: false, passed, rounds: round - 1, reason: `数据生成失败：${e?.message || e}` };
      callbacks.onDone?.(r);
      return r;
    }

    callbacks.onProgress?.({ round, passed, total: maxRounds, message: `正在对拍第 ${round}/${maxRounds} 组…` });

    const [solveRes, bruteRes] = await Promise.all([
      runCase(compileSolve.exePath, input, timeoutMs),
      runCase(compileBrute.exePath, input, timeoutMs)
    ]);

    // 双方都出错/超时：无法比对，按差异处理（附原因）
    const solveErr = solveRes.timedOut || solveRes.code !== 0;
    const bruteErr = bruteRes.timedOut || bruteRes.code !== 0;

    if (solveErr || bruteErr) {
      const reason = solveErr && bruteErr
        ? `双方均${solveRes.timedOut ? '超时' : '运行错误'}（正解: ${describeRun(solveRes)}，暴力: ${describeRun(bruteRes)}）`
        : solveErr
          ? `正解${describeRun(solveRes)}（暴力正常）`
          : `暴力${describeRun(bruteRes)}（正解正常）`;
      const mismatch: VerifierMismatch = {
        round, input, solveOut: solveRes.stdout, bruteOut: bruteRes.stdout,
        solveResult: solveRes, bruteResult: bruteRes, reason
      };
      callbacks.onMismatch?.(mismatch);
      const r: VerifierResult = { stopped: true, cancelled: false, passed, rounds: round - 1, reason };
      callbacks.onDone?.(r);
      return r;
    }

    // 按所选比对方式判断（默认 exact：忽略行尾空白/首尾空行）
    const cmp = await compareOutputs(solveRes.stdout, bruteRes.stdout, input, params.checker, checkerLauncher);
    if (cmp.ok) {
      passed++;
      continue;
    }

    const reason = cmp.reason
      ? `第 ${round} 组 ${cmp.reason}`
      : `第 ${round} 组输出不一致`;
    const mismatch: VerifierMismatch = {
      round, input, solveOut: solveRes.stdout, bruteOut: bruteRes.stdout,
      solveResult: solveRes, bruteResult: bruteRes,
      reason
    };
    callbacks.onMismatch?.(mismatch);
    const r: VerifierResult = { stopped: true, cancelled: false, passed, rounds: round - 1, reason: mismatch.reason };
    callbacks.onDone?.(r);
    return r;
  }

  const r: VerifierResult = { stopped: false, cancelled: false, passed, rounds: maxRounds, reason: `完成 ${maxRounds} 组，全部一致` };
  callbacks.onDone?.(r);
  return r;
}
