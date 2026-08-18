/**
 * records 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { getCodeforcesProblems } from '../../services/fetchers/codeforces';
import { fetchUserStats } from '../../services/fetchers/userStats/codeforces';
import { getStoredSession } from '../../services/cfSession';
import { bulkImport, ensureRecord, listRecords, removeRecord } from '../../services/records';
import { createProblemFile, listProblemCpps } from '../../services/template';
import type { WorkbenchHost } from '../../core/workbench';
import type { Problem } from '../../types';


export function installRecords(host: WorkbenchHost): void {
  host.handlers['recordAction'] = (msg: any) => handleRecordAction(host, msg?.payload);
  host.handlers['importCfHistory'] = (msg: any) => handleImportCfHistory(host);
}


async function handleRecordAction(host: WorkbenchHost, payload: any) {
  const id = payload?.id;
  const action = payload?.action;
  if (!id || !action) return;
  try {
    if (action === 'delete') {
      // V0.10：仅「未开始」题目可删除（已 AC 的题目不能删除）
      const records = await listRecords();
      const rec = records.find((r) => r.id === id);
      if (rec && rec.status === 'untouched') {
        await removeRecord(id);
        await host.pushRecords();
        await host.pushHistoryData();
      }
      return;
    }
    if (action !== 'open') return; // V0.10：记录仅保留「打开题目」+ 未开始的「删除」
    const records = await listRecords();
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    // 优先打开本地已生成的题目文件（目录名 = 题号）
    let filePath: string | null = null;
    try {
      for (const cpp of listProblemCpps()) {
        if (path.basename(path.dirname(cpp)).toLowerCase() === rec.id.toLowerCase()) {
          filePath = cpp;
          break;
        }
      }
    } catch {
      /* ignore */
    }
    // 本地没有 → 按记录生成代码文件（不抓样例，打开后可用命令补样例）
    if (!filePath) {
      const problem: Problem = {
        id: rec.id,
        platform: rec.platform,
        title: rec.title,
        tags: [],
        url: rec.url
      };
      filePath = createProblemFile(problem, []);
      ensureRecord(problem).catch(() => { /* ignore */ });
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    host.pushStatement(); // 立即刷新题面（编辑器切换事件也会触发）
    host.view?.webview.postMessage({ type: 'openStatementView', payload: {} }); // 前端切到题面视图
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'error', message: e?.message || '打开题目失败' });
  }
}


async function handleImportCfHistory(host: WorkbenchHost, ) {
  let handle = vscode.workspace.getConfiguration('acmWorkflow').get<string>('cfHandle', '') || '';
  if (!handle) {
    try {
      const session = await getStoredSession(host.context);
      if (session && session.handle && session.handle !== 'unknown') handle = session.handle;
    } catch { /* 读失败按未登录处理 */ }
  }
  if (!handle) {
    host.view?.webview.postMessage({ type: 'status', message: '请先登录 Codeforces（工作台顶部登录）', isError: true });
    return;
  }
  await importAndNotify(host, handle);
  await host.pushRecords();
  await host.pushHistoryData();
}


async function importAndNotify(host: WorkbenchHost, handle: string) {
  host.view?.webview.postMessage({ type: 'status', message: `正在拉取 ${handle} 的 AC 历史…` });
  try {
    const n = await importCfHistory(host, handle);
    host.view?.webview.postMessage({ type: 'status', message: `已导入 ${n} 道 AC 记录（重复的自动跳过）` });
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'error', message: `拉取 AC 历史失败：${e?.message || e}` });
  }
}


async function importCfHistory(host: WorkbenchHost, handle: string): Promise<number> {
  const stats = await fetchUserStats(handle, (page, total) => {
    host.view?.webview.postMessage({
      type: 'status',
      message: `正在爬取第 ${page} 页，已获取 ${total} 条提交记录…`
    });
  }, { force: true }); // V0.12：导入历史强制刷新，绕过旧缓存（否则数据不全）
  const all = await getCodeforcesProblems();
  const map = new Map(all.map((p) => [p.id, p]));
  const items = [...stats.solved]
    .filter((id) => map.has(id))
    .map((id) => {
      const p = map.get(id)!;
      const acSec = stats.solvedAt.get(id);
      return {
        id,
        platform: 'codeforces' as const,
        title: p.title,
        difficulty: p.difficulty,
        url: p.url,
        status: 'ac' as const,
        attempts: 1,
        // 历史 AC 时间（秒 → 毫秒），避免历史题混入"今日 AC"
        updatedAt: acSec ? acSec * 1000 : undefined
      };
    });
  return bulkImport(items);
}
