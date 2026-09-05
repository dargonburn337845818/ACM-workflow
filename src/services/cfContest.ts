import * as vscode from 'vscode';
import { cfApiGet } from './cfSession';
import { ContestProblemInfo } from './template';

/**
 * CF Round 比赛模块（模块二）
 *
 * - contest.list（公开接口）→ 筛选 BEFORE（即将开始）/ CODING（进行中）
 * - contest.standings → 题目列表（题号/名称/Rating/标签）+ 参赛人数
 * - 整场创建：code/Codeforces/Contest_{id}/contest_{id}_{index}.cpp + .prob（见 template.ts）
 */

export interface CfContest {
  id: number;
  name: string;
  phase: 'BEFORE' | 'CODING';
  startTimeSeconds: number;
  durationSeconds: number;
  /** 参赛人数（CODING 场次拉 standings 统计；BEFORE 为 undefined） */
  participants?: number;
}

export interface ContestProblem extends ContestProblemInfo {
  type?: string;
  points?: number;
}

/** 榜单选手行（精简版：只保留展示需要的字段） */
export interface ContestantRow {
  rank: number;
  handle: string;
  /** 通过题数 */
  solved: number;
  /** 罚时（分钟） */
  penalty: number;
  /** 总分（points 制场次；传统制为 0） */
  score: number;
  /** 每题状态：solved=是否通过，time=通过时间（分钟，未通过为 0），wa=被拒次数 */
  problems: { index: string; solved: boolean; time: number; wa: number }[];
}

export interface ContestDetail {
  contest: CfContest;
  problems: ContestProblem[];
  participants?: number;
  /** 大致榜单：前 20 名 */
  top: ContestantRow[];
  /** 我的关注：自己 + 关注列表（未参赛则为空） */
  mine: ContestantRow[];
}

const LIST_CACHE_TTL_MS = 60 * 1000;
/** 大致榜单展示行数（前 20） */
export const TOP_N = 20;

let contestListCache: { at: number; contests: CfContest[] } | null = null;
const participantsCache = new Map<number, { at: number; count: number }>();
const PARTICIPANTS_CACHE_TTL_MS = 60 * 1000;

interface CfContestRaw {
  id: number;
  name: string;
  phase: string;
  startTimeSeconds?: number;
  durationSeconds?: number;
  type?: string;
}

interface CfRowRaw {
  rank: number;
  party?: { members?: { handle?: string }[] };
  points?: number;
  penalty?: number;
  problemResults?: { points?: number; rejectedAttempts?: number; bestSubmissionTimeSeconds?: number }[];
}

interface CfStandingsRaw {
  contest: CfContestRaw;
  problems: ContestProblem[];
  rows: CfRowRaw[];
}

/** 从 standings 响应提取「大致榜单 + 我的关注」（纯函数，可单测） */
export function extractStandingsRows(
  rows: CfRowRaw[],
  problems: ContestProblem[],
  handles: string[],
  topN: number = TOP_N
): { top: ContestantRow[]; mine: ContestantRow[] } {
  const wanted = new Set(handles.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const toRow = (r: CfRowRaw): ContestantRow | null => {
    const handle = r.party?.members?.[0]?.handle;
    if (!handle) return null;
    const results = r.problemResults || [];
    const problemsDetail = problems.map((p, i) => {
      const pr = results[i];
      const solved = !!pr && (pr.bestSubmissionTimeSeconds != null || (pr.points || 0) > 0);
      return {
        index: p.index,
        solved,
        time: solved && pr ? Math.round((pr.bestSubmissionTimeSeconds || 0) / 60) : 0,
        wa: pr?.rejectedAttempts || 0
      };
    });
    return {
      rank: r.rank,
      handle,
      solved: problemsDetail.filter((p) => p.solved).length,
      penalty: r.penalty || 0,
      score: r.points || 0,
      problems: problemsDetail
    };
  };

  const top: ContestantRow[] = [];
  const mine: ContestantRow[] = [];
  for (const r of rows) {
    const row = toRow(r);
    if (!row) continue;
    if (top.length < topN) top.push(row);
    if (wanted.has(row.handle.toLowerCase())) mine.push(row);
    if (top.length >= topN && mine.length >= wanted.size) break;
  }
  return { top, mine };
}

/** 拉取比赛列表（BEFORE + CODING），带 60s 缓存 */
export async function listCfContests(context: vscode.ExtensionContext): Promise<CfContest[]> {
  if (contestListCache && Date.now() - contestListCache.at < LIST_CACHE_TTL_MS) {
    return contestListCache.contests;
  }
  const contests = await cfApiGet<CfContestRaw[]>(context, 'contest.list');
  const filtered = contests
    .filter((c) => c.phase === 'BEFORE' || c.phase === 'CODING')
    .sort((a, b) => (a.startTimeSeconds || 0) - (b.startTimeSeconds || 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      phase: c.phase as 'BEFORE' | 'CODING',
      startTimeSeconds: c.startTimeSeconds || 0,
      durationSeconds: c.durationSeconds || 0
    }));
  contestListCache = { at: Date.now(), contests: filtered };
  return filtered;
}

/**
 * 统计某场比赛的参赛人数。
 * 注意：非 Gym 比赛 standings 匿名访问只允许 contestId 一个参数
 * （from/count/showUnofficial 会返回 400），因此直接取返回的 rows 末位 rank。
 */
export async function fetchContestParticipants(context: vscode.ExtensionContext, contestId: number): Promise<number> {
  const hit = participantsCache.get(contestId);
  if (hit && Date.now() - hit.at < PARTICIPANTS_CACHE_TTL_MS) {
    return hit.count;
  }
  const data = await cfApiGet<CfStandingsRaw>(context, 'contest.standings', { contestId });
  const rows = data.rows || [];
  let count = 0;
  if (rows.length > 0) {
    const lastRank = Number(rows[rows.length - 1]?.rank);
    count = Number.isFinite(lastRank) && lastRank > 0 ? lastRank : rows.length;
  }
  participantsCache.set(contestId, { at: Date.now(), count });
  return count;
}

/**
 * 获取比赛题目列表（含 Rating/标签）+ 参赛人数。精简版：不拉取/不返回榜单与关注行。
 */
export async function getContestDetail(
  context: vscode.ExtensionContext,
  contestId: number
): Promise<ContestDetail> {
  const data = await cfApiGet<CfStandingsRaw>(context, 'contest.standings', { contestId });
  const problems = (data.problems || [])
    .filter((p) => p.type === 'PROGRAMMING')
    .map((p) => ({
      contestId,
      index: p.index,
      name: p.name,
      rating: p.rating,
      tags: p.tags || []
    }));
  // 参赛人数：rows 末位 rank（CODING 场次有效；BEFORE 场次为空）
  let participants: number | undefined;
  const rows = data.rows || [];
  if (rows.length > 0 && problems.length > 0) {
    const lastRank = Number(rows[rows.length - 1]?.rank);
    participants = Number.isFinite(lastRank) && lastRank > 0 ? lastRank : rows.length;
  }
  return {
    contest: {
      id: data.contest.id,
      name: data.contest.name,
      phase: (data.contest.phase as 'BEFORE' | 'CODING') || 'BEFORE',
      startTimeSeconds: data.contest.startTimeSeconds || 0,
      durationSeconds: data.contest.durationSeconds || 0
    },
    problems,
    participants,
    top: [],
    mine: []
  };
}

/** 比赛创建结果 */
export interface ContestCreateResult {
  contestId: number;
  files: { filePath: string; probPath: string }[];
  firstFilePath?: string;
}

/** 格式化时长：sec → "2h 15m" / "45m" */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** 格式化开始时间（本地时区） */
export function formatStartTime(seconds: number): string {
  if (!seconds) return '—';
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 距开始剩余时间（人性化）：如 "2h 15m 后" / "进行中" */
export function formatCountdown(seconds: number, now = Date.now() / 1000): string {
  const diff = seconds - now;
  if (diff <= 0) return '已开始';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m 后`;
  return `${m}m 后`;
}
