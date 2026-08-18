import * as fs from 'fs';
import * as vscode from 'vscode';
import { normalizePath } from '../utils/paths';

/** 探测系统可用的浏览器（Edge/Chrome/Chromium，供 puppeteer 使用）。 */
export function getBrowserPath(): string | null {
  try {
    const custom = vscode.workspace.getConfiguration('acmWorkflow').get<string>('browserPath', '');
    if (custom && custom.trim()) {
      const p = normalizePath(custom);
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 非 VS Code 环境忽略 */ }
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/local/bin/chromium'
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return null;
}
