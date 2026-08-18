# Changelog

最新版本：**0.18.2**（WSL 适配与题面公式修复）— 一键 WSL 环境脚本、Windows 路径自动转 `/mnt`、浏览器/编译/翻译适配、CF 公式排版修复。

完整迭代历史见 [docs/changelog.md](docs/changelog.md)：

- **0.18.2** WSL 适配与题面公式修复：新增 `tools/setup_wsl.sh`；`baseDir`/`templatePath`/`dbPath`/`browserPath` 自动把 Windows 路径转 WSL `/mnt` 路径；`.py` 造数据脚本使用 `python3`；WSL 浏览器探测与 `--no-sandbox` 适配；本地离线翻译工具脚本；生成 `题面.md`；修复本地翻译公式占位符泄漏；修复 CF `$$$` 公式排版；记录/比赛直接使用 CF 登录态并移除手动绑定；文档补充。
- **0.18.0** 开源首版：修复 72 处编译错误完成模块化重组；删除全部硬编码个人路径（默认数据目录 `~/.acm-workflow`）；新增 ESLint / 冒烟测试 / walkthrough 入门指引 / README 与 docs 全套文档；隐私打包验证。
- **0.17.x** CF 网络加速（IPv4 直连 / 代理配置）、URL 导入、比赛一键创建拉取样例。
- **0.16.0** CF 登录态 / 比赛管理 / 造数据 / 对拍器 / 提交闭环 五大能力落地。
- **0.8.0** 架构重构：回归左侧工作台 + 原生编辑器，新增题面翻译面板。
- **0.5.1** 稳定版：快照式退出、CDN 多源回退、彻底清理。
