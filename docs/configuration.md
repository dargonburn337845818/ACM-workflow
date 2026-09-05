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
| `acmWorkflow.translateProvider` | enum | `"auto"` | 题面翻译后端：<br>• `auto` — MyMemory（国内可达、无需 key）+ Google 兜底，零配置<br>• `libre` — LibreTranslate，端点用 `libreEndpoint` 配置（可自建）<br>• `local` — 本地 llama.cpp `hy-mt2:latest`，端点用 `localEndpoint` 配置（推荐，见 `tools/`）<br>• `deepseek` — DeepSeek API，密钥存系统密钥链（见下） |
| `acmWorkflow.libreEndpoint` | string | `https://libretranslate.com/translate` | LibreTranslate 翻译端点。自建实例填 `http://localhost:5000/translate`。 |
| `acmWorkflow.localEndpoint` | string | `http://127.0.0.1:11434` | 本地翻译端点。默认直接使用 llama.cpp `hy-mt2:latest`；也可填兼容 LibreTranslate 的自建服务地址（如 `http://127.0.0.1:5000/translate`）。 |
| `acmWorkflow.localAutoStart` | boolean | `true` | 使用 `local` 后端时，若 llama-server 或本地翻译服务未启动，扩展自动拉起（默认拉起 Windows 侧 `D:\llama\llama-server.exe`）。 |
| `acmWorkflow.llamaDir` | string | `D:\llama` | llama.cpp 目录（含 llama-server.exe 与 GGUF 模型；WSL 下也可写 `/mnt/d/llama`）。 |
| `acmWorkflow.llamaModel` | string | `Hy-MT2-1.8B-Q6_K.gguf` | 本地翻译 GGUF 模型文件名（位于 `acmWorkflow.llamaDir` 下）。 |
| `acmWorkflow.llamaThreads` | number | `4` | llama-server CPU 线程数；默认 4 兼顾响应与低消耗。 |
| `acmWorkflow.sparkEndpoint` | string | `http://127.0.0.1:8080` | Spark 本地模型端点（llama.cpp OpenAI 兼容接口）。 |
| `acmWorkflow.sparkServerPath` | string | `D:\llama-spark\build\bin\llama-server.exe` | Spark 使用的 `llama-server.exe` 路径（含 CUDA DLL 的构建目录）。 |
| `acmWorkflow.sparkModelPath` | string | `D:\llama\Spark-X2.5-4B-Q8_0\Spark-X2.5-4B-Q8_0.gguf` | Spark GGUF 模型文件路径。 |
| `acmWorkflow.sparkModelName` | string | `spark:latest` | Spark 在 llama-server 中的模型别名（`--alias`）。 |
| `acmWorkflow.sparkAutoStart` | boolean | `true` | 规则模板未覆盖输入格式时自动拉起本地 4B 模型；简单格式不启动模型。 |
| `acmWorkflow.sparkIdleTimeoutMs` | number | `180000` | Spark 空闲多少毫秒后自动停止并释放显存；0 表示不自动停止。 |
| `acmWorkflow.sparkCtxSize` | number | `8192` | Spark 上下文长度；默认 8192，轻量化本地运行。 |
| `acmWorkflow.sparkBatchSize` | number | `256` | Spark llama-server 批大小；默认 256，降低内存占用。 |
| `acmWorkflow.sparkThreads` | number | `8` | Spark llama-server CPU 线程数；默认 8，兼顾速度与 CPU 占用。 |
| `acmWorkflow.sparkCacheTypeK` | string | `q4_0` | Spark KV cache K 类型（与 `startmain.ps1` 一致）。 |
| `acmWorkflow.sparkCacheTypeV` | string | `q4_0` | Spark KV cache V 类型（与 `startmain.ps1` 一致）。 |
| `acmWorkflow.sparkGpuLayers` | number | `0` | Spark 加载到 GPU 的层数；默认 0（CPU 轻量运行），有独立显卡时可调高。 |
| `acmWorkflow.sparkMaxTokens` | number | `1024` | Spark 单次生成的最大 token 数；默认 1024，足够小型样例随机化脚本。 |
| `acmWorkflow.sparkRequestTimeoutMs` | number | `60000` | Spark 生成请求超时（毫秒），默认 60 秒。 |
| `acmWorkflow.sparkScriptPath` | string | `""` → 当前题目目录 `gen.py` | AI 生成的造数据 Python 脚本保存路径。留空按题目目录隔离，避免不同题目互相覆盖；填写后改为全局固定路径。 |
| `acmWorkflow.browserPath` | string | `""` | Puppeteer 使用的浏览器可执行文件路径。留空自动探测 Edge/Chrome/Chromium。 |
| `acmWorkflow.followHandles` | string[] | `[]` | 比赛面板「我的关注」榜单的额外关注 handle（逗号分隔编辑；自己的 `cfHandle` 自动包含，大小写不敏感）。 |
| `acmWorkflow.proxy` | string | `""` | CF 网络代理地址，如 `http://127.0.0.1:7890`。**VS Code 扩展进程的请求不跟随系统代理**，需要代理访问 CF 时在此填写；留空则尝试环境变量 `HTTPS_PROXY` / `HTTP_PROXY`。 |

## 敏感信息（不入配置，存系统密钥链）

以下数据**绝不写入设置文件**，全部通过 `vscode.SecretStorage`（Windows 凭据管理器 / macOS 钥匙串 / Linux libsecret）加密保存：

| 密钥 | 内容 | 写入时机 |
|---|---|---|
| `cf.session` | CF 登录会话（全量 Cookie + localStorage + 登录时间） | 工作台顶部「登录」成功后 |
| `acmWorkflow.deepseekKey` | DeepSeek API Key | 首次使用 deepseek 翻译时输入 |

## 数据目录结构（默认 `~/.acm-workflow`）

```
~/.acm-workflow/
├── code/                    # 生成的题目代码
│   ├── Codeforces/
│   │   ├── 154A/            #   单题：目录名 = 题号
│   │   │   └── Hometask.cpp
│   │   └── Contest_2257/    #   比赛：contest_{id}_{index}.cpp + .prob
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

**场景三：本地 llama.cpp 翻译（推荐，完全不走外网）**

1. 检查/准备 D:\llama 下的 llama.cpp 与模型：
   ```bash
   bash tools/setup_local_translate.sh
   ```
   翻译模型为 `D:\llama\Hy-MT2-1.8B-Q6_K.gguf`（约 1.47 GB，纯 CPU 低消耗）。
   Q6_K 为标准量化，使用官方预编译版 llama.cpp 即可直接加载。
   扩展会在首次使用 `local` 翻译时自动拉起 Windows 侧 `D:\llama\llama-server.exe`。
2. VS Code 设置：
   ```jsonc
   {
     "acmWorkflow.translateProvider": "local",
     "acmWorkflow.localEndpoint": "http://127.0.0.1:11434",
     "acmWorkflow.localAutoStart": true,
     "acmWorkflow.llamaDir": "D:\\llama",
     "acmWorkflow.llamaModel": "Hy-MT2-1.8B-Q6_K.gguf",
     "acmWorkflow.llamaThreads": 4
   }
   ```
   之后打开 VS Code 首次使用翻译时会自动拉起 `llama-server.exe`；也可以手动运行 `bash tools/setup_local_translate.sh` 检查环境。

**场景四：DeepSeek 翻译**

1. 设置 `acmWorkflow.translateProvider` 为 `deepseek`
2. 首次翻译时输入 API Key（存系统密钥链，之后无需再输）

**场景五：走代理访问 CF**

```jsonc
{
  "acmWorkflow.proxy": "http://127.0.0.1:7890"
}
```
