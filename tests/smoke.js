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
  const { ProblemWorkspace } = require(out('services/problemWorkspace.js'));
  const problemWorkspace = new ProblemWorkspace();
  const cases = [
    ['/x/P1001.cpp', null, null],
    ['/x/979E.cpp', '979E', 'codeforces'],
    ['/Codeforces/154A/Hometask.cpp', '154A', 'codeforces'],
    ['/Other/P1660/solve.cpp', null, null],
    ['/main.cpp', null, null],
    ['/USACO10FEB_Chocolate_Buying_S.cpp', null, null]
  ];
  for (const [file, id, platform] of cases) {
    const p = problemWorkspace.problemFromFileName(file);
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

console.log('== 4b. 记录展示统计 ==');
{
  const { computeStats } = require(out('services/recordService.js'));
  const mk = (status, id) => ({ id, platform: 'codeforces', title: id, url: 'u', status, attempts: 1, updatedAt: 0 });
  const stats = computeStats([mk('ac', '1'), mk('ac', '2'), mk('trying', '3'), mk('untouched', '4')]);
  assert(stats.total === 4 && stats.ac === 2 && stats.trying === 1 && stats.rate === '50%',
    'computeStats 汇总正确', JSON.stringify(stats));
  assert(computeStats([]).rate === '–', '空记录 rate 为 –');
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
    const pipe = await generateInput({
      type: 'pipeline',
      steps: [
        { type: 'array', nMin: 2, nMax: 2, vMin: 1, vMax: 9 },
        { type: 'string', lenMin: 3, lenMax: 3, charset: 'lower' }
      ]
    }, mulberry32(1));
    const pipeLines = pipe.trim().split('\n');
    assert(pipeLines.length >= 3, '组合流水线拼接多段数据', pipe);
    const tiny = await generateInput({
      type: 'pipeline',
      steps: [
        { type: 'int', vMin: 3, vMax: 3 },
        { type: 'text', text: ' ' },
        { type: 'int', vMin: 4, vMax: 4 },
        { type: 'newline' }
      ]
    }, mulberry32(1));
    assert(tiny === '3 4\n', '细粒度原语精确拼接', JSON.stringify(tiny));
    const pairs = await generateInput({ type: 'pairs', nMin: 2, nMax: 2, vMin: 1, vMax: 1, wMin: 2, wMax: 2 }, mulberry32(1));
    assert(pairs.trim().split('\n').length === 2 && pairs.trim().split('\n')[0] === '1 2', '每行两个数', pairs);
    const repeated = await generateInput({
      type: 'pipeline',
      steps: [
        { type: 'int', vMin: 3, vMax: 3, varName: 'm' },
        { type: 'newline' },
        { type: 'repeat', countRef: 'm', steps: [
          { type: 'int', vMin: 1, vMax: 1 },
          { type: 'text', text: ' ' },
          { type: 'int', vMin: 2, vMax: 2 },
          { type: 'newline' }
        ] }
      ]
    }, mulberry32(1));
    assert(repeated === '3\n1 2\n1 2\n1 2\n', 'repeat 变量联动重复块', JSON.stringify(repeated));
    const foolproof = await generateInput({
      type: 'pipeline',
      steps: [
        { type: 'line', vMin: 3, vMax: 3, varName: 'n' },
        { type: 'ints', countRef: 'n', vMin: 1, vMax: 1 },
        { type: 'line', vMin: 2, vMax: 2, varName: 'm' },
        { type: 'pairs', countRef: 'm', vMin: 7, vMax: 7, wMin: 8, wMax: 8 }
      ]
    }, mulberry32(1));
    assert(foolproof === '3\n1 1 1\n2\n7 8\n7 8\n', 'line+countRef 拼装', JSON.stringify(foolproof));
    const graph = await generateInput({ type: 'graph', nMin: 5, nMax: 5, mMin: 4, mMax: 4 }, mulberry32(9));
    const gLines = graph.trim().split('\n');
    const [gN, gM] = gLines[0].split(' ').map(Number);
    assert(gN === 5 && gM === 4 && gLines.length === 5, '图：首行/边数正确', graph);
    const gEdges = gLines.slice(1).map((l) => l.split(' ').slice(0, 2).map(Number).sort((a, b) => a - b).join(','));
    assert(new Set(gEdges).size === gM && gEdges.every((e) => e.split(',').every((x) => Number(x) >= 1 && Number(x) <= 5) && e.split(',')[0] !== e.split(',')[1]),
      '图：无重边/无自环', JSON.stringify(gEdges));
    const directed = await generateInput({ type: 'graph', nMin: 4, nMax: 4, mMin: 8, mMax: 8, directed: true }, mulberry32(11));
    const dLines = directed.trim().split('\n');
    const dEdges = dLines.slice(1).map((l) => l.split(' ').slice(0, 2).join(','));
    assert(dLines[0] === '4 8' && new Set(dEdges).size === 8 && !dEdges.some((e) => e.split(',')[0] === e.split(',')[1]),
      '有向图：无重边/无自环', directed);
  })().catch((e) => { assert(false, '造数据', e.message); });
}

console.log('== 5b. 造数据黄金样例 ==');
(async () => {
  const { generateInput, mulberry32 } = require(out('services/dataGen.js'));
  const tree = await generateInput({ type: 'tree', nMin: 4, nMax: 4 }, mulberry32(42));
  assert(tree === '4\n1 2\n1 3\n3 4\n', '树 golden 输出', JSON.stringify(tree));
  const str = await generateInput({ type: 'string', lenMin: 8, lenMax: 8, charset: 'lower' }, mulberry32(42));
  assert(str === 'lwrenhqw\n', '字符串 golden 输出', JSON.stringify(str));
  const graph = await generateInput({ type: 'graph', nMin: 5, nMax: 5, mMin: 4, mMax: 4 }, mulberry32(42));
  assert(graph === '5 4\n1 5\n2 5\n3 5\n1 3\n', '图 golden 输出', JSON.stringify(graph));
})().catch((e) => { assert(false, '造数据黄金样例', e.message); });

console.log('== 6. WSL 路径适配 ==');
{
  const { normalizePath } = require(out('utils/paths.js'));
  if (process.platform === 'linux') {
    assert(normalizePath('D:\\CF\\work') === '/mnt/d/CF/work', 'Windows 盘符路径转 WSL /mnt');
    assert(normalizePath('C:/Program Files/Edge/msedge.exe') === '/mnt/c/Program Files/Edge/msedge.exe', '正斜杠 Windows 路径转 WSL');
  } else {
    assert(normalizePath('D:\\CF\\work') === path.resolve('D:\\CF\\work'), 'Windows 平台保留原路径');
  }
}

console.log('== 7. 扩展激活链路（模拟 VS Code） ==');
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

console.log('== 8. 题面 LaTeX 排版（CF $$$ 行内公式） ==');
(async () => {
  try {
    const { parseCfStatementHtml } = require(out('services/statementHtml.js'));
    const html = `<div class="problem-statement"><div class="header"><div class="title">T</div><div class="time-limit"><div class="property-title">time limit per test</div>2 seconds</div><div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div></div><div class="legend"><p>Naman has two binary strings $$$s$$$ and $$$t$$$ of length $$$n$$$.</p></div><div class="sample-tests"><div class="sample-test"><div class="input"><pre>1</pre></div><div class="output"><pre>1</pre></div></div></div></div>`;
    const res = await parseCfStatementHtml(html, async () => null);
    assert(res.html.includes('<span class="acm-math">s</span> and <span class="acm-math">t</span> of length <span class="acm-math">n</span>'),
      'CF $$$ 公式被识别为行内公式');
    assert(!res.html.includes('acm-math-block'), 'CF $$$ 行内公式不会误判为块级公式', res.html);

    const htmlSupSub = `<div class="problem-statement"><div class="header"><div class="title">T</div></div><div class="legend"><p><span class="tex-span">10<sup>5</sup></span> and <span class="tex-span">x<sub>i</sub></span></p></div></div>`;
    const res2 = await parseCfStatementHtml(htmlSupSub, async () => null);
    assert(res2.html.includes('<span class="acm-math">10^{5}</span>'), 'tex-span 的 <sup> 转 LaTeX 上标');
    assert(res2.html.includes('<span class="acm-math">x_{i}</span>'), 'tex-span 的 <sub> 转 LaTeX 下标');

    // 0.20.1：题面页不再重复展示样例（样例只保留在「样例」页的可编辑用例中）
    const { stripSamplesFromStatementHtml } = require(out('services/statementHtml.js'));
    const stripped = stripSamplesFromStatementHtml(res.html);
    assert(!stripped.includes('st-sample'), '题面页 HTML 移除样例内容块', stripped);
    assert(!/样例/.test(stripped), '题面页 HTML 不出现「样例」标题', stripped);
    assert(stripped.includes('Naman has two binary strings'), '题面页 HTML 保留题目描述', stripped);
    assert(stripped.includes('acm-math'), '题面页 HTML 保留公式', stripped);
  } catch (e) {
    assert(false, '题面 LaTeX 排版', e.message);
  }
})();

console.log('== 8b. 题面 viewHtml 缓存 ==');
{
  const { StatementService } = require(out('services/statementService.js'));
  const st = new StatementService({});
  const html = '<h1 class="st-title">T</h1><div class="st-sample"><pre>1</pre></div><div class="st-block st-p"><div class="st-en">desc</div></div>';
  const a = st.viewHtml(html);
  const b = st.viewHtml(html);
  assert(a === b, 'viewHtml 重复调用返回同一缓存结果');
  assert(!a.includes('st-sample'), 'viewHtml 移除样例内容');
  assert(a.includes('desc'), 'viewHtml 保留正文');
}

console.log('== 9. 诊断服务（轨迹 / 脱敏 / 异常分析 / 报告） ==');
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

console.log('== 10. 算法术语表（ADR 0002） ==');
{
  const { applyGlossary, glossarySize } = require(out('services/glossary.js'));
  assert(glossarySize() > 0, '术语表非空');
  assert(
    applyGlossary('Use dynamic programming to solve it.', '使用动态编程来解决。') === '使用动态规划来解决。',
    '动态编程 → 动态规划'
  );
  assert(
    applyGlossary('Find the shortest path.', '找到最短路径。') === '找到最短路。',
    '最短路径 → 最短路'
  );
  assert(
    applyGlossary('No term here.', '没有术语。') === '没有术语。',
    '未命中英文术语时不替换'
  );
}

console.log('== 11. 测试页签 CSS（样例运行区只出现在样例页） ==');
{
  const fs = require('fs');
  const css = fs.readFileSync(path.join(root, 'media/style.css'), 'utf8');
  const m = css.match(/\.test-lower\s*\{([^}]*)\}/);
  assert(!!m, '找到 .test-lower 规则');
  assert(m && !/display\s*:\s*flex/.test(m[1]), '样例运行区不覆盖 .test-page-panel 的隐藏逻辑', m && m[1]);
}

console.log('== 12. Spark 解析器与提示词锚定 ==');
{
  const { extractPythonCode, buildDataGenPrompt, buildSampleShapeFallbackScript, buildInputFormatScript } = require(out('services/spark.js'));
  const fenced = extractPythonCode('Here:\n```python\nprint(1)\n```\nDone');
  assert(fenced === 'print(1)', '代码块优先提取', fenced);
  const plain = extractPythonCode('Here is your code:\nprint(1)\n');
  assert(plain === 'print(1)', '无代码块时按 print 起始暴力降级', plain);
  const def = extractPythonCode('Let me help.\ndef solve():\n    print(1)\n\nif __name__ == "__main__":\n    solve()\n');
  assert(def.startsWith('def solve():') && def.includes('solve()'), '按 def 起始提取完整脚本', def);
  const withProse = extractPythonCode('import random\nprint(1)\n说明：这是解释\n后面还有解释');
  assert(withProse === 'import random\nprint(1)', '切除代码尾部散文说明', JSON.stringify(withProse));
  assert(extractPythonCode('这段只是解题分析，没有代码。') === '', '无代码行返回空串，允许回退 reasoning 代码块');
  const fallback = buildSampleShapeFallbackScript([{ input: '3\n1 2 3\n4 5 6\n', output: '6\n' }]);
  assert(fallback && fallback.includes('random.randint') && fallback.split('\n').filter((l) => l.startsWith('print(')).length === 3,
    '样例形状保底脚本按行生成', JSON.stringify(fallback));
  const rangedFallback = buildSampleShapeFallbackScript([{ input: '3\n1 2 3\n4 5 6\n' }], '0≤a_i≤100');
  assert(rangedFallback && rangedFallback.includes('random.randint(0, 100)'),
    '样例兜底也应用题面元素范围', JSON.stringify(rangedFallback));
  const arrayFallback = buildSampleShapeFallbackScript([{ input: '5\n1 2 3 4 5\n' }]);
  assert(arrayFallback && arrayFallback.includes('n = 5') && arrayFallback.includes('print(n)') &&
    /print\(.*random\.randint/m.test(arrayFallback),
    '样例形状识别：首行N+数组', JSON.stringify(arrayFallback));
  const rowsFallback = buildSampleShapeFallbackScript([{ input: '3\n1 2\n3 4\n5 6\n' }]);
  assert(rowsFallback && rowsFallback.includes('for _ in range(n):') && rowsFallback.includes('print(n)'),
    '样例形状识别：首行N+矩阵', JSON.stringify(rowsFallback));
  const inputArray = buildInputFormatScript('## 输入格式\n第一行包含一个整数 n (1≤n≤5)。\n第二行包含 n 个整数 a_i。\n\n## 输出格式\n输出答案\n');
  assert(inputArray && inputArray.includes('n = random.randint(1, 5)') && inputArray.includes('print(n)'),
    '输入格式解析：首行N+数组', JSON.stringify(inputArray));
  const rangeArray = buildInputFormatScript('## 输入格式\n第一行包含一个整数 n。\n第二行包含 n 个整数 a_i (0≤a_i≤10)。\n\n## 输出格式\n输出答案\n');
  assert(rangeArray && rangeArray.includes('random.randint(0, 10)'),
    '输入格式解析：数组元素范围应用', JSON.stringify(rangeArray));
  const inputRows = buildInputFormatScript('## 输入格式\n第一行包含两个整数 n 和 m。\n接下来 m 行，每行两个整数 u v (1≤u≤5, 1≤v≤5)。\n\n## 输出格式\n输出答案\n');
  assert(inputRows && inputRows.includes('print(n, m)') && inputRows.includes('for _ in range(m):') &&
    inputRows.includes('random.randint(1, 5)') && inputRows.includes('random.randint(1, 5)'),
    '输入格式解析：N M+边列表+范围', JSON.stringify(inputRows));
  const prompt = buildDataGenPrompt({
    title: 'T',
    id: '1A',
    samples: [{ input: '3\n1 2 3\n', output: '6\n' }]
  });
  assert(prompt.includes('输出格式硬约束') && prompt.includes('样例格式') && prompt.includes('绝不能无输出'),
    '提示词含首尾锚定与样例格式', prompt.slice(0, 200));
}

setTimeout(() => {
  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}, 500);
