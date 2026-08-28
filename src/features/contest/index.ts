/**
 * contest 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Services } from '../../services';
import type { WorkbenchHost } from '../../core/workbench';


export function installContest(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'workspace' | 'statement' | 'records'>): void {
  host.handlers['contestListReady'] = (msg: any) => pushContestList(host, deps);
  host.handlers['contestSelect'] = (msg: any) => handleContestSelect(host, deps, msg?.payload);
  host.handlers['followHandlesAsk'] = (msg: any) => handleFollowHandlesAsk(host, deps);
  host.handlers['contestCreateAll'] = (msg: any) => handleContestCreate(host, deps, msg?.payload);
  host.handlers['problemTranslate'] = (msg: any) => handleProblemTranslate(host, deps, msg?.payload);
}


async function getContestDetailCached(host: WorkbenchHost, deps: Pick<Services, 'codeforces'>, contestId: number) {
  return deps.codeforces.getContestDetail(contestId);
}


async function handleFollowHandlesAsk(host: WorkbenchHost, deps: Pick<Services, 'codeforces'>) {
  const cfg = vscode.workspace.getConfiguration('acmWorkflow');
  const current = (cfg.get<string[]>('followHandles', []) || []).join(', ');
  const input = await vscode.window.showInputBox({
    prompt: '关注的 Codeforces Handle（逗号分隔；自己的 cfHandle 会自动加入）',
    placeHolder: '例如 tourist, jiangly, Benq',
    value: current,
    ignoreFocusOut: true
  });
  if (input === undefined) return; // 用户取消
  const handles = input.split(/[,，\s]+/).map((h) => h.trim()).filter(Boolean);
  await cfg.update('followHandles', handles, vscode.ConfigurationTarget.Global);
  host.post({ type: 'followHandlesSet', handles });
  host.post({ type: 'contestStatus', message: `已保存关注：${handles.join(', ') || '(无)'}（重新展开比赛即可查看关注榜单）` });
}


async function pushContestList(host: WorkbenchHost, deps: Pick<Services, 'codeforces'>) {
  try {
    deps.codeforces.clearContestDetailCache(); // 刷新列表时详情缓存一并失效（赛时榜单/题目会变）
    const contests = await deps.codeforces.listContests();
    host.post({ type: 'contestList', contests: contests.map((c) => ({ ...c })) });
  } catch (e: any) {
    host.post({ type: 'contestList', error: e?.message || '比赛列表获取失败' });
  }
}


async function handleContestSelect(host: WorkbenchHost, deps: Pick<Services, 'codeforces'>, payload: any) {
  const contestId = Number(payload?.contestId);
  if (!contestId) return;
  try {
    if (payload?.refresh) deps.codeforces.invalidateContestDetail(contestId); // 关注变化后强制刷新
    const detail = await getContestDetailCached(host, deps, contestId);
    host.post({ type: 'contestDetail', contestId, detail });
  } catch (e: any) {
    host.post({ type: 'contestDetailError', contestId, message: e?.message || '题目列表获取失败' });
  }
}


async function handleContestCreate(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'workspace' | 'records'>, payload: any) {
  const contestId = Number(payload?.contestId);
  if (!contestId) return;
  try {
    const detail = await getContestDetailCached(host, deps, contestId);
    if (detail.problems.length === 0) {
      throw new Error('该比赛题目尚未公布（比赛开始后可再次点击创建）');
    }
    host.post({
      type: 'contestStatus',
      message: `正在创建比赛 ${detail.contest.name} 的 ${detail.problems.length} 道题目…`
    });
    const files = deps.workspace.createContestProblemFiles(contestId, detail.problems);

    // 登记刷题记录（生成即登记）
    for (const p of detail.problems) {
      deps.records.ensure({
        id: `${contestId}${p.index}`,
        platform: 'codeforces',
        title: p.name,
        difficulty: p.rating,
        tags: p.tags,
        url: `https://codeforces.com/contest/${contestId}/problem/${p.index}`
      }).catch(() => { /* 记录失败不影响生成 */ });
    }

    // V0.17.1：串行抓取每道题样例写入 .prob（间隔 800ms 防风控；已有样例缓存的跳过）
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const n = detail.problems.length;
    let samplesOk = 0;
    let samplesFail = 0;
    for (let i = 0; i < n; i++) {
      const p = detail.problems[i];
      const filePath = files[i]?.filePath;
      if (!filePath) continue;
      // 复用已有缓存：.cph .prob 已有测试用例则跳过（重复创建不重复抓取）
      const probPath = deps.workspace.findProbFile(filePath);
      if (probPath) {
        try {
          const existing = JSON.parse(fs.readFileSync(probPath, 'utf8'));
          if ((existing.tests || []).length > 0) {
            samplesOk++;
            console.log(`[ACM-Workflow][比赛] ${p.index} 样例缓存命中，跳过抓取`);
            continue;
          }
        } catch { /* 按无缓存处理 */ }
      }
      host.post({
        type: 'contestStatus',
        message: `正在抓取第 ${i + 1}/${n} 题（${p.index}）样例…`
      });
      try {
        const pd = await deps.codeforces.getProblemDetail({
          id: `${contestId}${p.index}`,
          platform: 'codeforces',
          title: p.name,
          tags: p.tags,
          url: `https://codeforces.com/contest/${contestId}/problem/${p.index}`
        });
        const ok = deps.workspace.updateContestProblemSamples(filePath, pd.tests);
        console.log(`[ACM-Workflow][比赛] ${p.index} 样例抓取完成：${pd.tests.length} 组（${ok ? '已写入 .prob' : '写入失败' }）`);
        if (pd.tests.length > 0) samplesOk++;
        else {
          deps.workspace.markSamplesFetchFailed(filePath);
          samplesFail++;
        }
      } catch (e: any) {
        console.warn(`[ACM-Workflow][比赛] ${p.index} 样例抓取失败：${e?.message || e}`);
        deps.workspace.markSamplesFetchFailed(filePath);
        samplesFail++;
      }
      if (i < n - 1) await sleep(800); // 请求间隔，降低触发 CF 风控概率
    }

    host.post({
      type: 'contestCreated',
      contestId,
      count: files.length,
      samplesOk,
      samplesFail,
      firstPath: files[0]?.filePath,
      dir: files[0] ? path.dirname(files[0].filePath) : ''
    });

    // 自动打开第一题（A）
    if (files[0]) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(files[0].filePath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  } catch (e: any) {
    host.post({ type: 'contestStatus', message: e?.message || '创建失败', isError: true });
  }
}


async function handleProblemTranslate(host: WorkbenchHost, deps: Pick<Services, 'codeforces' | 'statement'>, payload: any) {
  const url = String(payload?.url || '');
  const label = String(payload?.label || '');
  if (!url) {
    host.post({ type: 'problemTranslateStatus', message: '缺少题目 URL', busy: false, isError: true });
    return;
  }
  host.post({ type: 'problemTranslateStatus', message: '正在抓取英文题面…', busy: true });
  try {
    const res = await deps.statement.fetchStatement({ platform: 'codeforces', id: label, title: label, tags: [], url });
    host.post({ type: 'problemTranslateStatus', message: '正在翻译（中英对照）…', busy: true });
    const zh = await deps.statement.translate(res.html).catch(() => null);
    host.post({ type: 'contestStatement', label, url, html: res.html, zh });
  } catch (e: any) {
    host.post({
      type: 'problemTranslateStatus',
      message: `题面获取/翻译失败：${e?.message || e}`,
      busy: false,
      isError: true
    });
  }
}
