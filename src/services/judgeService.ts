import * as vscode from 'vscode';
import { compileCpp, judge, normalizeOutput, runCase, RunResult } from './runner';
import { runVerifier, VerifierCallbacks, VerifierParams, VerifierResult } from './verifier';
import { DataGenSpec, generateInput, Rng } from './dataGen';

/**
 * JudgeService facade：封装编译、运行、输出比对、对拍与造数据能力。
 */
export class JudgeService {
  compile(srcPath: string): Promise<{ ok: boolean; exePath?: string; message: string }> {
    return compileCpp(srcPath);
  }

  run(exePath: string, input: string, timeoutMs = 5000): Promise<RunResult> {
    return runCase(exePath, input, timeoutMs);
  }

  judge(actual: string, expected: string): boolean {
    return judge(actual, expected);
  }

  normalizeOutput(output: string): string {
    return normalizeOutput(output);
  }

  runVerifier(params: VerifierParams, callbacks: VerifierCallbacks, isCancelled?: () => boolean): Promise<VerifierResult> {
    return runVerifier(params, callbacks, isCancelled);
  }

  generateInput(spec: DataGenSpec, rng?: Rng): Promise<string> {
    return generateInput(spec, rng);
  }

  defaultTimeoutMs(): number {
    return vscode.workspace.getConfiguration('acmWorkflow').get<number>('testTimeoutMs', 5000);
  }
}
