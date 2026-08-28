# ① 配置 Codeforces Handle

打开 **命令面板**（`Ctrl+Shift+P`）→ 输入 `设置` → **首选项：打开设置（UI）**，搜索 `acmWorkflow.cfHandle`，填入你的 Codeforces 账号名：

```
acmWorkflow.cfHandle: "your_cf_handle"
```

## 也可以在工作台内绑定

1. 按 `Ctrl+Alt+A` 打开 ACM Workflow 工作台
2. 切换到「记录」视图
3. 点击 **绑定 / 更换**，输入 Handle 即可

> 绑定后会自动拉取你的 AC 历史（首次约 10~30 秒），用于：
> - 记录面板的 AC 统计与难度分布图
> - 选题页的「薄弱点推荐」
> - 比赛面板「我的关注」榜单

## 可选：登录 CF 会话

工作台顶部状态条点击 **登录**，会打开浏览器进入 Codeforces 登录页（手动输入账号密码）。
登录态（Cookie）加密保存在系统密钥链（`vscode.SecretStorage`），约 30 天有效，用于带登录态的抓取。
