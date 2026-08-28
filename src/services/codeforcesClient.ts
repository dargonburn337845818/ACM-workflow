import * as vscode from 'vscode';
import { CfContest, ContestDetail, listCfContests, getContestDetail } from './cfContest';
import {
  CfSession,
  clearSession,
  getStoredSession,
  isSessionExpired,
  loginCfSession
} from './cfSession';
import {
  getCodeforcesProblems,
  getCodeforcesProblemDetail,
  pickCodeforcesProblem
} from './fetchers/codeforces';
import { fetchUserStats, UserStats } from './fetchers/userStats/codeforces';
import { Problem } from '../types';

/** 比赛详情缓存条目（2 分钟） */
interface ContestDetailCacheEntry {
  at: number;
  detail: ContestDetail;
}

/**
 * CodeforcesClient facade：封装所有 CF 网络/会话/比赛/用户数据能力，
 * 并持有跨功能共享的难度缓存与比赛详情缓存。
 */
export class CodeforcesClient {
  readonly contestDetailCache = new Map<number, ContestDetailCacheEntry>();
  readonly difficultyById = new Map<string, number>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async getProblems(): Promise<Problem[]> {
    return getCodeforcesProblems();
  }

  async pickProblem(options: {
    minRating: number;
    maxRating: number;
    tags: string[];
    exclude?: Set<string>;
  }): Promise<Problem> {
    return pickCodeforcesProblem(options);
  }

  async getProblemDetail(problem: Problem): Promise<{ tests: { input: string; output: string }[] }> {
    return getCodeforcesProblemDetail(problem);
  }

  async listContests(): Promise<CfContest[]> {
    return listCfContests(this.context);
  }

  async getContestDetail(contestId: number, force = false): Promise<ContestDetail> {
    if (force) this.contestDetailCache.delete(contestId);
    const hit = this.contestDetailCache.get(contestId);
    if (hit && Date.now() - hit.at < 120000) return hit.detail;
    const detail = await getContestDetail(this.context, contestId);
    this.contestDetailCache.set(contestId, { at: Date.now(), detail });
    return detail;
  }

  clearContestDetailCache(): void {
    this.contestDetailCache.clear();
  }

  invalidateContestDetail(contestId: number): void {
    this.contestDetailCache.delete(contestId);
  }

  async getStoredSession(): Promise<CfSession | null> {
    return getStoredSession(this.context);
  }

  isSessionExpired(session: CfSession, now: number = Date.now()): boolean {
    return isSessionExpired(session, now);
  }

  async login(onMessage?: (message: string) => void): Promise<CfSession> {
    return loginCfSession(this.context, onMessage);
  }

  async clearSession(): Promise<void> {
    return clearSession(this.context);
  }

  async fetchUserStats(
    handle: string,
    onPage?: (page: number, total: number) => void,
    opts?: { force?: boolean }
  ): Promise<UserStats> {
    return fetchUserStats(handle, onPage, opts);
  }

  async ensureDifficulty(problem: Problem): Promise<void> {
    if (problem.difficulty) {
      this.difficultyById.set(problem.id, problem.difficulty);
      return;
    }
    if (problem.platform !== 'codeforces') return;
    try {
      const all = await getCodeforcesProblems();
      const p = all.find((x) => x.id === problem.id);
      if (p && p.difficulty) this.difficultyById.set(problem.id, p.difficulty);
    } catch {
      /* 题集不可用时保持未定 */
    }
  }

  difficultyOf(id: string): number | undefined {
    return this.difficultyById.get(id);
  }
}
