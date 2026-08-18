#!/usr/bin/env bash
#
# 启动 ACM Workflow 本地离线翻译服务。
# 自动优先使用 ~/LibreTranslate/venv，其次使用 setup_local_translate.sh 创建的独立 venv。
#
# 用法：
#   bash tools/start_local_translate.sh [--port 5000]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -x "$HOME/LibreTranslate/venv/bin/python" ]; then
  PY="$HOME/LibreTranslate/venv/bin/python"
elif [ -x "$HOME/.local/share/acm-workflow-translate/venv/bin/python" ]; then
  PY="$HOME/.local/share/acm-workflow-translate/venv/bin/python"
else
  echo "错误：未找到可用的 Python 虚拟环境。" >&2
  echo "请先运行: bash tools/setup_local_translate.sh" >&2
  exit 1
fi

exec "$PY" "$SCRIPT_DIR/local_translate_server.py" "$@"
