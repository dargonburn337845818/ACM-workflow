# ACM Workflow

> **VSCode 中强大的 Codeforces 刷题助手** — 选题 → 题面翻译 → 生成 → 测试 → 对拍 → 提交 → 记录，全流程在编辑器内闭环。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)](https://code.visualstudio.com/)

硬边墨色设计 · 左侧工作台 + 右侧原生编辑器 · 双语题面 · 一键测试 · 中文界面

---

## ✨ 功能特性

| 模块 | 说明 |
|---|---|
| 🎯 **CF 选题** | 难度区间 800~3500 + 算法专题随机推荐；「薄弱点推荐」基于你的 AC 记录精准补弱 |
| 🔗 **URL 导入** | 粘贴 CF 题目链接（problemset / contest / gym）一键生成 cpp + 题面 + 样例 |
| 🏆 **比赛管理** | Round 列表（即将开始/进行中）、题目+Rating+标签、前 20 榜单、「我的关注」详细榜单、**一键创建整场比赛** |
| 📖 **题面与翻译** | 抓取即排版（标题/限制/公式/图片）、自动翻译为中文（MyMemory / LibreTranslate / DeepSeek 可选）、双语对照切换、离线缓存 |
| 🧪 **内置测试器** | 完全替代 CPH：样例自动写入、编辑/添加/删除用例（自动保存）、单用例运行、**运行可取消**、超时可配置、TLE/RE/WA 状态标记 |
| ⚔️ **通用对拍器** | 正解 vs 暴力循环比对，不一致立即停止并展示差异数据（可保存）；进度实时、可取消 |
| 🏭 **造数据机器** | 数组/树/图/字符串/排列（种子可复现）+ 自定义脚本（.js/.py/.cpp），生成自动填充测试框 |
| 📊 **刷题记录** | SQLite 本地库：自动登记、测试全过自动 AC、状态筛选/搜索、AC 统计、**CF 难度分布柱状图**、今日 AC + 连续天数 |
| 🔄 **连续刷题流** | 测试全过后状态栏出现「下一题 ▸」，同条件自动再推荐 |
| 🔐 **CF 登录态** | 浏览器登录 → Cookie 加密存系统密钥链（SecretStorage），带登录态抓取 + 一键提交（判定自动回写记录） |
| 🖥️ **浏览器推送** | 兼容 Competitive Companion 协议（端口 27121），浏览器点插件自动建题 |
| 🎨 **硬边墨色美化** | 一键应用/还原：活动栏沉底、单标签页、隐藏状态栏、硬边配色 |

## 🚀 快速开始（三步上手）

### ① 配置 CF Handle

`设置 → 搜索 acmWorkflow.cfHandle` 填入你的 Codeforces 账号名；
或在工作台「记录」页点击 **绑定 / 更换**（会自动拉取 AC 历史用于薄弱点推荐）。

### ② 拉取题目或导入 URL

按 `Ctrl+Alt+A` 打开工作台：

- **选题页** → 设置难度 → 「随机推荐」或「薄弱点推荐」
- **选题页底部** → 粘贴题目 URL（`https://codeforces.com/problemset/problem/1791/E`）→ 导入
- **比赛页** → 展开 Round → 「一键创建」生成整场题目

### ③ 开始刷题

生成后自动打开 cpp，样例与题面已就绪：**▶ 运行全部** → 全过自动标记 AC →
「下一题 ▸」保持节奏；需要验证正确性时切「对拍」模式；提交点「提交」按钮。

> 详细教程见 [docs/getting-started.md](docs/getting-started.md)

## 📦 安装方式

### 方式一：扩展商店（推荐）

在 VS Code 扩展商店搜索 `ACM Workflow` 安装。

### 方式二：VSIX 手动安装

1. 从 [Releases](https://github.com/dargonburn337845818/ACM-workflow/releases) 下载 `acm-workflow-<version>.vsix`
2. VS Code 扩展面板 → `...` → **从 VSIX 安装...** → 选择文件
3. 安装后按 `Ctrl+Alt+A` 打开工作台（首次安装会自动弹出三步入门指引）

> 每次推送 `vX.Y.Z` tag 到 `main`，GitHub Actions 会自动构建 VSIX 并发布到 Releases。

### 方式三：源码运行（开发模式）

```bash
git clone https://github.com/dargonburn337845818/ACM-workflow.git
cd ACM-workflow
npm install --include=dev   # NODE_ENV=production 环境下必须加 --include=dev
npm run compile
# 按 F5 启动 Extension Development Host
```

### WSL 用户

如果你通过 VS Code 的 WSL 插件在 WSL 里使用/开发本扩展，先准备 WSL 环境：

```bash
bash tools/setup_wsl.sh                  # g++ / curl / python3 / 浏览器
bash tools/setup_wsl.sh --with-translate # 需要本地离线翻译时
```

WSL 下如果不想在 Linux 里装浏览器，可以直接复用 Windows 的 Edge/Chrome，在设置里填写：

```jsonc
{
  "acmWorkflow.browserPath": "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
}
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
| `acmWorkflow.localEndpoint` | `http://127.0.0.1:5000/translate` | 本地离线翻译端点（配合 `tools/` 脚本） |
| `acmWorkflow.localAutoStart` | `true` | `local` 后端未启动时，扩展自动拉起本地服务 |
| `acmWorkflow.browserPath` | `""`（自动探测） | Puppeteer 浏览器路径；WSL 可填 `/usr/bin/chromium` 或 `/mnt/c/...` 的 Windows 浏览器 |
| `acmWorkflow.followHandles` | `[]` | 比赛「我的关注」额外 Handle（自己的自动包含） |
| `acmWorkflow.proxy` | `""` | CF 网络代理（扩展请求不跟随系统代理，需代理时填写） |

完整说明见 [docs/configuration.md](docs/configuration.md)

## ⌨️ 快捷键

| 快捷键 | 命令 |
|---|---|
| `Ctrl+Alt+A`（Mac `Cmd+Alt+A`） | 打开 ACM Workflow 工作台 |

其余功能在工作台内点击即可；命令面板输入 `ACM Workflow` 可查看全部命令：

`打开工作台` · `随机选题` · `重新获取测试数据` · `批量补充测试数据` · `环境诊断` · `应用硬边墨色美化` · `还原美化`

## ❓ 常见问题（FAQ）

- **题面空白 / 抓取失败？** 运行命令 `ACM Workflow: 环境诊断` 查看网络与工具链状态；题面有 30 天磁盘缓存，断网也可读缓存。
- **编译失败？** 需要 g++。Windows 装 [MinGW-w64](https://www.mingw-w64.org/) 或 MSYS2，Linux/macOS 装 gcc；WSL 可运行 `bash tools/setup_wsl.sh`；扩展自动探测 PATH 与常见安装位置。
- **WSL 里打不开浏览器？** 先运行 `bash tools/setup_wsl.sh` 安装 Chromium，或在设置里把 `acmWorkflow.browserPath` 指向 Windows 侧 Edge/Chrome（`/mnt/c/...`）。
- **CF 访问慢？** 扩展请求不跟随系统代理：有代理请配置 `acmWorkflow.proxy`；无代理时扩展已强制 IPv4 直连（规避 IPv6 半通问题）。
- **洛谷题目？** 支持洛谷题面/样例抓取与历史记录（浏览器直连 + 缓存兜底）；选题专注 Codeforces。
- **隐私？** 账号密码/Cookie/DeepSeek Key 全部存系统密钥链（`vscode.SecretStorage`），不写入任何配置文件与代码仓库。

更多见 [docs/troubleshooting.md](docs/troubleshooting.md)

## 📁 项目结构

```
src/
├── extension.ts              # 入口：仅激活 + 命令注册
├── core/
│   └── workbench.ts          # 工作台宿主：WebviewView、消息路由、联动状态
├── features/                 # 功能模块（每模块一个目录，自注册消息处理器）
│   ├── pick/                 #   CF 选题 + 薄弱点推荐
│   ├── urlImport/            #   URL 导入题目
│   ├── contest/              #   比赛管理 + 一键创建
│   ├── test/                 #   内置测试器 + 题面/翻译联动
│   ├── verifier/             #   通用对拍器
│   ├── datagen/              #   造数据机器
│   ├── session/              #   CF 登录态
│   ├── submit/               #   一键提交
│   ├── records/              #   刷题记录 + 历史导入
│   └── manual/               #   知识导论（算法手册）
├── services/                 # 通用服务
│   ├── fetchers/             #   codeforces / luogu / statement / userStats
│   ├── runner.ts             #   编译（缓存）/ 运行 / 比对 / 环境诊断
│   ├── template.ts           #   生成 cpp + .prob（CPH 兼容双盘符）
│   ├── cfSession.ts          #   CF 会话（SecretStorage）
│   ├── cfContest.ts          #   比赛 API + 榜单提取
│   ├── translate.ts          #   题面翻译（多后端）
│   ├── statementHtml.ts      #   题面 HTML 排版
│   ├── dataGen.ts / verifier.ts / submitter.ts / records.ts ...
│   └── companionServer.ts    #   Competitive Companion 接收服务
├── types/                    # 统一类型定义
└── utils/
    └── paths.ts              # 路径解析（配置化，跨平台默认）
tools/                        # WSL 环境脚本 + 本地离线翻译：安装脚本 + 极简 Argos HTTP 服务
media/                        # 工作台前端（main.js / style.css / icon / walkthrough）
tests/smoke.js                # 冒烟测试（无 VS Code 环境可跑）
docs/                         # 完整文档
```

## 🛠 技术栈

TypeScript · VS Code Extension API（WebviewView）· Node.js · puppeteer-core · cheerio · undici · sql.js（WASM SQLite，零原生依赖）

## 🤝 贡献指南

欢迎任何形式的贡献：Issue、PR、功能建议、文档改进。

1. Fork 本仓库并克隆
2. `npm install --include=dev && npm run compile`
3. 按 F5 启动开发宿主验证改动
4. 提交前确保：`npm run lint`（零错误）`npm run test`（冒烟全过）
5. 发起 Pull Request（说明改动与验证结果）

详细规范见 [docs/features.md](docs/features.md) 与 [docs/changelog.md](docs/changelog.md)

## 📜 开源协议

[MIT](LICENSE) © 2026 deepseekharness and contributors

---

*English: ACM Workflow is a powerful Codeforces problem-solving assistant for VSCode — problem picking, statement translation, one-click testing, stress-testing (duipai), test data generation, contest management and solving records, all inside your editor.*
