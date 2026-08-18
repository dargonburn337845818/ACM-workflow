# 配置说明（Configuration）

所有配置通过 VS Code 设置面板修改：`Ctrl+,` → 搜索 `ACM Workflow`（前缀 `acmWorkflow.*`）。
配置修改后立即生效，无需重启（路径类配置在下次使用时生效）。

## 完整配置表

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `acmWorkflow.baseDir` | string | `""` | **数据根目录**。题目代码生成到 `{baseDir}/code/{平台}/{题号}/`；记录数据库、缓存默认也放这里。留空时使用 `~/.acm-workflow`（跨平台默认，Windows 即 `C:\Users\你\.acm-workflow`）。 |
| `acmWorkflow.templatePath` | string | `""` | 生成题目的 **cpp 模板文件路径**。留空使用内置模板（`bits/stdc++.h` 骨架 + 题号/URL 头注释）。自定义模板内容原样写入生成的 cpp。 |
| `acmWorkflow.dbPath` | string | `""` | **刷题记录 SQLite 文件路径**。留空使用 `{baseDir}/records.db`。想单独换位置（如云同步目录）时填写。 |
| `acmWorkflow.testTimeoutMs` | number | `5000` | 单用例运行超时（毫秒）。打开过题面且解析到时间限制时，自动用「题面限制 + 1s」覆盖此值。 |
| `acmWorkflow.companionPort` | number | `27121` | 接收 Competitive Companion 浏览器插件推送的本地端口（与 CPH 默认一致）。浏览器插件设置里的端口需改为相同值。 |
| `acmWorkflow.cfHandle` | string | `""` | Codeforces 账号 handle。用于：AC 历史导入、薄弱点推荐、比赛关注榜单、登录后自动回填。 |
| `acmWorkflow.translateProvider` | enum | `"auto"` | 题面翻译后端：<br>• `auto` — MyMemory（国内可达、无需 key）+ Google 兜底，零配置<br>• `libre` — LibreTranslate，端点用 `libreEndpoint` 配置（可自建）<br>• `local` — 本地离线 Argos，端点用 `localEndpoint` 配置（推荐，见 `tools/`）<br>• `deepseek` — DeepSeek API，密钥存系统密钥链（见下） |
| `acmWorkflow.libreEndpoint` | string | `https://libretranslate.com/translate` | LibreTranslate 翻译端点。自建实例填 `http://localhost:5000/translate`。 |
| `acmWorkflow.localEndpoint` | string | `http://127.0.0.1:5000/translate` | 本地离线翻译端点。配合 `tools/local_translate_server.py` 或自建 LibreTranslate 实例。 |
| `acmWorkflow.localAutoStart` | boolean | `true` | 使用 `local` 后端时，若本地服务未启动，扩展自动用 `tools/start_local_translate.sh` 拉起。 |
| `acmWorkflow.maxTranslateParagraphs` | number | `200` | 单次题面翻译最多翻译的段落数，防止超长题面超时/耗配额。 |
| `acmWorkflow.maxTranslateSegments` | number | `50` | 单个长段落最多拆成几句进行翻译，防止提示等长段落被截断。 |
| `acmWorkflow.browserPath` | string | `""` | Puppeteer 使用的浏览器可执行文件路径。留空自动探测；WSL 可填 `/usr/bin/chromium` 或 `/mnt/c/Program Files/.../msedge.exe`。 |
| `acmWorkflow.followHandles` | string[] | `[]` | 比赛面板「我的关注」榜单的额外关注 handle（逗号分隔编辑；自己的 `cfHandle` 自动包含，大小写不敏感）。 |
| `acmWorkflow.proxy` | string | `""` | CF 网络代理地址，如 `http://127.0.0.1:7890`。**VS Code 扩展进程的请求不跟随系统代理**，需要代理访问 CF 时在此填写；留空则尝试环境变量 `HTTPS_PROXY` / `HTTP_PROXY`。 |

## 敏感信息（不入配置，存系统密钥链）

以下数据**绝不写入设置文件**，全部通过 `vscode.SecretStorage`（Windows 凭据管理器 / macOS 钥匙串 / Linux libsecret）加密保存：

| 密钥 | 内容 | 写入时机 |
|---|---|---|
| `cf.session` | CF 登录会话（全量 Cookie + localStorage + 登录时间） | 工作台顶部「登录」成功后 |
| `acmWorkflow.deepseekKey` | DeepSeek API Key | 首次使用 deepseek 翻译时输入 |
| `acmWorkflow.cfHandle`（SecretStorage） | 提交用 Handle | 首次提交时输入 |
| `acmWorkflow.cfPassword`（SecretStorage） | 提交用密码 | 首次提交时输入 |

> 注意：`acmWorkflow.cfHandle` 同时存在于「设置项」（用于看板统计等，非敏感）与
> SecretStorage（用于提交，敏感），两者独立，用途不同。

## WSL 路径自动适配

在 WSL 里使用本扩展时，路径类配置（`baseDir` / `templatePath` / `dbPath` / `browserPath`）
可以直接沿用 Windows 风格路径，例如 `D:\CF\work` 会自动转换成 `/mnt/d/CF/work`。
因此从 Windows 迁移到 WSL 时不需要手动改路径设置。

```jsonc
{
  "acmWorkflow.baseDir": "D:\\CF\\work",           // WSL 下自动变成 /mnt/d/CF/work
  "acmWorkflow.browserPath": "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
}
```

## 数据目录结构（默认 `~/.acm-workflow`）

```
~/.acm-workflow/
├── code/                    # 生成的题目代码
│   ├── Codeforces/
│   │   ├── 154A/            #   单题：目录名 = 题号
│   │   │   └── Hometask.cpp
│   │   └── Contest_2257/    #   比赛：contest_{id}_{index}.cpp + .prob
│   └── Luogu/
├── records.db               # 刷题记录（SQLite，sql.js WASM）
└── cache/                   # 磁盘缓存（可再生，可安全删除）
    ├── cf-problems.json     #   CF 题集（TTL 12h）
    ├── cf-userstats-*.json  #   用户数据（TTL 15min，按 handle）
    └── statements/          #   题面排版 HTML（TTL 30 天）
```

## 典型配置场景

**场景一：项目与数据分离（推荐）**

```jsonc
// settings.json
{
  "acmWorkflow.baseDir": "D:\\CF\\work",   // 不想用默认 ~/.acm-workflow 时
}
```

**场景二：使用自己的代码模板**

```jsonc
{
  "acmWorkflow.templatePath": "C:\\Users\\me\\templates\\my_template.cpp"
}
```

**场景三：WSL 环境准备**

在 WSL 里使用或开发本扩展时，先安装基础环境：

```bash
bash tools/setup_wsl.sh                  # g++ / curl / python3 / 浏览器
bash tools/setup_wsl.sh --with-translate # 需要本地离线翻译时
```

如果不想在 Linux 里装浏览器，可以把 `acmWorkflow.browserPath` 指向 Windows 侧浏览器：
`/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。

**场景四：本地离线翻译（推荐，完全不走外网）**

1. 安装本地环境并启动服务：
   ```bash
   bash tools/setup_local_translate.sh
   bash tools/start_local_translate.sh --port 5000
   ```
2. VS Code 设置：
   ```jsonc
   {
     "acmWorkflow.translateProvider": "local",
     "acmWorkflow.localEndpoint": "http://127.0.0.1:5000/translate",
     "acmWorkflow.localAutoStart": true
   }
   ```
   之后打开 VS Code 首次使用翻译时会自动拉起本地服务；也可以手动运行 `bash tools/start_local_translate.sh --port 5000`。

**场景五：DeepSeek 翻译**

1. 设置 `acmWorkflow.translateProvider` 为 `deepseek`
2. 首次翻译时输入 API Key（存系统密钥链，之后无需再输）

**场景六：走代理访问 CF**

```jsonc
{
  "acmWorkflow.proxy": "http://127.0.0.1:7890"
}
```
