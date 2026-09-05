# 研发建议与开发地图（Development）

本文面向维护者与贡献者，记录当前架构、已执行优化、待办与开发方向。
用户文档见 [features.md](features.md) / [configuration.md](configuration.md) / [troubleshooting.md](troubleshooting.md)。

## 1. 模块地图（深模块候选）

```
src/
├── extension.ts         # 激活入口：只注册命令/工作台，轻量
├── core/workbench.ts    # 工作台宿主：消息路由 + 联动状态（较厚，已收拢业务）
├── core/workbenchHtml.ts# Webview HTML 模板
├── features/*           # 功能模块：pick/urlImport/contest/test/verifier/datagen/session/records
└── services/*           # 深模块：judge/workspace/statement/spark/cf* /records/dataGen/…
```

- `services/judgeService.ts` + `runner.ts` 承担“编译/运行/比对/环境探测”，是典型的深模块。接口稳定，后续可替换实现。
- `services/dataGen.ts` 是纯函数生成器的主干；建议把“脚本子进程运行”与“内置生成器”继续分开，保持可单测。
- `services/spark.ts` 已拆为 `sparkLifecycle.ts`（服务器生命周期）+ `spark.ts`（生成/验证/保存），降低单文件认知负担。
- `media/main.js` 已经很大，Webview 前端建议按视图拆文件（pick/contest/datagen/test/records），用构建工具打包。

## 2. 性能优化（已做/建议）

已做或本轮落地：

- 随机简单图不再构造 O(n²) 全边数组：改为 Floyd 无放回抽样 + 边编号映射，内存从 O(n²) 降到 O(m)。
- 长字符串生成改用数组 `join`，避免逐字符字符串拼接。
- Spark 验证脚本临时文件每次清理，避免 `/tmp` 堆积。
- AI 生成脚本已轻量化为「按样例生成」：直接按样例形状生成随机化脚本，不调用 LLM、不加载模型，毫秒级完成（V0.24）。
- 生成脚本默认保存到当前题目目录 `gen.py`，并按原子写落盘，避免不同题目互相覆盖、半文件中断。
- `runner.compileCpp` 已改为异步 `execFile`，`judgeService` / `workbench.compileFor` / `verifier` 全部走 Promise，不再阻塞扩展事件循环。
- `compileCache` 已用源码 SHA-1 内容哈希替代 mtime，避免 mtime 抖动导致无谓重编译。
- `dataGen.runScript` 的 `.cpp` 编译也已是异步子进程，并清理编译产物。
- `spark.ts` 已拆成 `sparkLifecycle.ts` + `spark.ts`，生命周期与脚本生成职责分离。
- Spark 验证增加 stdout 8MB 上限，防止模型写出天文数字。
- AI 修复提示词现在携带完整题面；代码提取会切除尾部散文；验证增加轻量形状校验；保底脚本升级为“样例形状随机化”。
- 测试新增 Tree/Graph/String 种子 golden 样例、提取切散文、样例形状保底，当前冒烟 90 项通过。
- tag Release 现在一次发布 VSIX + APK 两个资产。

继续建议：

- `cfContest` / `fetchers` 的串行抓取可以增加有界并发（如 2~3）并保留 800ms 防风控；不要让并发数无上限。
- `statementHtml` / `translate` 长文本处理已有缓存；可对翻译段落做并发请求但保持结果顺序稳定。
- Webview 前端大量 DOM 重建，建议引入虚拟列表/增量渲染，尤其记录页与比赛榜单。

## 3. 造数据脚本生成：轻量化优先（V0.24 新方向）

当前闭环（默认路径，无 LLM）：

```
官方样例 → 样例规律推断（首行N + 数组/矩阵/边列表）→ 生成随机化 Python 脚本
  → 运行验证（有输出 + 轻量形状校验）→ 原子保存到题目目录/gen.py → 前端插入 pipeline
```

设计原则：

- 生成内容只是“样例格式的随机化数据”，**不需要模型理解题面**。
- 先理解样例形式规律，再指导本地生成，但理解过程仍是轻量规则而非 LLM。
- 本地 Spark 仅保留为可选“复杂题面理解模式”，默认 `sparkAutoStart=false`。
- 本地参数保持轻量：ctx 8192 / batch 256 / threads 8 / GPU 0 / max_tokens 1024。

继续增强建议：

1. **语法预检**：先用 `python -m py_compile` 或 `ast.parse` 快速排除语法错误。
2. **形状解析增强**：已落地“首行 N + 数组”、“首行 N + 矩阵/边列表”识别；下一步可扩展到“首行 N M + 后续依赖”。
3. **可复现性**：脚本头部注入可选 `SEED` 环境变量，便于 debug 与对拍。
4. **DAG 模板**：内置常见格式模板（数组/树/图/字符串），样例格式命中时直接用模板生成，不再依赖 LLM。

## 4. GitHub 仓库设计建议

当前是“VS Code 扩展 + knowledge-ladder 子项目”的 monorepo，GitHub Actions 只在根 `.github/workflows` 生效。

建议：

- **根工作流已统一**：`ci.yml`（扩展 CI）、`security.yml`（Gitleaks）、`build-apk.yml`（日常 APK artifact）、`release.yml`（tag 时 VSIX + APK 一起发 Release）。
- 已删除 `knowledge-ladder/.github/workflows/` 内不生效的嵌套模板，monorepo 中由根 `.github/workflows` 统一执行；子项目 README 已说明。
- 发布规范：`main` 只走 PR；tag 必须是 `vX.Y.Z` 且指向 `main`；Release 由 CI 自动产物生成。
- 已加 `dependabot.yml`、Issue/PR 模板与 `CODEOWNERS`。
- 配置项默认值避免绑定作者本机路径；所有机器相关路径应可配置、可覆盖。

## 5. 隐私与安全清单

- [x] 密钥仅存 SecretStorage；诊断报告脱敏。
- [x] `.gitignore` 排除运行数据库/日志/缓存/构建产物。
- [x] AI 生成脚本按题目隔离，不写个人盘符默认值。
- [x] 提交前 secret scan（Gitleaks）已接入；CI 中禁止跟踪 `*.db/*.log/*.sqlite*` 的检查已接入。
- [ ] `tools/*.sh` 中本机路径改为从环境变量/设置读取，README 只保留示例（可后续继续收敛）。

## 6. 后续路线

已完成：
1. `spark.ts` 拆成 `sparkLifecycle.ts` + `spark.ts`。
2. `dataGen` 增加 Tree/Graph/String 种子 golden 测试。
3. `runner.compileCpp` 异步化，`dataGen.runScript` C++ 编译异步化。
4. 清理 `knowledge-ladder` 生成产物（`mobile/www/data.js`、`reports/*.html`），由 CI 重新生成。
5. tag Release 附带 VSIX + APK；Gitleaks + Dependabot + Issue/PR 模板。

后续候选：
1. Webview 前端按视图拆分，引入构建工具打包。
2. `compileCache` 键加源码 hash，降低重编译率。
3. Spark 生成脚本增加语法预检与输出上限。
4. `tools/*.sh` 本机路径继续向环境变量收敛。
