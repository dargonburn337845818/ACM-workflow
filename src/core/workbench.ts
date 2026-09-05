import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkbenchHtml } from './workbenchHtml';
import { DiagnosticRuntime, ProblemRecord, Services } from '../services';
import { resolveBaseDir, resolveDbPath } from '../utils/paths';
import { Problem } from '../types';
import { installSession } from '../features/session';
import { installContest } from '../features/contest';
import { installDatagen } from '../features/datagen';
import { installVerifier } from '../features/verifier';
import { installUrlimport } from '../features/urlImport';
import { installPick } from '../features/pick';
import { installTest } from '../features/test';
import { installRecords } from '../features/records';

/** 消息处理器：返回 Promise 或直接完成 */
export type Handler = (msg: any) => Promise<void> | void;

/** 功能模块宿主接口：workbench 类对 features 暴露的能力（ADR 0003 精简版） */
export interface WorkbenchHost {
  post(msg: any): void;
  handlers: Record<string, Handler>;
  // 联动状态（由 workbench 持有，features 读写）
  testCancelled: boolean;
  verifierCancelled: boolean;
  // 联动方法（保留在 workbench 类，features 跨模块调用）
  pushTestState(): Promise<void>;
  pushStatement(force?: boolean): Promise<void>;
  pushRecords(): Promise<void>;
  pushTodayStats(): Promise<void>;
  pushHistoryData(): Promise<void>;
  /** 选题视图状态持久化（globalState，键 acmWorkflow.pickState） */
  saveState(patch: Partial<PickState>): Promise<void>;
  /** 读取选题视图状态（globalState，键 acmWorkflow.pickState） */
  getPickState(): Promise<PickState>;
  /** 单用例超时：优先按题面时间限制 + 1s 缓冲，否则用配置 testTimeoutMs */
  testTimeoutMs(): number;
  /** 编译当前文件（带缓存）；失败时向 webview 发送错误提示并返回 { ok: false } */
  compileFor(filePath: string, caseCount: number, mode?: string): Promise<{ ok: boolean; exePath?: string; message: string }>;
}

/** 选题视图状态（globalState 持久化） */
export interface PickState {
  platform?: 'codeforces';
  minRating?: number;
  maxRating?: number;
  tags?: string[];
  problem?: Problem;
  recent?: Problem[];
}

export const STATE_KEY = 'acmWorkflow.pickState';

export class WorkbenchSidebarProvider implements vscode.WebviewViewProvider, WorkbenchHost {
  public static readonly viewType = 'acmWorkflow.workbench';
  private static output: vscode.OutputChannel | undefined;
  public view: vscode.WebviewView | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly context: vscode.ExtensionContext;
  private readonly services: Services;
  private disposables: vscode.Disposable[] = [];

  /** 测试运行取消标志（前端发 testCancel 置位） */
  public testCancelled = false;

  /** 对拍取消标志（前端发 verifierCancel 置位） */
  public verifierCancelled = false;

  public handlers: Record<string, Handler> = {};

  constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext, services: Services) {
    this.extensionUri = extensionUri;
    this.context = context;
    this.services = services;
    // ADR 0003：features 只通过宿主 + 需要的服务门面注册，不再直接 import 内部 services
    this.handlers = {};
    installSession(this, this.services);
    installContest(this, this.services);
    installDatagen(this, this.services);
    installVerifier(this, this.services);
    installUrlimport(this, this.services);
    installPick(this, this.services);
    installTest(this, this.services);
    installRecords(this, this.services);
 }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    this.disposables = [];

    const wallpaperCfg = vscode.workspace.getConfiguration('acmWorkflow').get<string>('glassBackground', '');
    const localRoots = [vscode.Uri.joinPath(this.extensionUri, 'media')];
    if (wallpaperCfg && path.isAbsolute(wallpaperCfg)) {
      localRoots.push(vscode.Uri.file(path.dirname(wallpaperCfg)));
    }
    for (const weRoot of [
      'D:/steam/steamapps/workshop/content/431960',
      'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960',
      'C:/Program Files/Steam/steamapps/workshop/content/431960'
    ]) {
      if (fs.existsSync(weRoot)) localRoots.push(vscode.Uri.file(weRoot));
    }
    const uniqueRoots = Array.from(new Map(localRoots.map(r => [r.toString(), r])).values());
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: uniqueRoots
    };

    webviewView.webview.html = getWorkbenchHtml(webviewView.webview, this.extensionUri);
    webviewView.onDidDispose(() => this.dispose(), null, this.disposables);
    webviewView.webview.onDidReceiveMessage(
      msg => this.handleMessage(msg),
      null,
      this.disposables
    );
    this.refreshDifficultyMap(); // Bug6：预载难度缓存
    // 活动编辑器变化时，把测试用例与题面推送到对应视图（最近文件已在构造函数全局记录）
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
    const t = this.services.statement.lastLimits?.timeLimitMs;
    if (t && t > 0) return t + 1000;
    return this.services.judge.defaultTimeoutMs();
  }

  /** 编译当前文件（带缓存）；失败时向 webview 发送错误提示并返回 { ok: false } */
  public async compileFor(filePath: string, _caseCount: number, _mode?: string): Promise<{ ok: boolean; exePath?: string; message: string }> {
    const res = await this.services.judge.compile(filePath);
    this.services.support.trace('service', 'compile', res.ok ? 'ok' : `fail: ${res.message}`);
    if (!res.ok) {
      this.post({ type: 'testStatus', message: res.message, isError: true });
      this.post({ type: 'testRunDone', passed: 0, total: 0, message: '编译失败', cancelled: false });
    }
    return res;
  }

  private async restoreState() {
    const state = this.context.globalState.get<PickState>(STATE_KEY);
    if (state) {
      this.post({ type: 'initState', state });
    }
  }

  public async saveState(patch: Partial<PickState>) {
    const current = this.context.globalState.get<PickState>(STATE_KEY) || {};
    const next = { ...current, ...patch };
    await this.context.globalState.update(STATE_KEY, next);
  }

  public async getPickState(): Promise<PickState> {
    return this.context.globalState.get<PickState>(STATE_KEY) || {};
  }

  private async handleMessage(msg: any) {
    this.services.support.trace('webview', String(msg?.type || 'unknown'), 'received');

    if (msg?.type === 'diagnose') {
      await this.diagnose();
      return;
    }

    if (msg?.type === 'openExternal' && msg.url) {
      vscode.env.openExternal(vscode.Uri.parse(msg.url));
      return;
    }

    if (msg?.type === 'webviewReady') {
      this.restoreState();
      return;
    }

    if (msg?.type === 'clearHistory') {
      await this.context.globalState.update(STATE_KEY, {});
      this.post({ type: 'historyCleared' });
      return;
    }

    if (msg?.type === 'testReady') {
      await this.pushTestState();
      return;
    }

    if (msg?.type === 'testAutoSave') {
      if (msg?.payload?.filePath) {
        this.services.workspace.saveProblemTests(msg.payload.filePath, msg.payload.cases || []);
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

    const handler = this.handlers[msg?.type];
    if (handler) {
      await handler(msg);
      return;
    }
  }

  public async refreshTests() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个题目 cpp 文件');
      return;
    }
    const filePath = editor.document.fileName;
    const probPath = this.services.workspace.findProbFile(filePath);
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
      const problem: Problem = {
        id: '',
        platform: 'codeforces',
        title: '',
        tags: [],
        url
      };
      const detail = await this.services.codeforces.getProblemDetail(problem);
      if (detail.tests.length === 0) {
        throw new Error('页面里没有解析出测试数据');
      }
      const updated = this.services.workspace.updateProblemTests(filePath, detail.tests);
      vscode.window.showInformationMessage(
        updated
          ? `已写入 ${detail.tests.length} 组测试数据。切换一下标签页，内置测试器即会刷新。`
          : `抓到 ${detail.tests.length} 组测试数据，但没找到 .prob 写入位置。`
      );
    } catch (e: any) {
      WorkbenchSidebarProvider.offerDiagnose(`获取测试数据失败：${e?.message || e}`);
    }
  }

  public async pushStatement(force = false) {
    const editor = vscode.window.activeTextEditor;
    const filePath = editor?.document.fileName || '';
    const empty = () => this.post({ type: 'statementData', payload: { empty: true } });
    if (!filePath.toLowerCase().endsWith('.cpp')) { empty(); return; }
    let problem: Problem | null = null;
    const probPath = this.services.workspace.findProbFile(filePath);
    if (probPath) {
      try {
        problem = this.services.workspace.problemFromProb(JSON.parse(fs.readFileSync(probPath, 'utf8')));
      } catch {
        problem = null;
      }
    }
    if (!problem) {
      problem = this.services.workspace.problemFromFileName(filePath);
    }
    if (!problem) { empty(); return; }
    console.log(`[ACM-Workflow][题面] 解析成功: ${problem.platform} ${problem.id}（${filePath}）`);
    // 难度补全不再阻塞题面显示：后台加载题集，完成后通过 statementDifficulty 再推给前端。
    void this.refreshDifficultyAndNotify(problem);

    const st = this.services.statement;
    if (!force) {
      const cached = st.readFiles(filePath);
      if (cached) {
        console.log(`[ACM-Workflow][题面] 命中题目文件夹缓存：${filePath}（HTML ${cached.html.length} 字符${cached.zh ? ' + 译文' : ''}）`);
        st.lastStatement = { id: problem.id, title: problem.title, url: problem.url, html: cached.html, filePath };
        st.lastLimits = st.parseLimits(cached.html);
        if (cached.zh) st.translateCache.set(problem.id, cached.zh);
        this.post({
          type: 'statementData',
          payload: {
            id: problem.id, title: problem.title, url: problem.url, html: st.viewHtml(cached.html),
            fromCache: true, cacheSource: 'folder', difficulty: this.services.codeforces.difficultyOf(problem.id),
            limits: this.limitsPayload()
          }
        });
        if (cached.zh && cached.zh.length > 0) {
          this.post({ type: 'statementTranslated', payload: { id: problem.id, zh: cached.zh } });
        } else if (problem.platform === 'codeforces' && st.countTranslatable(cached.html) > 0) {
          this.post({ type: 'statementTranslated', payload: { id: problem.id, zh: null, reason: 'unavailable' } });
        }
        return;
      }
    }

    // 同一 cpp 正在抓取中 → 等待其完成（消息由首个任务推送），避免快速切界面重复抓取
    const inFlight = st.statementTasks.get(filePath);
    if (inFlight) {
      console.log(`[ACM-Workflow][题面] ${problem.id} 抓取进行中，跳过重复请求`);
      await inFlight.catch(() => {});
      return;
    }
    const task = this.doFetchAndPushStatement(filePath, problem);
    st.statementTasks.set(filePath, task);
    try {
      await task;
    } finally {
      st.statementTasks.delete(filePath);
    }
  }

  /** 后台补齐题目难度；若从题集/本地记录拿到了新值，通知前端更新共用指示器。 */
  private async refreshDifficultyAndNotify(problem: Problem): Promise<void> {
    try {
      await this.services.codeforces.ensureDifficulty(problem);
      const difficulty = this.services.codeforces.difficultyOf(problem.id);
      if (difficulty !== undefined) {
        this.post({ type: 'statementDifficulty', payload: { id: problem.id, difficulty } });
      }
    } catch {
      /* 题集不可用时保持 — */
    }
  }

  public limitsPayload(): { timeLabel?: string; memoryLabel?: string } {
    const t = this.services.statement.lastLimits;
    if (!t) return {};
    const out: { timeLabel?: string; memoryLabel?: string } = {};
    if (t.timeLimitMs !== undefined) out.timeLabel = t.timeLimitMs >= 1000 ? (t.timeLimitMs / 1000) + 's' : t.timeLimitMs + 'ms';
    if (t.memoryLimitMb !== undefined) out.memoryLabel = t.memoryLimitMb + ' MB';
    return out;
  }

  public async doFetchAndPushStatement(filePath: string, problem: Problem) {
    const st = this.services.statement;
    this.services.support.trace('service', 'fetchStatement', `start ${problem.platform} ${problem.id}`);
    this.post({ type: 'statementLoading', payload: {} });
    console.log('[ACM-Workflow][题面] 已发送 statementLoading → webview');
    try {
      const res = await st.fetchStatement(problem);
      st.lastStatement = { id: problem.id, title: problem.title, url: problem.url, html: res.html, filePath };
      st.lastLimits = { timeLimitMs: res.timeLimitMs, memoryLimitMb: res.memoryLimitMb };
      st.writeGlobalCache(problem.platform, problem.id, res.html);
      st.writeFiles(filePath, res.html, null);
      const viewHtml = st.viewHtml(res.html);
      this.post({
        type: 'statementData',
        payload: {
          id: problem.id, title: problem.title, url: problem.url, html: viewHtml,
          difficulty: this.services.codeforces.difficultyOf(problem.id),
          limits: { timeLabel: res.timeLabel, memoryLabel: res.memoryLabel },
          timeLimitMs: res.timeLimitMs, memoryLimitMb: res.memoryLimitMb
        }
      });
      console.log(`[ACM-Workflow][题面] 已发送 statementData → webview（HTML ${res.html.length} 字符）`);
      this.services.support.trace('service', 'fetchStatement', 'ok');

      if (problem.platform === 'codeforces') {
        this.services.support.trace('service', 'translateStatement', `start ${problem.id}`);
        console.log(`[ACM-Workflow][翻译] 自动翻译开始：${problem.id}`);
        void (async () => {
          this.post({ type: 'translationStatus', payload: { busy: true, id: problem.id } });
          try {
            const zh = await st.translate(res.html);
            if (zh) st.translateCache.set(problem.id, zh);
            const autoOk = zh ? zh.filter(Boolean).length : 0;
            this.services.support.trace('service', 'translateStatement', autoOk > 0 ? `ok ${problem.id} ${autoOk}段` : `fail ${problem.id}`);
            console.log(`[ACM-Workflow][翻译] 自动翻译结束：${problem.id}（${autoOk} 段）`);
            if (zh && zh.length > 0) {
              st.writeFiles(filePath, res.html, zh);
              this.post({ type: 'statementTranslated', payload: { id: problem.id, zh } });
              console.log(`[ACM-Workflow][题面] 已发送 statementTranslated → webview（${zh.filter(Boolean).length} 段译文）`);
            } else if (st.countTranslatable(res.html) > 0) {
              this.post({ type: 'statementTranslated', payload: { id: problem.id, zh: null, reason: 'unavailable' } });
              console.log('[ACM-Workflow][题面] 已发送 statementTranslated（翻译暂不可用）→ webview');
            }
          } catch (e) {
            this.services.support.trace('service', 'translateStatement', `fail ${problem.id}`);
            console.warn(`[ACM-Workflow][翻译] 自动翻译异常：${problem.id}`, e);
            if (st.countTranslatable(res.html) > 0) {
              this.post({ type: 'statementTranslated', payload: { id: problem.id, zh: null, reason: 'unavailable' } });
            }
          } finally {
            this.post({ type: 'translationStatus', payload: { busy: false, id: problem.id } });
          }
        })();
      }
    } catch (e: any) {
      this.services.support.trace('service', 'fetchStatement', `fail: ${e?.message || e}`);
      console.warn('[ACM-Workflow][题面] 抓取异常：', e?.message || e);
      const cached = st.readGlobalCache(problem.platform, problem.id);
      if (cached) {
        st.lastStatement = { id: problem.id, title: problem.title, url: problem.url, html: cached, filePath };
        st.lastLimits = st.parseLimits(cached);
        this.post({
          type: 'statementData',
          payload: {
            id: problem.id, title: problem.title, url: problem.url, html: st.viewHtml(cached),
            fromCache: true, cacheSource: 'fallback', difficulty: this.services.codeforces.difficultyOf(problem.id),
            limits: this.limitsPayload()
          }
        });
        console.log(`[ACM-Workflow][题面] 已发送 statementData（来自缓存，cacheSource=fallback）→ webview（${cached.length} 字符）`);
      } else {
        this.post({
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
      this.post({ type: 'testState', filePath: '', fileName: '', hasProb: false, cases: [] });
      return;
    }
    const probPath = this.services.workspace.findProbFile(filePath);
    if (!probPath) {
      this.post({ type: 'testState', filePath, fileName: path.basename(filePath), hasProb: false, cases: [] });
      return;
    }
    let cases: { id: number; input: string; output: string }[] = [];
    let samplesFetchFailed = false;
    try {
      const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
      cases = (prob.tests || []).map((t: any) => ({ id: t.id, input: t.input || '', output: t.output || '' }));
      samplesFetchFailed = !!prob.samplesFetchFailed;
      const problem = this.services.workspace.problemFromProb(prob);
      if (problem) {
        this.services.records.ensure(problem).catch(() => { /* 记录失败不影响使用 */ });
      }
    } catch {
      /* 忽略解析错误，按无用例处理 */
    }
    this.post({ type: 'testState', filePath, fileName: path.basename(filePath), hasProb: true, cases, samplesFetchFailed });
  }

  public async backfillAllTests() {
    const out = WorkbenchSidebarProvider.getOutput();
    out.clear();
    out.appendLine('== ACM Workflow: 批量补充测试数据 ==');
    const cpps = this.services.workspace.listProblemCpps();
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
      const probPath = this.services.workspace.findProbFile(filePath);
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
        const detail = await this.services.codeforces.getProblemDetail({ url } as Problem);
        if (detail.tests.length === 0) {
          out.appendLine(`[FAIL] ${base}  页面解析出 0 组测试`);
          fail++;
          continue;
        }
        this.services.workspace.updateProblemTests(filePath, detail.tests);
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
    if (fail > 0) {
      WorkbenchSidebarProvider.offerDiagnose(`批量补样例有 ${fail} 个失败，可运行工作流诊断查看原因。`);
    }
  }

  private static getOutput(): vscode.OutputChannel {
    if (!WorkbenchSidebarProvider.output) {
      WorkbenchSidebarProvider.output = vscode.window.createOutputChannel('ACM Workflow');
    }
    return WorkbenchSidebarProvider.output;
  }

  private buildDiagnosticRuntime(): DiagnosticRuntime {
    const cfg = vscode.workspace.getConfiguration('acmWorkflow');
    return {
      extensionVersion: String((this.context.extension as any)?.packageJSON?.version || 'unknown'),
      vscodeVersion: vscode.version,
      platform: process.platform,
      nodeVersion: process.version,
      baseDir: resolveBaseDir(),
      dbPath: resolveDbPath(),
      proxy: cfg.get<string>('proxy', '') || ''
    };
  }

  public async diagnose() {
    const out = WorkbenchSidebarProvider.getOutput();
    out.clear();
    out.appendLine('== ACM Workflow 工作流诊断 ==');
    this.services.support.trace('service', 'diagnose', 'start');
    try {
      const runtime = this.buildDiagnosticRuntime();
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'ACM Workflow 工作流诊断', cancellable: true },
        async (progress, token) => {
          const controller = new AbortController();
          const sub = token.onCancellationRequested(() => controller.abort());
          try {
            progress.report({ message: '收集环境与网络信息…' });
            const collected = await this.services.support.collectDiagnosticReport(runtime, { signal: controller.signal });
            progress.report({ message: '选择报告保存目录…' });
            const dirs = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: '保存诊断报告到此目录'
            });
            if (!dirs || dirs.length === 0) {
              this.services.support.trace('service', 'diagnose', 'cancel');
              out.appendLine('已取消保存报告。');
              out.show();
              return null;
            }
            const files = await this.services.support.writeDiagnosticFiles(dirs[0].fsPath, collected);
            this.services.support.trace('service', 'diagnose', 'ok');
            progress.report({ message: '完成' });
            return { collected, files };
          } finally {
            sub.dispose();
          }
        }
      );
      if (!result) return;
      const { collected, files } = result;
      out.appendLine('');
      out.appendLine('== 环境信息 ==');
      for (const line of collected.environment) out.appendLine(line);
      out.appendLine('');
      out.appendLine('== 网络诊断 ==');
      for (const line of collected.network) out.appendLine(line);
      out.appendLine('');
      out.appendLine('== 发现的问题 ==');
      if (collected.issues.length === 0) {
        out.appendLine('未发现轨迹异常。');
      } else {
        for (const issue of collected.issues) out.appendLine(`[${issue.id}] ${issue.title}: ${issue.detail}`);
      }
      out.show();
      vscode.window.showInformationMessage(`工作流诊断完成，报告已保存：${files.markdownPath}`);
      const translationFailed = (collected.translation || []).some((l) => l.includes('[FAIL]') || l.includes('[WARN]'));
      if (translationFailed) {
        await this.services.support.runSetupGuide();
      }
    } catch (e: any) {
      this.services.support.trace('service', 'diagnose', `fail: ${e?.message || e}`);
      out.appendLine(`诊断失败：${e?.message || e}`);
      out.show();
      vscode.window.showErrorMessage(`工作流诊断失败：${e?.message || e}`);
    }
  }

  /** 在失败提示里提供“运行工作流诊断”入口。 */
  public static offerDiagnose(message: string): void {
    const answer = vscode.window.showInformationMessage(message, '运行工作流诊断');
    if (answer && typeof (answer as Promise<string | undefined>).then === 'function') {
      (answer as Promise<string | undefined>).then((choice) => {
        if (choice === '运行工作流诊断') {
          vscode.commands.executeCommand('acmWorkflow.diagnose');
        }
      });
    }
  }

  public async pushRecords() {
    this.services.support.trace('service', 'pushRecords', 'start');
    try {
      let handle = vscode.workspace.getConfiguration('acmWorkflow').get<string>('cfHandle', '') || '';
      if (!handle) {
        try {
          const session = await this.services.codeforces.getStoredSession();
          if (session && session.handle && session.handle !== 'unknown') handle = session.handle;
        } catch { /* 读失败按未登录处理 */ }
      }
      this.post({ type: 'cfBound', handle });
      const dashboard = await this.services.dashboard.snapshot();
      for (const r of dashboard.records) {
        if (r.difficulty) this.services.codeforces.difficultyById.set(r.id, r.difficulty);
      }
      this.post({ type: 'recordsList', records: dashboard.records, stats: dashboard.stats });
      this.post({ type: 'todayStats', stats: dashboard.todayStats });
      // 历史图表（标签统计）需要题集，后台异步刷新，不阻塞记录列表/今日统计展示。
      void this.pushHistoryData(dashboard.records);
      this.services.support.trace('service', 'pushRecords', 'ok');
    } catch (e: any) {
      this.services.support.trace('service', 'pushRecords', `fail: ${e?.message || e}`);
      this.post({
        type: 'recordsList',
        records: [],
        stats: { total: 0, ac: 0, trying: 0, abandoned: 0, rate: '–' },
        error: e?.message || '记录读取失败'
      });
    }
  }

  public async pushTodayStats(records?: ProblemRecord[]) {
    try {
      const all = records ?? await this.services.records.list();
      const stats = this.services.records.todayStats(all);
      this.post({ type: 'todayStats', stats });
    } catch {
      this.post({ type: 'todayStats', stats: { acToday: 0, streak: 0 } });
    }
  }

  public async pushHistoryData(records?: ProblemRecord[]) {
    const all = records ?? await this.services.records.list().catch(() => [] as ProblemRecord[]);
    const history = await this.services.dashboard.history(all).catch(() => ({
      tagStats: [] as { tag: string; ac: number }[],
      difficultyBins: this.services.records.difficultyBins(all)
    }));
    this.post({ type: 'historyData', tagStats: history.tagStats, difficultyBins: history.difficultyBins });
  }

  /** 供扩展入口注册命令：重新获取当前题目测试数据 */
  public async refreshTestsCommand() {
    await this.refreshTests();
  }

  /** 供扩展入口注册命令：批量补充测试数据 */
  public async backfillAllTestsCommand() {
    await this.backfillAllTests();
  }

  public async refreshDifficultyMap() {
    try {
      const records = await this.services.records.list();
      for (const r of records) {
        if (r.difficulty) this.services.codeforces.difficultyById.set(r.id, r.difficulty);
      }
    } catch { /* 记录不可用时难度显示 — */ }
  }

  public dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
    this.view = undefined;
  }
}
