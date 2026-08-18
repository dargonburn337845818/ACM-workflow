/**
 * ACM Workflow 冒烟测试（无 VS Code 环境也可运行）：
 * 对编译产物 out/ 中的纯函数做回归断言。
 *
 * 运行：npm test（自动先编译）
 * 覆盖：URL 解析 / 文件名解析 / 输出比对 / 难度分档 / 造数据确定性 / 知识图谱结构
 */
'use strict';

const path = require('path');
const Module = require('module');

// ===== vscode mock：让依赖 vscode 的模块可在 Node 下加载 =====
const vscodeMock = require('./mock-vscode');
const mockPath = require.resolve('./mock-vscode');
require.cache[mockPath] = { id: mockPath, filename: mockPath, loaded: true, exports: vscodeMock };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return mockPath;
  return origResolve.call(this, request, ...args);
};

const root = path.join(__dirname, '..');
const out = (p) => path.join(root, 'out', p);

let passed = 0;
let failed = 0;
function assert(cond, name, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

console.log('== 1. cfUrl 解析 ==');
{
  const { parseCfProblemUrl } = require(out('services/cfUrl.js'));
  const cases = [
    ['https://codeforces.com/problemset/problem/1791/E', '1791E'],
    ['https://codeforces.com/contest/1791/problem/E', '1791E'],
    ['https://codeforces.com/gym/104053/problem/A', '104053A'],
    ['https://codeforces.com/problemset/problem/1791/e?locale=en', '1791E'], // 小写+query
    ['https://codeforces.com/contest/2257/problem/F2/', '2257F2'],           // 尾斜杠
    ['https://codeforces.com/problemset/problem/1060/E#comment', '1060E'],  // hash
    ['https://codeforces.com/gym/104053/problem/A?x=1#top', '104053A']
  ];
  for (const [url, id] of cases) {
    try {
      const p = parseCfProblemUrl(url);
      assert(p.id === id, `解析 ${url} → ${p.id}`, `期望 ${id}`);
    } catch (e) { assert(false, `解析 ${url}`, e.message); }
  }
  const errCases = [
    ['https://example.com/problem/P1001', '仅支持 Codeforces'],
    ['https://codeforces.com/problemset/problem/ABC', '无法识别的 CF 链接格式'],
    ['', '链接为空'],
    ['not a url', '仅支持 Codeforces']
  ];
  for (const [url, kind] of errCases) {
    try { parseCfProblemUrl(url); assert(false, `应报错：${url}`, '未抛异常'); }
    catch (e) { assert(String(e.message).includes(kind), `报错分类 ${url}`, e.message); }
  }
}

console.log('== 2. 文件名 → 题目解析 ==');
{
  const { problemFromFileName } = require(out('core/workbench.js'));
  const cases = [
    ['/x/P1001.cpp', null, null],
    ['/x/979E.cpp', '979E', 'codeforces'],
    ['/Codeforces/154A/Hometask.cpp', '154A', 'codeforces'],
    ['/Other/P1660/solve.cpp', null, null],
    ['/main.cpp', null, null],
    ['/USACO10FEB_Chocolate_Buying_S.cpp', null, null]
  ];
  for (const [file, id, platform] of cases) {
    const p = problemFromFileName(file);
    if (id === null) assert(p === null, `非题目文件 ${file}`);
    else assert(p && p.id === id && p.platform === platform, `解析 ${file} → ${p.id}`, JSON.stringify(p));
  }
}

console.log('== 3. 输出比对（空白容忍） ==');
{
  const { normalizeOutput, judge } = require(out('services/runner.js'));
  assert(normalizeOutput('1 2 3\n') === '1 2 3', 'normalizeOutput 去行尾空白');
  assert(judge('1 2 3\n', '1 2 3'), 'judge 通过');
  assert(!judge('1 2', '1 3'), 'judge 拒绝不同输出');
  assert(!judge(' 1  2\n\n', '1 2'), 'judge 不忽略行首空白（CPH 同规则）');
}

console.log('== 4. CF 难度分档 ==');
{
  const { computeDifficultyBins } = require(out('services/statistics.js'));
  const mk = (difficulty) => ({ id: 'x', platform: 'codeforces', title: 't', url: 'u', status: 'ac', attempts: 1, updatedAt: 0, difficulty });
  const bins = computeDifficultyBins([mk(800), mk(1500), mk(3500), mk(undefined)]);
  assert(bins.total === 4, '总数 4', JSON.stringify(bins));
  assert(bins.undetermined === 1, '未定分 1');
  const labeled = bins.bins.filter((b) => b.count > 0).map((b) => b.label);
  assert(labeled.includes('800') && labeled.includes('1400') && labeled.includes('3000+'), `分档 ${labeled.join(',')}`);
}

console.log('== 5. 造数据确定性 ==');
{
  const { generateInput, mulberry32 } = require(out('services/dataGen.js'));
  (async () => {
    const spec = { type: 'array', nMin: 5, nMax: 5, vMin: 1, vMax: 100, seed: 42 };
    const a = await generateInput(spec, mulberry32(42));
    const b = await generateInput(spec, mulberry32(42));
    assert(a === b, '同种子输出一致', `${a} vs ${b}`);
    const lines = a.trim().split('\n');
    assert(lines[0] === '5', '首行为 n', lines[0]);
    assert(lines[1].split(' ').length === 5, '次行为 5 个数');
    const perm = await generateInput({ type: 'permutation', nMin: 6, nMax: 6, seed: 7 }, mulberry32(7));
    const nums = perm.trim().split('\n')[1].split(' ').map(Number);
    assert(new Set(nums).size === 6, '排列无重复');
  })().catch((e) => { assert(false, '造数据', e.message); });
}

console.log('== 6. 知识图谱结构 ==');
{
  const { KNOWLEDGE_CATEGORIES } = require(out('features/manual/knowledgeMap.js'));
  assert(Array.isArray(KNOWLEDGE_CATEGORIES) && KNOWLEDGE_CATEGORIES.length >= 6, `一级分类 ${KNOWLEDGE_CATEGORIES.length} 个`);
  const all = KNOWLEDGE_CATEGORIES.flatMap((c) => c.subs || []).flatMap((s) => s.algorithms || []);
  assert(all.length >= 25, `算法节点 ${all.length} 个`);
  const bad = all.filter((a) => !a.name || !a.cpp || !a.complexity);
  assert(bad.length === 0, '每个算法含 name/cpp/complexity', bad.map((b) => b.name).join(','));
}

console.log('== 7. WSL 路径适配 ==');
{
  const { normalizePath } = require(out('utils/paths.js'));
  if (process.platform === 'linux') {
    assert(normalizePath('D:\\CF\\work') === '/mnt/d/CF/work', 'Windows 盘符路径转 WSL /mnt');
    assert(normalizePath('C:/Program Files/Edge/msedge.exe') === '/mnt/c/Program Files/Edge/msedge.exe', '正斜杠 Windows 路径转 WSL');
  } else {
    assert(normalizePath('D:\\CF\\work') === path.resolve('D:\\CF\\work'), 'Windows 平台保留原路径');
  }
}

console.log('== 8. 扩展激活链路（模拟 VS Code） ==');
(async () => {
  const vscodeMock = require('./mock-vscode');
  const { activate, deactivate } = require(out('extension.js'));
  const context = {
    extensionUri: { toString: () => 'mock://ext' },
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }
  };
  try {
    activate(context);
    const cmds = vscodeMock.__registeredCommands.map((c) => c.command);
    for (const expect of ['acmWorkflow.open', 'acmWorkflow.pickProblem', 'acmWorkflow.refreshTests',
      'acmWorkflow.backfillAllTests', 'acmWorkflow.diagnose', 'acmWorkflow.beautify', 'acmWorkflow.beautifyRestore']) {
      assert(cmds.includes(expect), `命令已注册 ${expect}`);
    }
    assert(vscodeMock.__registeredViews.length === 1 && vscodeMock.__registeredViews[0].viewType === 'acmWorkflow.workbench',
      '侧边栏 WebviewView 已注册');
    // 等 400ms 让 companion 服务绑定端口（activate 内异步无 await，端口在 close 前绑定）
    await new Promise((r) => setTimeout(r, 400));
    context.subscriptions.forEach((d) => { try { d.dispose && d.dispose(); } catch { /* ignore */ } });
    deactivate();
    console.log('  扩展激活与释放完成');
  } catch (e) {
    assert(false, '扩展激活', e.message);
  }
})();

console.log('== 9. 题面 LaTeX 排版（CF $$$ 行内公式） ==');
(async () => {
  try {
    const { parseCfStatementHtml } = require(out('services/statementHtml.js'));
    const html = `<div class="problem-statement"><div class="header"><div class="title">T</div><div class="time-limit"><div class="property-title">time limit per test</div>2 seconds</div><div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div></div><div class="legend"><p>Naman has two binary strings $$$s$$$ and $$$t$$$ of length $$$n$$$.</p></div><div class="sample-tests"><div class="sample-test"><div class="input"><pre>1</pre></div><div class="output"><pre>1</pre></div></div></div></div>`;
    const res = await parseCfStatementHtml(html, async () => null);
    assert(res.html.includes('<span class="acm-math">s</span> and <span class="acm-math">t</span> of length <span class="acm-math">n</span>'),
      'CF $$$ 公式被识别为行内公式');
    assert(!res.html.includes('acm-math-block'), 'CF $$$ 行内公式不会误判为块级公式', res.html);
  } catch (e) {
    assert(false, '题面 LaTeX 排版', e.message);
  }
})();

console.log('== 10. 诊断服务（轨迹 / 脱敏 / 异常分析 / 报告） ==');
{
  const diag = require(out('services/diagnostics.js'));
  // 轨迹环形缓冲：最多 100 条
  diag.clearTrace();
  for (let i = 0; i < 105; i++) diag.trace('command', 'event-' + i, 'ok');
  const trace = diag.getTrace();
  assert(trace.length === 100, '轨迹最多保留 100 条', String(trace.length));
  assert(trace[0].name === 'event-5', '轨迹丢弃最旧条目', trace[0].name);
  assert(trace[99].name === 'event-104', '轨迹保留最新条目', trace[99].name);

  // 脱敏
  const home = require('os').homedir();
  const sanitized = diag.sanitizeText(`path=${home}/x user@example.com key=abc123`);
  assert(!sanitized.includes(home), '脱敏隐藏主目录');
  assert(!sanitized.includes('user@example.com'), '脱敏隐藏邮箱');
  assert(!sanitized.includes('key=abc123'), '脱敏隐藏疑似密钥');

  // 重复事件：同源同事件 1 秒内 ≥3 次
  const dupTrace = [
    { time: 1000, source: 'webview', name: 'recordAction', result: 'received' },
    { time: 1100, source: 'webview', name: 'recordAction', result: 'received' },
    { time: 1200, source: 'webview', name: 'recordAction', result: 'received' }
  ];
  const dup = diag.findDuplicateEvents(dupTrace);
  assert(dup.length === 1 && dup[0].id === 'DUP', '重复事件被识别', JSON.stringify(dup));

  // 失败/错误结果
  const fail = diag.findFailureEvents([{ time: 1, source: 'service', name: 'fetchStatement', result: 'fail: timeout' }]);
  assert(fail.length === 1 && fail[0].id === 'FAIL', '失败结果被识别', JSON.stringify(fail));

  // 慢操作：超过 10 秒
  const slow = diag.findSlowOperations([
    { time: 1000, source: 'service', name: 'fetchStatement', result: 'start' },
    { time: 12000, source: 'service', name: 'fetchStatement', result: 'ok' }
  ]);
  assert(slow.length === 1 && slow[0].id === 'SLOW', '慢操作被识别', JSON.stringify(slow));

  // 参数化 start（如 "start codeforces 1A"）也应识别为任务开始
  const slowParam = diag.findSlowOperations([
    { time: 1000, source: 'service', name: 'fetchStatement', result: 'start codeforces 1A' },
    { time: 12000, source: 'service', name: 'fetchStatement', result: 'ok' }
  ]);
  assert(slowParam.length === 1 && slowParam[0].id === 'SLOW', '参数化 start 的慢操作被识别', JSON.stringify(slowParam));

  // 重复启动未结束的任务
  const unfinished = diag.findUnfinishedRepeatedTasks([
    { time: 1000, source: 'service', name: 'diagnose', result: 'start' },
    { time: 2000, source: 'service', name: 'diagnose', result: 'start' }
  ]);
  assert(unfinished.length === 1 && unfinished[0].id === 'UNFINISHED', '重复启动未结束任务被识别', JSON.stringify(unfinished));

  // 汇总异常分析
  const issues = diag.analyzeTrace([
    { time: 1000, source: 'webview', name: 'recordAction', result: 'received' },
    { time: 1100, source: 'webview', name: 'recordAction', result: 'received' },
    { time: 1200, source: 'webview', name: 'recordAction', result: 'received' },
    { time: 2000, source: 'service', name: 'diagnose', result: 'start' },
    { time: 3000, source: 'service', name: 'diagnose', result: 'start' }
  ]);
  assert(issues.some((i) => i.id === 'DUP') && issues.some((i) => i.id === 'UNFINISHED'), 'analyzeTrace 汇总多种异常', JSON.stringify(issues));

  // Markdown / JSON 报告渲染
  const report = {
    meta: { extensionVersion: '0.0.0', vscodeVersion: '1.0', platform: 'linux', nodeVersion: 'v0', baseDir: '/tmp', dbPath: '/tmp/records.db', proxy: '', generatedAt: '2026-01-01T00:00:00.000Z' },
    environment: ['平台: linux'], network: ['网络诊断（直连 Codeforces）:'], trace: [{ time: Date.now(), source: 'command', name: 'open', result: 'ok' }],
    issues: [{ id: 'DUP', title: '重复事件', detail: 'x', suggestion: 'y' }]
  };
  const md = diag.renderMarkdown(report);
  assert(md.includes('# ACM Workflow 工作流诊断报告'), 'Markdown 报告含标题');
  assert(md.includes('## 网络诊断') && md.includes('## 操作轨迹') && md.includes('## 发现的问题'), 'Markdown 报告含全部章节');
  const json = diag.renderJson(report);
  assert(json.includes('"issues"') && json.includes('"trace"'), 'JSON 报告含轨迹与异常分析');
}

setTimeout(() => {
  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}, 500);
