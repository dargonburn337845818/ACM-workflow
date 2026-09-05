# ACM Workflow

> **VSCode 中的 Codeforces 刷题工作台** — 在编辑器内完成选题 → 题面翻译 → 生成 → 测试 → 对拍 → 造数据 → 比赛 → 记录；同时支持玻璃拟态工作台，可联动 [VSCode Background](https://github.com/caoge5524/vscode-background) 背景插件把壁纸设为全局背景。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)](https://code.visualstudio.com/)

硬边墨色设计 · 左侧工作台 + 右侧原生编辑器 · 双语题面 · 运行测试 · 中文界面

---

## ✨ 功能特性

### 🎯 CF 选题

- 难度区间 **800~3500**，按 Codeforces Rating 滑动选择
- **算法标签多选**：常用标签 chips + 搜索框，可回车添加任意 CF 标签；命中任一标签即可（OR），与难度区间共同过滤
- **随机推荐**：从 CF 题集中抽取满足难度 + 标签条件的题目，换一题自动排除已推荐
- **薄弱点推荐**：基于本地 AC 记录 × 题集标签，从通过率最低的 2~3 个专题中抽**未 AC** 的题，按提交通过率补齐薄弱专题
- 生成后自动创建 cpp、抓取样例、登记记录并打开编辑器

### 🔗 URL 导入

支持 `problemset` / `contest` / `gym` 三类 Codeforces 链接：

```
https://codeforces.com/problemset/problem/1791/E
https://codeforces.com/contest/1791/problem/E
https://codeforces.com/gym/104053/problem/A
```

- 兼容尾随斜杠、query、hash、大小写
- 已存在的题目直接打开，不重复生成
- 解析失败给出分类错误提示（非 CF 域名 / 格式无法识别 / 非法题号）

### 🏆 比赛管理

- Round 列表：即将开始 / 进行中，自动加载并显示开始时间、时长、参赛人数
- 展开查看题目列表（题号 / 名称 / Rating / 标签）与 **前 20 榜单**
- **我的关注**：额外关注 Handle，查看 rank / 过题 / 罚时与每题状态
- **一次命令创建整场比赛**：生成 `Contest_{id}/contest_{id}_{字母}.cpp` + `.prob`，自动抓取样例

### 📖 题面与翻译

- 抓取即排版：标题、限制、公式、图片、输入输出格式、样例、提示
- 自动翻译为中文，支持 **MyMemory / LibreTranslate / DeepSeek / 本地 llama.cpp hy-mt2:latest** 多后端
- 中英对照渲染，可切换 双语 / 仅译文 / 仅原文
- 三级缓存保障：题目文件夹落盘 → 30 天全局缓存 → 简易渲染兜底，断网也能读

### 🧪 内置测试器

- 题面与样例分成两个页面：**题面**页专注阅读 / 翻译，**样例**页专注编辑 / 运行
- 完全替代 CPH：样例自动写入，编辑 / 添加 / 删除用例自动保存
- **运行全部**：自动编译（带缓存）→ 逐用例运行 → 通过 / 失败 / 超时 / 运行错误标记
- 运行可**取消**；超时可配置，有题面时限时自动采用「题面限制 + 1s」
- 全过自动标记 **已AC** 并登记刷题记录

### ⚔️ 通用对拍器

- 正解 vs 暴力循环比对，不一致立即停止
- 可组装比对方式：精确 / Token / 浮点误差 / Special Judge（外部 checker）
- 展示差异：输入 / 正解输出 / 暴力输出，可保存差异数据
- 进度实时显示，可随时取消
- 数据源直接使用「造数据」面板的当前配置

### 🏭 造数据机器

- 只有流水线拼装：没有预设整块结构，自己一个个添加步骤，每一步保存各自参数
- 流水线步骤：单行单数 / 单个数 / 一行多个数 / 每行两个数 / 固定文本 / 换行 / 重复块 / 数组 / 树 / 图 / 字符串 / 排列，种子可复现
- 拼装方式：单行单数绑定变量，一行多个数/每行两个数直接引用变量当数量，不用手动拼空格和换行
- 变量联动：单行单数可绑定变量名，供后续数量/重复块引用
- 支持自定义脚本：`.js` / `.py` / `.cpp`，生成结果只在造数据页预览，不自动覆盖测试样例
- **按样例生成**：`按样例生成` 按钮不调用 LLM；直接根据官方样例的输入行数/token 结构生成随机化 Python 脚本，毫秒级完成，保存到当前题目 `gen.py` 并自动插入造数据流水线
- 生成后可预览、保存为 `data_*.txt`

### 📊 刷题记录

- SQLite 本地库（sql.js WASM，零原生依赖），数据完全在本地
- 自动登记：生成题目 / 打开题目 / 测试全过 / AC 状态更新
- 统计：总计 / 已AC / 尝试中 / AC率 / 今日 AC / **连续刷题天数**
- 图表：标签 AC 环形饼图 + **CF 难度分布柱状图**（800~3500 共 11 档）
- 支持搜索、筛选、删除未开始题目与 CF 历史导入

### 🔄 连续刷题流

测试全过后状态栏出现 **「下一题 ▸」**，同一条件自动再推荐，保持刷题节奏。

### 🔐 CF 登录态

- 浏览器登录 → Cookie 加密存系统密钥链（SecretStorage），约 30 天有效
- 登录态自动附加到 CF API、页面与样例抓取，抓取更稳定
- 登录成功自动回填 `acmWorkflow.cfHandle`

### 🖥️ 浏览器推送

兼容 **Competitive Companion** 协议（端口 27121），浏览器插件推题后自动建题。

### 🛠 环境配置引导

新增 `ACM Workflow: 环境配置引导` 命令，自动检测本地翻译模型 / 服务等环境依赖；缺失时询问是否安装，失败时展示具体原因。

### 🔍 工作流诊断

运行 `ACM Workflow: 工作流诊断` 可检查网络、工具链、操作轨迹并输出 Markdown + JSON 报告，方便定位问题。

### 📦 独立知识阶梯

知识导论已拆分为独立本地小程序，源码位于 `knowledge-ladder/`，支持 8 档难度阶梯、知识点勾选进度、C++ 模板详情，可在 Windows 上打包为便携 exe。插件内不再内置该模块。

### 🎨 硬边墨色美化

命令 `ACM Workflow: 应用硬边墨色美化` 可用一条命令应用/还原：活动栏沉底、单标签页、隐藏状态栏、实色深色配色。

### 📰 主题

扩展自带两套全局 VSCode 颜色主题：

- **Parallax Editorial（视差杂志风）**：暖纸、墨黑、砖红、衬线。
- **Nocturne Glassmorphism（夜航玻璃拟态）**：深墨夜景、无色玻璃面板、香槟金强调，覆盖编辑器、活动栏、侧边栏、状态栏、终端与工作台 WebView。

安装后可在 `颜色主题` 中选择使用。

### 🖼 玻璃拟态背景图

工作台支持可选背景图：

```text
设置 → acmWorkflow.glassBackground
```

填入 wallpaper 图库直链（建议 https）后，工作台玻璃面板会透出背景；留空则使用内置深夜景光源，正常显示。

工作台壁纸栏中的 **「设为全局背景」** 会把当前壁纸写入联动插件 [VSCode Background](https://github.com/caoge5524/vscode-background) 的配置，让整个 VSCode（编辑器、侧边栏、状态栏等）都使用同一张壁纸。

> 联动插件 GitHub：<https://github.com/caoge5524/vscode-background>
>
> 安装该插件后，在 ACM Workflow 工作台选择壁纸 → 点击「设为全局背景」→ 按提示重启 VSCode 即可。

---

## 🚀 快速开始（三步上手）

### ① 配置 CF Handle

`设置 → 搜索 acmWorkflow.cfHandle` 填入你的 Codeforces 账号名；
或在工作台「记录」页点击 **绑定 / 更换**（会自动拉取 AC 历史用于薄弱点推荐）。

### ② 拉取题目或导入 URL

按 `Ctrl+Alt+A` 打开工作台：

- **选题页** → 设置难度 → 「随机推荐」或「薄弱点推荐」
- **选题页底部** → 粘贴题目 URL（`https://codeforces.com/problemset/problem/1791/E`）→ 导入
- **比赛页** → 展开 Round → 「创建整场比赛」生成整场题目

### ③ 开始刷题

生成后自动打开 cpp，样例与题面已就绪：**▶ 运行全部** → 全过自动标记 AC →
「下一题 ▸」保持节奏；需要验证正确性时切「对拍」模式。

> 详细教程见 [docs/getting-started.md](docs/getting-started.md)

## 📦 安装方式

### 方式一：VSIX 手动安装

1. 从 [Releases](https://github.com/dargonburn337845818/ACM-workflow/releases) 下载 `acm-workflow-<version>.vsix`
2. VS Code 扩展面板 → `...` → **从 VSIX 安装...** → 选择文件
3. 安装后按 `Ctrl+Alt+A` 打开工作台（首次安装会自动弹出三步入门指引）

> 每次推送 `vX.Y.Z` tag 到 `main`，GitHub Actions 会自动构建 **VSIX + Knowledge Ladder APK** 并发布到 Releases。

### 方式二：源码运行（开发模式）

```bash
git clone https://github.com/dargonburn337845818/ACM-workflow.git
cd ACM-workflow
npm install --include=dev   # NODE_ENV=production 环境下必须加 --include=dev
npm run compile
# 按 F5 启动 Extension Development Host
```

## ⚙️ 配置项

| 配置 | 默认值 | 说明 |
|---|---|---|
| `acmWorkflow.baseDir` | `""` → `~/.acm-workflow` | 数据根目录：题目生成到 `{baseDir}/code/{平台}/{题号}/` |
| `acmWorkflow.templatePath` | `""`（内置模板） | 生成题目的 cpp 模板路径 |
| `acmWorkflow.dbPath` | `""` → `{baseDir}/records.db` | 刷题记录 SQLite 路径 |
| `acmWorkflow.cfHandle` | `""` | Codeforces Handle（看板统计/薄弱点推荐/关注榜单） |
| `acmWorkflow.testTimeoutMs` | `5000` | 单用例运行超时（毫秒），有题面时间限制时自动用题面值+1s |
| `acmWorkflow.companionPort` | `27121` | competitive-companion 接收端口 |
| `acmWorkflow.translateProvider` | `auto` | 翻译后端：`auto` / `libre` / `local` / `deepseek`（DeepSeek 密钥存系统密钥链） |
| `acmWorkflow.libreEndpoint` | LibreTranslate 官方 | 自建 LibreTranslate 实例端点 |
| `acmWorkflow.localEndpoint` | `http://127.0.0.1:11434` | 本地翻译端点（默认直接使用 llama.cpp `hy-mt2:latest`） |
| `acmWorkflow.localAutoStart` | `true` | `local` 后端未启动时，扩展自动拉起 Windows 侧 `D:\llama\llama-server.exe` |
| `acmWorkflow.llamaDir` | `D:\llama` | llama.cpp 目录（含 llama-server.exe 与 GGUF） |
| `acmWorkflow.llamaModel` | `Hy-MT2-1.8B-Q6_K.gguf` | 本地翻译 GGUF 模型文件名 |
| `acmWorkflow.llamaThreads` | `4` | llama-server CPU 线程数（默认低消耗） |
| `acmWorkflow.sparkEndpoint` | `http://127.0.0.1:8080` | Spark 本地模型端点（llama.cpp OpenAI 兼容接口） |
| `acmWorkflow.sparkServerPath` | `D:\llama-spark\build\bin\llama-server.exe` | Spark 使用的 llama-server.exe（CUDA DLL 同目录） |
| `acmWorkflow.sparkModelPath` | `D:\llama\Spark-X2.5-4B-Q8_0\Spark-X2.5-4B-Q8_0.gguf` | Spark GGUF 模型文件 |
| `acmWorkflow.sparkModelName` | `spark:latest` | Spark 在 llama-server 中的模型别名 |
| `acmWorkflow.sparkAutoStart` | `true` | 规则模板未覆盖输入格式时自动拉起本地 4B 模型；简单格式不启动模型 |
| `acmWorkflow.sparkIdleTimeoutMs` | `180000` | Spark 空闲自动停止毫秒数（3 分钟，0=不自动停止） |
| `acmWorkflow.sparkCtxSize` | `8192` | Spark 上下文长度（轻量默认，非 131K） |
| `acmWorkflow.sparkThreads` | `8` | Spark CPU 线程数（轻量默认） |
| `acmWorkflow.sparkGpuLayers` | `0` | Spark GPU 层数（默认 CPU 轻量运行） |
| `acmWorkflow.sparkScriptPath` | `""` → 当前题目目录 `gen.py` | AI 生成的 Python 造数据脚本保存路径；留空时按题目隔离，避免互相覆盖 |
| `acmWorkflow.browserPath` | `""`（自动探测） | Puppeteer 浏览器路径；留空自动探测 Edge/Chrome/Chromium |
| `acmWorkflow.followHandles` | `[]` | 比赛「我的关注」额外 Handle（自己的自动包含） |
| `acmWorkflow.proxy` | `""` | CF 网络代理（扩展请求不跟随系统代理，需代理时填写） |

完整说明见 [docs/configuration.md](docs/configuration.md)

## ⌨️ 快捷键

| 快捷键 | 命令 |
|---|---|
| `Ctrl+Alt+A`（Mac `Cmd+Alt+A`） | 打开 ACM Workflow 工作台 |

其余功能在工作台内点击即可；命令面板输入 `ACM Workflow` 可查看全部命令：

`打开工作台` · `随机选题` · `重新获取测试数据` · `批量补充测试数据` · `环境配置引导` · `工作流诊断` · `应用硬边墨色美化` · `还原美化`

## 🔐 隐私与安全

- **密钥不进仓库**：CF Cookie、DeepSeek API Key 等敏感信息只存 `vscode.SecretStorage`（Windows 凭据管理器 / macOS 钥匙串 / Linux libsecret），不会写入 `settings.json`、日志或 Git。
- **数据默认留在本机**：题目、记录、缓存默认在 `~/.acm-workflow/`；上传/推送不包含这些运行时数据。
- **诊断报告脱敏**：诊断命令会自动隐藏主目录、邮箱与疑似密钥后再输出报告。
- **日志与本地产物**：`*.db`、`*.log`、`cache/`、`node_modules/`、`out/`、`dist/` 等已加入 `.gitignore`，不会被提交。
- **本地路径可配置**：工具脚本中的 `D:\...` 只是作者本机示例路径，公开使用前请在 VS Code 设置中改成自己的路径；`sparkScriptPath` 默认按题目目录保存，不再依赖个人盘符。

## ❓ 常见问题（FAQ）

- **题面空白 / 抓取失败？** 运行命令 `ACM Workflow: 工作流诊断` 查看网络、工具链、操作轨迹与发现的问题；题面有 30 天磁盘缓存，断网也可读缓存。
- **编译失败？** 需要 g++。Windows 装 [MinGW-w64](https://www.mingw-w64.org/) 或 MSYS2，Linux/macOS 装 gcc；扩展自动探测 PATH 与常见安装位置。
- **CF 访问慢？** 扩展请求不跟随系统代理：有代理请配置 `acmWorkflow.proxy`；无代理时扩展已强制 IPv4 直连（规避 IPv6 半通问题）。
- **隐私？** 账号密码/Cookie/DeepSeek Key 全部存系统密钥链（`vscode.SecretStorage`），不写入任何配置文件与代码仓库。

更多见 [docs/troubleshooting.md](docs/troubleshooting.md)

## 📁 项目结构

```
src/
├── extension.ts              # 入口：激活 + 命令注册
├── core/
│   ├── workbench.ts          # 工作台宿主：WebviewView、消息路由、联动状态
│   └── workbenchHtml.ts      # Webview HTML 模板
├── features/                 # 功能模块（每模块一个目录，自注册消息处理器）
│   ├── pick/                 #   CF 选题 + 薄弱点推荐
│   ├── urlImport/            #   URL 导入题目
│   ├── contest/              #   比赛管理 + 创建整场比赛
│   ├── test/                 #   内置测试器 + 题面/翻译联动
│   ├── verifier/             #   通用对拍器
│   ├── datagen/              #   造数据机器
│   ├── session/              #   CF 登录态
│   └── records/              #   刷题记录 + 历史导入
├── services/                 # 通用服务（深模块优先，跨模块走 index.ts 组合根）
│   ├── fetchers/             #   codeforces / statement / userStats
│   ├── judgeService.ts       #   编译/运行/判定/环境探测
│   ├── runner.ts             #   编译缓存与子进程运行
│   ├── dataGen.ts            #   造数据生成器（纯函数 + 脚本子进程）
│   ├── verifier.ts           #   对拍执行
│   ├── records.ts            #   记录/统计/历史导入
│   ├── dashboard.ts          #   记录面板展示数据组合
│   ├── diagnostics.ts        #   工作流诊断：轨迹 / 网络 / 异常分析 / 报告
│   ├── template.ts           #   生成 cpp + .prob（CPH 兼容）
│   ├── cfSession.ts          #   CF 会话（SecretStorage）
│   ├── cfContest.ts          #   比赛 API + 榜单提取
│   ├── translate.ts          #   题面翻译（多后端）
│   ├── statementHtml.ts      #   题面 HTML 排版
│   ├── statementCache.ts     #   题面三级缓存
│   ├── companionServer.ts    #   Competitive Companion 接收服务
│   ├── spark.ts              #   本地 4B 造数据脚本生成
│   └── sparkLifecycle.ts     #   Spark 服务器生命周期
├── types/                    # 统一类型定义
└── utils/
    ├── paths.ts              # 路径解析（配置化，跨平台默认）
    └── wsl.ts                # WSL 环境探测
tools/                        # 本地翻译：llama.cpp 启动/检查脚本 + HTTP 服务
media/                        # 工作台前端（main.js / style.css / icon / walkthrough）
themes/                       # 两套 VS Code 颜色主题
tests/                        # 无 VS Code 环境可跑的冒烟测试
docs/                         # 用户与研发文档
```

## 🧱 仓库结构（monorepo）

- `src/` + `media/`：VS Code 扩展主体。
- `knowledge-ladder/`：独立 Python 知识阶梯子项目（桌面端 + 移动端 PWA）。其生成产物（`mobile/www/data.js`、`reports/`）已由 `.gitignore` 排除，CI 中自动重新生成。
- `.github/workflows/`：根目录统一 Actions（扩展 CI/APK/Release/安全扫描）。`knowledge-ladder` 子目录不维护自己的 `.github`，避免“看起来会执行”的误判。
- `CODE_OF_CONDUCT.md` / `CONTRIBUTING.md` / `SECURITY.md`：社区协作、贡献与安全上报约定。

## 🛠 技术栈

TypeScript · VS Code Extension API（WebviewView）· Node.js · puppeteer-core · cheerio · undici · sql.js（WASM SQLite，零原生依赖）

## 🤝 贡献指南

欢迎任何形式的贡献：Issue、PR、功能建议、文档改进。

1. Fork 本仓库并克隆
2. `npm install --include=dev && npm run compile`
3. 按 F5 启动开发宿主验证改动
4. 提交前确保：`npm run lint`（零错误）`npm run test`（冒烟全过）
5. 发起 Pull Request（说明改动与验证结果）

完整流程与开发建议见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)；
功能详解见 [docs/features.md](docs/features.md)，变更记录见 [docs/changelog.md](docs/changelog.md)。
社区行为约定见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，安全与隐私见 [SECURITY.md](SECURITY.md)。

## 📜 开源协议

[MIT](LICENSE) © 2026 deepseekharness and contributors

---

*English: ACM Workflow is a VS Code extension for Codeforces problem solving: problem picking, statement translation, testing, stress-testing (duipai), data generation, contest management, and progress records inside the editor.*
