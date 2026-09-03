# ACM Workflow 工具脚本

本目录包含本地翻译相关脚本。

## 本地 llama.cpp 翻译（Local Translate）

这套脚本让 ACM Workflow 通过 Windows 侧 [llama.cpp](https://github.com/ggml-org/llama.cpp) 的
`llama-server.exe` 加载 `Hy-MT2-1.8B-Q6_K.gguf`，在**完全不依赖外网翻译 API** 的情况下把
Codeforces 题面翻译成简体中文。

原理：扩展默认直接调用 llama-server 的 OpenAI 兼容接口
（`http://127.0.0.1:11434/v1/chat/completions`），模型别名为 `hy-mt2:latest`。
`tools/start_local_translate.sh --llama-only` 负责确保 Windows 侧 llama-server 已启动且模型就绪；
`local_translate_server.py` 仍保留，用于兼容自建 LibreTranslate 风格端点的场景。

### 快速开始

```bash
# 1. 检查 D:\llama 下的 llama-server.exe 与 Hy-MT2 GGUF；缺失时尝试拉起服务
bash tools/setup_local_translate.sh

# 2. 只确保 llama-server 就绪（扩展默认会自动执行；手动执行也可）
bash tools/start_local_translate.sh --llama-only
```

## VS Code 设置

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

`localAutoStart` 默认为 `true`：打开 VS Code 后第一次翻译时会自动拉起 Windows 侧
`D:\llama\llama-server.exe`，不需要手动启动；VS Code 关闭时会停止本次自动拉起的 llama-server
（不会误杀你自己手动启动的服务）。

## 文件说明

| 文件 | 作用 |
|---|---|
| `local_translate_server.py` | 极简本地翻译 HTTP 服务，转发到 llama-server，实现 `GET /languages` 和 `POST /translate` |
| `setup_local_translate.sh` | 检查/拉起 llama-server，确认 `Hy-MT2` GGUF 与 `hy-mt2:latest` 别名就绪 |
| `start_local_translate.sh` | 确保 llama-server 可用；`--llama-only` 只检查/拉起服务，默认模式启动兼容 LibreTranslate 的 Python HTTP 服务 |

## 如果你已经有 LibreTranslate

如果你已经在本地跑起了 LibreTranslate（`http://localhost:5000`），也可以直接把
`acmWorkflow.translateProvider` 设为 `libre`、`acmWorkflow.libreEndpoint` 设为
`http://localhost:5000/translate`。`local` 模式默认直接使用 llama.cpp `hy-mt2:latest`。

## 断网/占用说明

- `Hy-MT2-1.8B-Q6_K.gguf` 约 1.47 GB，纯 CPU 运行；扩展按需拉起 llama-server。
- `Q6_K` 是标准 GGUF 量化，当前 `D:\llama\llama-server.exe` 可直接加载；无需 PR #22836 / AngelSlim fork。
- 使用该模型时请保证 llama-server 带 `--jinja` 启动；1.8B / 7B 推荐采样参数：`temperature 0.7`、
  `top_p 0.6`、`top_k 20`、`repetition_penalty 1.05`、`max_tokens 4096`。
- 启动参数已按题面段落翻译调优：`--ctx-size 4096`、`--batch-size 512`、`--threads 4`、
  `--parallel 1`、`--no-webui`、`--jinja`，兼顾模型卡推荐配置与本地占用。
- 日常翻译完全本地，不需要访问外网翻译 API。
