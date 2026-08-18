# 快速开始（Getting Started）

本教程带你 5 分钟内从零开始用 ACM Workflow 刷第一道 Codeforces 题。

## 0. 前置条件

| 项目 | 要求 | 说明 |
|---|---|---|
| VS Code | ≥ 1.85 | 任意平台（Windows / macOS / Linux / WSL） |
| C++ 编译器 | g++（可选但强烈建议） | Windows: MinGW-w64 / MSYS2；macOS: `xcode-select --install`；Linux/WSL: `sudo apt install g++` 或 `bash tools/setup_wsl.sh`。扩展会自动探测 PATH 与常见安装位置 |
| 浏览器（可选） | Chrome / Edge / Chromium | 用于 CF 登录、提交；WSL 可装 Chromium 或配置 `acmWorkflow.browserPath` 指向 Windows 浏览器 |
| 网络 | 可访问 codeforces.com | 国内网络一般直连可用；慢的话见 troubleshooting 的代理方案 |

> 没有 g++ 也可以先体验：选题、题面、翻译、记录都能用，只是「运行测试」需要编译器。
> WSL 用户建议先执行 `bash tools/setup_wsl.sh` 一键准备环境。

## 1. 安装扩展

**方式 A（推荐）**：扩展商店搜索 `ACM Workflow` → 安装。

**方式 B**：下载 `acm-workflow-*.vsix` → 扩展面板 `...` → 从 VSIX 安装。

安装后：
- 活动栏出现 ACM 图标（墨色括号图标）
- 首次安装自动弹出 **「ACM Workflow 快速上手」** 三步指引（也可随时在 开始/欢迎 页找到）
- 按 `Ctrl+Alt+A` 打开工作台（侧边栏）

## 2. 第一步：配置 CF Handle

工作台「记录」视图 → 点击 **绑定 / 更换** → 输入你的 Codeforces 账号名。

或者：`设置` 搜索 `acmWorkflow.cfHandle` 直接填写。

绑定后扩展会拉取你的 AC 历史（首次约 10~30 秒，之后 15 分钟缓存），用于：
- 记录面板统计（总数 / AC 率 / 难度分布）
- 选题页「薄弱点推荐」（通过率最低的专题抽题）
- 比赛面板「我的关注」榜单

> 💡 可选：工作台顶部状态条点 **登录**，打开浏览器登录 Codeforces（手动输账号密码）。
> 会话 Cookie 加密存系统密钥链，约 30 天有效；登录后抓取更稳、可一键提交。

## 3. 第二步：获得第一道题

三种方式任选：

### 方式一：随机选题（推荐新手）

1. 「选题」视图 → 难度区间默认 800~2400 → 点 **随机推荐**
2. 满意 → 点 **生成 cpp 并测试** → 自动创建 `code/Codeforces/{题号}/题目名.cpp` 并打开

### 方式二：URL 导入

「选题」视图底部粘贴链接：

```
https://codeforces.com/problemset/problem/1791/E
```

回车即完成：生成 cpp + 样例 + 题面。重复导入同一题会直接打开已有文件。

### 方式三：比赛一键创建

「CF 比赛」视图 → 展开某场 Round → **一键创建** → 生成全部题目
（`code/Codeforces/Contest_{id}/contest_{id}_{字母}.cpp`），自动抓样例，打开 A 题。

## 4. 第三步：测试与提交

打开题目 cpp，「测试」视图自动加载：

```
[题面（英文 + 中文翻译按钮）]
─────────────────────────────  ← 可拖动分隔条
[测试用例 1]  [测试用例 2] ...
[▶ 运行全部] [提交]
```

1. 点 **▶ 运行全部**：自动编译 → 逐用例运行 → 每个用例显示 通过/失败/超时/运行错误
2. 全过 → 记录自动标记 **已AC**，状态栏出现 **「下一题 ▸」** 保持刷题节奏
3. 题面点 **翻译** → 中英对照（可切 双语/仅译文/仅原文）
4. 有把握了点 **提交**：首次输入 Handle 与密码（存系统密钥链）→ 自动提交并轮询判定

### 对拍验证（进阶）

测试视图切「对拍」：正解 = 当前文件，选择/填写暴力程序路径 →
「造数据」页配置随机数据（数组/树/图/...）→ **开始对拍**：
随机生成输入 → 双跑比对 → 不一致立即停止并展示 `输入/正解输出/暴力输出`，可保存差异数据。

## 5. 接下来

- 查看全部功能：[docs/features.md](features.md)
- 配置项详解：[docs/configuration.md](configuration.md)
- 遇到问题：[docs/troubleshooting.md](troubleshooting.md)
- 数据位置：未配置 `baseDir` 时所有数据（题目/记录/缓存）在 `~/.acm-workflow/`
