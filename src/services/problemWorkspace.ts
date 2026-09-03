import * as path from 'path';
import { parseCfProblemUrl, CfProblemUrl } from './cfUrl';
import {
  ContestProblemInfo,
  createContestProblemFiles,
  createProblemFile,
  findProbFile,
  findProblemCppById,
  listProblemCpps,
  markSamplesFetchFailed,
  saveProblemTests,
  updateContestProblemSamples,
  updateProblemTests
} from './template';
import { Problem } from '../types';

/**
 * ProblemWorkspace facade：负责题目身份解析、URL 解析、本地题目文件/CPH 配置的
 * 创建与更新，以及 URL 导入的防重状态。
 */
export class ProblemWorkspace {
  urlImportBusy = false;

  /** 从 .prob 内容构造 Problem（用于刷题记录登记）；URL 解析统一走 `parseCfProblemUrl`。 */
  problemFromProb(prob: any): Problem | null {
    const url = String(prob?.url || '');
    if (!url) return null;
    const name = String(prob?.name || '');
    const title = name.replace(/^[A-Za-z0-9]+\.[\s\u00a0]*/, '').trim() || name;
    try {
      const parsed = parseCfProblemUrl(url);
      return { id: parsed.id, platform: 'codeforces', title, tags: [], url: parsed.url };
    } catch {
      return null;
    }
  }

  /** 从文件名 / 路径解析题目 ID（V0.13：修复「文件名是题目名、题号在目录名」的场景） */
  problemFromFileName(filePath: string): Problem | null {
    const base = path.basename(filePath).replace(/\.cpp$/i, '');
    const dir = path.basename(path.dirname(filePath));
    const m = /^(\d{3,6})([A-Za-z]\d*)$/.exec(base);
    if (m) return this.cfProblem(m[1], m[2]);
    const dm = /^(\d{3,6})([A-Za-z]\d*)$/.exec(dir);
    if (dm) return this.cfProblem(dm[1], dm[2]);
    return null;
  }

  parseCfProblemUrl(raw: string): CfProblemUrl {
    return parseCfProblemUrl(raw);
  }

  createProblemFile(problem: Problem, tests: { input: string; output: string }[]): string {
    return createProblemFile(problem, tests);
  }

  createContestProblemFiles(
    contestId: number,
    problems: ContestProblemInfo[]
  ): { filePath: string; probPath: string }[] {
    return createContestProblemFiles(contestId, problems);
  }

  saveProblemTests(filePath: string, tests: { id: number; input: string; output: string }[]): boolean {
    return saveProblemTests(filePath, tests);
  }

  updateProblemTests(filePath: string, tests: { input: string; output: string }[]): boolean {
    return updateProblemTests(filePath, tests);
  }

  findProbFile(filePath: string): string | null {
    return findProbFile(filePath);
  }

  listProblemCpps(): string[] {
    return listProblemCpps();
  }

  findProblemCppById(problemId: string): string | null {
    return findProblemCppById(problemId);
  }

  updateContestProblemSamples(filePath: string, tests: { input: string; output: string }[]): boolean {
    return updateContestProblemSamples(filePath, tests);
  }

  markSamplesFetchFailed(filePath: string): void {
    markSamplesFetchFailed(filePath);
  }

  private cfProblem(contestId: string, index: string): Problem {
    return {
      id: contestId + index,
      platform: 'codeforces',
      title: '',
      tags: [],
      url: `https://codeforces.com/problemset/problem/${contestId}/${index}`
    };
  }
}
