# ACM Workflow 0.21.3

VSCode 内 Codeforces 刷题全流程工作台：选题 → 题面翻译 → 测试 → 对拍 → 造数据 → 比赛 → 记录。

## 本次更新

- **本地 Spark 集成**：造数据页一键生成 Python 造数据脚本，自动验证并写入 `gen.py`、插入流水线。
- **空闲释放显存**：Spark 使用完 3 分钟自动停止，下次点击自动拉起。
- **全套 Spark 配置**：`acmWorkflow.spark*`，含端点/模型路径/上下文/空闲时间/脚本路径。
- **修复下拉框全白**：所有 `select` 改用深色配色，不再需要鼠标扫过才显示内容。
- **修复 Spark 启动失败**：`--ngl` 改为当前构建支持的 `-ngl`。
- **修复生成超时**：Spark 请求超时放宽到 5 分钟，默认最大 token 降到 4096，并给出明确超时提示。

## 安装

下载 `acm-workflow-0.21.3.vsix`，在 VS Code 扩展面板选择「从 VSIX 安装」。

## License

MIT
