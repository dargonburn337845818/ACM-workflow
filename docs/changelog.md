# 更新日志（Changelog）

版本号遵循语义化版本。本文件记录全部迭代历史（含内部开发记录提炼）。

## 0.18.1 — WSL 适配（2026-08-18）

- 新增 `tools/setup_wsl.sh`：一键安装 g++ / curl / python3 / Chromium，可选本地离线翻译
- `src/utils/paths.ts` 新增 `normalizePath`：WSL 下自动把 `C:\...` / `D:\...` 转成 `/mnt/c/...` / `/mnt/d/...`，`baseDir` / `templatePath` / `dbPath` / `browserPath` 全部生效
- `src/services/dataGen.ts`：`.py` 造数据脚本在非 Windows 平台优先使用 `python3`，找不到再回退 `python`
- `src/services/fetchers/luogu.ts`：浏览器探测增加 Chromium / Google Chrome / `/mnt/c` 路径，支持 `acmWorkflow.browserPath` 自定义；错误提示指向 `setup_wsl.sh`
- `src/services/runner.ts`：环境诊断增加 `/bin/curl` 与 python3 探测
- `src/services/cfSession.ts` / `submitter.ts`：WSL 浏览器启动加 `--no-sandbox`，错误提示更可操作
- `src/services/template.ts`：CPH `.prob` 同时生成 WSL `/mnt/...` 与 Windows `C:\...` 路径变体，WSL/Windows 两端都能命中
- `src/services/statementFiles.ts`：生成题目文件夹时同时写出 `题面.md`（由 HTML 转换），方便外部查看/分享
- `src/services/translate.ts`：公式占位符从 `MATH0` 改为 `☃0☃`，避免 Argos 等本地翻译把 `MATH` 音译成“马特”导致译文泄漏
- `src/services/statementHtml.ts`：修复 CF 题面 `$$$...$$$` 行内公式被误判为 `$$...$$` 块级公式，导致 “s and t of length n” 被拆成公式碎片、KaTeX 渲染乱版的问题；`statementFiles.ts` 同步提升题面 HTML 缓存版本，旧乱版缓存自动失效重抓
- `src/core/workbench.ts`：打开题目时自动从 CF 题集补全难度，URL 导入/本地打开也能显示 rating
- `src/features/records/index.ts` / `src/features/contest/index.ts`：记录导入与比赛“我的关注”直接使用 CF 登录态 handle，移除记录页手动“绑定 / 更换”按钮
- 文档：README / getting-started / configuration / troubleshooting / tools 增加 WSL 章节

## 0.18.0 — 开源首版（2026-08-18）

**结构重组完成**（V0.18 遗留收尾）：
- 修复 72 处编译错误：`src/` 按 core / features / services / types / utils 五层重构后
  所有模块导入路径修正、宿主接口（WorkbenchHost）补全、功能模块缺失的 `fs`/`path`/类型导入补齐
- 新增 `src/utils/paths.ts`：数据目录/模板/数据库路径统一配置化解析

**隐私清理（开源发布）**：
- 删除全部硬编码个人路径（`D:\ACM-Workflow`、`D:\vscode_code` 等），
  `baseDir`/`templatePath` 默认改为空 → 自动落到 `~/.acm-workflow`
- 删除含个人 handle 的缓存、个人开发脚本（tools/、*.bat）、内部文档（DEV/SPEC/ROADMAP）
- 新增 `.vscodeignore`：打包排除 .backup / code / records.db / cache 等个人数据
- `.gitignore` 补全 `*.db`、`.backup/`、`.vscode-test/` 等

**工程化**：
- ESLint 接入（flat config），修复 16 处真实问题（死导入/未用变量/require 混用/prefer-const）
- 冒烟测试 `tests/smoke.js`（27 断言，无 VS Code 环境可跑）：URL 解析/文件名解析/输出比对/难度分档/造数据确定性/知识图谱
- 新增 `media/icon.png`（128×128 硬边墨色图标）、walkthrough 三步入门
- 完整 README + docs/ 五件套 + CHANGELOG
- vsix 打包验证（`npm run lint` / `compile` / `test` / `vsce package` 全绿）

## 0.17.4 — 测试界面滑动受限修复（2026-08-18）

- 根因：模式切换引入的 `#test-single-panel` 缺少 `flex:1; min-height:0`，用例区被
  `overflow:hidden` 截断无法滚动
- 修复：补全 flex 列布局；对拍面板补 `overflow-y:auto`

## 0.17.3 — CF 直连加速（无代理方案）

- 全部 curl 抓取加 `-4` 强制 IPv4；Node fetch 无代理时同样 family:4，跳过 IPv6 试错
- 可选系统层 hosts 加速脚本（公共 DNS 解析 + 测速取最快 IP）

## 0.17.2 — CF 网络卡顿修复

- 新增配置 `acmWorkflow.proxy`（配置 > 环境变量优先级；curl 走 --proxy，fetch 走 undici ProxyAgent）
- 抓取提速：会话 curl → 裸 curl → fetch 顺序调整、超时 25s→12s、重试 3→1
- 登录会话 Cookie 写入 curl jar，页面/样例抓取带真实登录态，大幅降低匿名限流

## 0.17.1 — 比赛一键创建拉取样例

- 创建后串行抓取每道题样例（题间 800ms 防风控），写入平级 .prob + .cph 双盘符
- 已有样例缓存跳过；失败双写标记，测试面板提示「样例抓取失败，请手动添加用例」

## 0.17.0 — 通过 URL 导入题目

- 支持 problemset / contest / gym 三种链接格式（纯函数解析，7 格式 + 8 错误分类单测）
- 主流程：解析 → 本地查重 → 抓样例 → 生成 cpp + .prob → 登记记录 → 加载题面/翻译
- 修复：problemset 正则回溯错位、URL 大小写规范化

## 0.16.0 — 四大新模块

- **CF 登录态管理**（cfSession.ts）：有头浏览器登录 → CDP 全量 Cookie（含 httpOnly）
  存 SecretStorage → 过期检测（aec/cc/X-User-Sha1 最短 expires，兜底 30 天）→ 403 自动失效
- **CF Round 比赛**（cfContest.ts）：BEFORE/CODING 列表 + 展开题目/榜单/关注 +
  一键创建（contest_{id}_{index}.cpp + 双盘符 .prob）+ 题目中英对照翻译
- **造数据机器**（dataGen.ts）：数组/树/图（大 n 拒绝采样）/字符串/排列（mulberry32 可复现）+ 自定义脚本
- **通用对拍器**（verifier.ts）：造数据为数据源，编译缓存双跑，不一致即停并保存差异
- 提交闭环：测试工具栏「提交」→ SecretStorage 凭证 → 浏览器提交 → 轮询判定 → 记录联动

## 0.15.0 — 题面全链路调试日志 + 渲染兜底

- `[ACM][题面]` 前缀全链路日志（fetcher/panel/webview 三层）
- CDN 加载总超时 3.5s 强制简易渲染；错误可见化；空渲染显示原文前 200 字符

## 0.14.0 — 题面渲染不阻塞 CDN

- 数据到达即渲染（简易渲染先行），CDN 就绪后升级完整 marked/KaTeX 渲染
- 知识导论详情滚动回顶

## 0.13.0 — 题面不显示根因修复

- 新增父目录名解析：`Codeforces/154A/Hometask.cpp` → CF 154A
- 抓取前先发加载态；真实网络诊断确认抓取链路正常

## 0.12.0 — 删除洛谷选题 + 题面显示保障

- 删除洛谷选题（标签数字 ID 无法适配）；保留洛谷题面/样例/搜索
- 题面三级保障：加载即推送 + 磁盘缓存兜底（30 天）+ 简易渲染降级
- 记录面板新增 CF 难度分布柱状图（800-3500 分 11 档 + 未定分）

## 0.11.0 — Bug 修复（标签映射/防死循环/USACO/分页）

- 洛谷标签数字 ID → 中文映射 + 别名匹配
- 无题防死循环：前端去重（20 个已试 ID）+ 无题禁用按钮
- USACO 文件名联动：洛谷关键字搜索抓题面
- CF 历史导入分页修复：空页才停（400 题完整导入）

## 0.10.0 — Bug 修复与布局重构

- t.includes 类型错误、洛谷标签筛选失效（多页搜索不降级）
- 题面并入测试面板（同一事件源同步更新）
- 状态卡片精简为 3 个；已 AC 不可删/未开始可删；左下角仅保留连续天数

## 0.9.0 — 联动修复与面板重构

- 题面联动不依赖 .prob（文件名/目录名解析兜底）
- 恢复薄弱点推荐（纯本地计算）；洛谷算法标签筛选（37 个中文标签）
- 记录面板精简：饼图改「各标签已 AC 题数」；历史仅保留「打开题目」
- CF 历史导入分页修复（空页才停）

## 0.8.0 — 架构重构：删除 ACMOS 全屏工作台

- 删除 `src/immersive/`（layoutManager / webviewProvider）与相关命令/快捷键/激活事件
- 回归左侧工作台 + 右侧原生编辑器；启动清理遗留 globalState 键
- 新增题面与翻译面板（先排版后翻译、双语切换、按题缓存）
- 洛谷爬虫用完即关（try-finally）；记录面板重构（今日 AC / 总计 / 历史倒序）

## 0.7.0 — 体验重构

- 入口改为快捷键（Ctrl+Alt+O 进入 / Ctrl+Shift+Q 退出）与 Webview 内按钮
- 沉浸主题切换（硬边墨色，进入/退出对称 + 崩溃自愈）
- 选题面板重构、抓取性能（CF 题集磁盘缓存 12h）、画板 dpr 坐标修复
- 算法手册全量汉化（8 大分类 33 算法）

## 0.6.1 — 真机修复 + UI 打磨

- 面包屑正确配置键（`breadcrumbs.enabled`）；面板隐藏改幂等命令
- 层级式知识导论（官方命名 6 分类 25 算法，含可复制 C++ 模板 + 搜索）
- 双栏拖动分隔条、画板无限平移缩放、难度滑块增强、用例框自适应

## 0.6.0 — 重构：知识导论 / 滑块推荐 / CF 绑定 / 可视化

- 知识导论（SVG 导图）、选题双端难度滑块、薄弱点推荐
- CF 账号绑定 + AC 历史导入（分页）、近 7 天柱状图 + 专题通过率饼图（纯 CSS/SVG）

## 0.5.1 — 稳定版（彻底清理 + 致命 Bug 修复）

- 快照式退出（弃 toggle 取反，崩溃后启动自愈）、隐藏面包屑
- Webview 自定义确认弹窗（原生 confirm 不支持）
- CDN 多源回退（jsdelivr→unpkg→cdnjs→staticfile）+ UMD/AMD 加载顺序修复
- 凭证保存 ack 消除提交竞态、测试异常兜底、死代码与旧 vsix 清理
- 回归冒烟（44 项）+ E2E 全流程通过

## 0.5.0 — 沉浸式刷题 OS（SPEC 落地）

- 沉浸隔离：隐藏原生 UI 进入全屏工作台（快照恢复 + 崩溃自愈）
- Monaco 编辑器（CDN）、消息协议统一 `{command, payload}` 信封
- 沉浸内测试（编译缓存/判定/记录联动）、换一题、提交（puppeteer + SecretStorage）
- 看板（user.status 统计/近 7 天/标签频率/薄弱标签）、温习弹层

## 0.4.x 及更早（内部迭代）

- 0.4.4 及之前：基础工作台（手册/选题/生成/测试/记录/美化）持续迭代；
  0.4.x 期间完成 token 系统重写（极简设计）、连续刷题流、单用例运行、
  用例自动保存、编译缓存、路径配置化（baseDir/templatePath/dbPath）等
