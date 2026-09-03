/**
 * records 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Services } from '../../services';
import type { WorkbenchHost } from '../../core/workbench';
import type { Problem } from '../../types';


export function installRecords(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'records' | 'workspace'>): void {
  host.handlers['recordAction'] = (msg: any) => handleRecordAction(host, deps, msg?.payload);
  host.handlers['importCfHistory'] = (msg: any) => handleImportCfHistory(host, deps);
}


async function handleRecordAction(host: WorkbenchHost, deps: Pick<Services, 'records' | 'workspace'>, payload: any) {
  const id = payload?.id;
  const action = payload?.action;
  if (!id || !action) return;
  try {
    if (action === 'delete') {
      await deps.records.remove(id);
      await host.pushRecords();
      return;
    }
    if (action !== 'open') return; // V0.10：记录仅保留「打开题目」+ 未开始的「删除」
    const records = await deps.records.list();
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    // 优先打开本地已生成的题目文件（目录名 = 题号）
    let filePath: string | null = null;
    try {
      for (const cpp of deps.workspace.listProblemCpps()) {
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
      filePath = deps.workspace.createProblemFile(problem, []);
      deps.records.ensure(problem).catch(() => { /* ignore */ });
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    host.pushStatement(); // 立即刷新题面（编辑器切换事件也会触发）
    host.post({ type: 'openStatementView', payload: {} }); // 前端切到题面视图
  } catch (e: any) {
    host.post({ type: 'error', message: e?.message || '打开题目失败' });
  }
}


async function handleImportCfHistory(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'records'>) {
  let handle = vscode.workspace.getConfiguration('acmWorkflow').get<string>('cfHandle', '') || '';
  if (!handle) {
    try {
      const session = await deps.codeforces.getStoredSession();
      if (session && session.handle && session.handle !== 'unknown') handle = session.handle;
    } catch { /* 读失败按未登录处理 */ }
  }
  if (!handle) {
    host.post({ type: 'status', message: '请先登录 Codeforces（工作台顶部登录）', isError: true });
    return;
  }
  await importAndNotify(host, deps, handle);
  await host.pushRecords();
}


async function importAndNotify(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'records'>, handle: string) {
  host.post({ type: 'status', message: `正在拉取 ${handle} 的 AC 历史…` });
  try {
    const n = await importCfHistory(host, deps, handle);
    host.post({ type: 'status', message: `已导入 ${n} 道 AC 记录（重复的自动跳过）` });
  } catch (e: any) {
    host.post({ type: 'error', message: `拉取 AC 历史失败：${e?.message || e}` });
  }
}


async function importCfHistory(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'records'>, handle: string): Promise<number> {
  const stats = await deps.codeforces.fetchUserStats(handle, (page, total) => {
    host.post({
      type: 'status',
      message: `正在爬取第 ${page} 页，已获取 ${total} 条提交记录…`
    });
  }, { force: true }); // V0.12：导入历史强制刷新，绕过旧缓存（否则数据不全）
  const all = await deps.codeforces.getProblems();
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
  return deps.records.bulkImport(items);
}
