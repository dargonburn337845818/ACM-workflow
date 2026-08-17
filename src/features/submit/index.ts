/**
 * submit 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ensureRecord, updateRecord } from '../../services/records';
import { getStoredCredentials, storeCredentials, submitToCodeforces } from '../../services/submitter';
import { findProbFile } from '../../services/template';
import { problemFromProb, problemFromFileName, type WorkbenchHost } from '../../core/workbench';
import type { Problem } from '../../types';


export function installSubmit(host: WorkbenchHost): void {
  host.handlers['submitCurrent'] = (msg: any) => handleSubmitCurrent(host);
}


async function handleSubmitCurrent(host: WorkbenchHost, ) {
  if (host.submitBusy) return;
  const editor = vscode.window.activeTextEditor;
  const filePath = editor?.document.fileName || '';
  if (!filePath.toLowerCase().endsWith('.cpp')) {
    host.view?.webview.postMessage({ type: 'submitResult', ok: false, message: '请先打开要提交的 cpp 文件' });
    return;
  }
  // 定位题目：.prob → 文件名兜底
  let problem: Problem | null = null;
  const probPath = findProbFile(filePath);
  if (probPath) {
    try {
      problem = problemFromProb(JSON.parse(fs.readFileSync(probPath, 'utf8')));
    } catch { problem = null; }
  }
  if (!problem) problem = problemFromFileName(filePath);
  if (!problem || !/^\d+[A-Za-z]\d*$/.test(problem.id)) {
    host.view?.webview.postMessage({ type: 'submitResult', ok: false, message: '无法从当前文件识别 Codeforces 题目（如 2257A）' });
    return;
  }

  // 凭证：SecretStorage（acmWorkflow.cfHandle/cfPassword）
  let creds = await getStoredCredentials(host.context).catch(() => null);
  if (!creds) {
    const handle = await vscode.window.showInputBox({
      prompt: 'Codeforces 提交凭证：Handle',
      ignoreFocusOut: true,
      validateInput: (v) => (v && v.trim() ? null : '不能为空')
    });
    if (!handle) return;
    const password = await vscode.window.showInputBox({
      prompt: 'Codeforces 提交凭证：密码（仅保存在本机系统密钥链）',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v ? null : '不能为空')
    });
    if (!password) return;
    await storeCredentials(host.context, handle.trim(), password);
    creds = { handle: handle.trim(), password };
  }

  host.submitBusy = true;
  host.view?.webview.postMessage({ type: 'submitStatus', message: '正在打开浏览器提交…' });
  try {
    const result = await submitToCodeforces(host.context, problem.id, filePath, creds.handle, creds.password);
    host.view?.webview.postMessage({ type: 'submitResult', ...result });
    // 判定联动：OK → AC，其余 → trying
    if (result.ok && result.verdict) {
      try {
        const rec = await ensureRecord(problem);
        await updateRecord(problem.id, {
          status: result.verdict === 'OK' ? 'ac' : 'trying',
          attempts: rec.attempts + 1
        });
        host.pushRecords();
        host.pushTodayStats();
      } catch { /* 记录失败不影响提交结果 */ }
    }
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'submitResult', ok: false, message: `提交失败：${e?.message || e}` });
  } finally {
    host.submitBusy = false;
  }
}
