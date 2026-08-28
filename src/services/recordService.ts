import {
  ProblemRecord,
  RecordStatus,
  bulkImport,
  ensureRecord,
  getCanvas,
  getNote,
  getStats,
  listRecords,
  removeRecord,
  saveCanvas,
  saveNote,
  updateRecord
} from './records';
import { computeDifficultyBins, DifficultyStats } from './statistics';
import { Problem } from '../types';

export interface TodayStats {
  acToday: number;
  streak: number;
}

/** 今日 AC 数 + 连续刷题天数（以 ac 记录的 updatedAt 为据） */
export function computeTodayStats(records: ProblemRecord[]): TodayStats {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const DAY = 86400000;
  const today0 = dayStart(new Date());
  const acRecords = records.filter(r => r.status === 'ac');

  const acToday = acRecords.filter(r => r.updatedAt >= today0).length;

  // 连续天数：今天有 AC 从今天起算，否则从昨天起算（只要没断就续上）
  let streak = 0;
  const cursor = new Date(today0);
  if (acToday === 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  for (;;) {
    const start = dayStart(cursor);
    const has = acRecords.some(r => r.updatedAt >= start && r.updatedAt < start + DAY);
    if (!has) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { acToday, streak };
}

/**
 * RecordService facade：封装刷题记录、统计与本地持久化能力。
 */
export class RecordService {
  list(): Promise<ProblemRecord[]> {
    return listRecords();
  }

  ensure(problem: Problem): Promise<ProblemRecord> {
    return ensureRecord(problem);
  }

  update(id: string, patch: { status?: RecordStatus; attempts?: number }): Promise<void> {
    return updateRecord(id, patch);
  }

  remove(id: string): Promise<void> {
    return removeRecord(id);
  }

  stats(): Promise<{ total: number; ac: number; trying: number; abandoned: number; rate: string }> {
    return getStats();
  }

  bulkImport(
    items: { id: string; platform: 'codeforces'; title: string; difficulty?: number; url: string; status: RecordStatus; attempts?: number; updatedAt?: number }[]
  ): Promise<number> {
    return bulkImport(items);
  }

  getNote(id: string): Promise<string | undefined> {
    return getNote(id);
  }

  saveNote(id: string, note: string): Promise<void> {
    return saveNote(id, note);
  }

  getCanvas(id: string): Promise<string | undefined> {
    return getCanvas(id);
  }

  saveCanvas(id: string, data: string): Promise<void> {
    return saveCanvas(id, data);
  }

  difficultyBins(records: ProblemRecord[]): DifficultyStats {
    return computeDifficultyBins(records);
  }

  todayStats(records: ProblemRecord[]): TodayStats {
    return computeTodayStats(records);
  }
}
