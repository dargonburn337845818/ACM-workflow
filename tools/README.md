# ACM Workflow 工具脚本

本目录包含 WSL 环境准备和本地离线翻译两类脚本。

## WSL 环境准备

在 WSL（Ubuntu/Debian）里一键安装扩展运行/开发所需的基础环境：

```bash
bash tools/setup_wsl.sh                  # g++ / curl / python3 / 浏览器
bash tools/setup_wsl.sh --with-translate # 额外安装本地离线翻译
```

脚本会自动安装 `g++`、`curl`、`python3`、`python3-venv`，并尝试安装 Chromium。
如果 apt 的 Chromium 不可用，也可以在 VS Code 设置里把 `acmWorkflow.browserPath`
指向 Windows 侧浏览器，例如：

```jsonc
{
  "acmWorkflow.browserPath": "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
}
```

## 本地离线翻译（Local Translate）

这套脚本让 ACM Workflow 可以在**完全不依赖外网翻译 API** 的情况下把 Codeforces 题面翻译成简体中文。

原理：直接使用 [Argos Translate](https://github.com/argosopentech/argos-translate)（`argos-translate-lt`）加载本地 `en -> zh` 模型，
再提供一个与 LibreTranslate 兼容的极简 HTTP 接口，扩展通过 `acmWorkflow.localEndpoint` 调用。

### 快速开始

```bash
# 1. 安装依赖 + 下载模型（需要能访问 GitHub / argos-net.com，之后可离线使用）
#    如果检测到 ~/LibreTranslate/venv 会自动复用；否则新建独立 venv
bash tools/setup_local_translate.sh

# 2. 启动本地翻译服务（自动选择可用的 venv）
bash tools/start_local_translate.sh --port 5000
```

## VS Code 设置

```jsonc
{
  "acmWorkflow.translateProvider": "local",
  "acmWorkflow.localEndpoint": "http://127.0.0.1:5000/translate",
  "acmWorkflow.localAutoStart": true
}
```

`localAutoStart` 默认为 `true`：打开 VS Code 后第一次翻译时会自动拉起本地服务，不需要手动启动。
如果你不想让扩展自动拉起，把它设为 `false`，然后手动运行：

```bash
bash tools/start_local_translate.sh --port 5000
```

## 文件说明

| 文件 | 作用 |
|---|---|
| `setup_wsl.sh` | WSL 基础环境一键安装（g++ / curl / python3 / 浏览器），可选本地翻译 |
| `local_translate_server.py` | 极简本地翻译 HTTP 服务，实现 `GET /languages` 和 `POST /translate` |
| `setup_local_translate.sh` | 一键准备虚拟环境、安装 Argos en->zh 模型与 MiniSBD 句切分模型 |
| `start_local_translate.sh` | 启动本地翻译服务（自动选择已装好的 venv） |

## 如果你已经有 LibreTranslate

如果你已经在本地跑起了 LibreTranslate（`http://localhost:5000`），也可以不启动本脚本，直接把
`acmWorkflow.translateProvider` 设为 `libre`、`acmWorkflow.libreEndpoint` 设为
`http://localhost:5000/translate`。新增的 `local` 模式只是“只连本地端点、不走在线兜底”的专用选项。

## 断网/被墙注意事项

- 模型文件约 68MB，来自 `argos-net.com`；如果下载慢，可以先下载好放到 `~/.local/share/argos-translate/translate-en_zh-1_9.argosmodel`，脚本会直接使用；也可以用 `ARGOS_MODEL_URL` 指向内网/本地地址（如 `file:///path/to/model.argosmodel`）。
- MiniSBD 的 `en.onnx` 约 184KB，来自 GitHub Release；同样可用 `MINISBD_EN_URL` 覆盖。
- 模型装好后，日常翻译完全离线，不需要再访问外网。
