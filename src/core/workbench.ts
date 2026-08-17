import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { KNOWLEDGE_CATEGORIES } from '../features/manual/knowledgeMap';
import { getCodeforcesProblems, getCodeforcesProblemDetail } from '../services/fetchers/codeforces';
import { getLuoguProblemDetail, searchLuoguByKeyword } from '../services/fetchers/luogu';
import { fetchStatement, parseLimitsFromHtml } from '../services/fetchers/statement';
import { translateStatementHtml, countTranslatableParagraphs } from '../services/translate';
import { readStatementCache, writeStatementCache } from '../services/statementCache';
import { readStatementFiles, writeStatementFiles } from '../services/statementFiles';
import { findProbFile, updateProblemTests, listProblemCpps, saveProblemTests } from '../services/template';
import { compileCpp } from '../services/runner';
import { diagnoseEnv } from '../services/runner';
import { listRecords, ensureRecord, getStats, ProblemRecord } from '../services/records';
import { computeDifficultyBins } from '../services/statistics';
import { ContestDetail } from '../services/cfContest';
import { Problem } from '../types';
import { installSession } from '../features/session';
import { installContest } from '../features/contest';
import { installDatagen } from '../features/datagen';
import { installVerifier } from '../features/verifier';
import { installSubmit } from '../features/submit';
import { installUrlimport } from '../features/urlImport';
import { installPick } from '../features/pick';
import { installTest } from '../features/test';
import { installRecords } from '../features/records';

/** 消息处理器：返回 Promise 或直接完成 */
export type Handler = (msg: any) => Promise<void> | void;

/** 功能模块宿主接口：workbench 类对 features 暴露的能力（V0.18 结构重组） */
export interface WorkbenchHost {
  view: vscode.WebviewView | undefined;
  context: vscode.ExtensionContext;
  post(msg: any): void;
  handlers: Record<string, Handler>;
  // 联动状态（由 workbench 持有，features 读写）
  testCancelled: boolean;
  verifierCancelled: boolean;
  contestDetailCache: Map<number, { at: number; detail: any }>;
  lastStatement: { id: string; title: string; url: string; html: string; filePath?: string } | null;
  lastLimits: { timeLimitMs?: number; memoryLimitMb?: number } | null;
  translateCache: Map<string, (string | null)[]>;
  statementTasks: Map<string, Promise<void>>;
  difficultyById: Map<string, number>;
  submitBusy: boolean;
  urlImportBusy: boolean;
  // 联动方法（保留在 workbench 类，features 跨模块调用）
  pushTestState(): Promise<void>;
  pushStatement(force?: boolean): Promise<void>;
  pushRecords(): Promise<void>;
  pushTodayStats(): Promise<void>;
  pushHistoryData(): Promise<void>;
  refreshDifficultyMap(): Promise<void>;
  limitsPayload(): { timeLabel?: string; memoryLabel?: string };
  doFetchAndPushStatement(filePath: string, problem: Problem): Promise<void>;
  /** 选题视图状态持久化（globalState，键 acmWorkflow.pickState） */
  saveState(patch: Partial<PickState>): Promise<void>;
  /** 单用例超时：优先按题面时间限制 + 1s 缓冲，否则用配置 testTimeoutMs */
  testTimeoutMs(): number;
  /** 编译当前文件（带缓存）；失败时向 webview 发送错误提示并返回 { ok: false } */
  compileFor(filePath: string, caseCount: number, mode?: string): { ok: boolean; exePath?: string; message: string };
}

/** 选题视图状态（globalState 持久化） */
export interface PickState {
  platform?: 'codeforces' | 'luogu';
  minRating?: number;
  maxRating?: number;
  problem?: Problem;
  recent?: Problem[];
}

export const STATE_KEY = 'acmWorkflow.pickState';

function renderPickView(): string {
  return `
    <div class="view" id="view-pick">
      <div class="pick-wrap">
        <p class="muted">随机推荐训练通用能力，或基于 CF 提交通过率精准补弱。</p>

        <div class="card pick-card">
          <div class="control-row diff-row">
            <div class="diff-head">
              <label>难度区间</label>
              <span class="mono diff-label" id="diff-label">800 — 2400</span>
            </div>
            <div class="diff-sliders">
              <div class="slider-track"></div>
              <div class="slider-fill" id="slider-fill"></div>
              <input type="range" id="min-range" min="800" max="3500" step="100" value="800" title="最低难度">
              <input type="range" id="max-range" min="800" max="3500" step="100" value="2400" title="最高难度">
            </div>
            <div class="range-ends">
              <span class="mono range-end" id="range-min-label">800</span>
              <span class="mono range-end" id="range-max-label">3500</span>
            </div>
          </div>

          <div class="control-row pick-actions">
            <button id="weak-btn" class="btn gold" title="基于本地 AC 记录，推荐通过率最低专题中的未 AC 题（Codeforces）">薄弱点推荐</button>
            <button id="pick-btn" class="primary-btn">随机推荐</button>
          </div>
        </div>

        <!-- V0.23：通过 URL 直接导入题目 -->
        <div class="card url-import-card">
          <div class="url-import-head">
            <label>通过 URL 导入</label>
            <span class="muted url-import-hint">粘贴 CF 题目链接，一键生成 cpp + 题面</span>
          </div>
          <div class="url-import-row">
            <input id="url-import-input" class="url-import-input mono" placeholder="https://codeforces.com/problemset/problem/1791/E" spellcheck="false">
            <button id="url-import-btn" class="primary-btn">导入</button>
          </div>
          <div id="url-import-status" class="url-import-status"></div>
        </div>

        <div id="pick-result" class="pick-result"></div>
        <div id="pick-status" class="pick-status"></div>

        <div class="recent-section">
          <div class="recent-head">
            <h3>最近推荐</h3>
            <button id="clear-history-btn" class="ghost-btn">清空</button>
          </div>
          <div id="recent-list" class="recent-list"></div>
        </div>
      </div>
    </div>
  `;
}

/** 从 .prob 内容构造 Problem（用于刷题记录登记） */
export function problemFromProb(prob: any): Problem | null {
  const url = String(prob?.url || '');
  if (!url) return null;
  let platform: 'codeforces' | 'luogu' = 'codeforces';
  let id = '';
  if (url.includes('luogu.com.cn')) {
    platform = 'luogu';
    const m = /\/problem\/([A-Za-z0-9]+)/.exec(url);
    id = m ? m[1] : '';
  } else if (url.includes('codeforces.com')) {
    const m = /problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/.exec(url)
      || /contest\/(\d+)\/problem\/([A-Za-z0-9]+)/.exec(url);
    id = m ? m[1] + m[2] : '';
  }
  if (!id) return null;
  const name = String(prob?.name || '');
  const title = name.replace(/^[A-Za-z0-9]+\.[\s\u00a0]*/, '').trim() || name;
  return { id, platform, title, tags: [], url };
}

function cfProblem(contestId: string, index: string): Problem {
  return {
    id: contestId + index,
    platform: 'codeforces',
    title: '',
    tags: [],
    url: `https://codeforces.com/problemset/problem/${contestId}/${index}`
  };
}

function luoguProblem(id: string): Problem {
  const pid = id.toUpperCase();
  return { id: pid, platform: 'luogu', title: '', tags: [], url: `https://www.luogu.com.cn/problem/${pid}` };
}

/**
 * 从文件名 / 路径解析题目 ID（V0.13：修复「文件名是题目名、题号在目录名」的场景）。
 * 解析顺序：
 *  1. 文件名（basename）：`P1001.cpp` → 洛谷；`979E.cpp` → CF（contestId=979, index=E）
 *  2. 父目录名：`Codeforces/154A/Hometask.cpp` → CF 154A；`Luogu/P1660/x.cpp` → 洛谷 P1660
 *  3. USACO 文件名 → 返回 null（由 pushStatement 走洛谷关键字搜索）
 * 其余（main.cpp / A.cpp 等）→ 不是题目文件，返回 null
 */
export function problemFromFileName(filePath: string): Problem | null {
  const base = path.basename(filePath).replace(/\.cpp$/i, '');
  const dir = path.basename(path.dirname(filePath));
  // 1) 文件名优先
  if (/^p\d+$/i.test(base)) return luoguProblem(base);
  const m = /^(\d{3,6})([A-Za-z]\d*)$/.exec(base);
  if (m) return cfProblem(m[1], m[2]);
  // 洛谷目录下的纯数字文件名
  if (dir.toLowerCase() === 'luogu' && /^\d+$/.test(base)) return luoguProblem(base);
  // 2) V0.13：父目录名 = 题号（扩展生成的题目目录结构 code/{平台}/{题号}/题目名.cpp）
  if (/^p\d+$/i.test(dir)) return luoguProblem(dir);
  const dm = /^(\d{3,6})([A-Za-z]\d*)$/.exec(dir);
  if (dm) return cfProblem(dm[1], dm[2]);
  // 3) USACO 由 pushStatement 异步搜索
  if (/^USACO/i.test(base)) return null;
  return null;
}

/** 今日 AC 数 + 连续刷题天数（以 ac 记录的 updatedAt 为据） */
function computeTodayStats(records: ProblemRecord[]): { acToday: number; streak: number } {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const DAY = 86400000;
  const today0 = dayStart(new Date());
  const acRecords = records.filter(r => r.status === 'ac');

  const acToday = acRecords.filter(r => r.updatedAt >= today0).length;

  // 连续天数：今天有 AC 从今天起算，否则从昨天起算（只要没断就续上）
  let streak = 0;
  const cursor = new Date(today0);
  if (acToday === 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  for (;;) {
    const start = dayStart(cursor);
    const has = acRecords.some(r => r.updatedAt >= start && r.updatedAt < start + DAY);
    if (!has) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { acToday, streak };
}


export class WorkbenchSidebarProvider implements vscode.WebviewViewProvider, WorkbenchHost {
  public static readonly viewType = 'acmWorkflow.workbench';
  private static output: vscode.OutputChannel | undefined;
  public view: vscode.WebviewView | undefined;
  private readonly extensionUri: vscode.Uri;
  public readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  /** 测试运行取消标志（前端发 testCancel 置位） */
  public testCancelled = false;

  /** 对拍取消标志（前端发 verifierCancel 置位） */
  public verifierCancelled = false;

  /** 比赛详情缓存（2 分钟），避免反复展开重复请求 standings */
  public contestDetailCache = new Map<number, { at: number; detail: ContestDetail }>();

  /** 当前题面（V0.20：排版后的 HTML） */
  public lastStatement: { id: string; title: string; url: string; html: string; filePath?: string } | null = null;
  /** 当前题目的时间/内存限制（Bug4：测试运行 TLE 判定用） */
  public lastLimits: { timeLimitMs?: number; memoryLimitMb?: number } | null = null;
  /** 翻译缓存（按题号） */
  public translateCache = new Map<string, (string | null)[]>();
  /** 题面抓取进行中任务（按 cpp 路径去重，V0.16：快速切换界面不会重复抓取） */
  public statementTasks = new Map<string, Promise<void>>();
  public handlers: Record<string, Handler> = {};
  /** 题目难度缓存（题号 → CF rating，Bug6：共用「当前题目」指示器显示难度） */
  public difficultyById = new Map<string, number>();
  /** 提交进行中（防重复点击） */
  public submitBusy = false;
  /** URL 导入进行中（防重复点击） */
  public urlImportBusy = false;

  /** 从本地记录库刷新难度缓存 */
  public async refreshDifficultyMap() {
    try {
      const records = await listRecords();
      for (const r of records) {
        if (r.difficulty) this.difficultyById.set(r.id, r.difficulty);
      }
    } catch { /* 记录不可用时难度显示 — */ }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    this.disposables = [];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    webviewView.webview.html = this.getHtml();
    webviewView.onDidDispose(() => this.dispose(), null, this.disposables);
    webviewView.webview.onDidReceiveMessage(
      msg => this.handleMessage(msg),
      null,
      this.disposables
    );
    this.refreshDifficultyMap(); // Bug6：预载难度缓存

    // 活动编辑器变化时，把测试用例与题面推送到对应视图
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.pushTestState();
        this.pushStatement();
      })
    );
  }

  /** WorkbenchHost.post：统一 postMessage */
  public post(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  /** 单用例超时：优先按题面时间限制 + 1s 本地缓冲，否则用配置默认值 */
  public testTimeoutMs(): number {
    const t = this.lastLimits?.timeLimitMs;
    if (t && t > 0) return t + 1000;
    return vscode.workspace.getConfiguration('acmWorkflow').get<number>('testTimeoutMs', 5000);
  }

  /** 编译当前文件（带缓存）；失败时向 webview 发送错误提示并返回 { ok: false } */
  public compileFor(filePath: string, _caseCount: number, _mode?: string): { ok: boolean; exePath?: string; message: string } {
    const res = compileCpp(filePath);
    if (!res.ok) {
      this.view?.webview.postMessage({ type: 'testStatus', message: res.message, isError: true });
      this.view?.webview.postMessage({ type: 'testRunDone', passed: 0, total: 0, message: '编译失败', cancelled: false });
    }
    return res;
  }

  private async restoreState() {
    const state = this.context.globalState.get<PickState>(STATE_KEY);
    if (state) {
      this.view?.webview.postMessage({ type: 'initState', state });
    }
  }

  public async saveState(patch: Partial<PickState>) {
    const current = this.context.globalState.get<PickState>(STATE_KEY) || {};
    const next = { ...current, ...patch };
    await this.context.globalState.update(STATE_KEY, next);
  }

  private async handleMessage(msg: any) {
    if (msg?.type === 'openExternal' && msg.url) {
      vscode.env.openExternal(vscode.Uri.parse(msg.url));
      return;
    }

    if (msg?.type === 'webviewReady') {
      this.restoreState();
      this.view?.webview.postMessage({ type: 'knowledgeAll', data: KNOWLEDGE_CATEGORIES });
      return;
    }

    if (msg?.type === 'saveTestLayoutRatio') {
      await this.context.globalState.update('acmWorkflow.testLayoutRatio', msg?.payload?.ratio);
      return;
    }

    if (msg?.type === 'clearHistory') {
      await this.context.globalState.update(STATE_KEY, {});
      this.view?.webview.postMessage({ type: 'historyCleared' });
      return;
    }

    if (msg?.type === 'testReady') {
      await this.pushTestState();
      return;
    }

    if (msg?.type === 'testAutoSave') {
      if (msg?.payload?.filePath) {
        saveProblemTests(msg.payload.filePath, msg.payload.cases || []);
      }
      return;
    }

    if (msg?.type === 'testCancel') {
      this.testCancelled = true;
      return;
    }

    if (msg?.type === 'verifierCancel') {
      this.verifierCancelled = true;
      return;
    }

    if (msg?.type === 'statementReady') {
      await this.pushStatement();
      return;
    }

    if (msg?.type === 'refreshStatement') {
      await this.pushStatement(true);
      return;
    }

    if (msg?.type === 'recordsReady') {
      await this.pushRecords();
      return;
    }

    if (msg?.type === 'todayStatsReady') {
      await this.pushTodayStats();
      return;
    }

    if (msg?.type === 'historyDataReady') {
      await this.pushHistoryData();
      return;
    }

    // V0.18 结构重组：业务消息由 features 模块注册的 handlers 分发
    const handler = this.handlers[msg?.type];
    if (handler) {
      await handler(msg);
      return;
    }

  }

  public static async refreshTests() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个题目 cpp 文件');
      return;
    }
    const filePath = editor.document.fileName;
    const probPath = findProbFile(filePath);
    if (!probPath) {
      vscode.window.showWarningMessage('没有找到对应的 CPH 配置（.prob）。请先通过选题界面生成题目文件。');
      return;
    }
    let url: string;
    try {
      url = JSON.parse(fs.readFileSync(probPath, 'utf8')).url;
    } catch {
      vscode.window.showErrorMessage('CPH 配置（.prob）解析失败');
      return;
    }
    vscode.window.showInformationMessage('正在重新获取测试数据...');
    try {
      const detail = url.includes('luogu.com.cn')
        ? await getLuoguProblemDetail({ id: (url.split('/problem/')[1] || '').split('?')[0], platform: 'luogu', title: '', tags: [], url: '' } as Problem)
        : await getCodeforcesProblemDetail({ url } as Problem);
      if (detail.tests.length === 0) {
        throw new Error('页面里没有解析出测试数据');
      }
      const updated = updateProblemTests(filePath, detail.tests);
      vscode.window.showInformationMessage(
        updated
          ? `已写入 ${detail.tests.length} 组测试数据。切换一下标签页，内置测试器即会刷新。`
          : `抓到 ${detail.tests.length} 组测试数据，但没找到 .prob 写入位置。`
      );
    } catch (e: any) {
      vscode.window.showErrorMessage(`获取测试数据失败：${e?.message || e}`);
    }
  }

  public async pushStatement(force = false) {
    const editor = vscode.window.activeTextEditor;
    const filePath = editor?.document.fileName || '';
    const empty = () => this.view?.webview.postMessage({ type: 'statementData', payload: { empty: true } });
    if (!filePath.toLowerCase().endsWith('.cpp')) { empty(); return; }
    let problem: Problem | null = null;
    const probPath = findProbFile(filePath);
    if (probPath) {
      try {
        problem = problemFromProb(JSON.parse(fs.readFileSync(probPath, 'utf8')));
      } catch {
        problem = null;
      }
    }
    if (!problem) {
      problem = problemFromFileName(filePath); // V0.9：文件名解析兜底
    }
    // Bug3：USACO 等非标准命名（USACO10FEB_Chocolate_Buying_S.cpp）→ 洛谷关键字搜索
    if (!problem && /^USACO/i.test(path.basename(filePath))) {
      try {
        const kw = path.basename(filePath).replace(/\.cpp$/i, '').replace(/_/g, ' ');
        const hit = await searchLuoguByKeyword(kw);
        if (hit) {
          problem = {
            id: hit.pid,
            platform: 'luogu',
            title: hit.name,
            tags: [],
            url: `https://www.luogu.com.cn/problem/${hit.pid}`
          };
        }
      } catch {
        problem = null; // 搜索失败按非题目文件处理
      }
    }
    if (!problem) { empty(); return; }
    console.log(`[ACM-Workflow][题面] 解析成功: ${problem.platform} ${problem.id}（${filePath}）`);

    // V0.20：题目文件夹落盘（排版 HTML）优先——切换界面直接读盘；手动刷新时跳过
    if (!force) {
      const cached = readStatementFiles(filePath);
      if (cached) {
        console.log(`[ACM-Workflow][题面] 命中题目文件夹缓存：${filePath}（HTML ${cached.html.length} 字符${cached.zh ? ' + 译文' : ''}）`);
        this.lastStatement = { id: problem.id, title: problem.title, url: problem.url, html: cached.html, filePath };
        this.lastLimits = parseLimitsFromHtml(cached.html); // 缓存命中同样恢复限制
        if (cached.zh) this.translateCache.set(problem.id, cached.zh);
        this.view?.webview.postMessage({
          type: 'statementData',
          payload: {
            id: problem.id, title: problem.title, url: problem.url, html: cached.html,
            fromCache: true, cacheSource: 'folder', difficulty: this.difficultyById.get(problem.id),
            limits: this.limitsPayload()
          }
        });
        if (cached.zh && cached.zh.length > 0) {
          this.view?.webview.postMessage({ type: 'statementTranslated', payload: { id: problem.id, zh: cached.zh } });
        } else if (problem.platform === 'codeforces' && countTranslatableParagraphs(cached.html) > 0) {
          // 上次翻译失败无译文 → 提示暂不可用并给手动重试入口（Bug1）
          this.view?.webview.postMessage({ type: 'statementTranslated', payload: { id: problem.id, zh: null, reason: 'unavailable' } });
        }
        return;
      }
    }

    // 同一 cpp 正在抓取中 → 等待其完成（消息由首个任务推送），避免快速切界面重复抓取
    const inFlight = this.statementTasks.get(filePath);
    if (inFlight) {
      console.log(`[ACM-Workflow][题面] ${problem.id} 抓取进行中，跳过重复请求`);
      await inFlight.catch(() => {});
      return;
    }
    const task = this.doFetchAndPushStatement(filePath, problem);
    this.statementTasks.set(filePath, task);
    try {
      await task;
    } finally {
      this.statementTasks.delete(filePath);
    }
  }

  public limitsPayload(): { timeLabel?: string; memoryLabel?: string } {
    const t = this.lastLimits;
    if (!t) return {};
    const out: { timeLabel?: string; memoryLabel?: string } = {};
    if (t.timeLimitMs !== undefined) out.timeLabel = t.timeLimitMs >= 1000 ? (t.timeLimitMs / 1000) + 's' : t.timeLimitMs + 'ms';
    if (t.memoryLimitMb !== undefined) out.memoryLabel = t.memoryLimitMb + ' MB';
    return out;
  }

  public async doFetchAndPushStatement(filePath: string, problem: Problem) {
    // V0.13：先显示加载态（题面抓取需数秒）——同时覆盖之前的缓存提示状态
    this.view?.webview.postMessage({ type: 'statementLoading', payload: {} });
    console.log('[ACM-Workflow][题面] 已发送 statementLoading → webview');
    try {
      const res = await fetchStatement(problem);
      this.lastStatement = { id: problem.id, title: problem.title, url: problem.url, html: res.html, filePath };
      this.lastLimits = { timeLimitMs: res.timeLimitMs, memoryLimitMb: res.memoryLimitMb };
      writeStatementCache(problem.platform, problem.id, res.html); // 全局缓存（排版 HTML）
      // V0.20：抓取即翻译（CF，基于排版 HTML 的清晰纯文本）并落盘，之后直接调用
      let zh: (string | null)[] | null = null;
      if (problem.platform === 'codeforces') {
        console.log(`[ACM-Workflow][翻译] 自动翻译开始：${problem.id}`);
        try {
          zh = await translateStatementHtml(res.html);
          if (zh) this.translateCache.set(problem.id, zh);
        } catch {
          zh = null;
        }
        console.log(`[ACM-Workflow][翻译] 自动翻译结束：${problem.id}（${zh ? zh.filter(Boolean).length : 0} 段）`);
      }
      writeStatementFiles(filePath, res.html, zh);
      console.log(`[ACM-Workflow][题面] 已落盘：${filePath}（HTML ${res.html.length} 字符${zh ? '，译文 ' + zh.filter(Boolean).length + ' 段' : ''}）`);
      this.view?.webview.postMessage({
        type: 'statementData',
        payload: {
          id: problem.id, title: problem.title, url: problem.url, html: res.html,
          difficulty: this.difficultyById.get(problem.id),
          limits: { timeLabel: res.timeLabel, memoryLabel: res.memoryLabel },
          timeLimitMs: res.timeLimitMs, memoryLimitMb: res.memoryLimitMb
        }
      });
      console.log(`[ACM-Workflow][题面] 已发送 statementData → webview（HTML ${res.html.length} 字符）`);
      if (zh && zh.length > 0) {
        this.view?.webview.postMessage({ type: 'statementTranslated', payload: { id: problem.id, zh } });
        console.log(`[ACM-Workflow][题面] 已发送 statementTranslated → webview（${zh.filter(Boolean).length} 段译文）`);
      } else if (problem.platform === 'codeforces' && countTranslatableParagraphs(res.html) > 0) {
        this.view?.webview.postMessage({ type: 'statementTranslated', payload: { id: problem.id, zh: null, reason: 'unavailable' } });
        console.log('[ACM-Workflow][题面] 已发送 statementTranslated（翻译暂不可用）→ webview');
      }
    } catch (e: any) {
      // V0.12：抓取失败 → 读全局缓存兜底，保证题面可见（附「刷新」按钮，网络恢复可重抓）
      console.warn('[ACM-Workflow][题面] 抓取异常：', e?.message || e);
      const cached = readStatementCache(problem.platform, problem.id);
      if (cached) {
        this.lastStatement = { id: problem.id, title: problem.title, url: problem.url, html: cached, filePath };
        this.lastLimits = parseLimitsFromHtml(cached);
        this.view?.webview.postMessage({
          type: 'statementData',
          payload: {
            id: problem.id, title: problem.title, url: problem.url, html: cached,
            fromCache: true, cacheSource: 'fallback', difficulty: this.difficultyById.get(problem.id),
            limits: this.limitsPayload()
          }
        });
        console.log(`[ACM-Workflow][题面] 已发送 statementData（来自缓存，cacheSource=fallback）→ webview（${cached.length} 字符）`);
      } else {
        this.view?.webview.postMessage({
          type: 'statementError',
          payload: { message: e?.message || '题面抓取失败' }
        });
        console.log(`[ACM-Workflow][题面] 已发送 statementError → webview：${e?.message || '题面抓取失败'}`);
      }
    }
  }

  public async pushTestState() {
    const editor = vscode.window.activeTextEditor;
    const filePath = editor?.document.fileName || '';
    if (!filePath.toLowerCase().endsWith('.cpp')) {
      this.view?.webview.postMessage({ type: 'testState', filePath: '', fileName: '', hasProb: false, cases: [] });
      return;
    }
    const probPath = findProbFile(filePath);
    if (!probPath) {
      this.view?.webview.postMessage({ type: 'testState', filePath, fileName: path.basename(filePath), hasProb: false, cases: [] });
      return;
    }
    let cases: { id: number; input: string; output: string }[] = [];
    let samplesFetchFailed = false;
    try {
      const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
      cases = (prob.tests || []).map((t: any) => ({ id: t.id, input: t.input || '', output: t.output || '' }));
      samplesFetchFailed = !!prob.samplesFetchFailed; // V0.17.1：比赛样例抓取失败标记
      // 刷题记录：打开题目自动登记
      const problem = problemFromProb(prob);
      if (problem) {
        ensureRecord(problem).catch(() => { /* 记录失败不影响使用 */ });
      }
    } catch {
      /* 忽略解析错误，按无用例处理 */
    }
    this.view?.webview.postMessage({ type: 'testState', filePath, fileName: path.basename(filePath), hasProb: true, cases, samplesFetchFailed });
  }

  public static async backfillAllTests() {
    const out = WorkbenchSidebarProvider.getOutput();
    out.clear();
    out.appendLine('== ACM Workflow: 批量补充测试数据 ==');
    const cpps = listProblemCpps();
    if (cpps.length === 0) {
      out.appendLine('未找到已生成的题目文件。');
      out.show();
      return;
    }
    out.appendLine(`共发现 ${cpps.length} 个题目文件，开始抓取...`);
    out.appendLine('');
    let ok = 0, fail = 0, skip = 0;
    for (const filePath of cpps) {
      const base = path.basename(filePath);
      const probPath = findProbFile(filePath);
      if (!probPath) {
        out.appendLine(`[skip] ${base}  无 .prob 配置`);
        skip++;
        continue;
      }
      let url: string;
      try {
        url = JSON.parse(fs.readFileSync(probPath, 'utf8')).url;
      } catch {
        out.appendLine(`[FAIL] ${base}  .prob 解析失败`);
        fail++;
        continue;
      }
      try {
        const detail = url.includes('luogu.com.cn')
          ? await getLuoguProblemDetail({ id: (url.split('/problem/')[1] || '').split('?')[0], platform: 'luogu', title: '', tags: [], url: '' } as Problem)
          : await getCodeforcesProblemDetail({ url } as Problem);
        if (detail.tests.length === 0) {
          out.appendLine(`[FAIL] ${base}  页面解析出 0 组测试`);
          fail++;
          continue;
        }
        updateProblemTests(filePath, detail.tests);
        out.appendLine(`[OK]   ${base}  → ${detail.tests.length} 组测试`);
        ok++;
      } catch (e: any) {
        out.appendLine(`[FAIL] ${base}  ${e?.message || e}`);
        fail++;
      }
    }
    out.appendLine('');
    out.appendLine(`== 完成：成功 ${ok}，失败 ${fail}，跳过 ${skip} ==`);
    out.show();
    vscode.window.showInformationMessage(`批量补样例完成：成功 ${ok}，失败 ${fail}，跳过 ${skip}`);
  }

  private static getOutput(): vscode.OutputChannel {
    if (!WorkbenchSidebarProvider.output) {
      WorkbenchSidebarProvider.output = vscode.window.createOutputChannel('ACM Workflow');
    }
    return WorkbenchSidebarProvider.output;
  }

  public static async diagnose() {
    const out = WorkbenchSidebarProvider.getOutput();
    out.clear();
    out.appendLine('== ACM Workflow 环境诊断 ==');
    diagnoseEnv().forEach((l) => out.appendLine(l));
    out.show();
    vscode.window.showInformationMessage('环境诊断已输出到 "ACM Workflow" 输出面板');
  }

  public async pushRecords() {
    try {
      const [records, stats] = await Promise.all([
        listRecords(),
        getStats()
      ]);
      for (const r of records) {
        if (r.difficulty) this.difficultyById.set(r.id, r.difficulty); // Bug6：刷新难度缓存
      }
      this.view?.webview.postMessage({ type: 'recordsList', records, stats });
      await this.pushTodayStats();
    } catch (e: any) {
      this.view?.webview.postMessage({
        type: 'recordsList',
        records: [],
        stats: { total: 0, ac: 0, trying: 0, abandoned: 0, rate: '–' },
        error: e?.message || '记录读取失败'
      });
    }
  }

  public async pushTodayStats() {
    try {
      const records = await listRecords();
      const stats = computeTodayStats(records);
      this.view?.webview.postMessage({ type: 'todayStats', stats });
    } catch {
      this.view?.webview.postMessage({ type: 'todayStats', stats: { acToday: 0, streak: 0 } });
    }
  }

  public async pushHistoryData() {
    const records = await listRecords().catch(() => [] as ProblemRecord[]);
    let tagStats: { tag: string; ac: number }[] = [];
    try {
      const all = await getCodeforcesProblems(); // 磁盘 + 内存缓存，毫秒级
      const byId = new Map(all.map((p) => [p.id, p]));
      const acCount = new Map<string, number>();
      for (const r of records) {
        if (r.status !== 'ac') continue; // 只统计已 AC 题目
        const p = byId.get(r.id);
        if (!p) continue;
        for (const t of p.tags) {
          acCount.set(t, (acCount.get(t) || 0) + 1);
        }
      }
      tagStats = [...acCount.entries()]
        .map(([tag, ac]) => ({ tag, ac }))
        .sort((a, b) => b.ac - a.ac)
        .slice(0, 12); // 最多展示 12 个标签
    } catch {
      /* 题集缓存不可用（离线）时图表为空 */
    }
    // V0.12：CF 难度分布（本地记录，800-3500 分档 + 未定分）
    const diffStats = computeDifficultyBins(records);
    this.view?.webview.postMessage({ type: 'historyData', tagStats, difficultyBins: diffStats });
  }

  constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this.extensionUri = extensionUri;
    this.context = context;
    // V0.18 结构重组：注册各功能模块的消息处理器
    this.handlers = {};
    installSession(this);
    installContest(this);
    installDatagen(this);
    installVerifier(this);
    installSubmit(this);
    installUrlimport(this);
    installPick(this);
    installTest(this);
    installRecords(this);

  }

  private getHtml(): string {
    const webview = this.view!.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );

    const pickView = renderPickView();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.staticfile.org; style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.staticfile.org; font-src https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.staticfile.org; img-src ${webview.cspSource} data: https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>ACM Workflow</title>
</head>
<body>
  <div class="app">
    <nav class="rail">
      <button class="nav-item active" data-view="manual" title="知识导论">
        <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </button>
      <button class="nav-item" data-view="pick" title="选题">
        <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
      </button>
      <button class="nav-item" data-view="contest" title="CF 比赛（Round）">
        <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v5a6 6 0 0 1-12 0V3z"/><path d="M6 5H3.5v1.5A3.5 3.5 0 0 0 7 10"/><path d="M18 5h2.5v1.5A3.5 3.5 0 0 1 17 10"/><path d="M12 14v4"/><path d="M8.5 21h7"/></svg>
      </button>
      <button class="nav-item" data-view="datagen" title="造数据">
        <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
      </button>
      <button class="nav-item" data-view="test" title="测试（含题面与翻译）">
        <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="10 8.5 15.5 12 10 15.5 10 8.5"/></svg>
      </button>
      <button class="nav-item" data-view="history" title="记录">
        <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="0.6"/><circle cx="4" cy="12" r="0.6"/><circle cx="4" cy="18" r="0.6"/></svg>
      </button>
      <div class="rail-spacer"></div>
      <div class="rail-today" title="连续刷题天数（点击查看记录）">
        <span class="today-num" id="rail-today-streak">–</span>
        <span class="today-label">连续</span>
      </div>
    </nav>
    <main class="content">
      <!-- CF 登录态状态条（V0.22）：位于工作台顶部 -->
      <div class="cf-session" id="cf-session-bar">
        <span class="cf-s-dot" id="cf-s-dot"></span>
        <span class="cf-s-text mono" id="cf-s-text">CF 会话检测中…</span>
        <span class="spacer"></span>
        <button class="btn cf-s-btn" id="cf-s-login" style="display:none" title="打开浏览器登录 Codeforces（手动输入账号密码）">登录</button>
        <button class="btn danger cf-s-btn" id="cf-s-logout" style="display:none" title="清除本地保存的 CF 会话">退出</button>
      </div>
      <div class="view active" id="view-manual">
        <div class="manual-layout">
          <div class="map-toolbar">
            <input type="search" id="k-search" class="k-search" placeholder="搜索算法…（如 最短路 / 背包 / KMP）" />
            <span class="muted k-hint">层级知识导论 · 点击算法查看简介 / 复杂度 / C++ 模板</span>
            <span class="spacer"></span>
          </div>
          <div class="k-body">
            <div class="k-tree" id="k-tree"><div class="muted chart-empty">加载中…</div></div>
            <div class="k-detail" id="k-detail">
              <div class="muted k-detail-empty">← 在左侧选择一个算法查看详情</div>
            </div>
          </div>
        </div>
      </div>
      ${pickView}
      <div class="view" id="view-contest">
        <div class="contest-wrap">
          <div class="contest-toolbar">
            <span class="muted">CF Round · 即将开始 / 进行中</span>
            <span class="spacer"></span>
            <button class="btn" id="contest-refresh-btn" title="重新拉取比赛列表">刷新</button>
          </div>
          <div id="contest-list" class="contest-list"><div class="muted chart-empty">加载中…</div></div>
          <div class="contest-statement" id="contest-statement" style="display:none">
            <div class="contest-st-head">
              <span class="mono contest-st-title" id="contest-st-title"></span>
              <span class="spacer"></span>
              <button class="btn sm" id="contest-st-copy" title="复制译文（仅中文）">复制译文</button>
              <button class="btn sm" id="contest-st-close">关闭</button>
            </div>
            <div class="contest-st-body" id="contest-st-body"></div>
          </div>
        </div>
      </div>
      <div class="view" id="view-datagen">
        <div class="dg-wrap">
          <div class="card">
            <div class="control-row">
              <label>数据类型</label>
              <select id="dg-type" class="dg-select">
                <option value="array">随机整数数组</option>
                <option value="tree">随机树</option>
                <option value="graph">随机图</option>
                <option value="string">随机字符串</option>
                <option value="permutation">随机排列</option>
                <option value="script">自定义脚本</option>
              </select>
            </div>
            <div id="dg-params" class="dg-params"></div>
            <div class="control-row dg-actions">
              <button class="primary-btn" id="dg-gen-btn">生成数据</button>
              <button class="btn" id="dg-save-btn" title="把当前生成的数据保存为文件">保存为文件</button>
            </div>
            <div id="dg-status" class="dg-status"></div>
          </div>
          <div class="dg-output-head">
            <span class="muted">生成预览（自动填充测试面板输入框）</span>
          </div>
          <pre class="dg-output" id="dg-output"><span class="muted">尚未生成</span></pre>
        </div>
      </div>
      <div class="view" id="view-test">
        <div class="test-wrap" id="test-wrap">
          <!-- 模式切换：单测 / 对拍（V0.22） -->
          <div class="test-modes">
            <button class="test-mode active" data-mode="single">单测</button>
            <button class="test-mode" data-mode="duipai">对拍</button>
          </div>
          <div id="test-single-panel">
          <!-- Bug6：题面与测试用例共用的「当前题目」指示器（含难度） -->
          <div class="cur-file" id="cur-file">请在编辑器中打开一个题目文件</div>
          <!-- Bug4：时间/内存限制栏（由题面 Markdown 解析填充） -->
          <div class="st-limits" id="st-limits"></div>
          <div class="st-section" id="st-section">
            <div class="st-toolbar">
              <span class="spacer"></span>
              <button class="btn" id="st-translate-btn" title="抓取题面并翻译为中文（MyMemory/Google）">翻译</button>
              <button class="btn" id="st-mode-btn" title="切换 双语 / 仅译文 / 仅原文">双语</button>
            </div>
            <!-- Bug3：带图题提示（点击打开 CF 官网） -->
            <button class="st-img-hint" id="st-img-hint" style="display:none">⚠️ 本题包含图片，请前往 CF 官网查看完整题面</button>
            <div id="st-body" class="st-body"><div class="muted st-empty">请在编辑器中打开一个题目文件<br>（如 979E.cpp / P1001.cpp），这里自动显示对应题面<br>点击「翻译」可切换中文对照</div></div>
            <div id="st-error" class="st-error"></div>
          </div>
          <!-- Bug5：可拖动分隔条（题面 / 测试用例比例，min 20%，globalState 持久化） -->
          <div class="test-splitter" id="test-splitter" title="拖动调整题面与测试用例的比例"></div>
          <div class="test-lower" id="test-lower">
            <div class="test-toolbar">
              <button class="btn" id="test-add-btn">添加用例</button>
              <button class="btn" id="test-save-btn">保存</button>
              <span class="spacer"></span>
              <button class="btn danger" id="test-cancel-btn" style="display:none">取消</button>
              <button class="btn" id="test-submit-btn" title="提交当前题目到 Codeforces（凭证存系统密钥链）">提交</button>
              <button class="primary-btn" id="test-run-btn">运行全部</button>
            </div>
            <div id="test-status" class="test-status"></div>
            <div id="test-cases" class="test-cases"></div>
          </div>
          </div>
          <!-- 对拍面板（V0.22） -->
          <div id="duipai-panel" style="display:none">
            <div class="card">
              <div class="control-row">
                <label>正解文件</label>
                <input id="vp-solve" class="vp-input mono" placeholder="默认 = 当前编辑器文件" spellcheck="false">
              </div>
              <div class="control-row">
                <label>暴力文件</label>
                <div class="vp-path-row">
                  <input id="vp-brute" class="vp-input mono" placeholder="选择或输入 bruteforce.cpp 路径" spellcheck="false">
                  <button class="btn sm" id="vp-brute-pick">浏览…</button>
                </div>
              </div>
              <div class="control-row">
                <label>最大组数</label>
                <input id="vp-max" type="number" class="vp-input" value="1000" min="1" style="width:100px">
              </div>
              <div class="control-row dg-actions">
                <button class="primary-btn" id="vp-start">开始对拍</button>
                <button class="btn danger" id="vp-stop" style="display:none">停止</button>
              </div>
              <div class="vp-data-src">
                <span class="muted" id="vp-datasrc">数据源：造数据面板当前设置</span>
                <span class="spacer"></span>
                <button class="btn sm" id="vp-goto-dg">去设置</button>
              </div>
              <div id="vp-status" class="vp-status"></div>
              <div class="vp-progress mono" id="vp-progress"></div>
              <div class="vp-mismatch" id="vp-mismatch" style="display:none">
                <div class="vp-mismatch-head">
                  <span class="mono" id="vp-mismatch-title">输出不一致</span>
                  <span class="spacer"></span>
                  <button class="btn sm" id="vp-save">保存差异数据</button>
                </div>
                <div class="vp-block">
                  <div class="vp-label">输入数据</div>
                  <pre class="vp-pre" id="vp-in"></pre>
                </div>
                <div class="vp-block">
                  <div class="vp-label solve">正解输出</div>
                  <pre class="vp-pre" id="vp-so"></pre>
                </div>
                <div class="vp-block">
                  <div class="vp-label brute">暴力输出</div>
                  <pre class="vp-pre" id="vp-bo"></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="view" id="view-history">
        <div class="rec-wrap">
          <div class="card cf-bind">
            <span class="cf-bind-label">CF 账号</span>
            <span class="mono cf-handle" id="cf-handle">未绑定</span>
            <span class="spacer"></span>
            <button class="btn" id="cf-bind-btn" title="输入 CF Handle，拉取 AC 历史并作为薄弱点推荐依据">绑定 / 更换</button>
            <button class="btn" id="cf-import-btn" title="重新拉取该账号的 AC 历史并导入本地库">导入历史</button>
          </div>
          <div class="card chart-row">
            <div class="chart-block">
              <div id="pie-chart" class="pie-chart"></div>
            </div>
            <div class="chart-block">
              <div class="chart-title">CF 难度分布（800-3500）</div>
              <div id="diff-chart" class="diff-chart"></div>
            </div>
          </div>
          <div class="rec-stats" id="rec-stats"></div>
          <div class="rec-toolbar">
            <input type="search" id="rec-search" class="rec-search" placeholder="搜索题号或标题…" />
            <select id="rec-platform" title="按平台筛选">
              <option value="all">全部平台</option>
              <option value="codeforces">Codeforces</option>
              <option value="luogu">洛谷</option>
            </select>
          </div>
          <div class="rec-filters" id="rec-filters">
            <button class="rec-filter active" data-filter="all">全部</button>
            <button class="rec-filter" data-filter="ac">已AC</button>
            <button class="rec-filter" data-filter="untouched">未开始</button>
          </div>
          <div id="rec-list" class="rec-list"></div>
        </div>
      </div>
    </main>
  </div>
  <script src="${scriptUri}"></script>
  <div id="confirm-modal">
    <div class="confirm-box">
      <p id="confirm-text"></p>
      <div class="confirm-actions">
        <button class="btn" id="confirm-cancel">取消</button>
        <button class="primary-btn" id="confirm-ok">确定</button>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  public dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
    this.view = undefined;
  }
}
