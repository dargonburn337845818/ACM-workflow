/**
 * verifier 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DataGenSpec } from '../../services/dataGen';
import { runVerifier } from '../../services/verifier';
import { defaultDataDir } from '../../utils/paths';
import type { WorkbenchHost } from '../../core/workbench';


export function installVerifier(host: WorkbenchHost): void {
  host.handlers['verifierStart'] = (msg: any) => handleVerifierStart(host, msg?.payload);
  host.handlers['verifierSave'] = (msg: any) => handleVerifierSave(host, msg?.payload);
  host.handlers['verifierPickBrute'] = (msg: any) => handleVerifierPickBrute(host);
}


async function handleVerifierStart(host: WorkbenchHost, payload: any) {
  const solvePath = String(payload?.solvePath || '').trim();
  const brutePath = String(payload?.brutePath || '').trim();
  const maxRounds = Math.round(Number(payload?.maxRounds) || 1000);
  const spec: DataGenSpec = payload?.spec || { type: 'array', nMin: 5, nMax: 10, vMin: 1, vMax: 100 };

  if (!solvePath || !brutePath) {
    host.view?.webview.postMessage({ type: 'verifierStatus', message: '请填写正解与暴力文件路径', isError: true });
    return;
  }
  if (!fs.existsSync(solvePath)) {
    host.view?.webview.postMessage({ type: 'verifierStatus', message: `正解文件不存在：${solvePath}`, isError: true });
    return;
  }
  if (!fs.existsSync(brutePath)) {
    host.view?.webview.postMessage({ type: 'verifierStatus', message: `暴力文件不存在：${brutePath}`, isError: true });
    return;
  }

  host.verifierCancelled = false;
  const timeoutMs = vscode.workspace.getConfiguration('acmWorkflow').get<number>('testTimeoutMs', 5000);
  host.view?.webview.postMessage({ type: 'verifierStatus', message: `编译正解与暴力，开始对拍（最多 ${maxRounds} 组）…` });

  await runVerifier(
    { solvePath, brutePath, maxRounds, spec, timeoutMs },
    {
      onProgress: (p) => host.view?.webview.postMessage({ type: 'verifierProgress', ...p }),
      onMismatch: (m) => host.view?.webview.postMessage({ type: 'verifierMismatch', ...m }),
      onDone: (r) => host.view?.webview.postMessage({ type: 'verifierDone', ...r })
    },
    () => host.verifierCancelled
  );
}


async function handleVerifierSave(host: WorkbenchHost, payload: any) {
  const input = String(payload?.input ?? '');
  const solveOut = String(payload?.solveOut ?? '');
  const bruteOut = String(payload?.bruteOut ?? '');
  if (!input) {
    host.view?.webview.postMessage({ type: 'verifierStatus', message: '没有差异数据可保存', isError: true });
    return;
  }
  try {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(defaultDataDir(), `duipai_diff_${Date.now()}.txt`)),
      filters: { '文本文件': ['txt', 'in'], '所有文件': ['*'] }
    });
    if (!uri) return;
    const content = [
      '== ACM Workflow 对拍差异数据 ==',
      '',
      '--- input ---',
      input.trimEnd(),
      '',
      '--- solve output ---',
      solveOut.trimEnd(),
      '',
      '--- brute output ---',
      bruteOut.trimEnd(),
      ''
    ].join('\n');
    fs.writeFileSync(uri.fsPath, content, 'utf8');
    host.view?.webview.postMessage({ type: 'verifierStatus', message: `差异数据已保存：${uri.fsPath}` });
  } catch (e: any) {
    host.view?.webview.postMessage({ type: 'verifierStatus', message: `保存失败：${e?.message || e}`, isError: true });
  }
}


async function handleVerifierPickBrute(host: WorkbenchHost, ) {
  try {
    const uri = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: '选择暴力程序',
      filters: { 'C++ 源码': ['cpp', 'cc', 'cxx'] }
    });
    if (uri && uri[0]) {
      host.view?.webview.postMessage({ type: 'verifierBrutePicked', path: uri[0].fsPath });
    }
  } catch {
    /* 用户取消 */
  }
}
