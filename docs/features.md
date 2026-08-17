# 功能详解（Features）

本文逐个模块说明用法与设计要点。所有交互都在左侧工作台（`Ctrl+Alt+A` 打开）完成，
前端为 Webview（`media/main.js` + `media/style.css`），后端逻辑在各 `src/features/*` 与 `src/services/*`。

## 1. 🎯 选题（pick）

**入口**：工作台「选题」视图

- **难度区间**：滑块 800~3500（Codeforces rating），点击轨道任意位置可跳转
- **随机推荐**：从 CF 题集中随机抽一道区间内的题
- **薄弱点推荐**：基于本地 AC 记录 × 题集标签，计算每个标签的提交/通过率，
  从通过率最低的 2~3 个专题中随机抽**未 AC** 的题 —— 精准补弱
- **换一题**：排除已推荐的题目（前端维护最多 20 个已试 ID），避免重复
- 点「生成 cpp 并测试」→ 自动抓取样例、创建文件、登记记录、打开编辑器

**实现**：`src/features/pick/index.ts` + `src/services/fetchers/codeforces.ts`（题集 API + 12h 磁盘缓存）

## 2. 🔗 URL 导入（urlImport）

**入口**：「选题」视图底部输入框

支持三种 CF 链接格式：

```
https://codeforces.com/problemset/problem/1791/E   # problemset
https://codeforces.com/contest/1791/problem/E       # contest
https://codeforces.com/gym/104053/problem/A         # gym
```

- 兼容尾随斜杠 / query / hash / 大小写；题号规范化大写（`f2` → `F2`）
- 流程：解析 → 本地查重（已存在直接打开）→ 抓样例 → 生成 cpp + .prob → 登记记录 → 加载题面
- 解析失败会给出分类错误（非 CF 域名 / 格式无法识别 / 非法题号 / 空链接）

**实现**：`src/features/urlImport/index.ts` + `src/services/cfUrl.ts`（纯函数，可单测）

## 3. 🏆 比赛管理（contest）

**入口**：工作台「CF 比赛」视图

- 列表：即将开始（BEFORE）/ 进行中（CODING）的 Round，含开始时间、时长、参赛人数（60s 缓存）
- 展开：题目列表（题号/名称/Rating/标签）+ 前 20 名榜单 + **我的关注**详细行
  （rank/过题/罚时 + 每题状态格：✓通过时间 / ✗被拒次数 / ·未提交）
- **关注**：点击「关注…」编辑 handle 列表（逗号分隔，自己的 cfHandle 自动加入）
- **一键创建**：生成 `Contest_{id}/contest_{id}_{index}.cpp` + 人读 .prob + CPH .cph 双盘符配置，
  随后**串行抓取每道题样例**（题间 800ms 防风控；有缓存跳过），生成即登记记录
- 每题可「翻译」：抓题面 → 中英对照快速预览（复用题面排版）

**实现**：`src/features/contest/index.ts` + `src/services/cfContest.ts`

## 4. 📖 题面与翻译（statement）

**入口**：「测试」视图顶部（跟随当前打开的题目文件联动）

- 题号解析：`.prob` 配置 → 文件名（`979E.cpp`）→ **父目录名**（`Codeforces/154A/Hometask.cpp`）→ USACO 洛谷关键字搜索
- 排版：抓取页面 → cheerio 提取 标题/限制/描述/输入输出格式/样例/提示 → 结构化 HTML
  （公式保留、图片提示、时间/内存限制栏展示）
- 翻译（先排版后翻译）：按段落切分 → 公式掩码（不翻译）→ 多后端翻译 →
  按段落号还原，中英对照渲染（双语 / 仅译文 / 仅原文 切换）
- 缓存三级保障：题目文件夹落盘（`题面.html` + `题面.zh.json`）→ 全局缓存（30 天）→ 简易渲染兜底（CDN 全挂也可读）
- 网络：curl 多策略（会话 cookie → 裸 curl → fetch）+ 强制 IPv4 + 可选代理

**实现**：`src/features/test/index.ts`（联动）、`src/services/fetchers/statement.ts`、
`src/services/statementHtml.ts`、`src/services/translate.ts`、`src/services/statementCache.ts` / `statementFiles.ts`

## 5. 🧪 内置测试器（test）

**入口**：「测试」视图

- 用例编辑：添加/删除用例，输入/期望输出并排，**编辑自动保存**（800ms 防抖写回 .prob）
- **运行全部**：保存当前用例 → 编译（**同源码缓存编译结果**，重复运行不重编译）→ 逐用例运行
- 结果：通过 / 失败 / 超时（红色）/ 运行错误（退出码 + stderr），单用例耗时
- 超时：默认 5s（`testTimeoutMs`），解析到题面时间限制时自动用「题面限制 + 1s」
- 运行中可**取消**（取消信号）
- 记录联动：完整跑完一轮 → 全过 AC / 否则 trying，attempts+1；全过后状态栏出现「下一题 ▸」

**实现**：`src/features/test/index.ts` + `src/services/runner.ts`

## 6. ⚔️ 通用对拍器（verifier）

**入口**：「测试」视图 → 切换「对拍」模式

1. 正解文件（默认当前编辑器文件）+ 暴力文件（浏览选择或手填）
2. 最大组数（默认 1000）
3. 数据源 = 「造数据」面板当前设置（类型/范围/种子）
4. **开始对拍**：每轮生成随机输入 → 编译缓存双跑 → 输出比对（同测试器空白规则）
5. 不一致 / 超时 / 运行错误 → 立即停止，展示 输入 + 正解输出 + 暴力输出，**保存差异数据**（`duipai_diff_*.txt`）

**实现**：`src/features/verifier/index.ts` + `src/services/verifier.ts`

## 7. 🏭 造数据机器（datagen）

**入口**：工作台「造数据」视图

内置生成器（全部可复现：指定 seed 或注入 RNG）：

| 类型 | 参数 | 输出 |
|---|---|---|
| 随机整数数组 | n 范围 / 值域 / 排序（升序/降序/随机） | `n` + 一行数组 |
| 随机树 | n / 边权范围 | n-1 条边 |
| 随机图 | n / m / 有向/无向 / 带权 | 点边 + 边列表（大图拒绝采样防 O(n²)） |
| 随机字符串 | 长度 / 字符集（小写/大写/数字） | 一行字符串 |
| 随机排列 | n | 1..n 洗牌 |

自定义脚本：`.js` / `.py` / `.cpp`（g++ 编译）输出到 stdout，15s 超时。

生成后自动填充「测试」面板输入框 + 预览 + 可保存为文件（`data_*.txt`）。

**实现**：`src/features/datagen/index.ts` + `src/services/dataGen.ts`（mulberry32 种子）

## 8. 🔐 CF 登录态（session）

**入口**：工作台顶部状态条（未登录/已登录/已过期 三态）

- 登录：启动系统浏览器打开 CF 登录页，**用户手动输入账号密码**（扩展不触碰密码）
  → 检测到会话 Cookie（X-User-Sha1）即成功 → CDP 全量提取 Cookie（含 httpOnly）+ localStorage
  → 加密存 SecretStorage（键 `cf.session`）
- 过期检测：三个会话 Cookie 的最短 expires（兜底 30 天）；API 403 自动判失效清除
- 使用：所有 CF API 请求自动附加会话 Cookie；登录态同时写入 curl cookie jar，页面/样例抓取带真实登录态
- 登录成功自动回填 `acmWorkflow.cfHandle` 配置

**实现**：`src/features/session/index.ts` + `src/services/cfSession.ts`

## 9. 🚀 一键提交（submit）

**入口**：测试工具栏「提交」按钮

1. 定位题目（.prob → 文件名兜底）
2. 凭证：SecretStorage（`acmWorkflow.cfHandle` / `cfPassword`），首次 showInputBox 收集（密码掩码）
3. 有头浏览器打开提交页 → 选 G++20 → 填码提交 → 轮询判定（≤90s）
4. 判定 OK → 记录 AC；其余 → trying（attempts+1）；提交中按钮禁用防重复

> 浏览器会真实打开 CF 页面（依赖系统 Chrome/Edge），这是 CF 无官方提交 API 下的稳妥方案。

**实现**：`src/features/submit/index.ts` + `src/services/submitter.ts`

## 10. 📊 刷题记录（records）

**入口**：工作台「记录」视图

- 数据：SQLite（sql.js WASM，**零原生依赖**），路径见 `dbPath`
- 自动登记：生成题目 / 打开题目 / 测试全过 / 提交判定
- 手动操作：未开始的题可「删除」；已 AC 不可删
- 统计：总计 / 已AC / 尝试中 / AC率 / 今日 AC / **连续刷题天数**（rail 底部）
- 图表：各标签 AC 数环形饼图 + **CF 难度分布柱状图**（800~3500 共 11 档 + 未定分）
- 搜索与筛选：题号/标题搜索、平台筛选、状态筛选（全部/已AC/未开始）
- CF 历史导入：user.status 全量分页（空页才停，页间限流）→ 批量入库（去重），保留每题首次 AC 时间

**实现**：`src/features/records/index.ts` + `src/services/records.ts` / `statistics.ts` / `fetchers/userStats/codeforces.ts`

## 11. 📘 知识导论（manual）

**入口**：工作台第一个视图（书图标）

- 层级结构：8 大中文分类（基础算法/数据结构/图论/动态规划/字符串/数论/计算几何/其他）
  → 二级细分 → 47 个算法节点
- 每个算法：一句话简介 + 时间复杂度 + **可直接复制的 C++17 精简模板**（复制按钮）
- 顶部搜索框：英文名 + 中文别名即时过滤

**实现**：`src/features/manual/knowledgeMap.ts`（纯数据）+ 工作台渲染

## 12. 🖥️ 浏览器推送（companion）

安装 [Competitive Companion](https://github.com/jmerle/competitive-companion) 浏览器插件 →
插件端口设为 `27121` → 打开题目页点插件 → 扩展自动创建 cpp + .prob（洛谷反爬兜底方案）。

**实现**：`src/services/companionServer.ts`

## 13. 🎨 硬边墨色美化（beautify）

命令面板 → `ACM Workflow: 应用硬边墨色美化`：

- 活动栏沉底、单标签页、隐藏状态栏、面包屑
- 硬边墨色配色注入（自动备份原设置，`还原美化` 一键恢复）
- 浅色主题下应用前会提示切换深色主题

**实现**：`src/services/beautify.ts`
