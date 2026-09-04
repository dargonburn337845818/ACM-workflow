# 安全与隐私

ACM Workflow 是一款本地优先的 VS Code 扩展。我们承诺：

- **敏感信息不进仓库**：CF Cookie、DeepSeek API Key 等只存 `vscode.SecretStorage`，不写设置文件、日志或 Git。
- **运行时数据留在本机**：题目、记录、缓存默认在 `~/.acm-workflow/`。
- **诊断信息脱敏**：`工作流诊断` 在生成报告前隐藏主目录、邮箱与疑似密钥。
- **生成产物不入库**：`*.db`、`*.log`、`cache/`、`out/`、`dist/` 等已通过 `.gitignore` 排除。

## 报告漏洞

请勿在公开 Issue 中粘贴真实 Cookie、API Key、密码、个人路径或完整诊断报告。

- 安全相关问题：请直接通过 GitHub Private vulnerability reporting 或邮件联系维护者（见仓库 `package.json` author）。
- 请附上：复现步骤、影响范围、是否已脱敏的信息。
- 我们会在确认后修复，并在修复完成前不公开细节。

## 开发时的安全要求

1. 不提交任何 `.db` / `.log` / 密钥文件。
2. 新功能若输出用户信息到日志/报告，必须调用脱敏函数。
3. 本地模型路径、代理、Cookie 等均为用户侧配置，不得作为固定默认值写入公开配置。
4. 外部命令（python/g++/curl/llama-server）只接收明确参数，不拼接 shell 字符串；Windows 启动脚本使用 `Start-Process` 参数数组。
