#!/usr/bin/env bash
#
# ACM Workflow 本地翻译环境检查脚本（llama.cpp / Windows 侧 llama-server.exe + Hy-MT2 GGUF）
#
# 功能：
#   1. 检查 D:\llama 下 llama-server.exe 与 Hy-MT2 GGUF 是否存在
#   2. 检查/拉起 llama-server 服务并确认模型别名 hy-mt2:latest
#   3. 输出 VS Code 设置建议
#
# 用法：
#   bash tools/setup_local_translate.sh
#
# 环境变量：
#   LLAMA_DIR         llama.cpp 目录（默认 /mnt/d/llama，Windows 原生默认 D:\llama）
#   LLAMA_SERVER      llama-server.exe 路径（默认 $LLAMA_DIR/llama-server.exe）
#   LLAMA_MODEL       GGUF 模型路径（默认 $LLAMA_DIR/Hy-MT2-1.8B-Q6_K.gguf）
#   LLAMA_MODEL_ALIAS 对外模型名（默认 hy-mt2:latest）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d /mnt/d/llama ]; then
  DEFAULT_LLAMA_DIR="/mnt/d/llama"
else
  DEFAULT_LLAMA_DIR="D:\\llama"
fi
LLAMA_DIR="${LLAMA_DIR:-$DEFAULT_LLAMA_DIR}"
LLAMA_SERVER="${LLAMA_SERVER:-$LLAMA_DIR/llama-server.exe}"
LLAMA_MODEL="${LLAMA_MODEL:-$LLAMA_DIR/Hy-MT2-1.8B-Q6_K.gguf}"
LLAMA_MODEL_ALIAS="${LLAMA_MODEL_ALIAS:-hy-mt2:latest}"

say() { printf '\n[setup] %s\n' "$*"; }

echo "==> 1/4 检查 llama.cpp 文件"
if [ ! -x "$LLAMA_SERVER" ]; then
  echo "错误：未找到 llama-server.exe：$LLAMA_SERVER" >&2
  echo "请确认 D:\llama 已解压 llama.cpp Windows 版本（支持 Q6_K 即可）。" >&2
  exit 1
fi
say "llama-server.exe 存在：$LLAMA_SERVER"

if [ ! -f "$LLAMA_MODEL" ]; then
  echo "错误：未找到翻译模型：$LLAMA_MODEL" >&2
  echo "请确认 D:\\llama 下存在 Hy-MT2-1.8B-Q6_K.gguf。" >&2
  exit 1
fi
say "GGUF 模型存在：$LLAMA_MODEL"

echo "==> 2/3 检查/拉起 llama-server 服务"
# 直接复用启动脚本的 --llama-only 逻辑（包含 WSL 宿主机 IP 探测与模型别名校验）
if LLAMA_DIR="$LLAMA_DIR" LLAMA_SERVER="$LLAMA_SERVER" LLAMA_MODEL="$LLAMA_MODEL" LLAMA_MODEL_ALIAS="$LLAMA_MODEL_ALIAS" \
  bash "$SCRIPT_DIR/start_local_translate.sh" --llama-only; then
  say "llama-server 服务与模型别名 $LLAMA_MODEL_ALIAS 均已就绪"
else
  echo "错误：llama-server 启动/探测失败。" >&2
  exit 1
fi

echo "==> 3/3 输出配置建议"
echo
echo "==========================================================="
echo " 本地翻译环境已就绪。扩展默认会自动拉起/调用："
echo
echo '   "acmWorkflow.translateProvider": "local"'
echo '   "acmWorkflow.localEndpoint": "http://127.0.0.1:11434"'
echo '   "acmWorkflow.localAutoStart": true'
echo '   "acmWorkflow.llamaDir": "D:\\llama"'
echo
echo " 手动启动（仅确保服务）："
echo "   bash tools/start_local_translate.sh --llama-only"
echo
echo " 扩展会在首次翻译时自动拉起 Windows 侧 llama-server，并在 VS Code 关闭时自动停止。"
echo "==========================================================="
