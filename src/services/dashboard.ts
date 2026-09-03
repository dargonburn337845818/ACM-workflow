import { CodeforcesClient } from './codeforcesClient';
import { RecordService, TodayStats } from './recordService';
import { ProblemRecord } from './records';
import { DifficultyStats } from './statistics';

/**
 * DashboardService：记录面板展示数据的组合服务。
 *
 * 职责：一次读取刷题记录，产出列表、统计与今日数据；历史图表单独提供，
 * 避免多个 push 方法各自重复读取 SQLite/题集。Workbench 只负责 post 消息。
 */

export interface DashboardStats {
  total: number;
  ac: number;
  trying: number;
  abandoned: number;
  rate: string;
}

export interface DashboardHistory {
  tagStats: { tag: string; ac: number }[];
  difficultyBins: DifficultyStats;
}

export interface DashboardSnapshot {
  records: ProblemRecord[];
  stats: DashboardStats;
  todayStats: TodayStats;
}

export class DashboardService {
  constructor(
    private readonly records: RecordService,
    private readonly codeforces: CodeforcesClient
  ) {}

  /** 一次读取记录并产出列表/统计/今日数据；历史标签统计单独调用 `history`，不阻塞主列表刷新。 */
  async snapshot(): Promise<DashboardSnapshot> {
    const records = await this.records.list();
    const stats = this.records.statsFrom(records);
    const todayStats = this.records.todayStats(records);
    return { records, stats, todayStats };
  }

  /** 仅计算历史图表数据。 */
  async history(records: ProblemRecord[]): Promise<DashboardHistory> {
    let tagStats: { tag: string; ac: number }[] = [];
    try {
      const all = await this.codeforces.getProblems();
      const byId = new Map(all.map((p) => [p.id, p]));
      const acCount = new Map<string, number>();
      for (const r of records) {
        if (r.status !== 'ac') continue;
        const p = byId.get(r.id);
        if (!p) continue;
        for (const t of p.tags) {
          acCount.set(t, (acCount.get(t) || 0) + 1);
        }
      }
      tagStats = [...acCount.entries()]
        .map(([tag, ac]) => ({ tag, ac }))
        .sort((a, b) => b.ac - a.ac)
        .slice(0, 12);
    } catch {
      /* 题集缓存不可用（离线）时图表为空 */
    }
    return {
      tagStats,
      difficultyBins: this.records.difficultyBins(records)
    };
  }
}
