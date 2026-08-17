import * as vscode from 'vscode';
import * as fs from 'fs';
import puppeteer, { Page } from 'puppeteer-core';
import { getBrowserPath } from './fetchers/luogu';

/**
 * 一键提交（实验性 P2）：puppeteer 登录 Codeforces 并提交当前代码。
 * 凭证（handle/password）保存在 SecretStorage，首次提交时由 Webview 收集。
 */

export interface SubmitResult {
  ok: boolean;
  message: string;
  submissionUrl?: string;
  /** 轮询到的判定（OK / WA / TLE ...）；超时未出结果时为空 */
  verdict?: string;
}

const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

export const SECRET_HANDLE = 'acmWorkflow.cfHandle';
export const SECRET_PASSWORD = 'acmWorkflow.cfPassword';

export async function getStoredCredentials(context: vscode.ExtensionContext): Promise<{ handle: string; password: string } | null> {
  const [handle, password] = await Promise.all([
    context.secrets.get(SECRET_HANDLE),
    context.secrets.get(SECRET_PASSWORD)
  ]);
  return handle && password ? { handle, password } : null;
}

export async function storeCredentials(context: vscode.ExtensionContext, handle: string, password: string): Promise<void> {
  await context.secrets.store(SECRET_HANDLE, handle.trim());
  await context.secrets.store(SECRET_PASSWORD, password);
}

async function launchBrowser() {
  const exe = getBrowserPath();
  if (!exe) {
    throw new Error('未找到 Edge/Chrome 浏览器，无法提交');
  }
  return puppeteer.launch({
    executablePath: exe,
    headless: false,
    args: [
      '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=en',
      '--window-position=-32000,-32000',
      '--window-size=1280,900'
    ]
  });
}

/** 从 problemId（如 1966C / P1000）解析 CF contestId + index */
function parseCfId(problemId: string): { contestId: string; index: string } | null {
  const m = /^(\d+)([A-Za-z]\d*)$/.exec(problemId);
  return m ? { contestId: m[1], index: m[2] } : null;
}

async function ensureLoggedIn(page: Page, handle: string, password: string): Promise<void> {
  await page.goto('https://codeforces.com/enter', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  const hasForm = await page.$('input[name="handleOrEmail"]').catch(() => null);
  if (!hasForm) return; // 已登录
  await page.type('input[name="handleOrEmail"]', handle, { delay: 25 });
  await page.type('input[name="password"]', password, { delay: 25 });
  // 洛谷式点击提交按钮（带 CSRF token）
  await page.evaluate(() => {
    const doc = document as any;
    const btn = doc.querySelector('input[type="submit"], button[type="submit"]');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 4000));
  const stillForm = await page.$('input[name="handleOrEmail"]').catch(() => null);
  if (stillForm) {
    throw new Error('CF 登录失败：账号或密码错误（若已开启两步验证请先在浏览器登录一次）');
  }
}

/** 提交代码到 CF，并轮询一次判定结果（最多 90s） */
export async function submitToCodeforces(
  context: vscode.ExtensionContext,
  problemId: string,
  filePath: string,
  handle: string,
  password: string
): Promise<SubmitResult> {
  const parsed = parseCfId(problemId);
  if (!parsed) {
    return { ok: false, message: '仅支持 Codeforces 题目一键提交（洛谷提交暂未开放）' };
  }
  const code = fs.readFileSync(filePath, 'utf8');
  if (!code.trim()) {
    return { ok: false, message: '代码为空，无法提交' };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CF_UA);
    await page.setViewport({ width: 1280, height: 900 });

    await ensureLoggedIn(page, handle, password);

    const submitUrl = `https://codeforces.com/contest/${parsed.contestId}/submit`;
    await page.goto(submitUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));

    // 选择语言：GNU G++20（优先 64 位 winlibs）
    const langSelected = await page.evaluate(() => {
      const doc = document as any;
      const sel = doc.querySelector('select[name="programTypeId"]');
      if (!sel) return false;
      const opts = Array.from(sel.options) as any[];
      const pick = opts.find((o) => /GNU G\+\+20/i.test(o.textContent || '') && /64|winlibs|17/i.test(o.textContent || ''))
        || opts.find((o) => /GNU G\+\+20/i.test(o.textContent || ''))
        || opts.find((o) => /GNU G\+\+/i.test(o.textContent || ''));
      if (!pick) return false;
      sel.value = pick.value;
      return true;
    });
    if (!langSelected) {
      return { ok: false, message: '提交页未找到 G++20 语言选项（页面结构可能变化）' };
    }

    // 填入代码
    const codeFilled = await page.evaluate((src) => {
      const doc = document as any;
      const ta = doc.querySelector('textarea[name="source"], #sourceCodeTextarea');
      if (!ta) return false;
      ta.value = src;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, code);
    if (!codeFilled) {
      return { ok: false, message: '提交页未找到代码输入框' };
    }

    await new Promise((r) => setTimeout(r, 800));
    await page.evaluate(() => {
      const doc = document as any;
      const btn = doc.querySelector('input[type="submit"], button[type="submit"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 5000));

    // 轮询最新提交判定（API）
    const t0 = Date.now();
    let verdict = '';
    while (Date.now() - t0 < 90000) {
      try {
        const res = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=1`, {
          headers: { 'User-Agent': CF_UA },
          signal: AbortSignal.timeout(15000)
        });
        const data = await res.json() as any;
        const sub = data?.result?.[0];
        if (sub && sub.problem && String(sub.problem.contestId) === parsed.contestId && String(sub.problem.index).toUpperCase() === parsed.index.toUpperCase()) {
          if (sub.verdict && sub.verdict !== 'TESTING') {
            verdict = sub.verdict;
            break;
          }
        }
      } catch {
        /* 轮询失败继续 */
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    const submissionUrl = `https://codeforces.com/submissions/${encodeURIComponent(handle)}`;
    if (verdict) {
      const label = verdict === 'OK' ? 'Accepted ✓' : verdict;
      return { ok: true, message: `已提交，判定：${label}`, submissionUrl, verdict };
    }
    return { ok: true, message: '已提交，判定等待中（可到提交页查看）', submissionUrl };
  } catch (e: any) {
    return { ok: false, message: `提交失败：${e?.message || e}` };
  } finally {
    await browser.close().catch(() => {});
  }
}
