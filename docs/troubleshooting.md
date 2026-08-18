# 故障排查（Troubleshooting）

> 第一步永远是运行 **`ACM Workflow: 工作流诊断`**（命令面板或工作台顶部「诊断」按钮）：
> 输出面板会显示 平台 / Node 版本 / PATH / curl / g++ / 网络探测 / 操作轨迹 / 发现的问题；
> 选择保存目录后还会生成 Markdown + JSON 双份报告，90% 的问题一眼可见。

## 1. 题面空白 / 抓取失败

**现象**：打开题目 cpp，题面区一直「正在抓取题面…」或提示抓取失败。

**排查顺序**：

1. **确认题号被识别**：题面区顶部「当前题目」指示器应显示题号（如 `Codeforces 2257A`）。
   没有 → 文件名/目录名不符合规则（如 `main.cpp`、`A.cpp`）。要求：
   - `979E.cpp` 或 `Codeforces/154A/Hometask.cpp`（题号在文件名或父目录名）
2. **网络**：本机浏览器能打开 codeforces.com 吗？
   - 能 → 运行「工作流诊断」，看 fetch/curl 探测是否 OK；仍失败可配置代理 `acmWorkflow.proxy`
   - 不能 → 需要代理或加速器，配 `acmWorkflow.proxy`
3. **缓存**：题面有 30 天磁盘缓存 + 抓取失败自动读缓存兜底 + 简易渲染兜底，
   理论上任何情况都有内容。若缓存内容过旧，命令「ACM Workflow: 重新获取测试数据」可强制刷新。

**日志**：输出面板切换频道到 `ACM Workflow`，查看 `[ACM-Workflow][题面]` 前缀的链路日志
（解析成功 → 抓取 → 落盘 → 推送，每步都有）。

## 2. 编译失败 / 找不到 g++

**现象**：运行测试提示「未找到 g++ 编译器」。

**解决**：

| 平台 | 安装方式 |
|---|---|
| Windows | [MinGW-w64](https://www.mingw-w64.org/)（解压后把 `bin` 加入 PATH）或 MSYS2（`pacman -S mingw-w64-x86_64-gcc`） |
| macOS | 终端运行 `xcode-select --install` |
| Linux | `sudo apt install g++` / `sudo dnf install gcc-c++` |
| WSL | `bash tools/setup_wsl.sh` |

扩展自动探测：PATH → `C:\mingw64\bin\g++.exe` → `C:\msys64\mingw64\bin\g++.exe` →
mingw-w64 安装器默认路径 → `/usr/bin/g++`。安装后重启 VS Code 再试。

## 2.5 WSL 环境 / 浏览器问题

- **WSL 里打不开浏览器（登录 / 提交）**：
  1. 运行 `bash tools/setup_wsl.sh` 安装 Chromium；
  2. 或在设置里配置 `acmWorkflow.browserPath` 指向 Windows 侧浏览器：
     ```jsonc
     {
       "acmWorkflow.browserPath": "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
     }
     ```
- **路径设置从 Windows 带过来不生效**：`baseDir` / `templatePath` / `dbPath` / `browserPath`
  支持自动把 `C:\...` 转成 `/mnt/c/...`，一般无需手动改；如果发现没生效，请确认 VS Code
  的 Remote 窗口确实连接到了 WSL（左下角显示 `WSL: Ubuntu`）。
- **工作流诊断**：`ACM Workflow: 工作流诊断` 会显示 python3 探测结果，并包含 Codeforces 主页/API 连通性、最近操作轨迹与发现的问题（轨迹异常）。

## 3. CF 访问慢 / 超时

- **有 HTTP 代理**：VS Code 扩展进程**不跟随系统代理**，必须在设置里配
  `acmWorkflow.proxy: "http://127.0.0.1:7890"`（或设置环境变量 `HTTPS_PROXY`）
- **无代理**：扩展默认所有请求强制 IPv4 直连（规避 IPv6 半通导致的超时），一般即可用；
  仍慢可用 hosts 加速（把 `codeforces.com` 解析到的 IPv4 写入 hosts）
- **频繁 403 / 限流**：登录一次 CF 会话（工作台顶部「登录」），登录态会自动用于所有抓取

## 4. 提交（Submit）问题

- **浏览器没弹出来**：提交依赖系统 Chrome/Edge/Chromium（puppeteer-core 不内置浏览器）。Windows 一般自带 Edge；WSL 可运行 `bash tools/setup_wsl.sh` 或配置 `acmWorkflow.browserPath`
- **提交后判定超时**：轮询上限约 90s，超时会提示去 CF 页面手动查看
- **凭证**：Handle/密码存系统密钥链，忘记或想换 → 再次提交时输入新凭证会覆盖
- **登录态失效**：CF 会话约 30 天过期，API 403 会自动清除并提示重新登录

## 5. 记录库问题

- **统计全零 / 按钮无响应**：多为数据库目录不可写。`dbPath` 的父目录必须存在且可写
  （扩展会自动创建 `{baseDir}` 与 `dbPath` 父目录，但请确认没有权限限制）
- **想重置**：删除 `{baseDir}/records.db`（或配置里换 `dbPath`）即全新开始，不影响已生成题目
- **数据库格式**：标准 SQLite（sql.js WASM 实现），可用任何 SQLite 工具打开

## 6. 美化（Beautify）问题

- **应用后界面怪怪的**：运行 `ACM Workflow: 还原美化` 一键恢复
- **浅色主题**：应用前会提示先切深色主题（硬边墨色配色基于深色设计）

## 7. 其他

| 问题 | 处理 |
|---|---|
| 端口 27121 被占用 | 配置 `acmWorkflow.companionPort` 换端口，浏览器插件同步修改 |
| 批量补样例失败 | 命令「批量补充测试数据」会逐题抓取，网络慢时可能耗时较长 |
| 翻译为空 | 免费后端有日限额（MyMemory ~5000 字符/天），换 `libre`/`deepseek` 或次日再试 |
| 扩展更新后行为异常 | 重启 VS Code；仍异常可查看输出面板 `ACM Workflow` 频道日志 |
| 想反馈 Bug / 提需求 | GitHub Issues（附「工作流诊断」输出/报告与复现步骤） |

## 8. 日志位置

- **扩展日志**：输出面板 → 下拉选 `ACM Workflow`（前缀 `[ACM-Workflow]`）
- **设置恢复**：美化/沉浸功能会备份原设置，还原命令一键恢复，不会动你的其他配置
