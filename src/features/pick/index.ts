/**
 * pick 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import { Services } from '../../services';
import type { WorkbenchHost } from '../../core/workbench';
import type { Problem } from '../../types';


export function installPick(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'records' | 'workspace'>): void {
  host.handlers['fetchProblem'] = (msg: any) => handleFetchProblem(host, deps, msg?.payload);
  host.handlers['createFile'] = (msg: any) => handleCreateFile(host, deps, msg?.payload);
  host.handlers['fetchWeakProblem'] = (msg: any) => handleFetchWeakProblem(host, deps);
}


async function handleFetchProblem(host: WorkbenchHost, deps: Pick<Services, 'codeforces'>, payload: any) {
  try {
    const minRating = Number(payload?.minRating ?? 800);
    const maxRating = Number(payload?.maxRating ?? 2400);
    // 第 5 条：按算法标签多选过滤（命中任一标签即可，OR）
    const tags = Array.isArray(payload?.tags)
      ? payload.tags.filter((t: any) => typeof t === 'string' && t.trim() !== '')
      : [];
    // Bug2：前端已尝试过的题目 ID（避免重复推荐同一道题 / 空条件死循环）
    const exclude: Set<string> | undefined = Array.isArray(payload?.exclude)
      ? new Set(payload.exclude.map((x: any) => String(x)))
      : undefined;
    const problem = await deps.codeforces.pickProblem({ minRating, maxRating, tags, exclude });
    if (problem.difficulty) deps.codeforces.difficultyById.set(problem.id, problem.difficulty); // Bug6：记录难度

    const current = await host.getPickState();
    const recent = current.recent || [];
    const nextRecent = [problem, ...recent.filter(p => p.id !== problem.id)].slice(0, 10);
    await host.saveState({ platform: 'codeforces', minRating, maxRating, tags, problem, recent: nextRecent });

    host.post({ type: 'problemResult', problem });
    host.post({ type: 'recentList', recent: nextRecent });
  } catch (e: any) {
    host.post({ type: 'error', message: e?.message || '选题失败' });
  }
}


async function handleCreateFile(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'workspace' | 'records'>, payload: any) {
  try {
    const problem = payload?.problem as Problem;
    if (!problem) {
      throw new Error('没有可生成的题目');
    }

    host.post({ type: 'status', message: '正在获取题目详情...' });

    let tests: { input: string; output: string }[] = [];
    let detailWarning: string | undefined;
    try {
      const detail = await deps.codeforces.getProblemDetail(problem);
      tests = detail.tests;
      if (tests.length === 0) {
        detailWarning = '未能从题目页面解析出测试数据（可能被反爬拦截）';
      }
    } catch (e: any) {
      console.error('获取题目详情失败', e);
      detailWarning = e?.message || '获取题目详情失败';
    }

    const filePath = deps.workspace.createProblemFile(problem, tests);
    host.post({
      type: 'fileCreated',
      path: filePath,
      message: tests.length > 0
        ? `已生成题目文件夹，${tests.length} 组测试数据已写入 .prob 测试配置。打开文件后内置测试器会自动加载。`
        : `测试数据获取失败：${detailWarning || '未知原因'}。正在自动重试补样例...`
    });

    // 生成即登记刷题记录（不等打开文件）
    deps.records.ensure(problem).catch(() => { /* 记录失败不影响生成 */ });

    // 抓取失败：后台自动重试，成功后把样例写回 .prob
    if (tests.length === 0) {
      retryBackfill(host, deps, problem, filePath);
    }

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (e: any) {
    host.post({ type: 'error', message: e?.message || '生成文件失败' });
  }
}


async function retryBackfill(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'workspace'>, problem: Problem, filePath: string) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await new Promise(r => setTimeout(r, 2500 * attempt));
    try {
      const detail = await deps.codeforces.getProblemDetail(problem);
      if (detail.tests.length > 0) {
        const updated = deps.workspace.updateProblemTests(filePath, detail.tests);
        host.post({
          type: 'status',
          message: updated
            ? `已自动补充 ${detail.tests.length} 组测试数据。切换一下标签页，内置测试器即会显示样例。`
            : `抓到 ${detail.tests.length} 组测试数据，但没找到 .prob 写入位置。`
        });
        return;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  host.post({
    type: 'status',
    message: `自动重试 3 次仍未获取到测试数据${lastErr ? '：' + ((lastErr as any)?.message || lastErr) : ''}。可稍后用命令 “ACM Workflow: 重新获取测试数据” 补样例。`
  });
}


async function handleFetchWeakProblem(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'records'>) {
  try {
    const records = await deps.records.list();
    const all = await deps.codeforces.getProblems();
    const byId = new Map(all.map((p) => [p.id, p]));
    const tagMap = new Map<string, { sub: Set<string>; ac: Set<string> }>();
    for (const r of records) {
      const p = byId.get(r.id);
      if (!p) continue;
      for (const t of p.tags) {
        const e = tagMap.get(t) || { sub: new Set<string>(), ac: new Set<string>() };
        e.sub.add(r.id);
        if (r.status === 'ac') e.ac.add(r.id);
        tagMap.set(t, e);
      }
    }
    const tagStats = [...tagMap.entries()]
      .map(([tag, e]) => ({
        tag,
        submitted: e.sub.size,
        ac: e.ac.size,
        rate: e.sub.size > 0 ? Math.round((e.ac.size / e.sub.size) * 100) : 0
      }))
      .filter((t) => t.submitted >= 3)
      .sort((a, b) => a.rate - b.rate || b.submitted - a.submitted);
    const pool = tagStats.slice(0, 3).map((t) => t.tag); // 通过率最低 2-3 个专题
    const solved = new Set(records.filter((r) => r.status === 'ac').map((r) => r.id));

    let problem: Problem | null = null;
    let tag = '';
    if (pool.length > 0) {
      tag = pool[Math.floor(Math.random() * pool.length)];
      try {
        problem = await deps.codeforces.pickProblem({ minRating: 800, maxRating: 2400, tags: [tag], exclude: solved });
      } catch {
        problem = null;
      }
    }
    if (!problem) {
      problem = await deps.codeforces.pickProblem({ minRating: 800, maxRating: 2400, tags: [], exclude: solved });
      tag = '随机';
    }
    host.post({ type: 'weakProblem', problem, tag });
  } catch (e: any) {
    host.post({ type: 'weakProblem', problem: null, error: e?.message || '薄弱点推荐失败' });
  }
}
