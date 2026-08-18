/**
 * test 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as fs from 'fs';
import { ensureRecord, updateRecord } from '../../services/records';
import { judge, runCase } from '../../services/runner';
import { writeStatementFiles } from '../../services/statementFiles';
import { findProbFile, saveProblemTests } from '../../services/template';
import { countTranslatableParagraphs, translateStatementHtml } from '../../services/translate';
import { problemFromProb, type WorkbenchHost } from '../../core/workbench';
import { trace } from '../../services/diagnostics';


export function installTest(host: WorkbenchHost): void {
  host.handlers['testSaveCases'] = (msg: any) => handleTestSave(host, msg?.payload);
  host.handlers['testRunAll'] = (msg: any) => handleTestRun(host, msg?.payload);
  host.handlers['testRunOne'] = (msg: any) => handleTestRunOne(host, msg?.payload);
  host.handlers['translateStatement'] = (msg: any) => handleTranslateStatement(host);
}


async function handleTestSave(host: WorkbenchHost, payload: any) {
  const filePath = payload?.filePath;
  const cases: { id: number; input: string; output: string }[] = payload?.cases || [];
  if (!filePath) {
    host.view?.webview.postMessage({ type: 'testStatus', message: '未打开题目文件，无法保存' });
    return;
  }
  const updated = saveProblemTests(filePath, cases);
  host.view?.webview.postMessage({
    type: 'testStatus',
    message: updated ? `已保存 ${cases.length} 个测试用例` : '未找到 .prob 文件，保存失败'
  });
}


async function handleTestRun(host: WorkbenchHost, payload: any) {
  const filePath = payload?.filePath;
  const cases: { id: number; input: string; output: string }[] = payload?.cases || [];
  if (!filePath) {
    host.view?.webview.postMessage({ type: 'testRunDone', passed: 0, total: 0, message: '未打开题目文件' });
    return;
  }
  if (cases.length === 0) {
    host.view?.webview.postMessage({ type: 'testRunDone', passed: 0, total: 0, message: '没有测试用例' });
    return;
  }

  // 先把当前编辑的用例保存到 .prob，避免误改丢失
  saveProblemTests(filePath, cases);

  host.testCancelled = false;
  host.view?.webview.postMessage({ type: 'testRunning', running: true });

  // Bug4：优先按题面抓取的 CF 时间限制判定 TLE（+1s 本地缓冲），否则用配置默认值
  const timeoutMs = host.testTimeoutMs();
  const compile = host.compileFor(filePath, cases.length);
  if (!compile.ok || !compile.exePath) return;

  let passed = 0;
  let cancelled = false;
  for (let i = 0; i < cases.length; i++) {
    if (host.testCancelled) {
      cancelled = true;
      break;
    }
    const c = cases[i];
    host.view?.webview.postMessage({ type: 'testStatus', message: `正在运行用例 ${i + 1}/${cases.length}...` });
    const r = await runCase(compile.exePath, c.input, timeoutMs);
    let status: 'passed' | 'failed' | 'error';
    let message = '';
    if (r.timedOut) {
      status = 'error';
      message = `超时（>${(timeoutMs / 1000).toFixed(0)}s）`;
    } else if (r.code !== 0) {
      status = 'error';
      message = `运行错误（退出码 ${r.code}）${r.stderr ? '：' + r.stderr.slice(0, 400) : ''}`;
    } else if (judge(r.stdout, c.output)) {
      status = 'passed';
      passed++;
    } else {
      status = 'failed';
    }
    host.view?.webview.postMessage({ type: 'testResult', caseId: c.id, status, actual: r.stdout, timeMs: r.timeMs, message });
  }

  host.view?.webview.postMessage({
    type: 'testRunDone',
    passed,
    total: cases.length,
    message: cancelled ? '已取消' : `通过 ${passed}/${cases.length}`,
    cancelled
  });
  host.view?.webview.postMessage({ type: 'testRunning', running: false });

  // 刷题记录联动：完整跑完一轮（未取消）即更新——全过记 AC，否则记尝试中，attempts+1
  if (!cancelled && cases.length > 0) {
    try {
      const probPath = findProbFile(filePath);
      if (probPath) {
        const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
        const problem = problemFromProb(prob);
        if (problem) {
          const rec = await ensureRecord(problem);
          const allPassed = passed === cases.length;
          await updateRecord(problem.id, {
            status: allPassed ? 'ac' : 'trying',
            attempts: rec.attempts + 1
          });
          host.pushRecords();
          host.pushTodayStats();
          host.pushHistoryData(); // V0.8：记录变化后饼图实时刷新
        }
      }
    } catch {
      /* 记录失败不影响测试结果 */
    }
  }
}


async function handleTestRunOne(host: WorkbenchHost, payload: any) {
  const filePath = payload?.filePath;
  const caseId = payload?.caseId;
  const input = String(payload?.input ?? '');
  const output = String(payload?.output ?? '');
  if (!filePath || caseId === undefined) return;

  const timeoutMs = host.testTimeoutMs(); // Bug4：按题目时间限制判定 TLE
  const compile = host.compileFor(filePath, 1, 'one');
  if (!compile.ok || !compile.exePath) return;

  host.view?.webview.postMessage({ type: 'testStatus', message: '正在运行该用例...' });
  const r = await runCase(compile.exePath, input, timeoutMs);
  let status: 'passed' | 'failed' | 'error';
  let message = '';
  if (r.timedOut) {
    status = 'error';
    message = `超时（>${(timeoutMs / 1000).toFixed(0)}s）`;
  } else if (r.code !== 0) {
    status = 'error';
    message = `运行错误（退出码 ${r.code}）${r.stderr ? '：' + r.stderr.slice(0, 400) : ''}`;
  } else if (judge(r.stdout, output)) {
    status = 'passed';
  } else {
    status = 'failed';
  }
  host.view?.webview.postMessage({ type: 'testResult', caseId, status, actual: r.stdout, timeMs: r.timeMs, message });
  host.view?.webview.postMessage({ type: 'testStatus', message: '' });
}


async function handleTranslateStatement(host: WorkbenchHost, ) {
  const st = host.lastStatement;
  if (!st) {
    host.view?.webview.postMessage({ type: 'statementTranslated', payload: { id: null, zh: null, reason: 'noStatement' } });
    return;
  }
  trace('service', 'translateStatement', `start ${st.id}`);
  console.log(`[ACM-Workflow][翻译] 手动翻译请求：${st.id}（HTML ${st.html.length} 字符）`);
  let zh: (string | null)[] | null = host.translateCache.get(st.id) ?? null;
  if (!zh) {
    zh = await translateStatementHtml(st.html, { context: host.context }).catch(() => null);
    if (zh) host.translateCache.set(st.id, zh);
  }
  // V0.20：译文落盘到题目文件夹（题面.zh.json v2，与 HTML 段落对齐）
  if (zh && st.filePath) {
    writeStatementFiles(st.filePath, st.html, zh);
    console.log(`[ACM-Workflow][翻译] 译文已落盘：${st.filePath}`);
  }
  const translatable = countTranslatableParagraphs(st.html);
  const reason = zh && zh.some(Boolean) ? undefined : translatable > 0 ? 'unavailable' : 'none';
  host.view?.webview.postMessage({ type: 'statementTranslated', payload: { id: st.id, zh, reason } });
  const okCount = zh ? zh.filter(Boolean).length : 0;
  trace('service', 'translateStatement', okCount > 0 ? `ok ${st.id} ${okCount}段` : `fail ${st.id} ${translatable > 0 ? 'unavailable' : 'none'}`);
  console.log(`[ACM-Workflow][翻译] 手动翻译结果：${okCount > 0 ? okCount + ' 段' : '失败（' + (translatable > 0 ? '翻译暂不可用' : '无可翻译段落') + '）'}`);
}
