/**
 * urlImport 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import { parseCfProblemUrl } from '../../services/cfUrl';
import { getCodeforcesProblemDetail } from '../../services/fetchers/codeforces';
import { ensureRecord } from '../../services/records';
import { readStatementCache } from '../../services/statementCache';
import { writeStatementFiles } from '../../services/statementFiles';
import { createProblemFile, findProblemCppById } from '../../services/template';
import type { WorkbenchHost } from '../../core/workbench';
import type { Problem } from '../../types';


export function installUrlimport(host: WorkbenchHost): void {
  host.handlers['urlImport'] = (msg: any) => handleUrlImport(host, msg?.payload);
}


async function handleUrlImport(host: WorkbenchHost, payload: any) {
  if (host.urlImportBusy) return; // 防重复点击
  const raw = String(payload?.url || '');
  const status = (message: string, isError = false) =>
    host.view?.webview.postMessage({ type: 'urlImportStatus', busy: host.urlImportBusy, message, isError });

  host.urlImportBusy = true;
  console.log(`[ACM-Workflow][URL导入] 开始导入：${raw}`);
  status('正在解析 URL…');
  try {
    const parsed = parseCfProblemUrl(raw);
    console.log(`[ACM-Workflow][URL导入] 解析成功：${parsed.id}（${parsed.url}）`);
    const problem: Problem = {
      id: parsed.id,
      platform: 'codeforces',
      title: parsed.index,
      tags: [],
      url: parsed.url
    };

    // 本地查重：已存在 → 直接打开
    const existing = findProblemCppById(parsed.id);
    if (existing) {
      console.log(`[ACM-Workflow][URL导入] 题目已存在：${existing}`);
      status('题目已存在，正在打开…');
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(existing));
      await vscode.window.showTextDocument(doc, { preview: false });
      host.pushStatement(); // 编辑器切换事件可能先于本流程，显式拉一次确保题面加载
      host.view?.webview.postMessage({ type: 'urlImportDone', filePath: existing, existed: true, message: '题目已存在，已直接打开' });
      return;
    }

    // 抓取样例（多策略 curl）
    status('正在抓取题面与样例…');
    const detail = await getCodeforcesProblemDetail(problem);
    console.log(`[ACM-Workflow][URL导入] 样例抓取完成：${detail.tests.length} 组`);

    // 生成 cpp + .prob（含 .cph 双盘符）
    status('正在生成题目文件…');
    const filePath = createProblemFile(problem, detail.tests);
    ensureRecord(problem).catch(() => { /* 记录失败不影响导入 */ });
    console.log(`[ACM-Workflow][URL导入] 已生成：${filePath}`);

    // 题面缓存：全局缓存命中 → 直接落盘题目文件夹（pushStatement 优先读文件夹缓存，免二次抓取）
    const cachedHtml = readStatementCache('codeforces', parsed.id);
    if (cachedHtml) {
      writeStatementFiles(filePath, cachedHtml, null);
      console.log(`[ACM-Workflow][URL导入] 全局题面缓存命中并已落盘（${cachedHtml.length} 字符）`);
    }

    status('正在打开文件并加载题面…');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    // 主动触发题面加载：无文件夹缓存时抓取+翻译+落盘+推送；有缓存则秒开
    host.pushStatement();

    host.view?.webview.postMessage({
      type: 'urlImportDone',
      filePath,
      existed: false,
      message: `导入完成：${parsed.id}（样例 ${detail.tests.length} 组，已打开）`
    });
  } catch (e: any) {
    console.error(`[ACM-Workflow][URL导入] 失败：${e?.message || e}`);
    status(`导入失败：${e?.message || e}`, true);
  } finally {
    host.urlImportBusy = false;
  }
}
