/**
 * pick 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import { getCodeforcesProblemDetail, getCodeforcesProblems, pickCodeforcesProblem } from '../../services/fetchers/codeforces';
import { getLuoguProblemDetail } from '../../services/fetchers/luogu';
import { ensureRecord, listRecords } from '../../services/records';
import { createProblemFile, updateProblemTests } from '../../services/template';
import type { WorkbenchHost, PickState } from '../../core/workbench';
import { STATE_KEY } from '../../core/workbench';
import type { Problem } from '../../types';


export function installPick(host: WorkbenchHost): void {
  host.handlers['fetchProblem'] = (msg: any) => handleFetchProblem(host, msg?.payload);
  host.handlers['createFile'] = (msg: any) => handleCreateFile(host, msg?.payload);
  host.handlers['fetchWeakProblem'] = (msg: any) => handleFetchWeakProblem(host);
}


async function handleFetchProblem(host: WorkbenchHost, payload: any) {
  try {
    const minRating = Number(payload?.minRating ?? 800);
    const maxRating = Number(payload?.maxRating ?? 2400);
    // Bug2：前端已尝试过的题目 ID（避免重复推荐同一道题 / 空条件死循环）
    const exclude: Set<string> | undefined = Array.isArray(payload?.exclude)
      ? new Set(payload.exclude.map((x: any) => String(x)))
      : undefined;
    // V0.12：洛谷选题已移除，专心 CF
    const problem = await pickCodeforcesProblem({ minRating, maxRating, tags: [], exclude });
    if (problem.difficulty) host.difficultyById.set(problem.id, problem.difficulty); // Bug6：记录难度

    const current = host.context.globalState.get<PickState>(STATE_KEY) || {};
    const recent = current.recent || [];
    const nextRecent = [problem, ...recent.filter(p => p.id !== problem.id)].slice(0, 10);
    await host.saveState({ platform: 'codeforces', minRating, maxRating, problem, recent: nextRecent });

    host.view?.webview.postMessage({ type: 'problemResult', problem });
    host.view?.webview.postMessage({ type: 'recentList', recent: nextRecent });
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'error', message: e?.message || '选题失败' });
  }
}


async function handleCreateFile(host: WorkbenchHost, payload: any) {
  try {
    const problem = payload?.problem as Problem;
    if (!problem) {
      throw new Error('没有可生成的题目');
    }

    host.view?.webview.postMessage({ type: 'status', message: '正在获取题目详情...' });

    let tests: { input: string; output: string }[] = [];
    let detailWarning: string | undefined;
    try {
      const detail = problem.platform === 'luogu'
        ? await getLuoguProblemDetail(problem)
        : await getCodeforcesProblemDetail(problem);
      tests = detail.tests;
      if (tests.length === 0) {
        detailWarning = '未能从题目页面解析出测试数据（可能被反爬拦截）';
      }
    } catch (e: any) {
      console.error('获取题目详情失败', e);
      detailWarning = e?.message || '获取题目详情失败';
    }

    const filePath = createProblemFile(problem, tests);
    host.view?.webview.postMessage({
      type: 'fileCreated',
      path: filePath,
      message: tests.length > 0
        ? `已生成题目文件夹，${tests.length} 组测试数据已写入 .prob 测试配置。打开文件后内置测试器会自动加载。`
        : `测试数据获取失败：${detailWarning || '未知原因'}。正在自动重试补样例...`
    });

    // 生成即登记刷题记录（不等打开文件）
    ensureRecord(problem).catch(() => { /* 记录失败不影响生成 */ });

    // 抓取失败：后台自动重试，成功后把样例写回 .prob
    if (tests.length === 0) {
      retryBackfill(host, problem, filePath);
    }

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'error', message: e?.message || '生成文件失败' });
  }
}


async function retryBackfill(host: WorkbenchHost, problem: Problem, filePath: string) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await new Promise(r => setTimeout(r, 2500 * attempt));
    try {
      const detail = problem.platform === 'luogu'
        ? await getLuoguProblemDetail(problem)
        : await getCodeforcesProblemDetail(problem);
      if (detail.tests.length > 0) {
        const updated = updateProblemTests(filePath, detail.tests);
        host.view?.webview.postMessage({
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
  host.view?.webview.postMessage({
    type: 'status',
    message: `自动重试 3 次仍未获取到测试数据${lastErr ? '：' + ((lastErr as any)?.message || lastErr) : ''}。可稍后用命令 “ACM Workflow: 重新获取测试数据” 补样例。`
  });
}


async function handleFetchWeakProblem(host: WorkbenchHost, ) {
  try {
    const records = await listRecords();
    const all = await getCodeforcesProblems();
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
        problem = await pickCodeforcesProblem({ minRating: 800, maxRating: 2400, tags: [tag], exclude: solved });
      } catch {
        problem = null;
      }
    }
    if (!problem) {
      problem = await pickCodeforcesProblem({ minRating: 800, maxRating: 2400, tags: [], exclude: solved });
      tag = '随机';
    }
    host.view?.webview.postMessage({ type: 'weakProblem', problem, tag });
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'weakProblem', problem: null, error: e?.message || '薄弱点推荐失败' });
  }
}
