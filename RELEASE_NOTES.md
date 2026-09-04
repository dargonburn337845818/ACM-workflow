# ACM Workflow 0.23.0

VSCode 内 Codeforces 刷题全流程工作台：选题 → 题面翻译 → 测试 → 对拍 → 造数据 → 比赛 → 记录。

## 本次更新

### AI 造数据脚本可靠性重做
- **修正提示词带完整题面**：修复轮不再丢失题目约束，模型可以基于题面重写而不是盲修。
- **代码提取增强**：没有 Markdown 围栏时也能切掉代码尾部的解释性文字，减少“把说明当代码”导致的语法错误。
- **验证增强**：输出增加轻量形状校验，拒绝“有输出但实际是解释/废话”的假通过。
- **保底升级**：模型多次失败后不再只写 `print(1)`，而是根据官方样例生成“样例形状随机化脚本”，保留输入结构并随机化数值/字符串。

### 性能与工程
- 随机图生成改为边编号无放回抽样，大 `n` 内存从 `O(n²)` 降到 `O(m)`。
- 编译链路全异步化，`runner.compileCpp` 不再阻塞 VS Code 事件循环。
- 编译缓存改用源码 SHA-1 内容哈希。
- Spark 生命周期拆到 `sparkLifecycle.ts`，生成/验证/保存职责分离。
- Spark 生成脚本默认按题目目录保存，支持原子写、临时文件清理、8MB 输出上限。

### 仓库与 Actions
- monorepo Actions 统一：CI / Security Scan / APK / Release。
- tag Release 同时发布 **VSIX + APK**。
- 新增 SECURITY、CONTRIBUTING、开发文档、Issue/PR 模板、Dependabot、Gitleaks、CODEOWNERS。
- 生成产物与隐私红线加固。

## 安装

下载 `acm-workflow-0.23.0.vsix`，在 VS Code 扩展面板选择「从 VSIX 安装」。

## License

MIT
