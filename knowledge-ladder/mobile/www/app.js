/* 知识阶梯移动端 PWA 逻辑 */
(function () {
  const D = window.KNOWLEDGE_DATA;
  const algMap = {};
  (D.algorithms || []).forEach(a => { algMap[a.name] = a; });

  const STORAGE_KEY = "kl_mobile_mastered_v1";
  let mastered = {};
  try {
    mastered = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    mastered = {};
  }

  const OP_DESC = {
    "编码压缩": "减少冗余：哈希 / 前缀和 / 线性基 / SAM / 可持久化",
    "传播松弛": "扩散信息：BFS / DP / Dijkstra / 线段树 / 树形 DP",
    "剪枝决策": "缩小搜索：二分 / 双指针 / 单调栈 / 凸包 / 斜率优化 / 最小割",
    "变换域映射": "解耦纠缠：FFT / 矩阵幂 / 差分 / 对偶 / 生成函数 / LCT",
    "基线/暴力": "没有信息破缺：暴力 / 模拟 / 几何原子 / 构造"
  };

  let currentView = "home";
  let currentOp = "";
  let searchTerm = "";
  let openTiers = {};
  const allTierIds = (D.tiers || []).map(t => t.id);

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function saveMastered() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mastered));
  }

  function isMastered(id) {
    return !!mastered[id];
  }

  function setMastered(id, value) {
    mastered[id] = value;
    saveMastered();
  }

  function unique(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      if (x && !seen.has(x)) { seen.add(x); out.push(x); }
    }
    return out;
  }

  function aggregateTagInfo(tag) {
    const ops = [], topos = [], dyns = [], metrics = [];
    (tag.algorithms || []).forEach(name => {
      const info = algMap[name] && algMap[name].info;
      if (!info) return;
      (info.ops || []).forEach(op => ops.push(op));
      if (info.topology) topos.push(info.topology);
      if (info.dynamic) dyns.push(info.dynamic);
      if (info.metric) metrics.push(info.metric);
    });
    return {
      ops: unique(ops),
      topologies: unique(topos),
      dynamics: unique(dyns),
      metrics: unique(metrics)
    };
  }

  function totalTags() {
    return (D.tiers || []).reduce((sum, t) => sum + (t.tags || []).length, 0);
  }

  function masteredCount() {
    let c = 0;
    (D.tiers || []).forEach(t => (t.tags || []).forEach(tag => {
      if (isMastered(tag.id)) c++;
    }));
    return c;
  }

  function opCoverage() {
    const counts = {};
    (D.infoOps || []).forEach(op => counts[op] = 0);
    (D.tiers || []).forEach(t => (t.tags || []).forEach(tag => {
      if (!isMastered(tag.id)) return;
      const agg = aggregateTagInfo(tag);
      agg.ops.forEach(op => { if (counts[op] !== undefined) counts[op]++; });
    }));
    return counts;
  }

  // ---------- render home ----------
  function renderHome() {
    const total = totalTags();
    const done = masteredCount();
    document.getElementById("homeProgress").textContent =
      `总进度：${done} / ${total}（${Math.round(done * 100 / Math.max(1, total))}%）`;

    const counts = {};
    (D.infoOps || []).forEach(op => counts[op] = 0);
    (D.algorithms || []).forEach(a => {
      (a.info && a.info.ops || []).forEach(op => {
        if (counts[op] !== undefined) counts[op]++;
      });
    });
    const masteredCounts = opCoverage();

    document.getElementById("opOverview").innerHTML = (D.infoOps || []).map(op => `
      <div class="op-card">
        <div class="op-name" style="color:${(D.infoOpColors || {})[op] || "#6c8cff"}">${esc(op)}</div>
        <div class="op-desc">${esc(OP_DESC[op] || "")}</div>
        <div class="op-count">覆盖 ${counts[op]} 个算法 · 已掌握 ${masteredCounts[op] || 0} 个标签</div>
      </div>
    `).join("");

    const phases = D.phases || {};
    document.getElementById("phaseList").innerHTML = Object.keys(phases).sort((a,b)=>a-b).map(k => {
      const p = phases[k];
      return `
        <div class="phase-card">
          <div class="phase-name">${esc(p.name)}</div>
          <div class="phase-meta">${esc(p.range || "")} · ${esc(p.slogan || "")}</div>
          <div class="phase-desc">${esc(p.description || "")}</div>
        </div>
      `;
    }).join("");

    document.getElementById("anatomyList").innerHTML = (D.anatomySteps || []).map(s => `
      <div class="anatomy-card">
        <div class="anatomy-step">${esc(s.step)}</div>
        <div class="anatomy-question">${esc(s.question)} <b>${esc(s.choices)}</b></div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">${esc(s.output)}</div>
      </div>
    `).join("");
  }

  // ---------- render tier list ----------
  function tagMatches(tag) {
    if (currentOp) {
      const agg = aggregateTagInfo(tag);
      if (!agg.ops.includes(currentOp)) return false;
    }
    if (searchTerm) {
      const agg = aggregateTagInfo(tag);
      const hay = [
        tag.name || "", tag.desc || "", tag.detail || "", tag.group || "",
        (tag.algorithms || []).join(" "),
        agg.ops.join(" "), agg.topologies.join(" "), agg.metrics.join(" ")
      ].join(" ").toLowerCase();
      if (!hay.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  }

  function renderTiers() {
    document.getElementById("opFilter").innerHTML = ["", ...(D.infoOps || [])].map(op => `
      <button class="chip ${(currentOp || "") === (op || "") ? "active" : ""}" data-op="${esc(op)}">${esc(op || "全部")}</button>
    `).join("");

    const list = document.getElementById("tierList");
    list.innerHTML = (D.tiers || []).map(tier => {
      const tags = tier.tags || [];
      const total = tags.length;
      const done = tags.filter(t => isMastered(t.id)).length;
      const open = openTiers[tier.id];
      const filtering = !!(currentOp || searchTerm);
      const showBody = open || filtering;
      const visibleTags = tags.filter(tagMatches);
      return `
        <div class="tier-card ${open ? "open" : ""}">
          <button class="tier-head" data-tier="${tier.id}">
            <span class="tier-dot" style="background:${tier.color || "#6c8cff"}"></span>
            <span class="tier-head-text">
              <span class="tier-name">${esc(tier.name)}</span>
              <div class="tier-range">${esc(tier.range || "")} · ${esc(tier.phase_name || "")}</div>
            </span>
            <span class="tier-arrow">▶</span>
          </button>
          <div class="tier-progress"><div style="width:${total ? Math.round(done*100/total) : 0}%"></div></div>
          <div class="tier-body" style="display:${showBody ? "block" : "none"}">
            ${visibleTags.length ? visibleTags.map(tagRowHtml).join("") : '<div class="empty-tip">没有匹配的知识点</div>'}
          </div>
        </div>
      `;
    }).join("");
    bindTierEvents();
  }

  function tagRowHtml(tag) {
    const agg = aggregateTagInfo(tag);
    const badges = [
      ...agg.ops.map(op => {
        const c = (D.infoOpColors || {})[op] || "#6c8cff";
        return `<span class="badge" style="color:${c};border-color:${c}55;background:${c}18;">${esc(op)}</span>`;
      }),
      ...agg.topologies.map(t => `<span class="badge topo">${esc(t)}</span>`),
      ...agg.dynamics.map(d => `<span class="badge dyn">${esc(d)}</span>`)
    ].join("");
    const hasAlgs = (tag.algorithms || []).length > 0;
    const hasDetail = !!tag.detail;
    return `
      <div class="tag-row ${isMastered(tag.id) ? "mastered" : ""}" data-tag="${esc(tag.id)}">
        <div class="tag-top">
          <input type="checkbox" class="tag-check" ${isMastered(tag.id) ? "checked" : ""} data-tag-id="${esc(tag.id)}">
          <div style="min-width:0;flex:1;">
            <div class="tag-name">${esc(tag.name)}</div>
            <div class="tag-desc">${esc(tag.desc || "")}</div>
          </div>
        </div>
        ${badges ? `<div class="tag-badges">${badges}</div>` : ""}
        <div class="tag-actions">
          ${hasAlgs ? `<button class="tag-btn" data-template="${esc(tag.id)}">模板</button>` : ""}
          ${hasDetail ? `<button class="tag-btn" data-detail="${esc(tag.id)}">详情</button>` : ""}
        </div>
      </div>
    `;
  }

  function bindTierEvents() {
    document.querySelectorAll(".tier-head").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.tier);
        openTiers[id] = !openTiers[id];
        renderTiers();
      });
    });
    document.querySelectorAll(".tag-check").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.tagId;
        setMastered(id, cb.checked);
        const row = cb.closest(".tag-row");
        if (row) row.classList.toggle("mastered", cb.checked);
        renderHome();
        renderTiers();
      });
    });
    document.querySelectorAll("[data-template]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tag = findTagById(btn.dataset.template);
        if (tag) showTagTemplates(tag);
      });
    });
    document.querySelectorAll("[data-detail]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tag = findTagById(btn.dataset.detail);
        if (tag) showTagDetail(tag);
      });
    });
  }

  function findTagById(id) {
    for (const t of D.tiers || []) {
      for (const tag of t.tags || []) {
        if (tag.id === id) return tag;
      }
    }
    return null;
  }

  // ---------- modal ----------
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");

  function showModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modal.classList.remove("hidden");
  }

  function hideModal() {
    modal.classList.add("hidden");
    modalBody.innerHTML = "";
  }

  function showGuide() {
    const phases = D.phases || {};
    const phaseHtml = Object.keys(phases).sort((a,b)=>a-b).map(k => {
      const p = phases[k];
      return `<p><b>${esc(p.name)}</b>（${esc(p.range)}）<br>${esc(p.description)}</p>`;
    }).join("");
    const anatomyHtml = (D.anatomySteps || []).map(s => `
      <p><b>${esc(s.step)}</b>：${esc(s.question)}<br>${esc(s.choices)}<br>${esc(s.output)}</p>
    `).join("");
    showModal("信息论导论", `
      <h3>四种信息操作</h3>
      ${(D.infoOps || []).map(op => `<p><b>${esc(op)}</b>：${esc(OP_DESC[op] || "")}</p>`).join("")}
      <h3>四阶段地图</h3>
      ${phaseHtml}
      <h3>解剖四步</h3>
      ${anatomyHtml}
      <p style="font-size:12px;">四种操作是记忆坐标系，不是严格分类；一个算法可以属于多个操作。</p>
    `);
  }

  function showTagTemplates(tag) {
    const names = tag.algorithms || [];
    if (names.length === 1) {
      showAlgorithm(names[0]);
      return;
    }
    showModal(tag.name, `
      <p>请选择要查看的算法模板：</p>
      ${names.map(n => {
        const alg = algMap[n];
        if (!alg) return "";
        return `<p><button class="tag-btn" data-alg="${esc(n)}">${esc(n)}</button></p>`;
      }).join("")}
    `);
    modalBody.querySelectorAll("[data-alg]").forEach(btn => {
      btn.addEventListener("click", () => showAlgorithm(btn.dataset.alg));
    });
  }

  function showAlgorithm(name) {
    const a = algMap[name];
    if (!a) return;
    const info = a.info || {};
    showModal(a.name, `
      <div class="info-line">${esc((info.ops || []).join(" / "))} · ${esc(info.topology || "")} · ${esc(info.dynamic || "")}</div>
      <div class="why-line">为什么：${esc(info.why || "")}</div>
      <p>${esc(a.intro || "")}</p>
      <p><b>复杂度：</b>${esc(a.complexity || "")}</p>
      <h3>C++ 模板</h3>
      <pre>${esc(a.cpp || "")}</pre>
    `);
  }

  function showTagDetail(tag) {
    showModal(tag.name, `
      <p>${esc(tag.desc || "")}</p>
      ${(tag.detail || "").split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join("")}
    `);
  }

  // ---------- bind views / filters ----------
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentView = btn.dataset.view;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === currentView + "-view"));
      if (currentView === "home") renderHome();
      if (currentView === "tiers") renderTiers();
    });
  });

  document.getElementById("guideBtn").addEventListener("click", showGuide);
  document.getElementById("modalClose").addEventListener("click", hideModal);
  document.getElementById("modalMask").addEventListener("click", hideModal);

  document.getElementById("opFilter").addEventListener("click", e => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    currentOp = btn.dataset.op || "";
    renderTiers();
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    searchTerm = e.target.value.trim();
    renderTiers();
  });

  // ---------- PWA service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- init ----------
  renderHome();
  renderTiers();
})();
