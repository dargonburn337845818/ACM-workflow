# ACM Workflow 0.21.0

> 一款在 VSCode 中完成 Codeforces 刷题全流程的工作台：选题、题面翻译、生成、测试、对拍、造数据、比赛管理与刷题记录，全部在编辑器内闭环。

## 本次更新亮点

- **可组装对拍器**：正解与暴力可自由组合比对方式（精确 / Token / 浮点误差 / Special Judge），支持外部 checker，差异实时展示。
- **造数据流水线**：去掉顶层预设，改为一步一步拼装数据生成流程；支持变量绑定、重复块、树/图/数组等细粒度原语，种子可复现。
- **玻璃拟态工作台**：工作台可配置背景图，支持玻璃/夜航等视觉主题。
- **联动 VSCode Background**：在工作台选择壁纸后，可一键写入 [VSCode Background](https://github.com/caoge5524/vscode-background) 插件配置，将同一张壁纸应用到整个 VSCode。
- **刷题记录与统计**：SQLite 本地记录、AC 率、连续刷题天数、标签难度分布图。
- **稳定工具链**：本地翻译多后端、CF 登录态、比赛自动加载、工作流诊断、环境配置引导。

## 联动插件

- [VSCode Background](https://github.com/caoge5524/vscode-background) — 为 VSCode 设置视频/图片背景，支持玻璃拟态、透明主题等效果。

## 安装

1. 从本 Release 下载 `acm-workflow-0.21.0.vsix`
2. VS Code → 扩展面板 → `...` → 从 VSIX 安装
3. 按 `Ctrl+Alt+A` 打开 ACM Workflow 工作台

## 开源协议

MIT License
