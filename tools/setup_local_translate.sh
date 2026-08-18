#!/usr/bin/env bash
#
# ACM Workflow 本地离线翻译环境安装脚本
#
# 功能：
#   1. 创建/复用 Python 虚拟环境并安装 argos-translate-lt
#   2. 下载并安装 Argos en -> zh 模型（默认 argos-net.com，可用 ARGOS_MODEL_URL 覆盖）
#   3. 下载 MiniSBD en.onnx（默认 GitHub Release，可用 MINISBD_EN_URL 覆盖）
#   4. 提示启动本地翻译服务
#
# 用法：
#   bash tools/setup_local_translate.sh
#
# 可选环境变量：
#   PIP_INDEX_URL       pip 镜像，例如 https://pypi.tuna.tsinghua.edu.cn/simple
#   ARGOS_MODEL_URL     Argos en->zh 模型下载地址
#   MINISBD_EN_URL      MiniSBD en.onnx 下载地址
#   VENV_DIR            虚拟环境目录（默认 ~/.local/share/acm-workflow-translate/venv）
#
# 适用于 Linux / WSL / macOS。Windows 用户建议在 WSL 中运行。

set -euo pipefail

# 如果用户已有 LibreTranslate 的 venv，默认复用它；否则新建独立 venv
if [ -z "${VENV_DIR:-}" ] && [ -x "$HOME/LibreTranslate/venv/bin/python" ]; then
  VENV_DIR="$HOME/LibreTranslate/venv"
  echo "==> 检测到 LibreTranslate venv，将复用: $VENV_DIR"
fi
VENV_DIR="${VENV_DIR:-$HOME/.local/share/acm-workflow-translate/venv}"
ARGOS_DATA_DIR="${ARGOS_DATA_DIR:-$HOME/.local/share/argos-translate}"
ARGOS_MODEL_URL="${ARGOS_MODEL_URL:-https://argos-net.com/v1/translate-en_zh-1_9.argosmodel}"
MINISBD_EN_URL="${MINISBD_EN_URL:-https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/en.onnx}"

MODEL_FILE="$ARGOS_DATA_DIR/translate-en_zh-1_9.argosmodel"
MINISBD_DIR="$ARGOS_DATA_DIR/minisbd"
MINISBD_FILE="$MINISBD_DIR/en.onnx"

PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "==> 1/4 准备 Python 虚拟环境: $VENV_DIR"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi
PY="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

echo "==> 2/4 安装 argos-translate-lt"
"$PIP" install --upgrade argos-translate-lt

echo "==> 3/4 准备 Argos en -> zh 模型"
mkdir -p "$ARGOS_DATA_DIR"

# 已安装则跳过下载
if "$PY" - <<'PY' >/dev/null 2>&1
from argostranslate import package
if any(getattr(p, "from_code", None) == "en" and getattr(p, "to_code", None) == "zh" for p in package.get_installed_packages()):
    raise SystemExit(0)
raise SystemExit(1)
PY
then
  echo "    已检测到 en -> zh 模型，跳过下载。"
else
  if [ -f "$MODEL_FILE" ]; then
    echo "    使用已有模型文件：$MODEL_FILE"
  else
    echo "    下载模型（约 68MB，可断点续传）..."
    mkdir -p "$ARGOS_DATA_DIR"
    curl -k -L -C - --retry 5 --retry-delay 2 -o "$MODEL_FILE" "$ARGOS_MODEL_URL"
  fi
  echo "    安装模型..."
  "$PY" - "$MODEL_FILE" <<'PY'
import sys
from pathlib import Path
from argostranslate import package

model_path = Path(sys.argv[1])
package.install_from_path(model_path)
print("    模型安装完成。")
PY
fi

echo "==> 4/4 准备 MiniSBD en.onnx（句切分模型）"
mkdir -p "$MINISBD_DIR"
if [ -f "$MINISBD_FILE" ]; then
  echo "    已存在 $MINISBD_FILE，跳过下载。"
else
  echo "    下载 $MINISBD_FILE ..."
  curl -k -L --retry 5 --retry-delay 2 -o "$MINISBD_FILE" "$MINISBD_EN_URL"
fi

echo
echo "==========================================================="
echo " 本地离线翻译环境已就绪。启动服务："
echo
echo "   $VENV_DIR/bin/python tools/local_translate_server.py --port 5000"
echo
echo " 然后在 VS Code 设置中填写："
echo '   "acmWorkflow.translateProvider": "local"'
echo '   "acmWorkflow.localEndpoint": "http://127.0.0.1:5000/translate"'
echo "==========================================================="
