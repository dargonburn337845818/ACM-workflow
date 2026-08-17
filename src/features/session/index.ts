/**
 * session 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import { CfSessionError } from '../../services/cfSession';
import { clearSession, getStoredSession, isSessionExpired, loginCfSession } from '../../services/cfSession';
import type { WorkbenchHost } from '../../core/workbench';


export function installSession(host: WorkbenchHost): void {
  host.handlers['cfSessionReady'] = (msg: any) => pushCfSessionState(host);
  host.handlers['cfLogin'] = (msg: any) => handleCfLogin(host);
  host.handlers['cfLogout'] = (msg: any) => handleCfLogout(host);
}


async function pushCfSessionState(host: WorkbenchHost, ) {
  let state: { status: 'logged-in' | 'logged-out' | 'expired'; handle?: string; loginTime?: number; expiresAt?: number } = {
    status: 'logged-out'
  };
  try {
    const session = await getStoredSession(host.context);
    if (session) {
      if (isSessionExpired(session)) {
        state = { status: 'expired', handle: session.handle, loginTime: session.loginTime, expiresAt: session.expiresAt };
      } else {
        state = { status: 'logged-in', handle: session.handle, loginTime: session.loginTime, expiresAt: session.expiresAt };
      }
    }
  } catch {
    /* 读失败按未登录处理 */
  }
  host.view?.webview.postMessage({ type: 'cfSessionState', state });
}


async function handleCfLogin(host: WorkbenchHost, ) {
  host.view?.webview.postMessage({ type: 'cfLoginStatus', message: '正在打开 Codeforces 登录页…', busy: true });
  try {
    const session = await loginCfSession(host.context, (message) => {
      if (message) {
        host.view?.webview.postMessage({ type: 'cfLoginStatus', message, busy: true });
      }
    });
    host.view?.webview.postMessage({
      type: 'cfLoginStatus',
      message: `登录成功：${session.handle}。会话已加密保存（有效期约 ${Math.max(1, Math.round((session.expiresAt - session.loginTime) / 86400000))} 天）。`,
      busy: false,
      ok: true
    });

    // 登录成功后可顺带把 cfHandle 配置补上（仅当用户此前未手动绑定过）
    const cfg = vscode.workspace.getConfiguration('acmWorkflow');
    const existing = cfg.get<string>('cfHandle', '') || '';
    if (!existing && session.handle && session.handle !== 'unknown') {
      await cfg.update('cfHandle', session.handle, vscode.ConfigurationTarget.Global);
    }

    await pushCfSessionState(host);
    host.pushRecords();
    host.pushHistoryData();
  } catch (e: any) {
    const msg = e instanceof CfSessionError
      ? e.message
      : `登录失败：${e?.message || e}`;
    host.view?.webview.postMessage({ type: 'cfLoginStatus', message: msg, busy: false, isError: true });
    await pushCfSessionState(host);
  }
}


async function handleCfLogout(host: WorkbenchHost, ) {
  await clearSession(host.context);
  host.view?.webview.postMessage({ type: 'cfLoginStatus', message: '已退出 Codeforces 登录态', busy: false });
  await pushCfSessionState(host);
}
