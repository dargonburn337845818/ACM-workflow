/**
 * Codeforces 用户数据（看板）：AC 总数 / 近 7 天进度 / 标签分布 / 薄弱标签。
 * 数据源：codeforces.com/api/user.status（无需登录）。
 * V0.7：结果磁盘缓存 15 分钟（按 handle 分文件），看板/绑定刷新不重复慢请求。
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveBaseDir } from '../../../utils/paths';

const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const USER_STATS_TTL_MS = 15 * 60 * 1000;

function statsCachePath(handle: string): string {
  const safe = handle.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(resolveBaseDir(), 'cache', `cf-userstats-${safe}.json`);
}

function readStatsCache(handle: string): UserStats | null {
  try {
    const raw = fs.readFileSync(statsCachePath(handle), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.handle === handle && typeof obj.ts === 'number' && Date.now() - obj.ts < USER_STATS_TTL_MS && obj.stats) {
      const s = obj.stats as UserStats & { solved?: string[]; solvedAt?: [string, number][] };
      // solved / solvedAt 序列化为数组，读回时还原为 Map/Set
      return {
        ...s,
        solved: new Set(Array.isArray(s.solved) ? s.solved : []),
        solvedAt: new Map(Array.isArray(s.solvedAt) ? s.solvedAt : [])
      };
    }
  } catch {
    /* 无缓存或损坏 */
  }
  return null;
}

function writeStatsCache(handle: string, stats: UserStats): void {
  try {
    fs.mkdirSync(path.dirname(statsCachePath(handle)), { recursive: true });
    const payload = {
      ts: Date.now(),
      handle,
      stats: { ...stats, solved: [...stats.solved], solvedAt: [...stats.solvedAt] }
    };
    fs.writeFileSync(statsCachePath(handle), JSON.stringify(payload), 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow] 用户数据缓存写入失败：', e);
  }
}

export interface UserStats {
  handle: string;
  total: number;              // 去重 AC 题数
  recent7: number[];          // 近 7 天每日 AC 数（含今天，7 元素）
  tags: { tag: string; count: number }[]; // 已 AC 题的标签频率（降序）
  weakTags: string[];         // 频率最低的 3 个标签（薄弱方向）
  solved: Set<string>;        // 已 AC 题目 id 集合（contestId+index）
  solvedAt: Map<string, number>; // 每题首次 AC 的 Unix 秒（V0.8：历史导入保留真实时间）
  tagStats: TagStat[];        // 各专题通过率（去重题目口径，按通过率升序）
  weakByRate: string[];       // 通过率最低的 2 个专题（提交数 ≥3，薄弱点推荐依据）
}

/** 专题通过率：ac = 该标签下 AC 的题目数（去重），submitted = 该标签下提交过的题目数（去重） */
export interface TagStat {
  tag: string;
  ac: number;
  submitted: number;
  rate: number; // 0~100
}

interface Submission {
  verdict?: string;
  problem?: { contestId?: number; index?: string; tags?: string[] };
  creationTimeSeconds?: number;
}

function dayStartTs(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - offsetDays * 86400000;
}

/**
 * 拉取 CF user.status 全部提交记录（V0.11 修复：以「空页」为终止条件）。
 * Bug4 根因：旧逻辑以 `result.length < PAGE_SIZE` 终止——CF 在限流/截断时单页
 * 可能返回不足 1000 条（实测每页 100 条），导致只拉 2 页（约 200 条）就误判结束。
 * 现在：按实际返回条数推进 from，直到返回空页；另加页数上限与日志做安全兜底。
 * @param handle CF handle
 * @param onProgress 可选进度回调（page 页码从 1 起，total 累计条数）
 */
export async function fetchUserStatusAll(
  handle: string,
  onProgress?: (page: number, total: number) => void
): Promise<Submission[]> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 100; // 安全上限（约 10 万条），防止 CF 异常返回时死循环
  const all: Submission[] = [];
  let from = 1;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': CF_UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      throw new Error(`CF API 请求失败：HTTP ${res.status}（第 ${page} 页）`);
    }
    const data = await res.json() as { status: string; result?: Submission[] };
    if (data.status !== 'OK' || !data.result) {
      throw new Error(`CF API 返回异常（第 ${page} 页，请检查 handle 是否正确）`);
    }
    const got = data.result.length;
    all.push(...data.result);
    onProgress?.(page, all.length);
    console.log(`[ACM-Workflow] user.status 第 ${page} 页：本页 ${got} 条，累计 ${all.length} 条`);
    if (got === 0) break;          // 空页 = 已到末尾（Bug4：空页才停）
    from += got;                   // 按实际返回条数推进（而非固定 PAGE_SIZE）
    // CF API 限流：页间稍作停顿
    await new Promise((r) => setTimeout(r, 400));
  }
  if (all.length === 0) {
    throw new Error('CF 未返回任何提交记录（请检查 handle 是否正确）');
  }
  return all;
}

export async function fetchUserStats(
  handle: string,
  onProgress?: (page: number, total: number) => void,
  opts?: { force?: boolean }
): Promise<UserStats> {
  // 15 分钟内直接读缓存，避免每次看板刷新都打 CF API（实测慢且易限流）。
  // V0.12：「导入历史」必须 force=true 强制拉取最新，否则旧版少导的缓存会一直复用。
  const cached = readStatsCache(handle);
  if (cached && !opts?.force) return cached;

  const dataResult = await fetchUserStatusAll(handle, onProgress);

  const solvedMap = new Map<string, { tags: string[]; time: number }>();
  const recent7: number[] = new Array(7).fill(0);
  for (const s of dataResult) {
    const pid = s.problem?.contestId !== undefined
      ? String(s.problem.contestId) + (s.problem.index || '')
      : '';
    const time = (s.creationTimeSeconds || 0) * 1000;
    if (s.verdict === 'OK' && pid && s.problem) {
      const e = solvedMap.get(pid) || { tags: s.problem.tags || [], time: Infinity };
      e.time = Math.min(e.time, time); // 首次 AC 时间
      solvedMap.set(pid, e);
      // 近 7 天按提交时间统计（同日多题只算一次）
      for (let i = 0; i < 7; i++) {
        if (time >= dayStartTs(i) && time < dayStartTs(i - 1)) {
          recent7[i] = 1;
          break;
        }
      }
    }
  }

  const tagCount = new Map<string, number>();
  for (const { tags } of solvedMap.values()) {
    for (const t of tags) {
      tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
  }
  const tags = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  const weakTags = [...tagCount.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([tag]) => tag);

  // 专题通过率（去重题目口径）：提交过 ≥3 题的标签才算，避免 1 题 100% 的噪声
  const tagMap = new Map<string, { pids: Set<string>; acPids: Set<string> }>();
  for (const s of dataResult) {
    if (!s.problem) continue;
    const pid = s.problem.contestId !== undefined
      ? String(s.problem.contestId) + (s.problem.index || '')
      : '';
    if (!pid) continue;
    for (const t of s.problem.tags || []) {
      const e = tagMap.get(t) || { pids: new Set<string>(), acPids: new Set<string>() };
      e.pids.add(pid);
      if (s.verdict === 'OK') e.acPids.add(pid);
      tagMap.set(t, e);
    }
  }
  const tagStats: TagStat[] = [...tagMap.entries()]
    .map(([tag, e]) => ({
      tag,
      ac: e.acPids.size,
      submitted: e.pids.size,
      rate: e.pids.size > 0 ? Math.round((e.acPids.size / e.pids.size) * 100) : 0
    }))
    .filter((t) => t.submitted >= 3)
    .sort((a, b) => a.rate - b.rate || b.submitted - a.submitted);
  const weakByRate = tagStats.slice(0, 2).map((t) => t.tag);

  const solvedAt = new Map<string, number>();
  for (const [pid, e] of solvedMap) {
    if (Number.isFinite(e.time)) solvedAt.set(pid, Math.floor(e.time / 1000));
  }

  const stats: UserStats = {
    handle,
    total: solvedMap.size,
    recent7,
    tags,
    weakTags,
    solved: new Set(solvedMap.keys()),
    solvedAt,
    tagStats,
    weakByRate
  };
  writeStatsCache(handle, stats);
  return stats;
}
