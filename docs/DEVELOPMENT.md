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
- `services/spark.ts` 生命周期较复杂；建议下一步把“服务器生命周期”与“生成/验证/保存”拆成两个类，降低单文件认知负担。
- `media/main.js` 已经很大，Webview 前端建议按视图拆文件（pick/contest/datagen/test/records），用构建工具打包。

## 2. 性能优化（已做/建议）

已做或本轮落地：

- 随机简单图不再构造 O(n²) 全边数组：改为 Floyd 无放回抽样 + 边编号映射，内存从 O(n²) 降到 O(m)。
- 长字符串生成改用数组 `join`，避免逐字符字符串拼接。
- Spark 验证脚本临时文件每次清理，避免 `/tmp` 堆积。
- AI 生成脚本默认保存到当前题目目录 `gen.py`，并按原子写落盘，避免不同题目互相覆盖、半文件中断。

继续建议：

- `runner.ts` 的 `compileCpp` 仍使用同步 `execFileSync`，会短暂阻塞扩展事件循环；改为 `execFile` 异步 + `compileCache` 键增加源码 hash，进一步减少重编译。
- `dataGen.runScript` 编译 `.cpp` 也是同步调用；可统一改为异步子进程。
- `cfContest` / `fetchers` 的串行抓取可以增加有界并发（如 2~3）并保留 800ms 防风控；不要让并发数无上限。
- `statementHtml` / `translate` 长文本处理已有缓存；可对翻译段落做并发请求但保持结果顺序稳定。
- Webview 前端大量 DOM 重建，建议引入虚拟列表/增量渲染，尤其记录页与比赛榜单。

## 3. AI 生成造数据脚本（Spark）完善方向

当前闭环：

```
题面上下文 + 样例锚点 → 提示词 → local llama.cpp (Spark) → 提取 Python
  → 运行验证（15s）→ 无输出自动补函数入口 → 失败回喂最多 3 次修正
  → 仍失败写保底脚本 → 原子保存到题目目录/gen.py → 前端插入 pipeline
```

下一步建议（按优先级）：

1. **语法预检**：先用 `python -m py_compile` 或 `ast.parse` 快速排除语法错误，再执行耗时运行，可省一轮模型调用。
2. **输入形状校验**：根据样例/题目抽取首行 `n` 等变量，验证生成数据的第一段与格式假设一致（至少检查非空、行数稳定）。
3. **可复现性**：在脚本头部注入可选 `--seed` / `SEED` 环境变量，让同一随机种子可复现，便于 debug 与对拍。
4. **输出上限**：为生成数据设置最大 stdout 字节（如 8MB），防止模型写出天文数字导致前端卡死。
5. **失败分类**：把“语法错误/运行错误/无输出/超时”分开提示，给用户更精确的修复方向。
6. **模型参数**：`temperature 0.3` 适合稳定生成；若脚本风格单一可提供 `top_p` 配置项。

## 4. GitHub 仓库设计建议

当前是“VS Code 扩展 + knowledge-ladder 子项目”的 monorepo，GitHub Actions 只在根 `.github/workflows` 生效。

建议：

- **根工作流只留三件套**：`ci.yml`（扩展 CI）、`build-apk.yml`（子项目 APK）、`release.yml`（VSIX Release）。
- `knowledge-ladder/.github/workflows/` 是“如果抽成独立仓库”的模板；在 monorepo 中不执行，建议在子项目 README 中明确说明，避免误以为已触发。
- 发布规范：`main` 只走 PR；tag 必须是 `vX.Y.Z` 且指向 `main`；Release 由 CI 自动产物生成。
- 建议增加 `dependabot.yml` 与 `CODEOWNERS`；Issue/PR 模板可提升有效贡献。
- 配置项默认值避免绑定作者本机路径；所有机器相关路径应可配置、可覆盖。

## 5. 隐私与安全清单

- [x] 密钥仅存 SecretStorage；诊断报告脱敏。
- [x] `.gitignore` 排除运行数据库/日志/缓存/构建产物。
- [x] AI 生成脚本按题目隔离，不写个人盘符默认值。
- [ ] 建议未来增加：提交前 secret scan（如 gitleaks）、CI 中禁止上传 `*.db/*.log` 的检查。
- [ ] `tools/*.sh` 中本机路径改为从环境变量/设置读取，README 只保留示例。

## 6. 建议的近期路线

1. 把 `spark.ts` 拆成 `sparkLifecycle.ts` + `sparkScript.ts`，分别写单测。
2. 为 `dataGen` 图/树/组合流水线增加基于种子的 golden 测试。
3. 为 runner/translate 增加异步化与超时可配置化。
4. 清理 knowledge-ladder 生成产物（`mobile/www/data.js`、`reports/*.html`）为由 CI 生成，减少仓库体积。
5. 如有用户反馈，优先处理题面抓取与本地模型启动两个最高频问题。
