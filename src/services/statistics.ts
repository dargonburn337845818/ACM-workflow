import { ProblemRecord } from './records';

/**
 * 刷题统计工具（V0.12）：
 * CF 难度分布分档（800-3500）+ 未定分统计，供记录面板柱状图使用。
 */

export interface DifficultyBin {
  label: string;
  lo: number;
  hi: number;
  count: number;
}

/** CF 难度分档（与 Codeforces rating 区间对齐，覆盖 800~3500） */
export const DIFFICULTY_BINS: { label: string; lo: number; hi: number }[] = [
  { label: '800', lo: 800, hi: 1199 },
  { label: '1200', lo: 1200, hi: 1399 },
  { label: '1400', lo: 1400, hi: 1599 },
  { label: '1600', lo: 1600, hi: 1799 },
  { label: '1800', lo: 1800, hi: 1999 },
  { label: '2000', lo: 2000, hi: 2199 },
  { label: '2200', lo: 2200, hi: 2399 },
  { label: '2400', lo: 2400, hi: 2599 },
  { label: '2600', lo: 2600, hi: 2799 },
  { label: '2800', lo: 2800, hi: 2999 },
  { label: '3000+', lo: 3000, hi: 3500 }
];

export interface DifficultyStats {
  bins: DifficultyBin[];
  /** 未定分题目数（difficulty 缺失 / <=0） */
  undetermined: number;
  /** 全部题目数（用于占比） */
  total: number;
}

/** 由本地记录计算 CF 难度分布（V0.12） */
export function computeDifficultyBins(records: ProblemRecord[]): DifficultyStats {
  const bins: DifficultyBin[] = DIFFICULTY_BINS.map((b) => ({ ...b, count: 0 }));
  let undetermined = 0;
  for (const r of records) {
    const d = r.difficulty;
    if (d === undefined || d === null || d <= 0) {
      undetermined++;
      continue;
    }
    const bin = bins.find((b) => d >= b.lo && d <= b.hi);
    if (bin) bin.count++;
    else if (d > 3500) bins[bins.length - 1].count++; // 超出上限归入最高档
    else undetermined++; // 低于 800 视为未定分（CF 无 <800 难度）
  }
  return { bins, undetermined, total: records.length };
}
