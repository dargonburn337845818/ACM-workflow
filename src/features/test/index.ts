/**
 * test 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as fs from 'fs';
import { Services } from '../../services';
import type { WorkbenchHost } from '../../core/workbench';


export function installTest(host: WorkbenchHost, deps: Pick<Services, 'records' | 'judge' | 'workspace' | 'statement' | 'support'>): void {
  host.handlers['testSaveCases'] = (msg: any) => handleTestSave(host, deps, msg?.payload);
  host.handlers['testRunAll'] = (msg: any) => handleTestRun(host, deps, msg?.payload);
  host.handlers['testRunOne'] = (msg: any) => handleTestRunOne(host, deps, msg?.payload);
  host.handlers['translateStatement'] = (msg: any) => handleTranslateStatement(host, deps);
}


async function handleTestSave(host: WorkbenchHost, deps: Pick<Services, 'workspace'>, payload: any) {
  const filePath = payload?.filePath;
  const cases: { id: number; input: string; output: string }[] = payload?.cases || [];
  if (!filePath) {
    host.post({ type: 'testStatus', message: '未打开题目文件，无法保存' });
    return;
  }
  const updated = deps.workspace.saveProblemTests(filePath, cases);
  host.post({
    type: 'testStatus',
    message: updated ? `已保存 ${cases.length} 个测试用例` : '未找到 .prob 文件，保存失败'
  });
}


async function handleTestRun(host: WorkbenchHost, deps: Pick<Services, 'records' | 'judge' | 'workspace' | 'support'>, payload: any) {
  const filePath = payload?.filePath;
  const cases: { id: number; input: string; output: string }[] = payload?.cases || [];
  if (!filePath) {
    host.post({ type: 'testRunDone', passed: 0, total: 0, message: '未打开题目文件' });
    return;
  }
  if (cases.length === 0) {
    host.post({ type: 'testRunDone', passed: 0, total: 0, message: '没有测试用例' });
    return;
  }

  // 先把当前编辑的用例保存到 .prob，避免误改丢失
  deps.workspace.saveProblemTests(filePath, cases);

  host.testCancelled = false;
  host.post({ type: 'testRunning', running: true });

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
    host.post({ type: 'testStatus', message: `正在运行用例 ${i + 1}/${cases.length}...` });
    const r = await deps.judge.run(compile.exePath, c.input, timeoutMs);
    let status: 'passed' | 'failed' | 'error';
    let message = '';
    if (r.timedOut) {
      status = 'error';
      message = `超时（>${(timeoutMs / 1000).toFixed(0)}s）`;
    } else if (r.code !== 0) {
      status = 'error';
      message = `运行错误（退出码 ${r.code}）${r.stderr ? '：' + r.stderr.slice(0, 400) : ''}`;
    } else if (deps.judge.judge(r.stdout, c.output)) {
      status = 'passed';
      passed++;
    } else {
      status = 'failed';
    }
    host.post({ type: 'testResult', caseId: c.id, status, actual: r.stdout, timeMs: r.timeMs, message });
  }

  host.post({
    type: 'testRunDone',
    passed,
    total: cases.length,
    message: cancelled ? '已取消' : `通过 ${passed}/${cases.length}`,
    cancelled
  });
  host.post({ type: 'testRunning', running: false });

  // 刷题记录联动：完整跑完一轮（未取消）即更新——全过记 AC，否则记尝试中，attempts+1
  if (!cancelled && cases.length > 0) {
    try {
      const probPath = deps.workspace.findProbFile(filePath);
      if (probPath) {
        const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
        const problem = deps.workspace.problemFromProb(prob);
        if (problem) {
          const rec = await deps.records.ensure(problem);
          const allPassed = passed === cases.length;
          await deps.records.update(problem.id, {
            status: allPassed ? 'ac' : 'trying',
            attempts: rec.attempts + 1
          });
          host.pushRecords(); // V0.8：一次刷新同时更新列表、统计、今日与饼图
        }
      }
    } catch {
      /* 记录失败不影响测试结果 */
    }
  }
}


async function handleTestRunOne(host: WorkbenchHost, deps: Pick<Services, 'judge'>, payload: any) {
  const filePath = payload?.filePath;
  const caseId = payload?.caseId;
  const input = String(payload?.input ?? '');
  const output = String(payload?.output ?? '');
  if (!filePath || caseId === undefined) return;

  const timeoutMs = host.testTimeoutMs(); // Bug4：按题目时间限制判定 TLE
  const compile = host.compileFor(filePath, 1, 'one');
  if (!compile.ok || !compile.exePath) return;

  host.post({ type: 'testStatus', message: '正在运行该用例...' });
  const r = await deps.judge.run(compile.exePath, input, timeoutMs);
  let status: 'passed' | 'failed' | 'error';
  let message = '';
  if (r.timedOut) {
    status = 'error';
    message = `超时（>${(timeoutMs / 1000).toFixed(0)}s）`;
  } else if (r.code !== 0) {
    status = 'error';
    message = `运行错误（退出码 ${r.code}）${r.stderr ? '：' + r.stderr.slice(0, 400) : ''}`;
  } else if (deps.judge.judge(r.stdout, output)) {
    status = 'passed';
  } else {
    status = 'failed';
  }
  host.post({ type: 'testResult', caseId, status, actual: r.stdout, timeMs: r.timeMs, message });
  host.post({ type: 'testStatus', message: '' });
}


async function handleTranslateStatement(host: WorkbenchHost, deps: Pick<Services, 'statement' | 'support'>) {
  const st = deps.statement.lastStatement;
  if (!st) {
    host.post({ type: 'statementTranslated', payload: { id: null, zh: null, reason: 'noStatement' } });
    return;
  }
  deps.support.trace('service', 'translateStatement', `start ${st.id}`);
  console.log(`[ACM-Workflow][翻译] 手动翻译请求：${st.id}（HTML ${st.html.length} 字符）`);
  let zh: (string | null)[] | null = deps.statement.translateCache.get(st.id) ?? null;
  if (!zh) {
    zh = await deps.statement.translate(st.html).catch(() => null);
    if (zh) deps.statement.translateCache.set(st.id, zh);
  }
  // V0.20：译文落盘到题目文件夹（题面.zh.json v2，与 HTML 段落对齐）
  if (zh && st.filePath) {
    deps.statement.writeFiles(st.filePath, st.html, zh);
    console.log(`[ACM-Workflow][翻译] 译文已落盘：${st.filePath}`);
  }
  const translatable = deps.statement.countTranslatable(st.html);
  const reason = zh && zh.some(Boolean) ? undefined : translatable > 0 ? 'unavailable' : 'none';
  host.post({ type: 'statementTranslated', payload: { id: st.id, zh, reason } });
  const okCount = zh ? zh.filter(Boolean).length : 0;
  deps.support.trace('service', 'translateStatement', okCount > 0 ? `ok ${st.id} ${okCount}段` : `fail ${st.id} ${translatable > 0 ? 'unavailable' : 'none'}`);
  console.log(`[ACM-Workflow][翻译] 手动翻译结果：${okCount > 0 ? okCount + ' 段' : '失败（' + (translatable > 0 ? '翻译暂不可用' : '无可翻译段落') + '）'}`);
}
