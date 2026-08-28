#!/usr/bin/env bash
#
# 启动 ACM Workflow 本地翻译服务（Ollama hy-mt2:latest）。
#
# 如果 Ollama 服务未启动，会尝试拉起 Windows/WSL 里的 Ollama；
# 然后启动一个轻量 Python HTTP 服务，把扩展请求转发给 hy-mt2:latest。
#
# 用法：
#   bash tools/start_local_translate.sh [--port 5000]
#
# 环境变量：
#   OLLAMA_URL      Ollama API 地址（默认 http://127.0.0.1:11434）
#   OLLAMA_MODEL    翻译模型名（默认 hy-mt2:latest）
#   OLLAMA_EXE      Windows 侧 ollama.exe 路径（WSL 自动探测时可用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5000}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-hy-mt2:latest}"
OLLAMA_ONLY=0

# 解析参数
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port)
      PORT="${2:-$PORT}"
      shift 2
      ;;
    --ollama-only)
      OLLAMA_ONLY=1
      shift
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n[local-translate] %s\n' "$*"; }

# WSL2 下自动发现 Windows 宿主机 IP，用于访问 Windows 侧 Ollama
wsl_host_ip() {
  local ip=""
  ip="$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)"
  if [ -z "$ip" ]; then
    ip="$(grep nameserver /etc/resolv.conf 2>/dev/null | awk '{print $2}' | head -1)"
  fi
  printf '%s' "$ip"
}

resolve_ollama_url() {
  # WSL 且默认 127.0.0.1 连不通时，尝试 Windows 宿主机 IP
  if [ -d /mnt/c ] && [ -x /mnt/c/Windows/System32/cmd.exe ]; then
    if ! curl -fsS --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
      local host_ip
      host_ip="$(wsl_host_ip)"
      if [ -n "$host_ip" ]; then
        local candidate="http://$host_ip:11434"
        if curl -fsS --max-time 2 "$candidate/api/tags" >/dev/null 2>&1; then
          say "Windows 宿主机 Ollama 可达，使用 $candidate"
          OLLAMA_URL="$candidate"
        fi
      fi
    fi
  fi
}

ollama_ready() {
  curl -fsS --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1
}

start_ollama_windows() {
  # WSL 里启动 Windows 侧 Ollama。
  # 注意：不要用 `cmd.exe /c start ...` —— 在 WSL 互操作下启动 GUI/子进程会挂起，
  # 导致脚本卡在“尝试启动 Windows Ollama”而服务始终起不来。
  # 改用 PowerShell Start-Process 从 WSL 启动独立的 Windows 进程，能正常返回且进程可存活。
  local exe="${OLLAMA_EXE:-}"
  if [ -z "$exe" ] && [ -x "/mnt/c/Users/ru/AppData/Local/Programs/Ollama/ollama.exe" ]; then
    exe="/mnt/c/Users/ru/AppData/Local/Programs/Ollama/ollama.exe"
  fi
  if [ -n "$exe" ] && [ -x "$exe" ]; then
    local win_exe
    win_exe="$(wslpath -w "$exe" 2>/dev/null || echo "$exe")"
    say "尝试启动 Windows Ollama 服务: $win_exe serve"
    powershell.exe -NoProfile -Command "\$env:OLLAMA_HOST='${OLLAMA_HOST:-0.0.0.0:11434}'; Start-Process -FilePath '$win_exe' -ArgumentList 'serve' -WindowStyle Hidden" >/dev/null 2>&1 || true
  fi
}

start_ollama_linux() {
  if command -v ollama >/dev/null 2>&1; then
    say "尝试启动本机 Ollama: ollama serve"
    nohup ollama serve >/dev/null 2>&1 &
  fi
}

ensure_ollama() {
  resolve_ollama_url
  if ollama_ready; then
    return 0
  fi
  say "Ollama 未响应，尝试拉起..."
  if [ -d /mnt/c ] && [ -x /mnt/c/Windows/System32/cmd.exe ]; then
    start_ollama_windows
  else
    start_ollama_linux
  fi
  # 启动后循环重新探测：Windows Ollama 监听 0.0.0.0 后，WSL2 可从宿主机 IP 访问
  for _ in $(seq 1 30); do
    resolve_ollama_url
    if ollama_ready; then
      return 0
    fi
    sleep 1
  done
  echo "错误：Ollama 服务仍不可用（$OLLAMA_URL）。" >&2
  echo "请先在 Windows 启动 Ollama 托盘，或运行 tools/setup_local_translate.sh。" >&2
  exit 1
}

ensure_model() {
  if ! curl -fsS --max-time 3 "$OLLAMA_URL/api/tags" 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
    echo "错误：Ollama 中未找到模型 $OLLAMA_MODEL。" >&2
    echo "请运行：ollama pull $OLLAMA_MODEL 或 tools/setup_local_translate.sh" >&2
    exit 1
  fi
}

ensure_ollama
ensure_model

if [ "$OLLAMA_ONLY" -eq 1 ]; then
  say "Ollama 已就绪：$OLLAMA_URL / $OLLAMA_MODEL"
  exit 0
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python)"
else
  echo "错误：未找到 python3/python。" >&2
  exit 1
fi

say "启动本地翻译服务：端口 $PORT，模型 $OLLAMA_MODEL"
exec "$PYTHON_BIN" "$SCRIPT_DIR/local_translate_server.py" --host 127.0.0.1 --port "$PORT" --model "$OLLAMA_MODEL" --ollama-url "$OLLAMA_URL"
