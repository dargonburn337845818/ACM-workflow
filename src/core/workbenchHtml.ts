import * as vscode from 'vscode';

/** 选题视图 HTML（V0.23：URL 导入入口） */
export function renderPickView(): string {
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

          <!-- 第 5 条：按算法标签选题（多选，命中任一标签即可） -->
          <div class="control-row tag-row">
            <div class="tag-head">
              <label>算法标签（多选，命中任一即可）</label>
              <input type="search" id="pick-tag-search" class="pick-tag-search mono" placeholder="搜索或输入标签后回车…" spellcheck="false" autocomplete="off">
            </div>
            <div id="pick-selected-tags" class="pick-selected-tags"></div>
            <div id="pick-tag-chips" class="tag-chips"></div>
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

/** 生成工作台 Webview HTML 模板（V0.18 从 panel.ts 拆出，ADR 0003 再拆到独立文件） */
export function getWorkbenchHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
  );

  // 可选的玻璃拟态背景：支持 Wallpaper Engine 动态壁纸（视频）和静态图片
  const glassBackground = vscode.workspace.getConfiguration('acmWorkflow').get<string>('glassBackground', '').trim();
  let glassBgStyle = '';
  let glassBgVideo = '';
  if (glassBackground) {
    let bgUri = glassBackground;
    const localPath = glassBackground.startsWith('file://') ? glassBackground.slice(7) : null;
    if (localPath) {
      try { bgUri = webview.asWebviewUri(vscode.Uri.file(localPath)).toString(); } catch { /* keep original */ }
    }
    const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(glassBackground);
    if (isVideo) {
      glassBgVideo = `<video class="wallpaper-bg" autoplay loop muted playsinline src="${bgUri}"></video>`;
    } else {
      glassBgStyle = `<style>body { background-image: url("${bgUri}"), radial-gradient(560px 560px at 85% 8%, rgba(124,156,196,0.28), transparent 65%), radial-gradient(520px 520px at 8% 92%, rgba(51,81,122,0.35), transparent 65%) !important; background-size: cover, auto, auto; background-position: center, center, center; background-attachment: fixed, fixed, fixed; }</style>`;
    }
  }

  const pickView = renderPickView();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.staticfile.org; style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.staticfile.org; font-src https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.staticfile.org; img-src ${webview.cspSource} data: https: file:; media-src ${webview.cspSource} data: https: file: blob:;">
  <link rel="stylesheet" href="${styleUri}">
  ${glassBgStyle}
  <title>ACM Workflow</title>
</head>
<body class="${glassBackground ? 'has-wallpaper' : ''}">
  ${glassBgVideo}
  <div class="app">
    <nav class="rail">
      <button class="nav-item active" data-view="pick" title="选题">
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
        <button class="btn cf-s-btn" id="diag-btn" title="运行工作流诊断（环境/网络/操作轨迹/已知 Bug 检查）">诊断</button>
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
              <span class="muted">流水线拼装：没有预设整体结构，按需要一步步添加 / 配置</span>
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
          <!-- V0.24：题面 / 样例分成两个页面 -->
          <div class="test-page-tabs">
            <button class="test-page active" data-page="statement" title="查看题目描述、输入输出格式与翻译">题面</button>
            <button class="test-page" data-page="samples" title="查看、编辑并运行测试用例">样例</button>
          </div>
          <div class="st-section test-page-panel active" id="st-section" data-page="statement">
            <div class="st-toolbar">
              <span class="spacer"></span>
              <button class="btn" id="st-refetch-btn" title="重新抓取当前题面并更新本地缓存">重新获取</button>
              <button class="btn" id="st-mode-btn" title="切换 双语 / 仅译文 / 仅原文">双语</button>
            </div>
            <!-- Bug3：带图题提示（点击打开 CF 官网） -->
            <button class="st-img-hint" id="st-img-hint" style="display:none">⚠️ 本题包含图片，请前往 CF 官网查看完整题面</button>
            <div id="st-body" class="st-body"><div class="muted st-empty">请在编辑器中打开一个题目文件<br>（如 979E.cpp / P1001.cpp），这里自动显示对应题面<br>点击「重新获取」可更新题面缓存</div></div>
            <div id="st-error" class="st-error"></div>
            <div id="st-translation-status" class="st-info"></div>
          </div>
          <div class="test-lower test-page-panel" id="test-lower" data-page="samples">
            <div class="test-toolbar">
              <button class="btn" id="test-add-btn">添加用例</button>
              <button class="btn" id="test-save-btn">保存</button>
              <span class="spacer"></span>
              <button class="btn danger" id="test-cancel-btn" style="display:none">取消</button>
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
              <div class="control-row">
                <label>比对方式</label>
                <select id="vp-compare" class="vp-input" style="width:190px">
                  <option value="exact">精确（忽略行尾空白）</option>
                  <option value="token">Token 比较</option>
                  <option value="float">浮点误差</option>
                  <option value="spj">Special Judge</option>
                </select>
                <input id="vp-eps" type="number" class="vp-input" value="1e-6" step="any" style="width:120px;display:none" title="浮点误差阈值">
              </div>
              <div class="control-row" id="vp-spj-row" style="display:none">
                <label>SPJ 程序</label>
                <div class="vp-path-row">
                  <input id="vp-spj" class="vp-input mono" placeholder="选择或输入 checker.cpp / .py / .js / .exe 路径" spellcheck="false">
                  <button class="btn sm" id="vp-spj-browse">浏览…</button>
                </div>
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
            <span class="cf-bind-label">CF 账号（登录态）</span>
            <span class="mono cf-handle" id="cf-handle">未登录</span>
            <span class="spacer"></span>
            <button class="btn" id="cf-import-btn" title="拉取当前登录账号的 AC 历史并导入本地库">导入历史</button>
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
