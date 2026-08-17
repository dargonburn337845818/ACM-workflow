# 故障排查（Troubleshooting）

> 第一步永远是运行 **`ACM Workflow: 环境诊断`**（命令面板）：
> 输出面板会显示 平台 / Node 版本 / PATH / curl / g++ 探测结果，90% 的问题一眼可见。

## 1. 题面空白 / 抓取失败

**现象**：打开题目 cpp，题面区一直「正在抓取题面…」或提示抓取失败。

**排查顺序**：

1. **确认题号被识别**：题面区顶部「当前题目」指示器应显示题号（如 `Codeforces 2257A`）。
   没有 → 文件名/目录名不符合规则（如 `main.cpp`、`A.cpp`）。要求：
   - `979E.cpp` 或 `Codeforces/154A/Hometask.cpp`（题号在文件名或父目录名）
   - 洛谷 `P1001.cpp`
2. **网络**：本机浏览器能打开 codeforces.com 吗？
   - 能 → 运行「环境诊断」，看 curl 探测是否 OK；仍失败可配置代理 `acmWorkflow.proxy`
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

扩展自动探测：PATH → `C:\mingw64\bin\g++.exe` → `C:\msys64\mingw64\bin\g++.exe` →
mingw-w64 安装器默认路径 → `/usr/bin/g++`。安装后重启 VS Code 再试。

## 3. CF 访问慢 / 超时

- **有 HTTP 代理**：VS Code 扩展进程**不跟随系统代理**，必须在设置里配
  `acmWorkflow.proxy: "http://127.0.0.1:7890"`（或设置环境变量 `HTTPS_PROXY`）
- **无代理**：扩展默认所有请求强制 IPv4 直连（规避 IPv6 半通导致的超时），一般即可用；
  仍慢可用 hosts 加速（把 `codeforces.com` 解析到的 IPv4 写入 hosts）
- **频繁 403 / 限流**：登录一次 CF 会话（工作台顶部「登录」），登录态会自动用于所有抓取

## 4. 洛谷相关

- **洛谷题面/样例抓不到**：洛谷有 JS 挑战 WAF，扩展使用浏览器直连 + HTML 提取。
  被风控挂起（提示「未找到题目数据」）时等待 10~30 分钟再试，或使用 Competitive Companion 推送兜底
- **洛谷选题**：V0.12 起已移除（标签数字 ID 无法适配），选题专注 Codeforces

## 5. 提交（Submit）问题

- **浏览器没弹出来**：提交依赖系统 Chrome/Edge（puppeteer-core 不内置浏览器）。Windows 一般自带 Edge；其他平台请安装 Chrome
- **提交后判定超时**：轮询上限约 90s，超时会提示去 CF 页面手动查看
- **凭证**：Handle/密码存系统密钥链，忘记或想换 → 再次提交时输入新凭证会覆盖
- **登录态失效**：CF 会话约 30 天过期，API 403 会自动清除并提示重新登录

## 6. 记录库问题

- **统计全零 / 按钮无响应**：多为数据库目录不可写。`dbPath` 的父目录必须存在且可写
  （扩展会自动创建 `{baseDir}` 与 `dbPath` 父目录，但请确认没有权限限制）
- **想重置**：删除 `{baseDir}/records.db`（或配置里换 `dbPath`）即全新开始，不影响已生成题目
- **数据库格式**：标准 SQLite（sql.js WASM 实现），可用任何 SQLite 工具打开

## 7. 美化（Beautify）问题

- **应用后界面怪怪的**：运行 `ACM Workflow: 还原美化` 一键恢复
- **浅色主题**：应用前会提示先切深色主题（硬边墨色配色基于深色设计）

## 8. 其他

| 问题 | 处理 |
|---|---|
| 端口 27121 被占用 | 配置 `acmWorkflow.companionPort` 换端口，浏览器插件同步修改 |
| 批量补样例失败 | 命令「批量补充测试数据」会逐题抓取（洛谷风控严格，批量易挂，建议只用于 CF） |
| 翻译为空 | 免费后端有日限额（MyMemory ~5000 字符/天），换 `libre`/`deepseek` 或次日再试 |
| 扩展更新后行为异常 | 重启 VS Code；仍异常可查看输出面板 `ACM Workflow` 频道日志 |
| 想反馈 Bug / 提需求 | GitHub Issues（附「环境诊断」输出与复现步骤） |

## 9. 日志位置

- **扩展日志**：输出面板 → 下拉选 `ACM Workflow`（前缀 `[ACM-Workflow]`）
- **设置恢复**：美化/沉浸功能会备份原设置，还原命令一键恢复，不会动你的其他配置
