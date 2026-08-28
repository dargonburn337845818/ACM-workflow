#!/usr/bin/env bash
#
# ACM Workflow WSL 环境准备脚本（Ubuntu / Debian）
#
# 功能：
#   1. 安装 g++ / curl / python3 / python3-venv / python3-pip
#   2. 安装 Chromium（如果系统没有 Chrome/Edge/Chromium）
#   3. 可选安装本地离线翻译环境（Ollama hy-mt2:latest）
#   4. 输出 VS Code 设置建议
#
# 用法：
#   bash tools/setup_wsl.sh            # 只装基础环境
#   bash tools/setup_wsl.sh --with-translate   # 基础环境 + 本地离线翻译
#
# 说明：
#   - 需要 sudo 权限
#   - 如果 apt 里的 chromium-browser 是 snap 过渡包且 snap 不可用，
#     脚本会给出手动安装 Google Chrome 或使用 Windows 浏览器的提示。
#   - 如果只是使用已打包的 VSIX，不需要 Node.js；要从源码开发才需要 Node 18+ / npm。
#     Ubuntu 可用: sudo apt install nodejs npm

set -euo pipefail

WITH_TRANSLATE=0
for arg in "$@"; do
  case "$arg" in
    --with-translate) WITH_TRANSLATE=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

if ! command -v apt-get >/dev/null 2>&1; then
  echo "错误：此脚本目前只支持 apt 系 WSL（Ubuntu / Debian）。" >&2
  exit 1
fi

echo "==> 1/3 更新软件源并安装基础工具"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential \
  g++ \
  curl \
  ca-certificates \
  python3 \
  python3-venv \
  python3-pip

echo "==> 2/3 检查浏览器"
if command -v google-chrome >/dev/null 2>&1 \
  || command -v microsoft-edge >/dev/null 2>&1 \
  || command -v chromium >/dev/null 2>&1 \
  || command -v chromium-browser >/dev/null 2>&1; then
  echo "    已检测到浏览器，跳过安装。"
else
  echo "    未检测到 Chrome/Edge/Chromium，尝试安装 chromium-browser ..."
  if sudo apt-get install -y --no-install-recommends chromium-browser; then
    echo "    chromium-browser 安装完成。"
  else
    echo "    apt 安装 Chromium 失败。请任选一种方式："
    echo "      1. 安装 Google Chrome：https://www.google.com/chrome/"
    echo "      2. 使用 Windows 自带 Edge：在 VS Code 设置里配置"
    echo '         "acmWorkflow.browserPath": "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"'
  fi
fi

if [ "$WITH_TRANSLATE" -eq 1 ]; then
  echo "==> 3/3 检查本地 Ollama 翻译环境"
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$SCRIPT_DIR/setup_local_translate.sh"
else
  echo "==> 3/3 跳过本地 Ollama 翻译（需要时运行 bash tools/setup_wsl.sh --with-translate）"
fi

echo
echo "==========================================================="
echo " WSL 基础环境准备完成。"
echo
echo " 浏览器通常会自动探测；如果没找到，可在 VS Code 设置中指定："
echo '   "acmWorkflow.browserPath": "/usr/bin/chromium"'
echo '   # 或复用 Windows 浏览器: "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"'
echo
echo " 从源码开发还需要 Node.js 18+ / npm："
echo '   sudo apt install nodejs npm'
echo "==========================================================="
