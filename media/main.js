(function () {
  const vscode = acquireVsCodeApi();
  let currentProblem = null;
  let lastPickPayload = null; // 记住上次选题条件，供"换一题/下一题"复用
  let contestLoaded = false; // 比赛列表是否已请求过（避免进入比赛页只显示“加载中”但不加载）

  // ===== 题面与翻译（V0.8）：marked + KaTeX CDN 多源回退 =====
  const stBody = document.getElementById('st-body');
  const stModeBtn = document.getElementById('st-mode-btn');
  const stRefetchBtn = document.getElementById('st-refetch-btn');
  const curFileEl = document.getElementById('cur-file');   // Bug6：共用「当前题目」指示器
  const stLimitsEl = document.getElementById('st-limits'); // Bug4：时间/内存限制栏
  const stImgHint = document.getElementById('st-img-hint'); // Bug3：带图题提示
  let stData = null;   // {id,title,url,md,difficulty}
  let stZh = null;     // (string|null)[] 与原文段落一一对应
  let stMode = 'both'; // both | zh | en
  let stLibsReady = false;

  const CDN = {
    marked: [
      'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
      'https://unpkg.com/marked@12.0.2/marked.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
      'https://cdn.staticfile.org/marked/12.0.2/marked.min.js'
    ],
    katex: [
      'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js',
      'https://unpkg.com/katex@0.16.11/dist/katex.min.js'
    ],
    katexAutoRender: [
      'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/contrib/auto-render.min.js',
      'https://unpkg.com/katex@0.16.11/dist/contrib/auto-render.min.js'
    ]
  };

  function loadScriptChain(urls, done) {
    let i = 0;
    (function next() {
      if (i >= urls.length) { done(null); return; }
      const s = document.createElement('script');
      s.src = urls[i++];
      s.onload = () => done(s.src);
      s.onerror = () => next();
      document.head.appendChild(s);
    })();
  }

  function loadStatementLibs(done) {
    if (stLibsReady) { done(); return; }
    // V0.15：CDN 源不可达时脚本可能长时间不回调——3.5s 总超时兜底，渲染不卡死
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      done();
    };
    timer = setTimeout(function () {
      console.warn('[ACM-Workflow][题面] CDN 加载超时（3.5s），使用简易渲染');
      stLibsReady = true;
      finish();
    }, 3500);
    loadScriptChain(CDN.marked, () => {
      loadScriptChain(CDN.katex, (url) => {
        if (url) {
          const base = url.replace(/\/katex\.min\.js$/, '');
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = base + '/katex.min.css';
          document.head.appendChild(link);
        }
        loadScriptChain(CDN.katexAutoRender, () => {
          stLibsReady = true;
          finish();
          // Bug2：若超时兜底已先渲染简易版，库就绪后再补一次完整渲染（KaTeX 公式生效）
          try { done(); } catch (e) { /* 渲染函数异常不影响 */ }
        });
      });
    });
  }

  /** 简易 Markdown → HTML（V0.12：marked CDN 不可用时降级渲染，题面不空白） */
  function simpleMdToHtml(md) {
    return String(md).split(/\n{2,}/).map(function (block) {
      const b = block.trim();
      if (!b) return '';
      if (/^#{1,6}\s/.test(b)) {
        const level = Math.min(b.match(/^#+/)[0].length, 4);
        const text = escapeHtml(b.replace(/^#+\s*/, ''));
        return '<h' + level + '>' + text + '</h' + level + '>';
      }
      if (/^```/.test(b)) {
        const code = escapeHtml(b.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, ''));
        return '<pre>' + code + '</pre>';
      }
      if (/^>/.test(b)) {
        return '<blockquote>' + escapeHtml(b.replace(/^>\s?/gm, '')) + '</blockquote>';
      }
      const inline = escapeHtml(b)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // V0.17：Markdown 图片（data URI 内嵌 或 https 链接）渲染为 <img>
        .replace(/!\[([^\]]*)\]\((data:[^)\s]+|https?:\/\/[^)\s]+)\)/g,
          (_m, alt, url) => '<img class="st-img" alt="' + alt + '" src="' + url.replace(/&amp;/g, '&') + '">');
      return '<p>' + inline.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  // V0.20：渲染排版好的题面 HTML（公式在 .acm-math 标签内，KaTeX 渲染；失败保留源码）
  function renderMath(root) {
    try {
      if (window.katex) {
        root.querySelectorAll('.acm-math').forEach((el) => {
          try {
            katex.render(el.textContent, el, {
              throwOnError: false,
              displayMode: el.classList.contains('acm-math-block')
            });
          } catch (e) { /* 保留原始 LaTeX 源码 */ }
        });
      } else {
        console.warn('[ACM-Workflow][题面] KaTeX 未就绪，公式按原文显示');
      }
      // 译文里的 $..$ / $$..$$ 公式标记由 auto-render 处理
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(root, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      }
    } catch (e) { /* 渲染异常不影响题面 */ }
  }

  function renderStatementBody() {
    if (!stBody) return;
    if (!stData || !stData.html) {
      stBody.innerHTML = stData && stData.id
        ? '<div class="muted st-empty">题面为空或渲染失败（排版结果为空）</div>'
        : '<div class="muted st-empty">请在编辑器中打开一个题目文件（如 979E.cpp / P1001.cpp）</div>';
      return;
    }
    stBody.innerHTML = stData.html;
    // V0.20：双语——按 .st-block.st-p 顺序注入译文（与翻译管线段落对齐）
    if (stZh && Array.isArray(stZh)) {
      const blocks = stBody.querySelectorAll('.st-block.st-p');
      blocks.forEach((el, i) => {
        if (!stZh[i]) return;
        const zhDiv = document.createElement('div');
        zhDiv.className = 'st-zh';
        // V0.21：兜底还原 MATHn 占位符——若翻译侧还原失败（API 剥掉掩码控制符），
        // 直接从该段落英文侧的 .acm-math 源码按索引取回公式，绝不把 MATH0 泄漏给用户
        let zh = stZh[i];
        if (/\u0000?MATH\s*\d+\s*\u0000?/.test(zh)) {
          const mathEls = el.querySelectorAll('.acm-math');
          zh = zh.replace(/\u0000?MATH\s*(\d+)\s*\u0000?/g, (m, n) => {
            const me = mathEls[Number(n)];
            if (!me) return m;
            const block = me.classList.contains('acm-math-block');
            return (block ? '$$' : '$') + me.textContent + (block ? '$$' : '$');
          });
        }
        zhDiv.innerHTML = zh; // 含 $..$ / $$..$$ 公式标记
        el.insertBefore(zhDiv, el.firstChild);
      });
    }
    console.log('[ACM-Workflow][题面] 渲染完成：' + stBody.childElementCount + ' 个元素块');
    applyStMode();
    renderMath(stBody);
  }

  // Bug4：限制栏数据来自扩展侧 payload（时间/内存标签）
  function renderLimits() {
    if (!stLimitsEl) return;
    const l = stData && stData.limits ? stData.limits : {};
    stLimitsEl.textContent = (l.timeLabel || l.memoryLabel)
      ? '时间限制：' + (l.timeLabel || '—') + ' | 内存限制：' + (l.memoryLabel || '—')
      : '';
  }

  // Bug3：检测题面是否包含图片（排版 HTML 内嵌 data URI / <img>，或旧 Markdown 图链）
  function hasStatementImage(html) {
    return /(<img\b|data:image\/|!\[[^\]]*\]\()/i.test(String(html || ''));
  }
  function renderImageHint() {
    if (!stImgHint) return;
    stImgHint.style.display = stData && hasStatementImage(stData.html) ? 'block' : 'none';
  }
  if (stImgHint) {
    // 点击提示 → 通知扩展用 vscode.env.openExternal 打开 CF 官网原题
    stImgHint.addEventListener('click', () => {
      if (stData && stData.url) vscode.postMessage({ type: 'openExternal', url: stData.url });
    });
  }

  // V0.20：缓存兜底提示（含「刷新」按钮）；网络恢复重抓成功后自动清除
  function renderCacheNotice(mode) {
    const se = document.getElementById('st-error');
    if (!se) return;
    if (mode === 'fallback') {
      se.innerHTML = '题面来自本地缓存（网络抓取失败） <button class="btn" id="st-refresh-btn">刷新</button>';
      const rb = document.getElementById('st-refresh-btn');
      if (rb) {
        rb.addEventListener('click', () => {
          se.textContent = '正在重新抓取题面…';
          vscode.postMessage({ type: 'refreshStatement' });
        });
      }
    } else {
      se.textContent = '';
    }
  }

  // Bug6：题面与测试用例共用的「当前题目」指示器
  function renderCurFile(info) {
    if (!curFileEl) return;
    if (!info || !info.fileName) {
      curFileEl.textContent = '请在编辑器中打开一个题目文件';
      return;
    }
    if (info.id && info.title) {
      curFileEl.innerHTML = '当前题目：<span class="mono">' + escapeHtml(info.id) + '</span> · ' +
        escapeHtml(info.title) +
        '（难度：<span class="cur-diff">' + escapeHtml(String(info.difficulty != null ? info.difficulty : '—')) + '</span>）';
    } else {
      curFileEl.innerHTML = '当前题目：<span class="mono">' + escapeHtml(info.fileName) + '</span>（难度：—）' +
        (info.hasProb === false
          ? '<span class="muted">（未找到 .prob，可用命令「重新获取测试数据」补样例）</span>'
          : '');
    }
  }

  function applyStMode() {
    const host = document.getElementById('view-test');
    if (!host) return;
    host.classList.toggle('mode-en', stMode === 'en');
    host.classList.toggle('mode-zh', stMode === 'zh');
    if (stModeBtn) stModeBtn.textContent = stMode === 'both' ? '双语' : stMode === 'zh' ? '译文' : '原文';
  }

  if (stModeBtn) {
    stModeBtn.addEventListener('click', () => {
      stMode = stMode === 'both' ? 'zh' : stMode === 'zh' ? 'en' : 'both';
      applyStMode();
    });
  }
  if (stRefetchBtn) {
    stRefetchBtn.addEventListener('click', () => {
      if (!stData || refetchInFlight) return;
      const se = document.getElementById('st-error');
      if (se) se.textContent = '';
      beginRefetchRequest();
      stRefetchBtn.textContent = '重新获取中…';
      vscode.postMessage({ type: 'refreshStatement' });
    });
  }

  // ===== 测试视图状态 =====
  const testStatusEl = document.getElementById('test-status');
  const testCasesEl = document.getElementById('test-cases');
  const testRunBtn = document.getElementById('test-run-btn');
  const testCancelBtn = document.getElementById('test-cancel-btn');
  let testCases = []; // {id,input,output,status,actual,timeMs,message}
  let testFilePath = '';

  // ===== V0.24：题面 / 样例页面切换 =====
  function switchTestPage(page) {
    document.querySelectorAll('.test-page').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === page);
    });
    document.querySelectorAll('.test-page-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.page === page);
    });
    // V0.20.5：样例页切换为适应性窗口（占满可用宽度），题面页保持 720px 居中
    const testView = document.getElementById('view-test');
    if (testView) testView.classList.toggle('mode-samples', page === 'samples');
  }

  let testRunning = false;
  let autoSaveTimer = null;

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 自定义确认弹窗（Webview 不支持 window.confirm，直接调用会静默失败） =====
  const confirmModal = document.getElementById('confirm-modal');
  let confirmCb = null;
  function askConfirm(text, okLabel, cb) {
    const textEl = document.getElementById('confirm-text');
    const okEl = document.getElementById('confirm-ok');
    if (!confirmModal || !textEl || !okEl) { cb(); return; } // 兜底：弹窗缺失时直接执行
    textEl.textContent = text;
    okEl.textContent = okLabel || '确定';
    confirmCb = cb;
    confirmModal.classList.add('open');
    const cancelEl = document.getElementById('confirm-cancel');
    if (cancelEl) cancelEl.focus();
  }
  const confirmCancel = document.getElementById('confirm-cancel');
  if (confirmCancel) {
    confirmCancel.addEventListener('click', () => {
      if (confirmModal) confirmModal.classList.remove('open');
      confirmCb = null;
    });
  }
  const confirmOk = document.getElementById('confirm-ok');
  if (confirmOk) {
    confirmOk.addEventListener('click', () => {
      if (confirmModal) confirmModal.classList.remove('open');
      const cb = confirmCb;
      confirmCb = null;
      if (cb) cb();
    });
  }

  function badgeText(c) {
    if (c.status === 'passed') return '通过';
    if (c.status === 'failed') return '失败';
    if (c.status === 'error') return '错误';
    return '待运行';
  }

  function setTestStatus(text, kind) {
    if (!testStatusEl) return;
    testStatusEl.textContent = text || '';
    testStatusEl.className = 'test-status' + (kind ? ' ' + kind : '');
    // 全过后的"下一题"动作（kind === 'ok' 且全过时由调用方追加按钮）
  }

  function setTestRunning(running) {
    testRunning = running;
    if (testRunBtn) testRunBtn.disabled = running;
    if (testCancelBtn) testCancelBtn.style.display = running ? '' : 'none';
  }

  /** 单用例 DOM：仅更新状态区域（badge/耗时/实际输出），不重建 textarea，保住焦点 */
  function updateCaseDom(c) {
    const card = testCasesEl && testCasesEl.querySelector(`.test-case[data-case-id="${c.id}"]`);
    if (!card) return;
    const badge = card.querySelector('.test-case-badge');
    if (badge) {
      badge.className = 'test-case-badge badge ' + (c.status || 'idle');
      badge.textContent = badgeText(c);
      if (c.status === 'passed' && c.timeMs !== undefined) {
        badge.textContent = '通过';
      }
    }
    const time = card.querySelector('.test-case-time');
    if (time) time.textContent = c.timeMs !== undefined ? c.timeMs + 'ms' : '';
    card.className = 'test-case card' + (c.status ? ' ' + c.status : '');

    // 实际输出区：failed/error 显示，passed/待运行移除
    const oldActual = card.querySelector('.test-case-actual');
    if (c.status === 'failed' || c.status === 'error') {
      const kind = c.status === 'error' ? ' warn' : '';
      const html =
        '<div class="test-case-actual' + kind + '">' +
        '<div class="test-case-label">实际输出' +
        (c.message ? ' · ' + escapeHtml(c.message) : '') + '</div>' +
        '<pre class="test-actual-output">' + escapeHtml(c.actual || '') + '</pre>' +
        '</div>';
      if (oldActual) oldActual.outerHTML = html;
      else card.insertAdjacentHTML('beforeend', html);
    } else if (oldActual) {
      oldActual.remove();
    }
  }

  /** 用例框自适应高度：每行约 20px，120~480px 之间，超出滚动；上限随窗口高度收缩（配合 resize:none） */
  function autoSizeTextareas() {
    const maxH = Math.min(480, Math.max(120, Math.floor(window.innerHeight * 0.6)));
    document.querySelectorAll('.test-input, .test-output').forEach((ta) => {
      const lines = (ta.value.match(/\n/g) || []).length + 1;
      const h = Math.min(maxH, Math.max(120, lines * 20 + 16));
      ta.style.height = h + 'px';
    });
  }

  // 适应性窗口：窗口尺寸变化时重新计算用例框高度
  let autoSizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(autoSizeTimer);
    autoSizeTimer = setTimeout(autoSizeTextareas, 80);
  });

  function renderTestCases() {
    if (!testCasesEl) return;
    if (testCases.length === 0) {
      testCasesEl.innerHTML =
        '<div class="empty">暂无测试用例。<br>可用「添加用例」手动填写，或用命令「ACM Workflow: 重新获取测试数据」补样例。</div>';
      return;
    }
    testCasesEl.innerHTML = testCases.map((c, i) => {
      const actual =
        c.status === 'failed' || c.status === 'error'
          ? '<div class="test-case-actual' + (c.status === 'error' ? ' warn' : '') + '">' +
            '<div class="test-case-label">实际输出' +
            (c.message ? ' · ' + escapeHtml(c.message) : '') + '</div>' +
            '<pre class="test-actual-output">' + escapeHtml(c.actual || '') + '</pre>' +
            '</div>'
          : '';
      return (
        '<div class="test-case card' + (c.status ? ' ' + c.status : '') + '" data-case-id="' + c.id + '">' +
        '<div class="test-case-head">' +
        '<span class="test-case-title">用例 ' + (i + 1) + '</span>' +
        '<span class="test-case-badge badge ' + (c.status || 'idle') + '">' + badgeText(c) + '</span>' +
        '<span class="test-case-time">' + (c.timeMs !== undefined ? c.timeMs + 'ms' : '') + '</span>' +
        '<span class="test-case-ops">' +
        '<button class="case-op" data-op="run" title="运行此用例">运行</button>' +
        '<button class="case-op danger" data-op="del" title="删除用例">删除</button>' +
        '</span>' +
        '</div>' +
        '<div class="test-case-grid">' +
        '<div class="test-case-col">' +
        '<div class="test-case-label">输入</div>' +
        '<textarea class="test-input" spellcheck="false">' + escapeHtml(c.input) + '</textarea>' +
        '</div>' +
        '<div class="test-case-col">' +
        '<div class="test-case-label">期望输出</div>' +
        '<textarea class="test-output" spellcheck="false">' + escapeHtml(c.output) + '</textarea>' +
        '</div>' +
        '</div>' +
        actual +
        '</div>'
      );
    }).join('');
    autoSizeTextareas();
  }

  // ===== 测试视图交互（事件委托，避免重建绑定） =====
  if (testCasesEl) {
    testCasesEl.addEventListener('input', (e) => {
      const ta = e.target;
      const card = ta.closest('.test-case');
      if (!card) return;
      const c = testCases.find((x) => String(x.id) === String(card.dataset.caseId));
      if (!c) return;
      if (ta.classList.contains('test-input')) c.input = ta.value;
      if (ta.classList.contains('test-output')) c.output = ta.value;
      autoSizeTextareas();
      scheduleAutoSave();
    });

    testCasesEl.addEventListener('click', (e) => {
      const op = e.target.closest('.case-op');
      if (!op) return;
      const card = op.closest('.test-case');
      if (!card) return;
      const c = testCases.find((x) => String(x.id) === String(card.dataset.caseId));
      if (!c) return;
      if (op.dataset.op === 'del') {
        testCases = testCases.filter((x) => x !== c);
        renderTestCases();
        scheduleAutoSave();
      } else if (op.dataset.op === 'run') {
        if (!testRunning && testFilePath) {
          vscode.postMessage({
            type: 'testRunOne',
            payload: { filePath: testFilePath, caseId: c.id, input: c.input, output: c.output }
          });
        }
      }
    });
  }

  /** 编辑后 800ms 静默自动保存到 .prob */
  function scheduleAutoSave() {
    if (!testFilePath) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      vscode.postMessage({
        type: 'testAutoSave',
        payload: {
          filePath: testFilePath,
          cases: testCases.map((c) => ({ id: c.id, input: c.input, output: c.output }))
        }
      });
    }, 800);
  }

  function initTestView() {
    const addBtn = document.getElementById('test-add-btn');
    const saveBtn = document.getElementById('test-save-btn');

    document.querySelectorAll('.test-page').forEach((btn) => {
      btn.addEventListener('click', () => switchTestPage(btn.dataset.page));
    });

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        testCases.push({ id: Date.now(), input: '', output: '' });
        renderTestCases();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'testSaveCases',
          payload: {
            filePath: testFilePath,
            cases: testCases.map((c) => ({ id: c.id, input: c.input, output: c.output }))
          }
        });
      });
    }
    if (testRunBtn) {
      testRunBtn.addEventListener('click', () => {
        if (testRunning || !testFilePath) return;
        vscode.postMessage({
          type: 'testRunAll',
          payload: {
            filePath: testFilePath,
            cases: testCases.map((c) => ({ id: c.id, input: c.input, output: c.output }))
          }
        });
      });
    }
    if (testCancelBtn) {
      testCancelBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'testCancel' });
      });
    }
  }

  // ===== 主导航 =====
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      navItems.forEach((b) => b.classList.toggle('active', b === btn));
      views.forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
      if (view === 'history') vscode.postMessage({ type: 'recordsReady' });
      if (view === 'test') vscode.postMessage({ type: 'statementReady' }); // V0.10：题面并入测试面板
      if (view === 'contest' && !contestLoaded) {
        const cl = document.getElementById('contest-list');
        if (cl) cl.innerHTML = '<div class="muted chart-empty">加载中…</div>';
        vscode.postMessage({ type: 'contestListReady' });
      }
    });
  });

  // ===== 选题 =====
  const pickBtn = document.getElementById('pick-btn');
  const weakBtn = document.getElementById('weak-btn');
  const pickResult = document.getElementById('pick-result');
  const pickStatus = document.getElementById('pick-status');
  const recentList = document.getElementById('recent-list');
  const minRange = document.getElementById('min-range');
  const maxRange = document.getElementById('max-range');
  const diffLabel = document.getElementById('diff-label');

  // 第 5 条：常用 CF 标签（key 为 CF 原始标签，zh 用于界面展示）
  const PICK_TAGS = [
    { key: 'dp', zh: '动态规划' },
    { key: 'greedy', zh: '贪心' },
    { key: 'math', zh: '数学' },
    { key: 'graphs', zh: '图论' },
    { key: 'data structures', zh: '数据结构' },
    { key: 'binary search', zh: '二分' },
    { key: 'strings', zh: '字符串' },
    { key: 'implementation', zh: '实现' },
    { key: 'constructive algorithms', zh: '构造' },
    { key: 'sortings', zh: '排序' },
    { key: 'brute force', zh: '暴力' },
    { key: 'combinatorics', zh: '组合数学' },
    { key: 'two pointers', zh: '双指针' },
    { key: 'dfs and similar', zh: '深搜' },
    { key: 'bfs', zh: '广搜' },
    { key: 'trees', zh: '树' },
    { key: 'shortest paths', zh: '最短路' },
    { key: 'dsu', zh: '并查集' },
    { key: 'bitmasks', zh: '位运算' },
    { key: 'number theory', zh: '数论' },
    { key: 'geometry', zh: '计算几何' },
    { key: 'probabilities', zh: '概率期望' },
    { key: 'games', zh: '博弈' },
    { key: 'flows', zh: '网络流' },
    { key: 'hashing', zh: '哈希' },
    { key: 'divide and conquer', zh: '分治' },
    { key: 'matrices', zh: '矩阵' },
    { key: 'knapsack', zh: '背包' },
    { key: 'meet-in-the-middle', zh: '折半搜索' },
    { key: 'ternary search', zh: '三分' },
    { key: 'fft', zh: '快速傅里叶变换' },
    { key: 'interactive', zh: '交互' },
    { key: '2-sat', zh: '2-SAT' },
    { key: 'string suffix structures', zh: '后缀结构' },
    { key: 'graph matchings', zh: '图匹配' },
    { key: 'chinese remainder theorem', zh: '中国剩余定理' }
  ];
  let selectedTags = []; // 当前选中的 CF 标签（多选）

  function sliderStep() { return 100; }

  function sliderRange() {
    return { lo: Number(minRange ? minRange.min : 800), hi: Number(maxRange ? maxRange.max : 3500) };
  }

  /** 同步填充条、两端标签、手柄悬停提示与难度文本 */
  function updateSliderUI() {
    const { lo, hi } = sliderRange();
    const span = hi - lo || 1;
    const minP = ((Number(minRange.value) - lo) / span) * 100;
    const maxP = ((Number(maxRange.value) - lo) / span) * 100;
    const fill = document.getElementById('slider-fill');
    if (fill) {
      fill.style.left = minP + '%';
      fill.style.width = Math.max(0, maxP - minP) + '%';
    }
    if (diffLabel) diffLabel.textContent = minRange.value + ' — ' + maxRange.value;
    if (minRange) minRange.title = '最低难度 ' + minRange.value;
    if (maxRange) maxRange.title = '最高难度 ' + maxRange.value;
    const minEnd = document.getElementById('range-min-label');
    const maxEnd = document.getElementById('range-max-label');
    if (minEnd) minEnd.textContent = String(lo);
    if (maxEnd) maxEnd.textContent = String(hi);
  }

  // 双端滑块互相约束：低 ≤ 高 - step
  if (minRange) {
    minRange.addEventListener('input', () => {
      const step = sliderStep();
      const hi = Number(maxRange.value);
      if (Number(minRange.value) > hi - step) minRange.value = String(Math.max(Number(minRange.min), hi - step));
      updateSliderUI();
      resetPicked(); // Bug2：条件变化 → 恢复推荐
    });
  }
  if (maxRange) {
    maxRange.addEventListener('input', () => {
      const step = sliderStep();
      const lo = Number(minRange.value);
      if (Number(maxRange.value) < lo + step) maxRange.value = String(Math.min(Number(maxRange.max), lo + step));
      updateSliderUI();
      resetPicked();
    });
  }

  // 点击轨道直接跳转：离哪个手柄近就移动哪个（双滑块原生的轨道不可点，需手动实现）
  const sliderTrack = document.querySelector('.slider-track');
  if (sliderTrack) {
    sliderTrack.addEventListener('click', (e) => {
      const rect = sliderTrack.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const { lo, hi } = sliderRange();
      const step = sliderStep();
      const val = Math.round((lo + ratio * (hi - lo)) / step) * step;
      const dMin = Math.abs(val - Number(minRange.value));
      const dMax = Math.abs(val - Number(maxRange.value));
      if (dMin <= dMax) {
        minRange.value = String(Math.min(val, Number(maxRange.value) - step));
      } else {
        maxRange.value = String(Math.max(val, Number(minRange.value) + step));
      }
      updateSliderUI();
    });
  }

  // ===== 第 5 条：按算法标签选题（多选 OR） =====
  function getSelectedTags() {
    return selectedTags.slice();
  }

  function pickTagLabel(tag) {
    const hit = PICK_TAGS.find((t) => t.key.toLowerCase() === String(tag).toLowerCase());
    return hit ? hit.zh : tag;
  }

  function togglePickTag(tag) {
    const key = String(tag || '').trim();
    if (!key) return;
    const idx = selectedTags.indexOf(key);
    if (idx >= 0) selectedTags.splice(idx, 1);
    else selectedTags.push(key);
    renderPickSelectedTags();
    renderPickTagChips();
    resetPicked(); // 标签变化 → 清空已试记录并恢复推荐按钮
  }

  function renderPickSelectedTags() {
    const el = document.getElementById('pick-selected-tags');
    if (!el) return;
    if (!selectedTags.length) {
      el.innerHTML = '<span class="tag-empty muted">未选择标签（不限制）</span>';
      return;
    }
    el.innerHTML = selectedTags.map((t) =>
      '<span class="tag-chip active" data-tag="' + escapeHtml(t) + '">' +
        escapeHtml(pickTagLabel(t)) +
        '<span class="tag-remove" data-remove="' + escapeHtml(t) + '">✕</span>' +
      '</span>'
    ).join('');
  }

  function renderPickTagChips() {
    const el = document.getElementById('pick-tag-chips');
    if (!el) return;
    const searchEl = document.getElementById('pick-tag-search');
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const list = PICK_TAGS.filter((t) =>
      !q || t.key.toLowerCase().indexOf(q) !== -1 || t.zh.toLowerCase().indexOf(q) !== -1
    );
    if (!list.length) {
      el.innerHTML = '<span class="tag-empty muted">没有匹配的常用标签，可直接在搜索框输入后回车</span>';
      return;
    }
    el.innerHTML = list.map((t) => {
      const active = selectedTags.indexOf(t.key) >= 0;
      return '<span class="tag-chip' + (active ? ' active' : '') + '" data-tag="' + escapeHtml(t.key) + '">' + escapeHtml(t.zh) + '</span>';
    }).join('');
  }

  function setStatus(text, isError) {
    if (!pickStatus) return;
    pickStatus.textContent = text || '';
    pickStatus.className = 'pick-status' + (isError ? ' error' : '');
  }

  function renderProblem(problem) {
    currentProblem = problem;
    if (!pickResult) return;

    const tags = (problem.tags || []).slice(0, 8)
      .map((t) => '<span class="cf-tag">' + escapeHtml(t) + '</span>').join('');

    pickResult.innerHTML =
      '<div class="card problem-card">' +
      '<div class="problem-head">' +
      '<span class="problem-id">' + escapeHtml(problem.id) + '</span>' +
      '<span class="problem-rating">' + escapeHtml(problem.difficulty ?? '?') + '</span>' +
      '</div>' +
      '<div class="problem-title">' + escapeHtml(problem.title) + '</div>' +
      '<div class="problem-tags">' + tags + '</div>' +
      '<div class="problem-actions">' +
      '<a class="btn" href="#" data-url="' + escapeHtml(problem.url) + '">打开题目</a>' +
      '<button class="btn" id="re-pick-btn">换一题</button>' +
      '<button class="primary-btn" id="create-btn">生成 cpp 并测试</button>' +
      '</div>' +
      '</div>';

    const createBtn = document.getElementById('create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'createFile', payload: { problem: currentProblem } });
      });
    }
    const rePickBtn = document.getElementById('re-pick-btn');
    if (rePickBtn) {
      rePickBtn.addEventListener('click', () => {
        if (!lastPickPayload || pickRequestInFlight) return;
        beginPickRequest();
        rePickBtn.disabled = true;
        if (pickBtn) pickBtn.disabled = true;
        setStatus('正在换一道 Codeforces 题...');
        vscode.postMessage({ type: 'fetchProblem', payload: lastPickPayload });
      });
    }
  }

  function renderRecentList(recent) {
    if (!recentList) return;
    if (!recent || recent.length === 0) {
      recentList.innerHTML = '<div class="empty">暂无推荐记录</div>';
      return;
    }
    recentList.innerHTML = recent.map((p) =>
      '<button class="recent-item" data-id="' + escapeHtml(p.id) + '">' +
      '<span class="recent-id">' + escapeHtml(p.id) + '</span>' +
      '<span class="recent-title">' + escapeHtml(p.title) + '</span>' +
      '<span class="recent-rating">' + escapeHtml(p.difficulty ?? '?') + '</span>' +
      '</button>'
    ).join('');

    recentList.querySelectorAll('.recent-item').forEach((item) => {
      item.addEventListener('click', () => {
        const problem = recent.find((p) => String(p.id) === String(item.dataset.id));
        if (problem) renderProblem(problem);
      });
    });
  }

  function applyState(state) {
    if (!state) return;
    // 恢复 CF 难度与结果
    if (minRange && state.minRating !== undefined) minRange.value = String(state.minRating);
    if (maxRange && state.maxRating !== undefined) maxRange.value = String(state.maxRating);
    updateSliderUI();
    // 第 5 条：恢复已选标签
    if (Array.isArray(state.tags)) {
      selectedTags = state.tags.filter((t) => typeof t === 'string');
      renderPickSelectedTags();
      renderPickTagChips();
    }
    if (state.problem) renderProblem(state.problem);
    if (state.recent) renderRecentList(state.recent);
  }

  // Bug2：筛选条件下已尝试过的题目 ID（最多 20），避免重复推荐/空条件死循环
  let pickedIds = [];
  let pickRequestInFlight = false;
  let pickRequestTimer = null;
  let refetchInFlight = false;
  let refetchTimer = null;
  let translationStatusTimer = null;
  let translationStatusStart = 0;
  const stTranslationStatusEl = document.getElementById('st-translation-status');
  const NO_PROBLEM_MSG = '当前筛选条件下无可用题目，请调整筛选条件';

  function updateTranslationStatus() {
    if (!stTranslationStatusEl) return;
    const sec = Math.max(1, Math.round((Date.now() - translationStatusStart) / 1000));
    stTranslationStatusEl.textContent = '正在翻译中…（已 ' + sec + 's）';
  }

  function beginTranslationStatus() {
    translationStatusStart = Date.now();
    if (translationStatusTimer) clearInterval(translationStatusTimer);
    translationStatusTimer = setInterval(updateTranslationStatus, 500);
    updateTranslationStatus();
  }

  function endTranslationStatus() {
    if (translationStatusTimer) {
      clearInterval(translationStatusTimer);
      translationStatusTimer = null;
    }
    if (stTranslationStatusEl) stTranslationStatusEl.textContent = '';
  }

  function setPickButtonsDisabled(disabled) {
    const reBtn = document.getElementById('re-pick-btn');
    if (reBtn) reBtn.disabled = disabled;
    if (pickBtn) pickBtn.disabled = disabled;
  }

  /** 筛选条件变化 → 清空已尝试记录并恢复按钮 */
  function resetPicked() {
    pickedIds = [];
    setPickButtonsDisabled(false);
  }

  function beginPickRequest() {
    if (pickRequestTimer) clearTimeout(pickRequestTimer);
    pickRequestInFlight = true;
    pickRequestTimer = setTimeout(() => {
      pickRequestInFlight = false;
      pickRequestTimer = null;
      setPickButtonsDisabled(false);
    }, 20000);
  }

  function endPickRequest() {
    pickRequestInFlight = false;
    if (pickRequestTimer) {
      clearTimeout(pickRequestTimer);
      pickRequestTimer = null;
    }
  }

  function beginRefetchRequest() {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchInFlight = true;
    if (stRefetchBtn) stRefetchBtn.disabled = true;
    refetchTimer = setTimeout(() => {
      refetchInFlight = false;
      refetchTimer = null;
      if (stRefetchBtn) {
        stRefetchBtn.disabled = false;
        stRefetchBtn.textContent = '重新获取';
      }
    }, 60000);
  }

  function endRefetchRequest() {
    refetchInFlight = false;
    if (refetchTimer) {
      clearTimeout(refetchTimer);
      refetchTimer = null;
    }
    if (stRefetchBtn) {
      stRefetchBtn.disabled = false;
      stRefetchBtn.textContent = '重新获取';
    }
  }

  let opTimer = null;
  let opTimerStart = 0;
  function beginOpTimer(update) {
    opTimerStart = Date.now();
    if (opTimer) clearInterval(opTimer);
    opTimer = setInterval(() => {
      const sec = Math.max(1, Math.round((Date.now() - opTimerStart) / 1000));
      update(sec);
    }, 1000);
  }
  function endOpTimer() {
    if (opTimer) {
      clearInterval(opTimer);
      opTimer = null;
    }
  }

  function rememberPicked(id) {
    if (!id) return;
    pickedIds = pickedIds.filter((x) => x !== id);
    pickedIds.push(id);
    if (pickedIds.length > 20) pickedIds.shift();
  }

  function currentPickPayload() {
    const minRating = Number(minRange ? minRange.value : 800);
    const maxRating = Number(maxRange ? maxRange.value : 2400);
    const payload = { platform: 'codeforces', minRating, maxRating };
    const tags = getSelectedTags();
    if (tags.length > 0) payload.tags = tags;
    // Bug2：附带已尝试题目（后端据此排除）
    if (pickedIds.length > 0) payload.exclude = pickedIds.slice();
    return payload;
  }

  if (pickBtn) {
    pickBtn.addEventListener('click', () => {
      const payload = currentPickPayload();
      if (payload.minRating > payload.maxRating) {
        setStatus('难度区间有误：最小值不能大于最大值', true);
        return;
      }
      if (pickRequestInFlight) return;
      beginPickRequest();
      pickBtn.disabled = true;
      const reBtn = document.getElementById('re-pick-btn');
      if (reBtn) reBtn.disabled = true;
      setStatus('正在从 Codeforces 获取题目...');
      vscode.postMessage({ type: 'fetchProblem', payload });
    });
  }

  if (weakBtn) {
    weakBtn.addEventListener('click', () => {
      setStatus('正在基于本地 AC 记录计算薄弱专题...');
      vscode.postMessage({ type: 'fetchWeakProblem' });
    });
  }

  // ===== 第 5 条：标签选择交互（多选 OR） =====
  const pickTagChips = document.getElementById('pick-tag-chips');
  const pickSelectedTags = document.getElementById('pick-selected-tags');
  const pickTagSearch = document.getElementById('pick-tag-search');

  if (pickTagChips) {
    pickTagChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-chip');
      if (chip && chip.dataset.tag) togglePickTag(chip.dataset.tag);
    });
  }
  if (pickSelectedTags) {
    pickSelectedTags.addEventListener('click', (e) => {
      const remove = e.target.closest('.tag-remove');
      if (remove && remove.dataset.remove) togglePickTag(remove.dataset.remove);
    });
  }
  if (pickTagSearch) {
    pickTagSearch.addEventListener('input', renderPickTagChips);
    pickTagSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = pickTagSearch.value.trim();
        if (val) {
          if (selectedTags.indexOf(val) < 0) selectedTags.push(val);
          pickTagSearch.value = '';
          renderPickSelectedTags();
          renderPickTagChips();
          resetPicked();
        }
      }
    });
  }
  renderPickSelectedTags();
  renderPickTagChips();

  // ===== 通过 URL 导入题目（V0.23）=====
  const urlImportInput = document.getElementById('url-import-input');
  const urlImportBtn = document.getElementById('url-import-btn');
  const urlImportStatusEl = document.getElementById('url-import-status');
  let urlImporting = false;

  function setUrlImportStatus(text, kind) {
    if (!urlImportStatusEl) return;
    urlImportStatusEl.textContent = text || '';
    urlImportStatusEl.className = 'url-import-status' + (kind ? ' ' + kind : '');
  }

  function doUrlImport() {
    if (urlImporting || !urlImportInput) return;
    const url = urlImportInput.value.trim();
    if (!url) {
      setUrlImportStatus('请先粘贴 Codeforces 题目链接', 'error');
      return;
    }
    // 前端快速预校验（详细解析在扩展侧）
    if (!/^https?:\/\/codeforces\.com\//i.test(url)) {
      setUrlImportStatus('仅支持 codeforces.com 的题目链接（http/https）', 'error');
      return;
    }
    urlImporting = true;
    if (urlImportBtn) {
      urlImportBtn.disabled = true;
      urlImportBtn.textContent = '导入中…';
    }
    setUrlImportStatus('正在导入…', '');
    vscode.postMessage({ type: 'urlImport', payload: { url } });
  }

  if (urlImportBtn) {
    urlImportBtn.addEventListener('click', doUrlImport);
  }
  if (urlImportInput) {
    urlImportInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doUrlImport();
      }
    });
    urlImportInput.addEventListener('focus', () => {
      if (urlImportStatusEl) urlImportStatusEl.textContent = '';
    });
  }

  const clearHistoryBtn = document.getElementById('clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearHistory' });
    });
  }

  // ===== 刷题记录（前端本地过滤 + 搜索） =====
  const recStatsEl = document.getElementById('rec-stats');
  const recListEl = document.getElementById('rec-list');
  const recSearchEl = document.getElementById('rec-search');
  let recRecords = [];
  let recFilter = 'all';
  let recPlatform = 'all';

  function recBadge(status) {
    return { ac: '已AC', trying: '尝试中', untouched: '未开始', abandoned: '已放弃' }[status] || status;
  }

  /** 记录日期：今天/昨天显示时刻，更早显示日期（V0.8） */
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, now)) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (same(d, yest)) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderRecords() {
    if (!recListEl) return;
    const q = (recSearchEl ? recSearchEl.value : '').trim().toLowerCase();
    let list = recRecords;
    if (recFilter !== 'all') list = list.filter((r) => r.status === recFilter);
    if (recPlatform !== 'all') list = list.filter((r) => r.platform === recPlatform);
    if (q) {
      list = list.filter((r) =>
        String(r.id).toLowerCase().includes(q) || String(r.title).toLowerCase().includes(q)
      );
    }
    if (list.length === 0) {
      recListEl.innerHTML =
        '<div class="empty">' +
        (recRecords.length === 0
          ? '暂无记录。打开题目或运行测试后会自动记录。'
          : '没有符合条件的记录。') +
        '</div>';
      return;
    }
    // V0.9：记录仅保留 题号/标题/难度/平台/AC日期 + 「打开题目」
    recListEl.innerHTML = list.map((r) =>
      '<div class="rec-item">' +
      '<div class="rec-item-head">' +
      '<span class="rec-id">' + escapeHtml(r.id) + '</span>' +
      '<span class="rec-platform">CF</span>' +
      (r.difficulty !== undefined && r.difficulty !== null
        ? '<span class="rec-diff">' + escapeHtml(r.difficulty) + '</span>' : '') +
      '<span class="rec-date">' + fmtDate(r.updatedAt) + '</span>' +
      '</div>' +
      '<div class="rec-title">' + escapeHtml(r.title) + '</div>' +
      '<div class="rec-actions">' +
      '<button class="rec-action" data-url="' + escapeHtml(r.url || ('https://codeforces.com/problemset/problem/' + r.id)) + '" title="在浏览器打开 CF 题目页">打开题目</button>' +
      '<button class="rec-action danger" data-id="' + escapeHtml(r.id) + '" data-action="delete" title="从列表中删除该记录">删除</button>' +
      '</div>' +
      '</div>'
    ).join('');

    recListEl.querySelectorAll('.rec-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action) vscode.postMessage({ type: 'recordAction', payload: { id: btn.dataset.id, action } });
      });
    });
  }

  function renderStats(stats) {
    if (!recStatsEl || !stats) return;
    // V0.9：仅保留「题目总数」与「AC 数」两个核心统计
    recStatsEl.innerHTML =
      '<div class="rec-stat"><span class="num">' + (stats.total || 0) + '</span><span class="lbl">题目总数</span></div>' +
      '<div class="rec-stat"><span class="num ok">' + (stats.ac || 0) + '</span><span class="lbl">AC 数</span></div>';
  }

  /** 今日统计：rail 底部（V0.9 记录面板不再显示今日 AC 块） */
  function renderTodayStats(ts) {
    // V0.10：左下角仅保留连续天数
    const streakEl = document.getElementById('rail-today-streak');
    if (streakEl) streakEl.textContent = ts && ts.streak != null ? ts.streak : '–';
  }

  // ===== CF 账号（登录态）/ 专题饼图（纯 SVG 环形图，零依赖；标签中文，V0.8） =====
  const cfHandleEl = document.getElementById('cf-handle');
  const cfImportBtn = document.getElementById('cf-import-btn');
  const pieChartEl = document.getElementById('pie-chart');

  if (cfImportBtn) {
    cfImportBtn.addEventListener('click', () => {
      cfImportBtn.disabled = true;
      cfImportBtn.textContent = '导入中…';
      beginOpTimer((sec) => setStatus('正在导入 AC 历史…（已 ' + sec + 's）'));
      vscode.postMessage({ type: 'importCfHistory' });
    });
  }

  /** CF 标签 → 中文（V0.8：饼图/推荐全部中文展示） */
  const CF_TAG_ZH = {
    'dp': '动态规划', 'graphs': '图论', 'greedy': '贪心', 'math': '数论',
    'number theory': '数论', 'strings': '字符串', 'data structures': '数据结构',
    'implementation': '实现', 'binary search': '二分', 'sortings': '排序',
    'brute force': '暴力', 'constructive algorithms': '构造', 'combinatorics': '组合数学',
    'two pointers': '双指针', 'dfs and similar': '深搜', 'bfs': '广搜', 'trees': '树',
    'shortest paths': '最短路', 'dsu': '并查集', 'bitmasks': '位运算', 'geometry': '计算几何',
    'probabilities': '概率期望', 'games': '博弈论', 'flows': '网络流', 'hashing': '哈希',
    'string suffix structures': '后缀结构', 'divide and conquer': '分治',
    'graph matchings': '图匹配', 'matrices': '矩阵', 'knapsack': '背包',
    'meet-in-the-middle': '折半搜索', 'ternary search': '三分', 'fft': '快速傅里叶变换',
    'interactive': '交互', 'chinese remainder theorem': '中国剩余定理', 'schedules': '调度',
    '2-sat': '2-SAT', 'expression parsing': '表达式解析', 'games': '博弈'
  };
  function tagZh(tag) {
    return CF_TAG_ZH[String(tag).toLowerCase()] || tag;
  }

  const PIE_COLORS = ['#E4B863', '#7C9CC4', '#33517A', '#8B9D77', '#C25644', '#16233A'];

  function renderPie(tagStats) {
    if (!pieChartEl) return;
    if (!tagStats || tagStats.length === 0) {
      pieChartEl.innerHTML = '<div class="muted chart-empty">暂无数据（打开题目、运行测试或导入历史后自动统计）</div>';
      return;
    }
    const top = tagStats.slice(0, 6);
    const total = top.reduce((s, t) => s + (t.ac || 0), 0);
    if (total <= 0) {
      pieChartEl.innerHTML = '<div class="muted chart-empty">暂无 AC 数据</div>';
      return;
    }
    const R = 34;
    const C = 2 * Math.PI * R;
    let acc = 0;
    const segs = top.map((t, i) => {
      const frac = (t.ac || 0) / total;
      const dash = Math.max(frac * C - 1, 0.5);
      const gap = C - dash;
      const zh = tagZh(t.tag);
      const seg = '<circle r="' + R + '" cx="40" cy="40" fill="none" stroke="' + PIE_COLORS[i % PIE_COLORS.length] +
        '" stroke-width="12" stroke-dasharray="' + dash + ' ' + gap + '" stroke-dashoffset="' + (-acc * C) +
        '" transform="rotate(-90 40 40)"><title>' + escapeHtml(zh) + ' · AC ' + t.ac + ' 题</title></circle>';
      acc += frac;
      return seg;
    }).join('');
    const legend = top.map((t, i) =>
      '<div class="pie-legend">' +
      '<span class="pie-dot" style="background:' + PIE_COLORS[i % PIE_COLORS.length] + '"></span>' +
      '<span class="pie-name" title="' + escapeHtml(t.tag) + '">' + escapeHtml(tagZh(t.tag)) + '</span>' +
      '<span class="pie-rate">' + t.ac + ' 题</span>' +
      '</div>'
    ).join('');
    pieChartEl.innerHTML =
      '<div class="pie-wrap">' +
      '<svg viewBox="0 0 80 80" width="116" height="116" aria-label="各算法标签 AC 题数">' + segs + '</svg>' +
      '<div class="pie-legend-list">' + legend + '</div>' +
      '</div>';
  }

  /** V0.12：CF 难度分布柱状图（800-3500 分档 + 未定分） */
  function renderDifficultyBars(diffStats) {
    const el = document.getElementById('diff-chart');
    if (!el) return;
    if (!diffStats || !diffStats.bins || diffStats.bins.length === 0) {
      el.innerHTML = '<div class="muted chart-empty">暂无数据</div>';
      return;
    }
    const bins = diffStats.bins;
    const und = diffStats.undetermined || 0;
    const max = Math.max(1, ...bins.map((b) => b.count), und);
    const bar = (label, count, cls) =>
      '<div class="diff-col" title="' + escapeHtml(label) + ' · ' + count + ' 题">' +
      '<div class="diff-bar' + (cls ? ' ' + cls : '') + '" style="height:' + Math.max(count > 0 ? 8 : 2, Math.round((count / max) * 100)) + '%"></div>' +
      '<div class="diff-label">' + escapeHtml(label) + '</div>' +
      '</div>';
    let html = '<div class="diff-bars">';
    bins.forEach((b) => { html += bar(b.label, b.count, ''); });
    html += bar('未定分', und, 'und');
    html += '</div>';
    // 统计摘要
    html += '<div class="diff-summary mono">共 ' + diffStats.total + ' 题 · 未定分 ' + und + ' 题</div>';
    el.innerHTML = html;
  }

  function renderCfHandle(handle) {
    if (cfHandleEl) {
      cfHandleEl.textContent = handle || '未登录';
      cfHandleEl.classList.toggle('bound', !!handle);
    }
  }

  function initRecordsView() {
    const filters = document.querySelectorAll('.rec-filter');
    filters.forEach((btn) => {
      btn.addEventListener('click', () => {
        recFilter = btn.dataset.filter || 'all';
        filters.forEach((b) => b.classList.toggle('active', b === btn));
        renderRecords();
      });
    });
    const platformSel = document.getElementById('rec-platform');
    if (platformSel) {
      platformSel.addEventListener('change', () => {
        recPlatform = platformSel.value || 'all';
        renderRecords();
      });
    }
    if (recSearchEl) {
      recSearchEl.addEventListener('input', () => renderRecords());
    }
    const railToday = document.querySelector('.rail-today');
    if (railToday) {
      railToday.addEventListener('click', () => {
        const nav = document.querySelector('.nav-item[data-view="history"]');
        if (nav) nav.click();
      });
    }
  }

  // ===== CF 登录态状态条（V0.22）=====
  const cfSDot = document.getElementById('cf-s-dot');
  const cfSText = document.getElementById('cf-s-text');
  const cfSLogin = document.getElementById('cf-s-login');
  const cfSLogout = document.getElementById('cf-s-logout');

  /** 渲染 CF 登录态：logged-in / logged-out / expired / checking */
  function renderCfSession(state) {
    if (!cfSDot || !cfSText) return;
    const s = state || { status: 'logged-out' };
    cfSDot.className = 'cf-s-dot ' + s.status;
    if (s.status === 'logged-in') {
      cfSText.textContent = 'CF: ' + (s.handle || '?') +
        (s.loginTime ? ' · ' + new Date(s.loginTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' 登录' : '');
      cfSText.title = '会话有效期至 ' + (s.expiresAt ? new Date(s.expiresAt).toLocaleString('zh-CN') : '未知');
    } else if (s.status === 'expired') {
      cfSText.textContent = 'CF 会话已过期（' + (s.handle || '') + '），请重新登录';
      cfSText.title = '';
    } else {
      cfSText.textContent = 'CF 未登录';
      cfSText.title = '';
    }
    if (cfSLogin) cfSLogin.style.display = s.status === 'logged-in' ? 'none' : '';
    if (cfSLogout) cfSLogout.style.display = s.status === 'logged-in' ? '' : 'none';
  }

  if (cfSLogin) {
    cfSLogin.addEventListener('click', () => {
      cfSLogin.disabled = true;
      cfSText.textContent = '正在打开浏览器…';
      cfSDot.className = 'cf-s-dot checking';
      vscode.postMessage({ type: 'cfLogin' });
    });
  }
  if (cfSLogout) {
    cfSLogout.addEventListener('click', () => {
      askConfirm('确定退出 Codeforces 登录态？将清除本地加密保存的会话。', '退出', () => {
        vscode.postMessage({ type: 'cfLogout' });
      });
    });
  }
  const diagBtn = document.getElementById('diag-btn');
  if (diagBtn) {
    diagBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'diagnose' });
    });
  }

  // ===== CF 比赛视图（V0.22）=====
  const contestListEl = document.getElementById('contest-list');
  const contestRefreshBtn = document.getElementById('contest-refresh-btn');
  const contestStatementEl = document.getElementById('contest-statement');
  const contestStTitle = document.getElementById('contest-st-title');
  const contestStBody = document.getElementById('contest-st-body');
  let contestDetailCache = {};   // contestId -> detail（前端侧缓存展开结果）
  let currentStatement = null;   // { label, html, zh }
  const expandedContestIds = new Set(); // 已展开的比赛（刷新列表后自动重新展开拉取最新详情）

  function fmtDur(sec) {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h === 0) return m + 'm';
    return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
  }

  function fmtStart(sec) {
    if (!sec) return '—';
    const d = new Date(sec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtCountdown(sec) {
    const diff = sec - Date.now() / 1000;
    if (diff <= 0) return '已开始';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? h + 'h ' + m + 'm 后' : m + 'm 后';
  }

  function contestCard(c) {
    const meta = c.phase === 'CODING'
      ? '进行中 · 参赛 ' + (c.participants != null ? c.participants : '…') + ' 人'
      : fmtStart(c.startTimeSeconds) + '（' + fmtCountdown(c.startTimeSeconds) + '）';
    return '<div class="card contest-card" data-contest-id="' + c.id + '">' +
      '<div class="contest-card-head">' +
        '<span class="contest-phase ' + (c.phase === 'CODING' ? 'coding' : 'before') + '">' + (c.phase === 'CODING' ? '进行中' : '即将开始') + '</span>' +
        '<span class="contest-name" title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</span>' +
        '<span class="spacer"></span>' +
      '</div>' +
      '<div class="contest-meta muted">' + meta + ' · 时长 ' + fmtDur(c.durationSeconds) + '</div>' +
      '<div class="contest-actions">' +
        '<button class="btn sm contest-expand-btn">题目 ▾</button>' +
        '<button class="btn sm gold contest-create-btn" title="一键创建全部题目的 cpp + .prob 并打开 A 题">一键创建所有题目</button>' +
      '</div>' +
      '<div class="contest-problems" style="display:none"><div class="muted chart-empty">加载中…</div></div>' +
    '</div>';
  }

  function renderContests(contests) {
    if (!contestListEl) return;
    contestListEl.innerHTML = contests.length === 0
      ? '<div class="muted chart-empty">暂无即将开始或进行中的比赛</div>'
      : contests.map(contestCard).join('');
  }

  function renderContestProblems(contestId, detail) {
    const card = contestListEl && contestListEl.querySelector('.contest-card[data-contest-id="' + contestId + '"]');
    const box = card && card.querySelector('.contest-problems');
    if (!box) return;
    if (!detail || detail.problems.length === 0) {
      box.innerHTML = '<div class="muted chart-empty">题目尚未公布（比赛开始后可刷新查看）</div>';
      return;
    }
    box.innerHTML = detail.problems.map((p) =>
      '<div class="contest-prob">' +
        '<span class="mono prob-index">' + escapeHtml(p.index) + '</span>' +
        '<span class="prob-name" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>' +
        '<span class="mono prob-rating">' + (p.rating || '—') + '</span>' +
        '<button class="btn sm prob-open-btn" data-url="https://codeforces.com/contest/' + contestId + '/problem/' + escapeHtml(p.index) + '" title="在浏览器打开该题">打开题目</button>' +
      '</div>'
    ).join('');
  }

  /** 榜单渲染：大致榜单（前 20）+ 我的关注（详细，含每题状态格） */
  function renderStandings(contestId, detail) {
    const card = contestListEl && contestListEl.querySelector('.contest-card[data-contest-id="' + contestId + '"]');
    const box = card && card.querySelector('.contest-problems');
    if (!box || !detail) return;
    const top = detail.top || [];
    const mine = detail.mine || [];
    const phase = detail.contest && detail.contest.phase;
    if (phase && phase !== 'CODING') {
      const preHtml = '<div class="st-sec-head"><span>比赛尚未开始</span><span class="spacer"></span>' +
        '<button class="btn sm follow-btn" title="设置关注的 Handle（自己会自动加入）">关注…</button></div>' +
        '<div class="muted chart-empty">榜单与关注数据将在比赛开始后公布</div>';
      box.insertAdjacentHTML('beforeend', preHtml);
      const followBtn = box.querySelector('.follow-btn');
      if (followBtn) {
        followBtn.addEventListener('click', () => vscode.postMessage({ type: 'followHandlesAsk' }));
      }
      return;
    }
    let html = '<div class="st-sec-head"><span>大致榜单 · 前 ' + top.length + ' 名</span><span class="spacer"></span>' +
      '<button class="btn sm follow-btn" title="设置关注的 Handle（自己会自动加入）">关注…</button></div>';
    if (top.length === 0) {
      html += '<div class="muted chart-empty">榜单暂未公布</div>';
    } else {
      html += '<table class="st-table"><tr><th>#</th><th>Handle</th><th>过题</th><th>罚时</th></tr>' +
        top.map((r) =>
          '<tr><td class="mono">' + r.rank + '</td><td>' + escapeHtml(r.handle) + '</td>' +
          '<td class="mono">' + r.solved + '</td><td class="mono">' + r.penalty + '</td></tr>'
        ).join('') + '</table>';
    }
    html += '<div class="st-sec-head"><span>我的关注 · ' + mine.length + ' 人参赛</span></div>';
    if (mine.length === 0) {
      html += '<div class="muted chart-empty">关注列表暂无人参赛（点「关注…」设置）</div>';
    } else {
      html += mine.map((r) => {
        const cells = r.problems.map((p) => {
          const cls = p.solved ? 'ok' : (p.wa > 0 ? 'wa' : 'idle');
          const tip = p.solved
            ? p.index + ' 通过 ' + p.time + 'min' + (p.wa ? '（' + p.wa + ' 次被拒）' : '')
            : p.wa > 0 ? p.index + ' 被拒 ' + p.wa + ' 次' : p.index + ' 未提交';
          return '<span class="prob-cell ' + cls + '" title="' + tip + '">' + (p.solved ? '✓' : p.wa > 0 ? '✗' + p.wa : '·') + '</span>';
        }).join('');
        return '<div class="mine-row"><span class="mono mine-rank">' + r.rank + '</span>' +
          '<span class="mine-handle">' + escapeHtml(r.handle) + '</span>' +
          '<span class="mono mine-nums">' + r.solved + '题 / ' + r.penalty + '罚</span>' +
          '<span class="mine-cells">' + cells + '</span></div>';
      }).join('');
    }
    box.insertAdjacentHTML('beforeend', html);
    const followBtn = box.querySelector('.follow-btn');
    if (followBtn) {
      followBtn.addEventListener('click', () => vscode.postMessage({ type: 'followHandlesAsk' }));
    }
  }

  /** 重新拉取所有已展开比赛的详情（关注列表变化后） */
  function refreshExpandedContests() {
    if (!contestListEl) return;
    contestListEl.querySelectorAll('.contest-card').forEach((card) => {
      const box = card.querySelector('.contest-problems');
      if (box && box.style.display !== 'none') {
        const id = Number(card.dataset.contestId);
        if (id) vscode.postMessage({ type: 'contestSelect', payload: { contestId: id, refresh: true } });
      }
    });
  }

  /** 渲染中英对照题面（复用 .st-block/.st-en/.st-zh 排版与公式还原） */
  function renderContestStatement(label, html, zh) {
    if (!contestStatementEl || !contestStTitle || !contestStBody) return;
    currentStatement = { label, html, zh: zh || [] };
    contestStTitle.textContent = label;
    contestStBody.innerHTML = html || '<div class="muted st-empty">题面为空</div>';
    if (Array.isArray(zh)) {
      const blocks = contestStBody.querySelectorAll('.st-block.st-p');
      blocks.forEach((el, i) => {
        if (!zh[i]) return;
        let t = zh[i];
        if (/\u0000?MATH\s*\d+\s*\u0000?/.test(t)) {
          const mathEls = el.querySelectorAll('.acm-math');
          t = t.replace(/\u0000?MATH\s*(\d+)\s*\u0000?/g, (m, n) => {
            const me = mathEls[Number(n)];
            if (!me) return m;
            const block = me.classList.contains('acm-math-block');
            return (block ? '$$' : '$') + me.textContent + (block ? '$$' : '$');
          });
        }
        const zhDiv = document.createElement('div');
        zhDiv.className = 'st-zh';
        zhDiv.innerHTML = t;
        el.insertBefore(zhDiv, el.firstChild);
      });
    }
    contestStatementEl.style.display = '';
    contestStatementEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function initContestView() {
    if (!contestListEl) return;
    if (contestRefreshBtn) {
      contestRefreshBtn.addEventListener('click', () => {
        contestListEl.innerHTML = '<div class="muted chart-empty">加载中…</div>';
        vscode.postMessage({ type: 'contestListReady' });
      });
    }
    if (!contestLoaded) {
      contestListEl.innerHTML = '<div class="muted chart-empty">加载中…</div>';
      vscode.postMessage({ type: 'contestListReady' });
    }
    contestListEl.addEventListener('click', (e) => {
      const expandBtn = e.target.closest('.contest-expand-btn');
      const createBtn = e.target.closest('.contest-create-btn');
      const openBtn = e.target.closest('.prob-open-btn');
      const card = e.target.closest('.contest-card');
      if (!card) return;
      const contestId = Number(card.dataset.contestId);
      const box = card.querySelector('.contest-problems');

      if (expandBtn) {
        const expanded = box.style.display !== 'none';
        box.style.display = expanded ? 'none' : '';
        expandBtn.textContent = expanded ? '题目 ▾' : '题目 ▴';
        if (expanded) expandedContestIds.delete(contestId);
        else expandedContestIds.add(contestId);
        if (!expanded && !contestDetailCache[contestId]) {
          vscode.postMessage({ type: 'contestSelect', payload: { contestId } });
        } else if (!expanded && contestDetailCache[contestId]) {
          renderContestProblems(contestId, contestDetailCache[contestId]);
          renderStandings(contestId, contestDetailCache[contestId]);
        }
        return;
      }
      if (createBtn) {
        const name = card.querySelector('.contest-name') ? card.querySelector('.contest-name').textContent : contestId;
        askConfirm('确定为一键创建比赛「' + name + '」的全部题目（cpp + .prob）？将自动打开 A 题。', '创建', () => {
          vscode.postMessage({ type: 'contestCreateAll', payload: { contestId } });
        });
        return;
      }
      if (openBtn) {
        const url = openBtn.dataset.url;
        if (url) vscode.postMessage({ type: 'openExternal', url });
      }
    });
    const stClose = document.getElementById('contest-st-close');
    if (stClose) {
      stClose.addEventListener('click', () => {
        if (contestStatementEl) contestStatementEl.style.display = 'none';
      });
    }
    const stCopy = document.getElementById('contest-st-copy');
    if (stCopy) {
      stCopy.addEventListener('click', () => {
        if (!currentStatement) return;
        const blocks = contestStBody ? contestStBody.querySelectorAll('.st-block.st-p') : [];
        const text = Array.from(blocks).map((el) => {
          const zhEl = el.querySelector('.st-zh');
          return zhEl ? zhEl.textContent : el.querySelector('.st-en').textContent;
        }).join('\n\n');
        navigator.clipboard.writeText(text).then(() => {
          stCopy.textContent = '已复制';
          setTimeout(() => { stCopy.textContent = '复制译文'; }, 1200);
        }).catch(() => {});
      });
    }
  }

  // ===== 造数据视图（V0.22）=====
  const dgParamsEl = document.getElementById('dg-params');
  const dgGenBtn = document.getElementById('dg-gen-btn');
  const dgSaveBtn = document.getElementById('dg-save-btn');
  const dgStatusEl = document.getElementById('dg-status');
  const dgOutputEl = document.getElementById('dg-output');
  let lastGenerated = '';
  // 组合流水线：只记录每步类型；表单值从 DOM 采集
  let dgPipelineSteps = [];

  const DG_TYPE_OPTIONS = [
    ['line', '单行单数'],
    ['int', '单个（不自动换行）'],
    ['ints', '一行多个数'],
    ['pairs', '每行两个数'],
    ['text', '固定文本'],
    ['newline', '换行'],
    ['repeat', '重复块'],
    ['array', '随机整数数组'],
    ['tree', '随机树'],
    ['graph', '随机图'],
    ['string', '随机字符串'],
    ['permutation', '随机排列'],
    ['script', '自定义脚本']
  ];

  const DG_FIELDS = {
    line: [
      { key: 'vMin', label: '值域下限', type: 'num', def: 1 },
      { key: 'vMax', label: '值域上限', type: 'num', def: 100 },
      { key: 'varName', label: '变量名（供后面数量引用）', type: 'text', def: '' }
    ],
    int: [
      { key: 'vMin', label: '值域下限', type: 'num', def: 1 },
      { key: 'vMax', label: '值域上限', type: 'num', def: 100 },
      { key: 'newline', label: '末尾换行', type: 'check', def: false },
      { key: 'varName', label: '变量名（供后面 repeat 引用）', type: 'text', def: '' }
    ],
    ints: [
      { key: 'nMin', label: '个数最小值 n（或填变量名）', type: 'num', def: 5 },
      { key: 'nMax', label: '个数最大值 n', type: 'num', def: 10 },
      { key: 'countRef', label: '个数变量名（引用单行单数）', type: 'text', def: '' },
      { key: 'vMin', label: '值域下限', type: 'num', def: 1 },
      { key: 'vMax', label: '值域上限', type: 'num', def: 100 },
      { key: 'sep', label: '分隔符（空格/逗号/空）', type: 'text', def: ' ', raw: true },
      { key: 'newline', label: '末尾换行', type: 'check', def: true }
    ],
    pairs: [
      { key: 'nMin', label: '行数最小值（或填变量名）', type: 'num', def: 2 },
      { key: 'nMax', label: '行数最大值', type: 'num', def: 5 },
      { key: 'countRef', label: '行数变量名（引用单行单数）', type: 'text', def: '' },
      { key: 'vMin', label: '第一个数下限', type: 'num', def: 1 },
      { key: 'vMax', label: '第一个数上限', type: 'num', def: 100 },
      { key: 'wMin', label: '第二个数下限', type: 'num', def: 1 },
      { key: 'wMax', label: '第二个数上限', type: 'num', def: 1000 }
    ],
    text: [
      { key: 'text', label: '固定文本（可多行）', type: 'textarea', def: '' }
    ],
    newline: [],
    repeat: [
      { key: 'countRef', label: '重复次数变量名（引用前面“单个数”填的变量名）', type: 'text', def: '' },
      { key: 'count', label: '固定重复次数（二选一）', type: 'num', def: 1 }
    ],
    array: [
      { key: 'nMin', label: '长度最小值 n', type: 'num', def: 5 },
      { key: 'nMax', label: '长度最大值 n', type: 'num', def: 10 },
      { key: 'vMin', label: '值域下限', type: 'num', def: 1 },
      { key: 'vMax', label: '值域上限', type: 'num', def: 100 },
      { key: 'sorted', label: '排序', type: 'select', def: 'none', options: [['none', '不排序'], ['asc', '升序'], ['desc', '降序']] }
    ],
    tree: [
      { key: 'n', label: '节点数 n', type: 'num', def: 10 },
      { key: 'weighted', label: '边权随机', type: 'check', def: false },
      { key: 'wMin', label: '权值下限', type: 'num', def: 1, showIf: 'weighted' },
      { key: 'wMax', label: '权值上限', type: 'num', def: 100, showIf: 'weighted' }
    ],
    graph: [
      { key: 'n', label: '节点数 n', type: 'num', def: 8 },
      { key: 'mMin', label: '边数最小值 m', type: 'num', def: 6 },
      { key: 'mMax', label: '边数最大值 m', type: 'num', def: 10 },
      { key: 'directed', label: '有向图', type: 'check', def: false },
      { key: 'weighted', label: '带权', type: 'check', def: false },
      { key: 'wMin', label: '权值下限', type: 'num', def: 1, showIf: 'weighted' },
      { key: 'wMax', label: '权值上限', type: 'num', def: 100, showIf: 'weighted' }
    ],
    string: [
      { key: 'lenMin', label: '长度最小值', type: 'num', def: 5 },
      { key: 'lenMax', label: '长度最大值', type: 'num', def: 15 },
      { key: 'charset', label: '字符集', type: 'select', def: 'lower', options: [['lower', '小写字母'], ['upper', '大写字母'], ['digit', '数字'], ['lowerdigit', '小写+数字'], ['lowerupper', '大小写字母']] }
    ],
    permutation: [
      { key: 'nMin', label: '长度最小值 n', type: 'num', def: 5 },
      { key: 'nMax', label: '长度最大值 n', type: 'num', def: 10 }
    ],
    script: [
      { key: 'scriptPath', label: '脚本路径（.js / .py / .cpp，数据输出到 stdout）', type: 'text', def: '' }
    ]
  };

  function dgFieldHtml(f, value) {
    const showIf = f.showIf ? ' data-showif="' + f.showIf + '"' : '';
    const val = value !== undefined ? value : f.def;
    if (f.type === 'check') {
      return '<label class="dg-field' + showIf + '"><input type="checkbox" data-key="' + f.key + '"' + (val ? ' checked' : '') + '> ' + f.label + '</label>';
    }
    if (f.type === 'select') {
      const opts = f.options.map((o) => '<option value="' + o[0] + '"' + (String(val) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
      return '<label class="dg-field' + showIf + '"><span>' + f.label + '</span><select data-key="' + f.key + '">' + opts + '</select></label>';
    }
    if (f.type === 'textarea') {
      return '<label class="dg-field' + showIf + '"><span>' + f.label + '</span><textarea data-key="' + f.key + '" rows="2" style="flex:1">' + escapeHtml(val || '') + '</textarea></label>';
    }
    const rawAttr = f.raw ? ' data-raw="1"' : '';
    return '<label class="dg-field' + showIf + '"><span>' + f.label + '</span><input type="' + (f.type === 'text' ? 'text' : 'number') + '" data-key="' + f.key + '" value="' + escapeHtml(val ?? '') + '"' + rawAttr + (f.type === 'text' ? ' style="flex:1"' : '') + '></label>';
  }

  function dgTypeOptionsHtml(selected) {
    return DG_TYPE_OPTIONS.map((o) => '<option value="' + o[0] + '"' + (o[0] === selected ? ' selected' : '') + '>' + o[1] + '</option>').join('');
  }

  /** 事件委托绑定标志：DOM 重建后需要重新绑定到新的 #dg-steps */
  let dgEventsBound = false;

  /** 读取单个步骤（含 repeat 嵌套子步骤） */
  function collectStepSpec(stepEl) {
    const control = Array.from(stepEl.children).find((el) => el.classList.contains('control-row'));
    const typeEl = control ? control.querySelector('.dg-step-type') : null;
    const stepType = typeEl ? typeEl.value : 'int';
    const st = { type: stepType };
    const paramsEl = Array.from(stepEl.children).find((el) => el.classList.contains('dg-step-params'));
    if (paramsEl) {
      // 只收集当前步骤直接子级参数（.dg-field），不会混入嵌套 repeat 子流水线的字段
      Array.from(paramsEl.querySelectorAll('.dg-field [data-key]')).forEach((el) => {
        const label = el.closest('.dg-field');
        if (label && label.parentElement === paramsEl) {
          st[el.dataset.key] = readDgFieldValue(el);
        }
      });
      if (stepType === 'repeat') {
        const body = Array.from(paramsEl.children).find((el) => el.classList.contains('dg-step-list'));
        st.steps = body
          ? Array.from(body.children).filter((el) => el.classList.contains('dg-pipeline-step')).map((sub) => collectStepSpec(sub))
          : [];
      }
    }
    if (stepType === 'tree' || stepType === 'graph') {
      if (st.n != null) { st.nMin = st.n; st.nMax = st.n; }
    }
    return st;
  }

  function readDgFieldValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') {
      const v = Number(el.value);
      return Number.isFinite(v) ? v : undefined;
    }
    if (el.tagName === 'TEXTAREA' || el.dataset.raw === '1') return el.value;
    return el.value.trim();
  }

  /** 同步整个流水线 DOM 到状态（含嵌套 repeat），返回顶层步骤数组 */
  function captureDgPipeline() {
    const stepsEl = document.getElementById('dg-steps');
    const steps = stepsEl
      ? Array.from(stepsEl.children).filter((el) => el.classList.contains('dg-pipeline-step')).map((el) => collectStepSpec(el))
      : [];
    dgPipelineSteps = steps;
    return steps;
  }

  function renderStepListHtml(steps, listPath) {
    return (steps || []).map((step, idx) => {
      const path = listPath ? listPath + '.' + idx : String(idx);
      const type = step.type || 'int';
      const fields = (DG_FIELDS[type] || []).map((f) => dgFieldHtml(f, step[f.key])).join('');
      let bodyHtml = '';
      if (type === 'repeat') {
        const subListPath = path + '.repeat';
        const subSteps = Array.isArray(step.steps) ? step.steps : [];
        bodyHtml = '<div class="dg-step-list dg-repeat-body" data-list-path="' + subListPath + '">' +
          '<button class="btn sm dg-step-add">+ 子步骤</button>' +
          renderStepListHtml(subSteps, subListPath) +
        '</div>';
      }
      return '<div class="dg-pipeline-step" data-path="' + path + '">' +
        '<div class="control-row">' +
          '<select class="dg-step-type">' + dgTypeOptionsHtml(type) + '</select>' +
          '<button class="btn sm dg-step-del">删除</button>' +
        '</div>' +
        '<div class="dg-step-params">' + fields + bodyHtml + '</div>' +
      '</div>';
    }).join('');
  }

  function renderDgPipeline(steps) {
    const stepsEl = document.getElementById('dg-steps');
    if (!stepsEl) return;
    dgPipelineSteps = steps || [];
    stepsEl.innerHTML = renderStepListHtml(dgPipelineSteps, '');
    bindDgPipelineEvents();
  }

  function getStepByPath(steps, pathStr) {
    const parts = String(pathStr).split('.');
    let arr = steps;
    let node = null;
    for (let i = 0; i < parts.length; i += 2) {
      node = arr[Number(parts[i])];
      if (!node) return null;
      if (i + 1 < parts.length) {
        if (parts[i + 1] !== 'repeat') return null;
        arr = node.steps || (node.steps = []);
      }
    }
    return node;
  }

  function getListByPath(steps, listPath) {
    if (!listPath) return steps;
    const parts = String(listPath).split('.');
    let arr = steps;
    for (let i = 0; i < parts.length; i += 2) {
      const step = arr[Number(parts[i])];
      if (!step) return null;
      if (parts[i + 1] !== 'repeat') return null;
      arr = step.steps || (step.steps = []);
    }
    return arr;
  }

  function removeStepByPath(steps, pathStr) {
    const parts = String(pathStr).split('.');
    let arr = steps;
    for (let i = 0; i < parts.length; i += 2) {
      const idx = Number(parts[i]);
      const step = arr[idx];
      if (!step) return false;
      if (i + 1 < parts.length) {
        if (parts[i + 1] !== 'repeat') return false;
        arr = step.steps || (step.steps = []);
      } else {
        arr.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  function updateStepFieldFromEvent(t) {
    const stepEl = t.closest('.dg-pipeline-step');
    if (!stepEl || !t.dataset || !t.dataset.key) return;
    const step = getStepByPath(dgPipelineSteps, stepEl.dataset.path || '');
    if (step) step[t.dataset.key] = readDgFieldValue(t);
  }

  function bindDgPipelineEvents() {
    const stepsEl = document.getElementById('dg-steps');
    if (!stepsEl || dgEventsBound) return;
    dgEventsBound = true;

    stepsEl.addEventListener('change', (e) => {
      const t = e.target;
      // 步骤类型变化：直接改状态，其他步骤数据本来就在状态里，不会重置
      if (t.classList && t.classList.contains('dg-step-type')) {
        const stepEl = t.closest('.dg-pipeline-step');
        if (!stepEl) return;
        const step = getStepByPath(dgPipelineSteps, stepEl.dataset.path || '');
        if (step) step.type = t.value;
        renderDgPipeline(dgPipelineSteps);
        return;
      }
      // 普通输入/选择/复选框：实时同步到状态
      updateStepFieldFromEvent(t);
      if (t.type === 'checkbox' && t.closest('.dg-field')) {
        const container = t.closest('.dg-pipeline-step');
        if (!container) return;
        container.querySelectorAll('[data-showif="' + t.dataset.key + '"]').forEach((el) => {
          el.style.display = t.checked ? '' : 'none';
        });
      }
    });

    // 输入过程中也同步（数字/文本/多行文本）
    stepsEl.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.key) updateStepFieldFromEvent(t);
    });

    stepsEl.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.dg-step-del');
      if (delBtn) {
        const stepEl = delBtn.closest('.dg-pipeline-step');
        if (stepEl) {
          removeStepByPath(dgPipelineSteps, stepEl.dataset.path || '');
          renderDgPipeline(dgPipelineSteps);
        }
        return;
      }
      const addBtn = e.target.closest('.dg-step-add');
      if (addBtn) {
        const listEl = addBtn.closest('.dg-step-list');
        if (listEl) {
          const list = getListByPath(dgPipelineSteps, listEl.dataset.listPath || '');
          if (list) list.push({ type: 'int', vMin: 1, vMax: 100 });
          renderDgPipeline(dgPipelineSteps);
        }
      }
    });
  }

  function renderDgParams() {
    if (!dgParamsEl) return;
    dgEventsBound = false; // DOM 重建，重新绑定事件委托
    dgParamsEl.innerHTML =
      '<div class="control-row">' +
        '<span class="muted">流水线拼装：按需添加步骤，每步保留自己的参数</span>' +
        '<button class="btn sm" id="dg-step-add">+ 添加步骤</button>' +
      '</div>' +
      '<div id="dg-steps"></div>';
    renderDgPipeline(dgPipelineSteps);
    const add = document.getElementById('dg-step-add');
    if (add) {
      add.addEventListener('click', () => {
        dgPipelineSteps.push({ type: 'int', vMin: 1, vMax: 100 });
        renderDgPipeline(dgPipelineSteps);
      });
    }
  }

  function cloneSteps(steps) {
    return (steps || []).map((s) => {
      const c = { ...s };
      if (Array.isArray(s.steps)) c.steps = cloneSteps(s.steps);
      return c;
    });
  }

  function collectDgSpec() {
    // 直接使用实时维护的 JS 状态，不再依赖 DOM 树解析，避免嵌套参数丢失
    return { type: 'pipeline', steps: cloneSteps(dgPipelineSteps) };
  }

  function initDataGenView() {
    renderDgParams();
    if (dgGenBtn) {
      dgGenBtn.addEventListener('click', () => {
        dgGenBtn.disabled = true;
        updateDgSummary();
        vscode.postMessage({ type: 'dataGenGenerate', payload: { spec: collectDgSpec() } });
      });
    }
    if (dgSaveBtn) {
      dgSaveBtn.addEventListener('click', () => {
        if (!lastGenerated) {
          if (dgStatusEl) dgStatusEl.textContent = '请先生成数据';
          return;
        }
        vscode.postMessage({ type: 'dataGenSave', payload: { input: lastGenerated } });
      });
    }
  }

  // ===== 对拍视图（V0.22）=====
  const vpSolve = document.getElementById('vp-solve');
  const vpBrute = document.getElementById('vp-brute');
  const vpMax = document.getElementById('vp-max');
  const vpStart = document.getElementById('vp-start');
  const vpStop = document.getElementById('vp-stop');
  const vpStatus = document.getElementById('vp-status');
  const vpProgress = document.getElementById('vp-progress');
  const vpMismatch = document.getElementById('vp-mismatch');
  const vpIn = document.getElementById('vp-in');
  const vpSo = document.getElementById('vp-so');
  const vpBo = document.getElementById('vp-bo');
  const vpCompare = document.getElementById('vp-compare');
  const vpEps = document.getElementById('vp-eps');
  const vpSpjRow = document.getElementById('vp-spj-row');
  const vpSpj = document.getElementById('vp-spj');
  const vpSpjBrowse = document.getElementById('vp-spj-browse');
  let lastMismatch = null;

  function switchTestMode(mode) {
    document.querySelectorAll('.test-mode').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const single = document.getElementById('test-single-panel');
    const duipai = document.getElementById('duipai-panel');
    if (single) single.style.display = mode === 'single' ? '' : 'none';
    if (duipai) duipai.style.display = mode === 'duipai' ? '' : 'none';
    if (mode === 'duipai') {
      if (vpSolve && !vpSolve.value && testFilePath) vpSolve.value = testFilePath;
      updateDgSummary();
    }
  }

  /** 数据源摘要：当前造数据面板设置的通俗描述 */
  function dgSpecSummary(spec) {
    if (!spec || !spec.type) return '数据源：造数据面板当前设置';
    const t = spec.type;
    if (t === 'array') {
      return '数据源：随机数组 n∈[' + (spec.nMin || 5) + ',' + (spec.nMax || 10) + '] 值域[' + (spec.vMin || 1) + ',' + (spec.vMax || 100) + ']' +
        (spec.sorted && spec.sorted !== 'none' ? (spec.sorted === 'asc' ? ' 升序' : ' 降序') : '');
    }
    if (t === 'tree') return '数据源：随机树 n=' + (spec.n || 10) + (spec.weighted ? '（带权）' : '');
    if (t === 'graph') return '数据源：随机图 n=' + (spec.n || 8) + ' m∈[' + (spec.mMin || 6) + ',' + (spec.mMax || 10) + ']' + (spec.directed ? ' 有向' : '') + (spec.weighted ? ' 带权' : '');
    if (t === 'string') return '数据源：随机字符串 长度∈[' + (spec.lenMin || 5) + ',' + (spec.lenMax || 15) + ']';
    if (t === 'permutation') return '数据源：随机排列 n∈[' + (spec.nMin || 5) + ',' + (spec.nMax || 10) + ']';
    if (t === 'script') return '数据源：生成脚本 ' + (spec.scriptPath || '(未设置)');
    if (t === 'line') return '数据源：单行单数 值域[' + (spec.vMin || 1) + ',' + (spec.vMax || 100) + ']';
    if (t === 'int') return '数据源：单个数 值域[' + (spec.vMin || 1) + ',' + (spec.vMax || 100) + ']';
    if (t === 'ints') return '数据源：一行' + (spec.nMin || 5) + '~' + (spec.nMax || 10) + '个数 值域[' + (spec.vMin || 1) + ',' + (spec.vMax || 100) + ']';
    if (t === 'pairs') return '数据源：每行两个数 ' + (spec.nMin || 2) + '~' + (spec.nMax || 5) + ' 行';
    if (t === 'text') return '数据源：固定文本';
    if (t === 'newline') return '数据源：换行';
    if (t === 'pipeline') {
      const labels = (spec.steps || []).map((s) => s.type || '?').join(' + ');
      return '数据源：组合流水线（' + (labels || '空') + '）';
    }
    return '数据源：造数据面板当前设置';
  }

  function updateDgSummary() {
    const el = document.getElementById('vp-datasrc');
    if (el) el.textContent = dgSpecSummary(collectDgSpec());
  }

  function initDuipaiView() {
    document.querySelectorAll('.test-mode').forEach((btn) => {
      btn.addEventListener('click', () => switchTestMode(btn.dataset.mode));
    });
    const gotoDg = document.getElementById('vp-goto-dg');
    if (gotoDg) {
      gotoDg.addEventListener('click', () => {
        const nav = document.querySelector('.nav-item[data-view="datagen"]');
        if (nav) nav.click();
      });
    }

    // 比对方式联动：float 显示误差输入，spj 显示 SPJ 路径输入
    function updateCompareUi() {
      const mode = vpCompare ? vpCompare.value : 'exact';
      if (vpEps) vpEps.style.display = mode === 'float' ? '' : 'none';
      if (vpSpjRow) vpSpjRow.style.display = mode === 'spj' ? '' : 'none';
    }
    if (vpCompare) {
      vpCompare.addEventListener('change', updateCompareUi);
      updateCompareUi();
    }
    if (vpSpjBrowse) {
      vpSpjBrowse.addEventListener('click', () => vscode.postMessage({ type: 'verifierPickChecker' }));
    }

    if (vpStart) {
      vpStart.addEventListener('click', () => {
        const solve = (vpSolve && vpSolve.value.trim()) || testFilePath;
        const brute = vpBrute ? vpBrute.value.trim() : '';
        const max = vpMax ? Math.round(Number(vpMax.value) || 1000) : 1000;
        if (!solve) {
          if (vpStatus) { vpStatus.textContent = '请先打开一个 cpp 文件，或填写正解路径'; vpStatus.className = 'vp-status error'; }
          return;
        }
        if (!brute) {
          if (vpStatus) { vpStatus.textContent = '请填写暴力程序路径'; vpStatus.className = 'vp-status error'; }
          return;
        }
        const mode = vpCompare ? vpCompare.value : 'exact';
        const epsRaw = vpEps ? Number(vpEps.value) : NaN;
        const checker = {
          mode,
          eps: Number.isFinite(epsRaw) && epsRaw >= 0 ? epsRaw : 1e-6
        };
        if (mode === 'spj') {
          checker.checkerPath = vpSpj ? vpSpj.value.trim() : '';
        }
        lastMismatch = null;
        if (vpMismatch) vpMismatch.style.display = 'none';
        if (vpStart) vpStart.disabled = true;
        if (vpStop) vpStop.style.display = '';
        if (vpProgress) vpProgress.textContent = '';
        vscode.postMessage({ type: 'verifierStart', payload: { solvePath: solve, brutePath: brute, maxRounds: max, spec: collectDgSpec(), checker } });
      });
    }
    if (vpStop) {
      vpStop.addEventListener('click', () => vscode.postMessage({ type: 'verifierCancel' }));
    }
    const pick = document.getElementById('vp-brute-pick');
    if (pick) {
      pick.addEventListener('click', () => vscode.postMessage({ type: 'verifierPickBrute' }));
    }
    const save = document.getElementById('vp-save');
    if (save) {
      save.addEventListener('click', () => {
        if (!lastMismatch) return;
        vscode.postMessage({ type: 'verifierSave', payload: lastMismatch });
      });
    }
  }

  // ===== 接收扩展消息 =====
  // ===== 壁纸控制（动态视频 / 静态图 / 清除）=====
  const wallpaperBtn = document.getElementById('wallpaper-btn');
  const wallpaperBar = document.getElementById('wallpaper-bar');
  const wallpaperUrl = document.getElementById('wallpaper-url');
  const wallpaperApply = document.getElementById('wallpaper-apply');
  const wallpaperPick = document.getElementById('wallpaper-pick');
  const wallpaperClear = document.getElementById('wallpaper-clear');

  function applyWallpaper(url, isVideo) {
    const old = document.querySelector('body > video.wallpaper-bg');
    if (old) old.remove();
    if (isVideo) {
      const v = document.createElement('video');
      v.className = 'wallpaper-bg';
      v.autoplay = true;
      v.loop = true;
      v.muted = true;
      v.setAttribute('playsinline', '');
      v.src = url;
      document.body.insertBefore(v, document.body.firstChild);
    } else if (url) {
      document.body.style.backgroundImage = `url("${url}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundPosition = '';
    }
  }

  if (wallpaperBtn) {
    wallpaperBtn.addEventListener('click', () => {
      wallpaperBar.style.display = wallpaperBar.style.display === 'none' ? 'flex' : 'none';
    });
  }
  if (wallpaperApply) {
    wallpaperApply.addEventListener('click', () => {
      const url = (wallpaperUrl.value || '').trim();
      const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(url) || url.startsWith('file://');
      applyWallpaper(url, isVideo);
      vscode.postMessage({ type: 'setWallpaper', url, isVideo });
    });
  }
  if (wallpaperPick) {
    wallpaperPick.addEventListener('click', () => {
      vscode.postMessage({ type: 'pickWallpaper' });
    });
  }
  if (wallpaperClear) {
    wallpaperClear.addEventListener('click', () => {
      wallpaperUrl.value = '';
      applyWallpaper('', false);
      vscode.postMessage({ type: 'setWallpaper', url: '' });
    });
  }
  const wallpaperGlobal = document.getElementById('wallpaper-global');
  if (wallpaperGlobal) {
    wallpaperGlobal.addEventListener('click', () => {
      vscode.postMessage({ type: 'applyGlobalWallpaper' });
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'statementLoading':
        console.log('[ACM-Workflow][题面] webview 收到 statementLoading');
        // V0.13：抓取中显示加载态；同时清除之前的缓存兜底提示（覆盖旧提示状态）
        renderCacheNotice(null);
        if (stBody) stBody.innerHTML = '<div class="muted st-empty">正在抓取题面…（网络抓取约需数秒）</div>';
        break;
      case 'statementData': {
        // V0.16：扩展侧统一 { type, payload } 信封，这里兼容两种格式（payload 优先，旧平铺兜底）
        const data = msg.payload || msg;
        console.log('[ACM-Workflow][题面] webview 收到 statementData：' + (data.id || '') +
          '，HTML ' + String(data.html || '').length + ' 字符' +
          (data.cacheSource === 'fallback' ? '（来自全局缓存兜底）' : data.cacheSource === 'folder' ? '（来自题目文件夹缓存）' : ''));
        if (data.empty) {
          stData = null; stZh = null;
          if (stRefetchBtn) stRefetchBtn.textContent = '重新获取';
          if (stBody) stBody.innerHTML = '<div class="muted st-empty">请在编辑器中打开一个题目文件（如 979E.cpp / P1001.cpp）</div>';
          renderCurFile(null);
          renderLimits();
          renderImageHint();
          renderCacheNotice(null);
          break;
        }
        stData = { id: data.id, title: data.title, url: data.url, html: data.html, difficulty: data.difficulty, limits: data.limits || {} };
        stZh = null;
        endRefetchRequest();
        // V0.20：仅「抓取失败→全局缓存兜底」显示提示+刷新按钮；成功/文件夹缓存命中自动清除
        renderCacheNotice(data.cacheSource === 'fallback' ? 'fallback' : null);
        // Bug6/Bug4/Bug3：同步共用指示器、限制栏与图片提示
        renderCurFile({ id: data.id, title: data.title, fileName: data.title, difficulty: data.difficulty });
        renderLimits();
        renderImageHint();
        // V0.20：直接渲染排版好的 HTML（含 acm-math 公式标签）；CDN 库就绪后补一次公式渲染
        renderStatementBody();
        loadStatementLibs(renderStatementBody);
        break;
      }
      case 'translationStatus': {
        const data = msg.payload || msg;
        if (data.busy) beginTranslationStatus();
        else endTranslationStatus();
        break;
      }
      case 'statementTranslated': {
        // V0.16：兼容 { type, payload } 信封与旧平铺格式
        const data = msg.payload || msg;
        endRefetchRequest();
        if (data.id && data.zh) {
          stZh = data.zh;
          renderStatementBody();
        } else if (data.reason === 'unavailable') {
          // Bug1：翻译重试后仍失败 → 友好降级提示 + 重新获取按钮
          const se = document.getElementById('st-error');
          if (se) {
            se.innerHTML = '翻译暂不可用，可重新获取题面更新缓存 <button class="btn" id="st-retry-btn">重新获取</button>';
            const rb = document.getElementById('st-retry-btn');
            if (rb) {
              rb.addEventListener('click', () => {
                if (refetchInFlight) return;
                se.textContent = '';
                beginRefetchRequest();
                if (stRefetchBtn) stRefetchBtn.textContent = '重新获取中…';
                vscode.postMessage({ type: 'refreshStatement' });
              });
            }
          }
        } else {
          const se = document.getElementById('st-error');
          if (se) se.textContent = '题面已获取，翻译暂不可用；可点击「重新获取」更新本地缓存';
        }
        break;
      }
      case 'statementError': {
        // V0.16：兼容 { type, payload } 信封与旧平铺格式
        const data = msg.payload || msg;
        endRefetchRequest();
        console.warn('[ACM-Workflow][题面] webview 收到 statementError：', data.message);
        stData = null;
        renderCacheNotice(null);
        if (stBody) stBody.innerHTML = '<div class="muted st-empty">题面抓取失败：' + escapeHtml(data.message || '未知错误') + '</div>';
        break;
      }
      case 'initState':
        applyState(msg.state);
        break;
      case 'problemResult': {
        const tags = getSelectedTags();
        lastPickPayload = {
          platform: 'codeforces',
          minRating: Number(minRange ? minRange.value : 0),
          maxRating: Number(maxRange ? maxRange.value : 0)
        };
        if (tags.length > 0) lastPickPayload.tags = tags;
        rememberPicked(msg.problem && msg.problem.id); // Bug2：记录已尝试
        endPickRequest();
        setPickButtonsDisabled(false);
        setStatus('');
        renderProblem(msg.problem);
        break;
      }
      case 'weakProblem': {
        if (!msg.problem) {
          setStatus(msg.error || '薄弱点推荐失败（可先绑定 CF 账号并导入历史）', true);
          setPickButtonsDisabled(false);
          break;
        }
        const tags = getSelectedTags();
        lastPickPayload = {
          platform: 'codeforces',
          minRating: Number(minRange ? minRange.value : 800),
          maxRating: Number(maxRange ? maxRange.value : 2400)
        };
        if (tags.length > 0) lastPickPayload.tags = tags;
        rememberPicked(msg.problem.id);
        endPickRequest();
        setPickButtonsDisabled(false);
        setStatus('薄弱专题：' + (msg.tag || '未知') + '（基于本地 AC 记录通过率）');
        renderProblem(msg.problem);
        break;
      }
      case 'recentList':
        renderRecentList(msg.recent);
        break;
      case 'openStatementView': {
        // V0.10：记录「打开题目」→ 切到测试视图（题面整合在此）
        const stNav = document.querySelector('.nav-item[data-view="test"]');
        if (stNav) stNav.click();
        break;
      }
      case 'status': {
        setStatus(msg.message || '');
        const im = msg.message || '';
        if (/已导入|拉取 AC 历史失败|请先登录/.test(im)) {
          endOpTimer();
          if (cfImportBtn) {
            cfImportBtn.disabled = false;
            cfImportBtn.textContent = '导入历史';
          }
        }
        break;
      }
      case 'fileCreated':
        setStatus(msg.message || '已生成');
        const testNav = document.querySelector('.nav-item[data-view="test"]');
        if (testNav) testNav.click();
        break;
      case 'historyCleared':
        currentProblem = null;
        if (pickResult) pickResult.innerHTML = '';
        renderRecentList([]);
        setStatus('历史已清空');
        break;
      case 'error': {
        const em = msg.message || '';
        endOpTimer();
        if (cfImportBtn) {
          cfImportBtn.disabled = false;
          cfImportBtn.textContent = '导入历史';
        }
        // Bug2：筛选无结果 → 指定提示并禁用换一题/随机推荐，直到用户调整条件
        endPickRequest();
        if (/无可用题目|没有找到|没有符合条件|无符合条件的题目/.test(em)) {
          setStatus(NO_PROBLEM_MSG, true);
          setPickButtonsDisabled(true);
        } else {
          setStatus(em, true);
          setPickButtonsDisabled(false);
        }
        break;
      }
      case 'testState': {
        testFilePath = msg.filePath || '';
        testCases = (msg.cases || []).map((c) => ({ id: c.id, input: c.input, output: c.output }));
        // Bug6：共用「当前题目」指示器（题面未到时用文件名兜底）
        if (stData && stData.id) {
          renderCurFile({ id: stData.id, title: stData.title, fileName: msg.fileName, difficulty: stData.difficulty });
        } else {
          renderCurFile({ fileName: msg.fileName, hasProb: msg.hasProb });
        }
        setTestRunning(false);
        // V0.17.1：比赛样例抓取失败 → 明确提示手动添加
        if (msg.samplesFetchFailed) {
          setTestStatus('样例抓取失败，请手动添加用例', 'error');
        } else {
          setTestStatus('');
        }
        renderTestCases();
        break;
      }
      case 'testResult': {
        const c = testCases.find((x) => x.id === msg.caseId);
        if (c) {
          c.status = msg.status;
          c.actual = msg.actual || '';
          c.timeMs = msg.timeMs;
          c.message = msg.message || '';
          updateCaseDom(c);
        }
        break;
      }
      case 'testRunDone': {
        setTestRunning(false);
        const allPassed = msg.passed > 0 && msg.passed === msg.total && !msg.cancelled;
        setTestStatus(
          msg.cancelled ? '已取消'
            : msg.detail ? msg.message + '：' + msg.detail
            : msg.message,
          allPassed ? 'ok' : msg.passed < msg.total ? 'error' : ''
        );
        // 全过 → 提供"下一题"，保持刷题流
        if (allPassed && testStatusEl) {
          const nextBtn = document.createElement('button');
          nextBtn.className = 'btn';
          nextBtn.style.marginLeft = '8px';
          nextBtn.textContent = '下一题 ▸';
          nextBtn.addEventListener('click', () => {
            if (lastPickPayload && !pickRequestInFlight) {
              beginPickRequest();
              vscode.postMessage({ type: 'fetchProblem', payload: lastPickPayload });
              const pickNav = document.querySelector('.nav-item[data-view="pick"]');
              if (pickNav) pickNav.click();
            }
          });
          testStatusEl.appendChild(nextBtn);
        }
        break;
      }
      case 'testStatus':
        setTestStatus(msg.message || '', msg.isError ? 'error' : '');
        break;
      case 'testRunning':
        setTestRunning(!!msg.running);
        break;
      case 'recordsList': {
        recRecords = msg.records || [];
        renderStats(msg.stats);
        renderRecords();
        vscode.postMessage({ type: 'todayStatsReady' });
        vscode.postMessage({ type: 'historyDataReady' }); // V0.8：记录变化后饼图实时刷新
        break;
      }
      case 'todayStats':
        renderTodayStats(msg.stats);
        break;
      case 'cfBound':
        renderCfHandle(msg.handle);
        break;
      case 'historyData':
        renderPie(msg.tagStats);
        renderDifficultyBars(msg.difficultyBins);
        break;
      // ===== CF 登录态（V0.22）=====
      case 'cfSessionState':
        if (cfSLogin) cfSLogin.disabled = false;
        renderCfSession(msg.state);
        break;
      case 'cfLoginStatus': {
        if (cfSText && msg.message) {
          cfSText.textContent = msg.message;
          cfSText.title = '';
        }
        if (msg.busy && cfSDot) cfSDot.className = 'cf-s-dot checking';
        if (!msg.busy) {
          if (cfSLogin) cfSLogin.disabled = false;
          if (msg.isError && cfSDot) cfSDot.className = 'cf-s-dot logged-out';
        }
        break;
      }
      // ===== 比赛模块（V0.22）=====
      case 'contestList': {
        contestLoaded = true;
        if (msg.error) {
          if (contestListEl) contestListEl.innerHTML = '<div class="muted chart-empty">' + escapeHtml(msg.error) + '</div>';
          break;
        }
        contestDetailCache = {};
        renderContests(msg.contests || []);
        // 刷新后自动重新展开之前展开的比赛并拉最新详情（赛时榜单/题目实时）
        expandedContestIds.forEach((id) => {
          const card = contestListEl && contestListEl.querySelector('.contest-card[data-contest-id="' + id + '"]');
          const box = card && card.querySelector('.contest-problems');
          if (box) {
            box.style.display = '';
            const btn = card.querySelector('.contest-expand-btn');
            if (btn) btn.textContent = '题目 ▴';
            vscode.postMessage({ type: 'contestSelect', payload: { contestId: id } });
          }
        });
        break;
      }
      case 'contestDetail':
        contestDetailCache[msg.contestId] = msg.detail;
        renderContestProblems(msg.contestId, msg.detail);
        break;
      case 'contestDetailError': {
        const card = contestListEl && contestListEl.querySelector('.contest-card[data-contest-id="' + msg.contestId + '"]');
        const box = card && card.querySelector('.contest-problems');
        if (box) box.innerHTML = '<div class="muted chart-empty">' + escapeHtml(msg.message || '题目列表获取失败') + '</div>';
        break;
      }
      case 'contestCreated': {
        const card = contestListEl && contestListEl.querySelector('.contest-card[data-contest-id="' + msg.contestId + '"]');
        const btn = card && card.querySelector('.contest-create-btn');
        if (btn) btn.textContent = '已创建 ' + msg.count + ' 题 ✓';
        const fail = msg.samplesFail || 0;
        const ok = msg.samplesOk || 0;
        // V0.17.1：样例抓取结果提示（失败题在测试面板也会有「请手动添加用例」提示）
        if (fail > 0) {
          setStatus('已创建 ' + msg.count + ' 题（样例就绪 ' + ok + ' 题，' + fail + ' 题抓取失败，请手动添加用例），正在打开 A 题…', 'error');
        } else {
          setStatus('已创建 ' + msg.count + ' 题，样例 ' + ok + ' 题全部就绪，正在打开 A 题…');
        }
        break;
      }
      case 'contestStatus':
        setStatus(msg.message || '', msg.isError ? 'error' : '');
        break;
      case 'followHandlesSet':
        refreshExpandedContests();
        break;
      case 'problemTranslateStatus': {
        document.querySelectorAll('.prob-translate-btn').forEach((b) => {
          b.disabled = false;
          b.textContent = '翻译';
        });
        if (msg.busy) {
          setStatus(msg.message);
        } else if (msg.isError) {
          setStatus(msg.message, true);
        }
        break;
      }
      case 'contestStatement':
        setStatus('翻译完成（英文/中文对照）');
        renderContestStatement(msg.label || msg.url, msg.html, msg.zh);
        break;
      // ===== 造数据机器（V0.22）=====
      case 'dataGenerated': {
        lastGenerated = msg.input || '';
        if (dgOutputEl) dgOutputEl.textContent = lastGenerated || '(空)';
        // 不再自动写入测试面板/样例，只保留生成预览，避免覆盖题目官方样例
        break;
      }
      case 'dataGenStatus': {
        if (dgStatusEl) {
          dgStatusEl.textContent = msg.message || '';
          dgStatusEl.className = 'dg-status' + (msg.isError ? ' error' : msg.busy ? ' busy' : ' ok');
        }
        if (dgGenBtn) dgGenBtn.disabled = false;
        break;
      }
      // ===== 对拍器（V0.22）=====
      case 'verifierProgress':
        if (vpProgress) vpProgress.textContent = '第 ' + msg.round + '/' + msg.total + ' 组 · 已通过 ' + msg.passed + ' 组';
        if (vpStatus) { vpStatus.textContent = msg.message || ''; vpStatus.className = 'vp-status'; }
        break;
      case 'verifierMismatch': {
        lastMismatch = { input: msg.input, solveOut: msg.solveOut, bruteOut: msg.bruteOut };
        if (vpMismatch) vpMismatch.style.display = '';
        const title = document.getElementById('vp-mismatch-title');
        if (title) title.textContent = msg.reason || '输出不一致';
        if (vpIn) vpIn.textContent = msg.input;
        if (vpSo) vpSo.textContent = msg.solveOut;
        if (vpBo) vpBo.textContent = msg.bruteOut;
        break;
      }
      case 'verifierDone': {
        if (vpStart) vpStart.disabled = false;
        if (vpStop) vpStop.style.display = 'none';
        if (vpProgress) vpProgress.textContent = '共运行 ' + msg.rounds + ' 组 · 通过 ' + msg.passed + ' 组' + (msg.cancelled ? '（已取消）' : '');
        if (vpStatus) {
          vpStatus.textContent = msg.reason || '';
          vpStatus.className = 'vp-status ' + (msg.cancelled ? '' : msg.passed === msg.rounds && !msg.stopped ? 'ok' : 'error');
        }
        break;
      }
      case 'verifierStatus': {
        if (vpStatus) {
          vpStatus.textContent = msg.message || '';
          vpStatus.className = 'vp-status' + (msg.isError ? ' error' : '');
        }
        break;
      }
      case 'verifierBrutePicked':
        if (vpBrute) vpBrute.value = msg.path || '';
        break;
      case 'verifierCheckerPicked':
        if (vpSpj) vpSpj.value = msg.path || '';
        break;
      // ===== 通过 URL 导入题目（V0.23）=====
      case 'wallpaperPicked': {
        if (msg.path) {
          wallpaperUrl.value = msg.path;
          applyWallpaper(msg.path, msg.isVideo || /\.(mp4|webm|mov|m4v)$/i.test(msg.path));
          vscode.postMessage({ type: 'setWallpaper', url: msg.path, isVideo: msg.isVideo || /\.(mp4|webm|mov|m4v)$/i.test(msg.path) });
        }
        break;
      }
      case 'urlImportStatus': {
        urlImporting = !!msg.busy;
        if (urlImportBtn) {
          urlImportBtn.disabled = !!msg.busy;
          urlImportBtn.textContent = msg.busy ? '导入中…' : '导入';
        }
        if (msg.message) setUrlImportStatus(msg.message, msg.isError ? 'error' : '');
        break;
      }
      case 'urlImportDone': {
        urlImporting = false;
        if (urlImportBtn) {
          urlImportBtn.disabled = false;
          urlImportBtn.textContent = '导入';
        }
        setUrlImportStatus(msg.message || '导入完成', msg.existed ? '' : 'ok');
        setStatus(msg.message || '导入完成', msg.existed ? '' : 'ok');
        // 自动切到测试视图：题面/翻译/测试用例已随文件打开加载
        const testNav = document.querySelector('.nav-item[data-view="test"]');
        if (testNav) testNav.click();
        break;
      }
    }
  });

  // ===== 外部链接统一交给扩展打开 =====
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-url]');
    if (target) {
      e.preventDefault();
      const url = target.getAttribute('data-url');
      if (url) {
        vscode.postMessage({ type: 'openExternal', url });
      }
    }
  });

  // ===== 初始化 =====
  vscode.postMessage({ type: 'webviewReady' });
  initTestView();
  initRecordsView();
  initContestView();
  initDataGenView();
  initDuipaiView();
  vscode.postMessage({ type: 'testReady' });
  vscode.postMessage({ type: 'todayStatsReady' });
  vscode.postMessage({ type: 'historyDataReady' });
  vscode.postMessage({ type: 'statementReady' }); // V0.12：加载即推送当前文件题面（不再等切视图）
  vscode.postMessage({ type: 'cfSessionReady' }); // V0.22：加载即检查 CF 登录态
})();
