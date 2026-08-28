/* 拆题引导：入口即四步，建议可点解，下一步进入引导式思考 */
(function () {
  const STEPS = [
    {
      key: "shape", title: "数据形状？", hint: "先看数据长在哪里",
      options: [
        { value: "linear", label: "线性", desc: "数组 / 字符串 / 区间" },
        { value: "graph", label: "树 / 图", desc: "树 / 图 / 网络 / 依赖" },
        { value: "algebra", label: "数学对象", desc: "数字 / 集合 / 异或" }
      ]
    },
    {
      key: "dynamic", title: "数据会变吗？", hint: "运行过程中是否修改",
      options: [
        { value: "static", label: "静态", desc: "只读，可预处理" },
        { value: "dynamic", label: "动态", desc: "需要实时维护" }
      ]
    },
    {
      key: "metric", title: "运算规则？", hint: "信息如何合并",
      options: [
        { value: "sum", label: "加法 / 最值", desc: "路径 / 区间和" },
        { value: "xor", label: "异或", desc: "线性基" },
        { value: "conv", label: "卷积 / 计数", desc: "FFT / 组合" },
        { value: "bool", label: "可行性", desc: "连通 / 匹配 / 2-SAT" },
        { value: "number", label: "数论 / 模", desc: "gcd / 同余" },
        { value: "geom", label: "几何", desc: "凸包 / 距离" }
      ]
    },
    {
      key: "scale", title: "n 多大？", hint: "决定复杂度级别",
      options: [
        { value: "n20", label: "≤ 20", desc: "状压 / 枚举" },
        { value: "n100", label: "≤ 100", desc: "O(n³) / 区间DP" },
        { value: "n5000", label: "≤ 5000", desc: "O(n²) / 简单DP" },
        { value: "n1e5", label: "≤ 1e5", desc: "O(n log n)" },
        { value: "n1e9", label: "≤ 1e9", desc: "公式 / 矩阵" }
      ]
    }
  ];

  const LABELS = {
    shape: "数据形状",
    dynamic: "是否变化",
    metric: "运算规则",
    scale: "数据规模"
  };

  const OP_INFO = {
    "编码压缩": {
      human: "先想能不能把重复信息压掉，把慢查询变成快查询。",
      examples: "前缀和、哈希、线性基、SAM、可持久化",
      question: "能不能预处理？重复的信息是不是只需要存一份？"
    },
    "传播松弛": {
      human: "信息按依赖关系一层层传，走到哪算到哪。",
      examples: "BFS / DP、Dijkstra、树形DP、线段树",
      question: "能不能按顺序把状态推过去？后面会不会用到前面的结果？"
    },
    "剪枝决策": {
      human: "先排除不可能成为答案的候选，别全部试一遍。",
      examples: "二分、双指针、单调栈、凸包、斜率优化、最小割",
      question: "有没有单调性？能不能一次性排除一大批选项？"
    },
    "变换域映射": {
      human: "换个角度看题，原本纠缠的东西会变简单。",
      examples: "FFT、矩阵快速幂、差分、对偶、生成函数",
      question: "能不能把问题换个坐标系？比如时域变频域、静态变动态？"
    },
    "基线/暴力": {
      human: "暂时看不出破绽，就先按最直接的方式做。",
      examples: "暴力枚举、模拟、构造",
      question: "数据够小吗？先写一个能过的朴素版再说？"
    }
  };

  let index = 0;
  let ans = {};

  const stage = document.getElementById("stage");
  const stepCount = document.getElementById("stepCount");

  function valueLabel(step, value) {
    const opt = step.options.find(o => o.value === value);
    return opt ? opt.label : value;
  }

  function renderQuestion() {
    stepCount.style.display = "";
    stepCount.textContent = `${index + 1} / ${STEPS.length}`;
    const step = STEPS[index];
    const nextStep = STEPS[index + 1];
    const prevLabel = index > 0 ? valueLabel(STEPS[index - 1], ans[STEPS[index - 1].key]) : null;

    stage.innerHTML = `
      <div class="stack">
        <div class="card back">
          <div class="card-title">引导思考</div>
          <div class="card-hint">只回答一个问题</div>
          <div style="color:var(--muted);font-size:13px;">不背名词，跟着走。</div>
        </div>
        <div class="card mid">
          <div class="card-title">${nextStep ? nextStep.title : "建议方向"}</div>
          <div class="card-hint">${nextStep ? "下一步" : "完成"}</div>
        </div>
        <div class="card front">
          <div class="card-title">${step.title}</div>
          <div class="card-hint">${step.hint}</div>
          <div class="options">
            ${step.options.map(opt => `
              <button class="option" data-value="${opt.value}">
                ${opt.label}
                <small>${opt.desc}</small>
              </button>
            `).join("")}
          </div>
          ${prevLabel ? `<div style="margin-top:14px;color:var(--muted);font-size:12px;">上一步：${prevLabel}</div>` : ""}
        </div>
      </div>
    `;

    stage.querySelectorAll(".option").forEach(btn => {
      btn.addEventListener("click", () => {
        ans[step.key] = btn.dataset.value;
        index++;
        if (index < STEPS.length) renderQuestion();
        else renderResult();
      });
    });
  }

  function recommend() {
    const ops = new Set();
    if (ans.metric === "conv") ops.add("变换域映射");
    if (ans.metric === "xor") { ops.add("编码压缩"); ops.add("变换域映射"); }
    if (ans.metric === "number") ops.add("变换域映射");
    if (ans.scale === "n20") { ops.add("编码压缩"); ops.add("基线/暴力"); }
    if (ans.scale === "n100") ops.add("传播松弛");
    if (ans.scale === "n5000") { ops.add("传播松弛"); ops.add("剪枝决策"); }
    if (ans.scale === "n1e5") { ops.add("剪枝决策"); ops.add("编码压缩"); }
    if (ans.scale === "n1e9") ops.add("变换域映射");
    if (ans.shape === "graph") { ops.add("传播松弛"); ops.add("剪枝决策"); }
    if (ans.shape === "linear") ops.add("编码压缩");
    if (ans.dynamic === "dynamic") ops.add("传播松弛");
    if (ans.dynamic === "static") ops.add("编码压缩");
    if (!ops.size) ops.add("剪枝决策");
    return ["编码压缩", "传播松弛", "剪枝决策", "变换域映射", "基线/暴力"].filter(op => ops.has(op));
  }

  function hints() {
    const map = {
      shape_linear: "如果是序列题，先试着用双指针、前缀和或区间DP来切。",
      shape_graph: "图或树题，先想连通性、最短路、树形DP这三条路。",
      shape_algebra: "抽象数学题，优先考虑线性基、同余、生成函数。",
      dynamic_dynamic: "数据会改，优先想到线段树、树状数组、平衡树。",
      dynamic_static: "数据不变，可以先预处理：前缀和、ST表、莫队。",
      metric_sum: "加法或最值，通常就是DP或最短路。",
      metric_xor: "异或类，优先线性基，别先想最短路。",
      metric_conv: "卷积或计数，直接往FFT/NTT想。",
      metric_bool: "只问能不能，就往并查集、二分图、2-SAT想。",
      metric_number: "数论相关，先看gcd、逆元、同余、质因子。",
      metric_geom: "几何题，先想凸包、叉积、极角排序。",
      scale_n20: "n很小，直接考虑状压、搜索、暴力都能过。",
      scale_n100: "n到100，O(n³)或区间DP是安全选择。",
      scale_n5000: "n到5000，可以写O(n²)DP，再找单调性优化。",
      scale_n1e5: "n到1e5，必须O(n log n)：排序、二分、线段树、分治。",
      scale_n1e9: "n到1e9，别循环，直接找公式、矩阵快速幂、循环节。"
    };
    return STEPS.map(s => map[s.key + "_" + ans[s.key]]).filter(Boolean);
  }

  const opClass = { "编码压缩": "c1", "传播松弛": "c2", "剪枝决策": "c3", "变换域映射": "c4" };

  function renderResult() {
    stepCount.style.display = "none";
    const ops = recommend();
    const next = hints();
    stage.innerHTML = `
      <div class="diagram">
        ${STEPS.map((s, i) => `
          <div class="diagram-node">
            <div class="node-label">${LABELS[s.key]}</div>
            <div class="node-value">${valueLabel(s, ans[s.key])}</div>
          </div>
          ${i < STEPS.length - 1 ? '<div class="diagram-arrow">↓</div>' : ""}
        `).join("")}
        <div class="diagram-arrow">↓</div>
        <div class="diagram-node">
          <div class="node-label">建议方向</div>
          <div class="ops-row">
            ${ops.map(op => `<span class="op-pill ${opClass[op] || "c1"} clickable" data-op="${op}">${op}</span>`).join("")}
          </div>
          <div class="go-hint">点操作看解释</div>
        </div>
        <div class="diagram-arrow">↓</div>
        <button class="diagram-node clickable" id="nextBtn" style="width:100%;text-align:left;">
          <div class="node-label">下一步</div>
          <ul class="next-list">
            ${next.slice(0, 3).map(h => `<li>· ${h}</li>`).join("")}
          </ul>
          <div class="go-hint">点这里进入引导式思考 →</div>
        </button>
      </div>
      <button class="restart-btn" id="restart">下一题</button>
    `;

    stage.querySelectorAll("[data-op]").forEach(p => {
      p.addEventListener("click", () => showExplain(p.dataset.op));
    });
    document.getElementById("nextBtn").addEventListener("click", renderThinking);
    document.getElementById("restart").addEventListener("click", () => {
      index = 0;
      ans = {};
      renderQuestion();
    });
  }

  function renderThinking() {
    stepCount.style.display = "none";
    const ops = recommend();
    const next = hints();
    const shapeText = {
      linear: "你的数据是线性的。做题时先问：能不能用双指针、前缀和、区间DP？",
      graph: "你的数据长在树或图上。先问：能不能转成最短路、树形DP、连通性问题？",
      algebra: "你的数据是抽象数学对象。先问：能不能用线性基、同余、生成函数解决？"
    }[ans.shape];
    const dynText = {
      static: "数据不变，说明可以花时间预处理，查询就能快。",
      dynamic: "数据会变，说明要维护一个能实时更新的结构。"
    }[ans.dynamic];
    const metricText = {
      sum: "运算规则是加法/最值，通常走 DP 或最短路。",
      xor: "运算规则是异或，优先想到线性基。",
      conv: "运算规则是卷积/计数，直接想到 FFT / NTT。",
      bool: "只问能不能，想到并查集、二分图、2-SAT。",
      number: "数论相关，想到 gcd、逆元、同余、质因子。",
      geom: "几何相关，想到凸包、叉积、极角排序。"
    }[ans.metric];
    const scaleText = {
      n20: "规模很小，别犹豫，状压/搜索/暴力都先试。",
      n100: "规模到100，O(n³) 或区间DP 是安全选择。",
      n5000: "规模到5000，先写 O(n²) DP，再看能不能单调优化。",
      n1e5: "规模到1e5，必须 O(n log n)：排序、二分、线段树、分治。",
      n1e9: "规模到1e9，别枚举，直接找公式、矩阵快速幂、循环节。"
    }[ans.scale];

    const cards = [
      { step: "形状", q: LABELS.shape, a: shapeText },
      { step: "变动", q: LABELS.dynamic, a: dynText },
      { step: "规则", q: LABELS.metric, a: metricText },
      { step: "规模", q: LABELS.scale, a: scaleText }
    ];

    stage.innerHTML = `
      <div class="thinking-view">
        <div class="think-head">
          <button class="think-back" id="thinkBack">‹ 返回</button>
          <div class="think-title">引导式思考</div>
        </div>
        ${cards.map(c => `
          <div class="think-card">
            <div class="think-step">${c.step}</div>
            <div class="think-q">${c.q}</div>
            <div class="think-a">${c.a}</div>
          </div>
        `).join("")}
        <div class="think-final">
          <div class="think-step">建议方向</div>
          <div class="ops-row">
            ${ops.map(op => `<span class="op-pill ${opClass[op] || "c1"} clickable" data-op="${op}">${op}</span>`).join("")}
          </div>
          <ul class="next-list" style="color:#fff;margin-top:10px;">
            ${next.map(h => `<li>· ${h}</li>`).join("")}
          </ul>
        </div>
        <button class="restart-btn" id="thinkRestart">下一题</button>
      </div>
    `;

    document.getElementById("thinkBack").addEventListener("click", renderResult);
    document.getElementById("thinkRestart").addEventListener("click", () => {
      index = 0;
      ans = {};
      renderQuestion();
    });
    stage.querySelectorAll("[data-op]").forEach(p => {
      p.addEventListener("click", () => showExplain(p.dataset.op));
    });
  }

  // ---------- operation explanation modal ----------
  const explainModal = document.getElementById("explainModal");
  const explainTitle = document.getElementById("explainTitle");
  const explainBody = document.getElementById("explainBody");

  function showExplain(op) {
    const info = OP_INFO[op];
    if (!info) return;
    explainTitle.textContent = op;
    explainBody.innerHTML = `
      <p>${info.human}</p>
      <div class="eg">
        <b>常见例子：</b>${info.examples}<br><br>
        <b>你可以问自己：</b>${info.question}
      </div>
    `;
    explainModal.classList.remove("hidden");
  }

  function hideExplain() {
    explainModal.classList.add("hidden");
  }

  document.getElementById("explainClose").addEventListener("click", hideExplain);
  document.getElementById("explainMask").addEventListener("click", hideExplain);

  // ---------- 风格切换：玻璃拟态 / 旧 Editorial ----------
  const THEME_KEY = "kl_mobile_theme";
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    if (localStorage.getItem(THEME_KEY) === "editorial") {
      document.body.classList.add("theme-editorial");
    }
    themeToggle.addEventListener("click", () => {
      const on = document.body.classList.toggle("theme-editorial");
      localStorage.setItem(THEME_KEY, on ? "editorial" : "glass");
    });
  }

  renderQuestion();
})();

/* ---------- parallax editorial rAF ---------- */
let peTicking = false;
function peOnScroll() {
  if (peTicking) return;
  peTicking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY || 0;
    document.querySelectorAll("[data-parallax]").forEach(el => {
      const rate = parseFloat(el.dataset.parallax || "0");
      el.style.setProperty("--pe-y", `${-y * rate}px`);
    });
    peTicking = false;
  });
}
window.addEventListener("scroll", peOnScroll, { passive: true });
window.addEventListener("resize", peOnScroll);
peOnScroll();
