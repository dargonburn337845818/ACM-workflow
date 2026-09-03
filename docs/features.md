# 功能详解（Features）

本文逐个模块说明用法与设计要点。所有交互都在左侧工作台（`Ctrl+Alt+A` 打开）完成，
前端为 Webview（`media/main.js` + `media/style.css`），后端逻辑在各 `src/features/*` 与 `src/services/*`。

## 1. 🎯 选题（pick）

**入口**：工作台「选题」视图

- **难度区间**：滑块 800~3500（Codeforces rating），点击轨道任意位置可跳转
- **算法标签**：常用标签 chips 多选 + 搜索框；可回车添加任意 CF 标签，多选语义为 **OR**，与难度区间共同过滤
- **随机推荐**：从 CF 题集中随机抽一道满足难度 + 标签条件的题
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

- 列表：即将开始（BEFORE）/ 进行中（CODING）的 Round，自动加载，含开始时间、时长、参赛人数（60s 缓存）
- 展开：题目列表（题号/名称/Rating/标签）+ 前 20 名榜单 + **我的关注**详细行
  （rank/过题/罚时 + 每题状态格：✓通过时间 / ✗被拒次数 / ·未提交）
- **关注**：点击「关注…」编辑 handle 列表（逗号分隔，自己的 cfHandle 自动加入）
- **一键创建**：生成 `Contest_{id}/contest_{id}_{index}.cpp` + 人读 .prob + CPH .cph 配置，
  随后**串行抓取每道题样例**（题间 800ms 防风控；有缓存跳过），生成即登记记录
- 每题可「翻译」：抓题面 → 中英对照快速预览（复用题面排版）

**实现**：`src/features/contest/index.ts` + `src/services/cfContest.ts`

## 4. 📖 题面与翻译（statement）

**入口**：「测试」视图 → **题面**页（跟随当前打开的题目文件联动）

- 题号解析：`.prob` 配置 → 文件名（`979E.cpp`）→ **父目录名**（`Codeforces/154A/Hometask.cpp`）
- 排版：抓取页面 → cheerio 提取 标题/限制/描述/输入输出格式/样例/提示 → 结构化 HTML
  （公式保留、图片提示、时间/内存限制栏展示；题面页不重复展示样例，样例统一在「样例」页以可编辑用例展示）
- 翻译（先排版后翻译）：按段落切分 → 公式掩码（不翻译）→ 多后端翻译（含本地 llama.cpp `hy-mt2:latest`）→
  按段落号还原，中英对照渲染（双语 / 仅译文 / 仅原文 切换）
- 术语后处理（ADR 0002）：翻译完成后用 **算法术语表** 修正常见算法术语（如 动态编程 → 动态规划、最短路径 → 最短路）
- 缓存三级保障：题目文件夹落盘（`题面.html` + `题面.zh.json`）→ 全局缓存（30 天）→ 简易渲染兜底（CDN 全挂也可读）
- 网络：curl 多策略（会话 cookie → 裸 curl → fetch）+ 强制 IPv4 + 可选代理

**实现**：`src/features/test/index.ts`（联动）、`src/services/fetchers/statement.ts`、
`src/services/statementHtml.ts`、`src/services/translate.ts`、`src/services/glossary.ts`、`src/services/statementCache.ts` / `statementFiles.ts`

## 5. 🧪 内置测试器（test）

**入口**：「测试」视图 → **样例**页（题面与样例已分成两个页面）

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
4. **开始对拍**：每轮生成随机输入 → 编译缓存双跑 → 输出比对
5. 不一致 / 超时 / 运行错误 → 立即停止，展示 输入 + 正解输出 + 暴力输出，**保存差异数据**（`duipai_diff_*.txt`）

比对方式可组装：

| 方式 | 说明 |
|---|---|
| 精确（默认） | 忽略行尾空白/首尾空行，与内置测试器一致 |
| Token | 按空白分词后顺序比较，容忍换行/多个空格差异 |
| 浮点误差 | 按 token 比较，数字用相对/绝对误差判定（默认 `1e-6`） |
| Special Judge | 选择外部 checker（`.cpp` / `.py` / `.js` / `.exe`），按 `checker input.txt expected.txt actual.txt` 调用，退出码 0 判通过 |

**实现**：`src/features/verifier/index.ts` + `src/services/verifier.ts`

## 7. 🏭 造数据机器（datagen）

**入口**：工作台「造数据」视图

造数据面板已去掉顶层“预设类型”，**统一使用组合流水线**：自己一个个添加步骤、配置参数，拼成任意输入格式。没有预设整块结构，需要什么就拼什么。

流水线中可用的步骤（全部可复现：指定 seed 或注入 RNG）：

| 类型 | 参数 | 输出 |
|---|---|---|
| 单行单数 | 值域 / 变量名 | 一个整数 + 换行（傻瓜式一行） |
| 单个（不自动换行） | 值域 / 是否换行 / 变量名 | 一个整数（进阶拼接用） |
| 一行多个数 | 个数范围 / 个数变量名 / 值域 / 分隔符 / 是否换行 | 一行整数 |
| 每行两个数 | 行数范围 / 行数变量名 / 两个值域 | `x y` 每行一组 |
| 固定文本 | 文本内容（可多行） | 原样输出 |
| 换行 | 无 | `\n` |
| 重复块 | 重复次数变量名 / 固定次数 / 子步骤 | 重复生成子步骤 N 次 |
| 随机整数数组 | n 范围 / 值域 / 排序（升序/降序/随机） | `n` + 一行数组 |
| 随机树 | n / 边权范围 | n-1 条边 |
| 随机图 | n / m / 有向/无向 / 带权 | 点边 + 边列表（大图拒绝采样防 O(n²)） |
| 随机字符串 | 长度 / 字符集（小写/大写/数字） | 一行字符串 |
| 随机排列 | n | 1..n 洗牌 |

流水线是**精确拼接**——每步生成什么就拼什么，不会自动补换行；要换行就加「换行」步骤或使用自带换行的类型。这样既能拼数组、树、图，也能拼“一行多个数 + 固定分隔符 + 单个数”这类细粒度格式，仍然不需要写脚本。

**傻瓜式常用拼法**（不用手动加空格/换行，也不用重复块）：

```text
单行单数(n)          变量名填 n
一行多个数           个数变量名填 n
单行单数(m)          变量名填 m
每行两个数           行数变量名填 m
```

这样就直接生成：

```text
n
a1 a2 ... an
m
x1 y1
x2 y2
...
xm ym
```

如果你需要更自由的“重复一个步骤块 N 次”，仍可用**重复块**：在「单个数/单行单数」步骤填变量名，重复块填该变量名作为次数，再在重复块里添加子步骤。

自定义脚本：`.js` / `.py` / `.cpp`（g++ 编译）输出到 stdout，15s 超时。

**AI 生成脚本（V0.21.2）**：造数据页顶部「AI 生成脚本」按钮，自动读取当前打开的题目 `.prob` 与题面缓存，调用本地 Spark 模型生成 Python 造数据脚本；生成后自动运行一次验证（有 stdout 才通过），通过后覆盖 `acmWorkflow.sparkScriptPath`（默认 `D:\vscode_code\code\shell\gen.py`），并自动更新/追加流水线里的「自定义脚本」步骤。Spark 空闲 3 分钟自动停止释放显存，下次点击自动拉起；不抢占本地翻译服务。

生成后只在「造数据」页预览，**不会自动写入「测试」面板/题目样例**（避免覆盖官方样例）；可另存为文件（`data_*.txt`）或手动复制。

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

## 9. 🛠 环境配置引导（setupGuide）

**入口**：命令面板 → `ACM Workflow: 环境配置引导`

- 自动检测本地翻译模型 / 服务等环境依赖是否就绪
- 缺失时询问是否安装，并提供可操作的安装命令
- 安装失败时展示具体原因，方便继续排查

**实现**：`src/services/setupGuide.ts`

## 10. 📊 刷题记录（records）

**入口**：工作台「记录」视图

- 数据：SQLite（sql.js WASM，**零原生依赖**），路径见 `dbPath`
- 自动登记：生成题目 / 打开题目 / 测试全过 / AC 状态更新
- 手动操作：未开始的题可「删除」；已 AC 不可删
- 统计：总计 / 已AC / 尝试中 / AC率 / 今日 AC / **连续刷题天数**（rail 底部）
- 图表：各标签 AC 数环形饼图 + **CF 难度分布柱状图**（800~3500 共 11 档 + 未定分）
- 搜索与筛选：题号/标题搜索、平台筛选、状态筛选（全部/已AC/未开始）
- CF 历史导入：user.status 全量分页（空页才停，页间限流）→ 批量入库（去重），保留每题首次 AC 时间

**实现**：`src/features/records/index.ts` + `src/services/records.ts` / `statistics.ts` / `fetchers/userStats/codeforces.ts`

## 11. 🖥️ 浏览器推送（companion）

安装 [Competitive Companion](https://github.com/jmerle/competitive-companion) 浏览器插件 →
插件端口设为 `27121` → 打开 Codeforces 题目页点插件 → 扩展自动创建 cpp + .prob。

**实现**：`src/services/companionServer.ts`

## 12. 🔍 工作流诊断（diagnostics）

命令面板 → `ACM Workflow: 工作流诊断`：

- 检查平台 / Node 版本 / PATH / curl / g++ / 网络连通性
- 记录最近操作轨迹，自动分析可能的问题
- 导出 Markdown + JSON 双份报告，方便提交 Issue 时附上

**实现**：`src/services/diagnostics.ts`
