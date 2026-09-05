# ACM Workflow

> 在 VS Code 内完成 Codeforces 刷题的本地工作台：选题、翻译、测试、对拍、造数据、比赛管理与刷题记录。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 简介

ACM Workflow 是一个 VS Code 扩展，把 Codeforces 刷题需要的常见操作收进一个工作台：

- 在编辑器内按难度、标签选择题目
- 自动创建题目文件、抓取样例与题面
- 运行测试、对拍、生成测试数据
- 管理比赛、关注选手榜单
- 本地记录 AC 历史和统计

运行时数据默认保存在本机，不调用云端 AI 作为核心依赖；本地翻译与造数据模型均为可选配置。

## 功能

- **CF 选题**：按难度区间（800–3500）与算法标签过滤、随机推荐、薄弱点推荐。
- **URL 导入**：支持 `problemset`、`contest`、`gym` 三类 Codeforces 链接。
- **比赛管理**：Round 列表、题目列表、前 20 榜单、关注 Handle、一键创建整场比赛。
- **题面与翻译**：抓取题面并排版；支持 MyMemory、LibreTranslate、DeepSeek、本地 llama.cpp 多后端；三级缓存。
- **内置测试器**：自动编译、逐用例运行、超时/错误标记、全过自动记录 AC。
- **通用对拍器**：正解对暴力，支持精确、Token、浮点误差、Special Judge。
- **造数据机器**：流水线式生成数据，支持变量联动、脚本生成、按样例生成。
- **刷题记录**：SQLite 本地存储；统计标签、难度分布、连续天数；支持 CF 历史导入。
- **浏览器推送**：兼容 Competitive Companion 协议（端口 27121）。
- **环境配置与诊断**：自动检测本地翻译模型、工具链；产出脱敏后的诊断报告。
- **主题与美化**：自带两套 VS Code 颜色主题，可选玻璃拟态背景并联动 [VSCode Background](https://github.com/caoge5524/vscode-background)。

## 安装

### 从 Releases 安装

1. 从 [Releases](https://github.com/dargonburn337845818/ACM-workflow/releases) 下载 `acm-workflow-<version>.vsix`。
2. 在 VS Code 扩展面板中选择“从 VSIX 安装”。
3. 按 `Ctrl+Alt+A`（macOS `Cmd+Alt+A`）打开工作台。

推送 `vX.Y.Z` tag 后，GitHub Actions 会自动构建 VSIX 并发布到 Releases。

### 源码运行

```bash
git clone https://github.com/dargonburn337845818/ACM-workflow.git
cd ACM-workflow
npm install --include=dev
npm run compile
```

然后按 `F5` 启动 Extension Development Host。

## 快速开始

1. 配置 Codeforces Handle：`设置 → acmWorkflow.cfHandle`，或在工作台“记录”页绑定。
2. 打开工作台：`Ctrl+Alt+A`。
3. 在选题页设置难度，选择“随机推荐”或“薄弱点推荐”；也可以粘贴题目 URL 导入。
4. 生成后自动创建 C++ 文件与样例；运行测试，全过会自动标记 AC。

详细教程见 [docs/getting-started.md](docs/getting-started.md)。

## 文档

- [功能说明](docs/features.md)
- [配置项](docs/configuration.md)
- [故障排查](docs/troubleshooting.md)
- [开发指南](docs/DEVELOPMENT.md)
- [更新日志](docs/changelog.md)

## 项目结构

```text
src/                 # VS Code 扩展源码（features/services/core/utils）
media/               # 工作台前端
themes/              # VS Code 颜色主题
knowledge-ladder/    # 独立 Python 知识阶梯子项目
tools/               # 本地翻译与辅助工具
tests/               # 无 VS Code 环境的冒烟测试
docs/                # 用户与研发文档
```

更详细的模块说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 开发

```bash
npm run compile
npm run lint
npm test
```

知识阶梯子项目改动后，请运行 `python3 export_mobile_data.py` 验证数据导出。

## 隐私与安全

- 敏感信息（CF Cookie、DeepSeek API Key）只存 `vscode.SecretStorage`，不写入设置、日志或 Git。
- 题目、记录、缓存默认在 `~/.acm-workflow/`。
- 诊断报告会隐藏主目录、邮箱与疑似密钥后再输出。
- 配置中的 `D:\...` 仅为作者本机示例，请按自身环境修改。

完整安全说明见 [SECURITY.md](SECURITY.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请：

1. 运行 `npm run lint`、`npm test`、`npm run compile`。
2. 在 PR 中说明改动、验证结果与隐私影响。

完整流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，社区行为见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可证

[MIT](LICENSE)
