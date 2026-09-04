# 贡献指南

感谢你参与 ACM Workflow 开发。本仓库既是 VS Code 扩展，也是 `knowledge-ladder` 子项目的 monorepo。
所有贡献都应遵守「深模块优先、接口即测试面、隐私不越线」三条底线。

## 开发环境

```bash
npm install --include=dev
npm run compile        # TypeScript 编译到 out/
npm run lint           # ESLint（必须零错误）
npm test               # 编译 + 冒烟测试（无 VS Code 也能跑）
```

- `knowledge-ladder/` 为独立 Python 子项目，改动后至少运行 `python3 export_mobile_data.py` 验证数据导出。
- 提交前请运行完整测试，不要只提交能编译的代码。

## 代码结构

- `src/features/*`：功能模块，只通过 `WorkbenchHost` + 服务门面交互，不自建隐式依赖。
- `src/services/*`：深模块服务，每个服务有清晰接口；跨模块调用走 `src/services/index.ts` 组合根。
- `src/core/`：工作台宿主，只做消息路由与联动，不放业务逻辑。
- `media/` + `src/core/workbenchHtml.ts`：Webview 前端。
- `tests/smoke.js`：无 VS Code 依赖的回归测试；新功能必须补断言。
- `docs/`：面向用户的功能/配置/故障文档；`docs/DEVELOPMENT.md` 是研发侧地图。

## 接口与重构

- 任何重构先固定公开接口：命令、Webview 消息、`services/index.ts` 导出的门面、`.prob`/数据库 schema。
- 只有一个实现的抽象按 Deletion Test 处理：删掉它复杂度是否消失？否则就深化为真正的模块。
- 优先用测试锁行为，再重写实现；不允许靠“能跑”替代可观察断言。

## 性能要求

- 不能阻塞 VS Code UI 事件循环：文件 I/O 大操作、外部命令（g++/python/curl）、网络请求尽量异步。
- 数据生成器必须可复现：带种子输出一致；随机图/树生成避免 O(n²) 全量数组。
- 缓存要写明 TTL 与失效策略；禁止把运行时大文件（`db`/`log`/`node_modules`/`out`/`dist`）提交进仓库。

## AI 造数据脚本（Spark）

- 提示词必须含「输出格式硬约束」与样例锚点；解析器要兼容 Markdown 围栏与纯文本两种输出。
- 生成脚本保存默认按题目目录隔离，避免覆盖；明确指定 `sparkScriptPath` 时才使用全局固定路径。
- 验证闭环：运行 → 无输出自动补函数入口 → 最多 3 次小步修正 → 仍失败写保底脚本。
- 所有验证临时文件必须清理；保存使用原子写（先写临时文件再 rename）。

## 隐私红线

- 禁止提交：`.db`、`.log`、Cookie、API Key、密码、个人目录全路径、诊断原始报告。
- 新增任何写日志/报告功能时必须先经过脱敏：隐藏 home 目录、邮箱、疑似密钥。
- 用户本地路径（如 `D:\...`）只作为示例，不应作为硬编码默认值出现在公开文档；新增配置优先跨平台。

## PR 流程

1. 小步提交，commit message 说明“为什么”。
2. 附上测试结果：`npm run lint && npm test`。
3. 说明改动是否影响 `package.json` / GitHub Actions / 数据 schema。
4. 涉及隐私的改动要额外说明“会收集/输出哪些信息”。
