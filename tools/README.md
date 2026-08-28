# ACM Workflow 工具脚本

本目录包含本地翻译相关脚本。

## 本地 Ollama 翻译（Local Translate）

这套脚本让 ACM Workflow 可以通过本机 [Ollama](https://ollama.com) 的 `hy-mt2:latest` 模型，
在**完全不依赖外网翻译 API** 的情况下把 Codeforces 题面翻译成简体中文。

原理：扩展默认直接调用 Ollama API（`http://127.0.0.1:11434`）上的 `hy-mt2:latest`（ID `ad76b286cab2`）。
`tools/start_local_translate.sh --ollama-only` 只负责确保 Ollama 已启动且模型存在；`local_translate_server.py` 仍保留，用于兼容自建 LibreTranslate 风格端点的场景。

### 快速开始

```bash
# 1. 检查 Ollama 服务与 hy-mt2:latest 模型；缺失时尝试拉起/拉取
bash tools/setup_local_translate.sh

# 2. 只确保 Ollama 就绪（扩展默认会自动执行；手动执行也可）
bash tools/start_local_translate.sh --ollama-only
```

## VS Code 设置

```jsonc
{
  "acmWorkflow.translateProvider": "local",
  "acmWorkflow.localEndpoint": "http://127.0.0.1:11434",
  "acmWorkflow.localAutoStart": true
}
```

`localAutoStart` 默认为 `true`：打开 VS Code 后第一次翻译时会自动拉起 Ollama `hy-mt2:latest`，不需要手动启动。

## 文件说明

| 文件 | 作用 |
|---|---|
| `local_translate_server.py` | 极简本地翻译 HTTP 服务，转发到 Ollama `hy-mt2:latest`，实现 `GET /languages` 和 `POST /translate` |
| `setup_local_translate.sh` | 检查/拉起 Ollama 服务，确认 `hy-mt2:latest` 模型存在 |
| `start_local_translate.sh` | 确保 Ollama 可用；`--ollama-only` 只检查/拉起模型，默认模式启动兼容 LibreTranslate 的 Python HTTP 服务 |

## 如果你已经有 LibreTranslate

如果你已经在本地跑起了 LibreTranslate（`http://localhost:5000`），也可以直接把
`acmWorkflow.translateProvider` 设为 `libre`、`acmWorkflow.libreEndpoint` 设为
`http://localhost:5000/translate`。`local` 模式默认直接使用 Ollama `hy-mt2:latest`。

## 断网/占用说明

- `hy-mt2:latest` 约 1.5 GB，100% GPU 运行，上下文 4096；扩展按需拉起 Ollama 与模型。
- 服务端翻译参数已按题面段落翻译调低：`num_ctx=2048`、`num_predict=512`、`temperature=0.3`、`keep_alive=3m`，在保证译文质量的同时降低显存/内存占用，空闲 3 分钟后自动卸载模型。
- 日常翻译完全本地，不需要访问外网翻译 API。
