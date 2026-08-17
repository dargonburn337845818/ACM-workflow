import { compileCpp, runCase, judge, RunResult } from './runner';
import { generateInput, DataGenSpec } from './dataGen';

/**
 * 通用对拍器（模块四）
 *
 * 流程：生成随机数据 → 编译正解/暴力 → 分别运行 → 比对输出。
 * 一致 → 下一组；不一致/出错 → 停止并回传差异数据。
 * 数据源：造数据机器（generateInput），内置规格或用户脚本均可。
 */

export interface VerifierParams {
  solvePath: string;
  brutePath: string;
  /** 最大测试组数（默认 1000） */
  maxRounds: number;
  /** 数据生成规格（来自造数据面板） */
  spec: DataGenSpec;
  /** 单程序运行超时（毫秒，默认 5000） */
  timeoutMs?: number;
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

function describeRun(r: RunResult): string {
  if (r.timedOut) return '超时';
  if (r.code !== 0) return `运行错误(退出码 ${r.code})`;
  return '正常';
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

    // 输出比对（忽略行尾空白/首尾空行，与内置测试器同一规则）
    if (judge(solveRes.stdout, bruteRes.stdout)) {
      passed++;
      continue;
    }

    const mismatch: VerifierMismatch = {
      round, input, solveOut: solveRes.stdout, bruteOut: bruteRes.stdout,
      solveResult: solveRes, bruteResult: bruteRes,
      reason: `第 ${round} 组输出不一致`
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
