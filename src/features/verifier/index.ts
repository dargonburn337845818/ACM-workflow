/**
 * verifier 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CheckerOptions, CompareMode, DataGenSpec, Services } from '../../services';
import { defaultDataDir } from '../../utils/paths';
import type { WorkbenchHost } from '../../core/workbench';


export function installVerifier(host: WorkbenchHost, deps: Pick<Services, 'judge'>): void {
  host.handlers['verifierStart'] = (msg: any) => handleVerifierStart(host, deps, msg?.payload);
  host.handlers['verifierSave'] = (msg: any) => handleVerifierSave(host, msg?.payload);
  host.handlers['verifierPickBrute'] = (msg: any) => handleVerifierPickBrute(host);
  host.handlers['verifierPickChecker'] = (msg: any) => handleVerifierPickChecker(host);
}


async function handleVerifierStart(host: WorkbenchHost, deps: Pick<Services, 'judge'>, payload: any) {
  const solvePath = String(payload?.solvePath || '').trim();
  const brutePath = String(payload?.brutePath || '').trim();
  const maxRounds = Math.round(Number(payload?.maxRounds) || 1000);
  const spec: DataGenSpec = payload?.spec || { type: 'array', nMin: 5, nMax: 10, vMin: 1, vMax: 100 };

  const rawChecker = payload?.checker || {};
  const mode = String(rawChecker.mode || 'exact') as CompareMode;
  const checkerPath = String(rawChecker.checkerPath || '').trim();
  if (mode === 'spj' && !checkerPath) {
    host.post({ type: 'verifierStatus', message: 'Special Judge 模式需要选择/填写 SPJ 程序路径', isError: true });
    return;
  }
  const epsRaw = Number(rawChecker.eps);
  const eps = Number.isFinite(epsRaw) && epsRaw >= 0 ? epsRaw : 1e-6;
  const checker: CheckerOptions = {
    mode,
    eps,
    checkerPath: checkerPath || undefined
  };

  if (!solvePath || !brutePath) {
    host.post({ type: 'verifierStatus', message: '请填写正解与暴力文件路径', isError: true });
    return;
  }
  if (!fs.existsSync(solvePath)) {
    host.post({ type: 'verifierStatus', message: `正解文件不存在：${solvePath}`, isError: true });
    return;
  }
  if (!fs.existsSync(brutePath)) {
    host.post({ type: 'verifierStatus', message: `暴力文件不存在：${brutePath}`, isError: true });
    return;
  }
  if (checkerPath && !fs.existsSync(checkerPath)) {
    host.post({ type: 'verifierStatus', message: `SPJ 程序不存在：${checkerPath}`, isError: true });
    return;
  }

  host.verifierCancelled = false;
  const timeoutMs = deps.judge.defaultTimeoutMs();
  host.post({ type: 'verifierStatus', message: `编译正解与暴力，开始对拍（最多 ${maxRounds} 组）…` });

  await deps.judge.runVerifier(
    { solvePath, brutePath, maxRounds, spec, timeoutMs, checker },
    {
      onProgress: (p) => host.post({ type: 'verifierProgress', ...p }),
      onMismatch: (m) => host.post({ type: 'verifierMismatch', ...m }),
      onDone: (r) => host.post({ type: 'verifierDone', ...r })
    },
    () => host.verifierCancelled
  );
}


async function handleVerifierSave(host: WorkbenchHost, payload: any) {
  const input = String(payload?.input ?? '');
  const solveOut = String(payload?.solveOut ?? '');
  const bruteOut = String(payload?.bruteOut ?? '');
  if (!input) {
    host.post({ type: 'verifierStatus', message: '没有差异数据可保存', isError: true });
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
    host.post({ type: 'verifierStatus', message: `差异数据已保存：${uri.fsPath}` });
  } catch (e: any) {
    host.post({ type: 'verifierStatus', message: `保存失败：${e?.message || e}`, isError: true });
  }
}


async function handleVerifierPickBrute(host: WorkbenchHost) {
  try {
    const uri = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: '选择暴力程序',
      filters: { 'C++ 源码': ['cpp', 'cc', 'cxx'] }
    });
    if (uri && uri[0]) {
      host.post({ type: 'verifierBrutePicked', path: uri[0].fsPath });
    }
  } catch {
    /* 用户取消 */
  }
}


async function handleVerifierPickChecker(host: WorkbenchHost) {
  try {
    const uri = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: '选择 SPJ 程序',
      filters: {
        'C++ / Python / JS': ['cpp', 'cc', 'cxx', 'py', 'js', 'mjs', 'cjs'],
        '可执行程序': ['exe'],
        '所有文件': ['*']
      }
    });
    if (uri && uri[0]) {
      host.post({ type: 'verifierCheckerPicked', path: uri[0].fsPath });
    }
  } catch {
    /* 用户取消 */
  }
}
