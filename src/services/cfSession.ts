import * as vscode from 'vscode';
import puppeteer from 'puppeteer-core';
import { getBrowserPath } from './fetchers/luogu';
import { writeSessionCookiesToJar, getFetchDispatcher } from './fetchers/codeforces';

/**
 * CF 登录态管理（模块一）
 *
 * 登录：Puppeteer 启动【有头】浏览器（系统 Chrome/Edge），打开 Codeforces 登录页，
 *       由用户手动输入账号密码；检测到会话 Cookie（X-User-Sha1）即视为登录成功。
 * 存储：提取全部 Cookie（CDP Network.getAllCookies，含 httpOnly）+ localStorage，
 *       以 JSON 写入 vscode.SecretStorage（键 cf.session），并记录登录时间戳。
 * 过期：aec / cc / X-User-Sha1 三个 Cookie 的 expires 最小值即会话过期时间（约一个月），
 *       兜底为登录时间 + 30 天；API 返回 403 时视为会话失效，自动清除并提示重登。
 * 使用：所有 CF API 请求走 cfApiGet()，自动从 SecretStorage 读取会话并附加 Cookie 头。
 */

export const CF_SESSION_KEY = 'cf.session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 兜底有效期：30 天

const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const LOGIN_WAIT_MS = 10 * 60 * 1000; // 等待用户手动登录的上限：10 分钟
const LOGIN_POLL_MS = 1000;
const LOGIN_STATUS_INTERVAL_MS = 15000;

/** 会决定会话生命周期的 Cookie（有效期约为一个月） */
const SESSION_COOKIE_NAMES = ['aec', 'cc', 'X-User-Sha1'];

export interface CfCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;   // epoch 秒（-1 表示会话级 Cookie）
  httpOnly?: boolean;
  secure?: boolean;
}

export interface CfSession {
  version: number;
  handle: string;
  loginTime: number;   // epoch 毫秒
  expiresAt: number;   // epoch 毫秒
  cookies: CfCookie[];
  localStorage: Record<string, string>;
}

/** 会话错误：code 供 UI 区分"未登录 / 已过期 / 其他" */
export class CfSessionError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-logged-in' | 'expired' | 'login-failed' | 'network'
  ) {
    super(message);
    this.name = 'CfSessionError';
  }
}

// ===== 纯函数（可单测）=====

/** 会话过期时间：aec/cc/X-User-Sha1 的 expires 最小值（epoch 秒 → 毫秒）；全缺则 loginTime + 30 天 */
export function computeSessionExpiry(cookies: CfCookie[], loginTime: number): number {
  const expiries = cookies
    .filter((c) => SESSION_COOKIE_NAMES.includes(c.name))
    .map((c) => c.expires)
    .filter((e): e is number => typeof e === 'number' && e > 0);
  if (expiries.length === 0) {
    return loginTime + SESSION_MAX_AGE_MS;
  }
  return Math.min(...expiries) * 1000;
}

/** 拼装 Cookie 请求头（模拟真实浏览器请求） */
export function cookiesToHeader(cookies: CfCookie[]): string {
  return cookies
    .filter((c) => c.name && c.value && c.value !== 'deleted')
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** 解析 SecretStorage 中的会话 JSON；损坏返回 null */
export function parseStoredSession(raw: string | undefined | null): CfSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as CfSession;
    if (!s || typeof s.handle !== 'string' || !Array.isArray(s.cookies)) return null;
    return s;
  } catch {
    return null;
  }
}

export function isSessionExpired(s: CfSession, now: number = Date.now()): boolean {
  return now >= s.expiresAt;
}

// ===== SecretStorage 读写 =====

export async function getStoredSession(context: vscode.ExtensionContext): Promise<CfSession | null> {
  return parseStoredSession(await context.secrets.get(CF_SESSION_KEY));
}

/** 读取会话并做过期检查：过期则自动清除并抛 CfSessionError('expired') */
export async function loadValidSession(context: vscode.ExtensionContext): Promise<CfSession> {
  const session = await getStoredSession(context);
  if (!session) {
    throw new CfSessionError('未登录 Codeforces，请先在工作台顶部登录', 'not-logged-in');
  }
  if (isSessionExpired(session)) {
    await context.secrets.delete(CF_SESSION_KEY);
    throw new CfSessionError(
      'Codeforces 会话已过期（约一个月有效期），请重新登录',
      'expired'
    );
  }
  return session;
}

export async function storeSession(context: vscode.ExtensionContext, session: CfSession): Promise<void> {
  await context.secrets.store(CF_SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(CF_SESSION_KEY);
}

// ===== 有头浏览器登录 =====

async function launchVisibleBrowser() {
  const exe = getBrowserPath();
  if (!exe) {
    throw new CfSessionError('未找到 Edge/Chrome 浏览器，无法打开 Codeforces 登录页', 'login-failed');
  }
  return puppeteer.launch({
    executablePath: exe,
    headless: false, // 有头：用户需要手动输入账号密码
    args: [
      '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=en',
      '--window-size=1100,850',
      '--window-position=120,80'
    ]
  });
}

/** 判断当前页面是否已处于登录态（存在有效的 X-User-Sha1 会话 Cookie） */
function hasSessionCookie(cookies: { name: string; value: string }[]): boolean {
  return cookies.some(
    (c) => c.name === 'X-User-Sha1' && !!c.value && c.value !== 'deleted'
  );
}

/**
 * 启动有头浏览器让用户手动登录 Codeforces，成功后提取会话并存入 SecretStorage。
 * onStatus 用于向工作台实时推送进度（"等待登录… / 登录成功，正在提取会话…"）。
 */
export async function loginCfSession(
  context: vscode.ExtensionContext,
  onStatus?: (message: string) => void
): Promise<CfSession> {
  const browser = await launchVisibleBrowser();
  let lastStatusAt = 0;
  const status = (msg: string) => {
    const now = Date.now();
    if (onStatus && (now - lastStatusAt > 500 || msg === '')) {
      lastStatusAt = now;
      onStatus(msg);
    }
  };

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CF_UA);
    await page.setViewport({ width: 1100, height: 850 });
    await page.goto('https://codeforces.com/enter?locale=en', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    }).catch(() => { /* 网络慢时继续轮询 */ });

    // 若已登录（Cookie 残留），直接进入提取流程
    let loggedIn = hasSessionCookie(await page.cookies());

    if (!loggedIn) {
      status('已打开 Codeforces 登录页，请在浏览器窗口中输入账号密码完成登录…');
      const t0 = Date.now();
      let lastStatusMsg = '';
      while (Date.now() - t0 < LOGIN_WAIT_MS) {
        await new Promise((r) => setTimeout(r, LOGIN_POLL_MS));
        if (page.isClosed()) {
          throw new CfSessionError('登录窗口已被关闭，本次登录取消', 'login-failed');
        }
        try {
          loggedIn = hasSessionCookie(await page.cookies());
        } catch {
          throw new CfSessionError('登录窗口已被关闭，本次登录取消', 'login-failed');
        }
        if (loggedIn) break;
        if (Date.now() - lastStatusAt > LOGIN_STATUS_INTERVAL_MS) {
          const msg = `仍在等待登录…（已等待 ${Math.round((Date.now() - t0) / 60000)} 分钟，可在浏览器中完成登录）`;
          if (msg !== lastStatusMsg) {
            lastStatusMsg = msg;
            status(msg);
          }
        }
      }
      if (!loggedIn) {
        throw new CfSessionError('等待登录超时（10 分钟），请重试', 'login-failed');
      }
    }

    status('登录成功，正在提取会话数据…');

    // 回到首页确认登录态，并从页头提取 handle
    await page.goto('https://codeforces.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => { /* 提取 handle 失败时回退到空 */ });
    const handle = await page.evaluate(() => {
      const a = document.querySelector('.lang-chooser a[href*="/profile/"]');
      return a ? (a.textContent || '').trim() : '';
    }).catch(() => '');

    // CDP 全量 Cookie（含 httpOnly），比 page.cookies() 更完整
    const cdp = await page.createCDPSession();
    const { cookies } = await cdp.send('Network.getAllCookies') as { cookies: CfCookie[] };

    const localStorage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k) out[k] = window.localStorage.getItem(k) || '';
      }
      return out;
    }).catch(() => ({}));

    const loginTime = Date.now();
    const session: CfSession = {
      version: 1,
      handle: handle || 'unknown',
      loginTime,
      expiresAt: computeSessionExpiry(cookies, loginTime),
      cookies,
      localStorage
    };
    await storeSession(context, session);
    // V0.17.2：登录会话同步写入 curl cookie jar，此后所有页面/样例抓取带真实登录态，
    // 显著降低匿名限流导致的卡顿/失败
    writeSessionCookiesToJar(session.cookies);

    status('');
    return session;
  } catch (e: any) {
    if (e instanceof CfSessionError) throw e;
    throw new CfSessionError(`登录过程出错：${e?.message || e}`, 'login-failed');
  } finally {
    await browser.close().catch(() => {});
  }
}

// ===== CF API（统一入口，自动附加会话 Cookie）=====

export interface CfApiOptions {
  /** 需要登录态（附加 Cookie 头）；默认 false（contest.list 等公开接口无需登录） */
  needSession?: boolean;
  timeoutMs?: number;
}

/** 调用 Codeforces API：自动读取 SecretStorage 会话并附加 Cookie，模拟真实浏览器访问 */
export async function cfApiGet<T>(
  context: vscode.ExtensionContext,
  apiPath: string,
  query: Record<string, string | number | boolean> = {},
  options: CfApiOptions = {}
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const url = `https://codeforces.com/api/${apiPath}${qs.toString() ? '?' + qs.toString() : ''}`;

  const headers: Record<string, string> = {
    'User-Agent': CF_UA,
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://codeforces.com/'
  };

  if (options.needSession) {
    let session: CfSession;
    try {
      session = await loadValidSession(context);
    } catch (e: any) {
      throw e instanceof CfSessionError ? e : new CfSessionError(e?.message || '会话读取失败', 'not-logged-in');
    }
    headers['Cookie'] = cookiesToHeader(session.cookies);
  }

  const timeoutMs = options.timeoutMs ?? 20000;
  let res: Response;
  try {
    const dispatcher = getFetchDispatcher();
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      ...(dispatcher ? { dispatcher } : {})
    } as any);
  } catch (e: any) {
    throw new CfSessionError(`CF API 网络请求失败：${e?.message || e}`, 'network');
  }

  // 403 = 会话失效（CF 对无效会话的典型响应），清除并提示重新登录
  if (res.status === 403) {
    if (options.needSession) {
      await clearSession(context);
      throw new CfSessionError('Codeforces 会话已失效（被服务端拒绝），请重新登录', 'expired');
    }
    throw new CfSessionError(`CF API 拒绝访问（HTTP 403），可能被限流，请稍后重试`, 'network');
  }
  if (!res.ok) {
    throw new CfSessionError(`CF API 请求失败（HTTP ${res.status}）`, 'network');
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new CfSessionError('CF API 返回非 JSON 数据', 'network');
  }
  if (data?.status !== 'OK') {
    throw new CfSessionError(`CF API 返回错误：${data?.comment || 'unknown'}`, 'network');
  }
  return data.result as T;
}
