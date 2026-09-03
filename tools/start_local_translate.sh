#!/usr/bin/env bash
#
# 启动 ACM Workflow 本地翻译服务（llama.cpp / Windows 侧 llama-server.exe + Hy-MT2 GGUF）。
#
# 如果 llama-server 未启动，会尝试拉起 Windows 里的 D:\llama\llama-server.exe；
# 扩展默认直接调用其 OpenAI 兼容接口（/v1/chat/completions）。
# 本脚本也保留 --port 模式：启动轻量 Python HTTP 服务，把 LibreTranslate 风格
# /translate 请求转发给 llama-server。
#
# 用法：
#   bash tools/start_local_translate.sh [--llama-only] [--port 5000]
#
# 环境变量：
#   LLAMA_DIR         llama.cpp 目录（默认 /mnt/d/llama，Windows 原生默认 D:\llama）
#   LLAMA_SERVER      llama-server.exe 路径（默认 $LLAMA_DIR/llama-server.exe）
#   LLAMA_MODEL       GGUF 模型路径（默认 $LLAMA_DIR/Hy-MT2-1.8B-Q6_K.gguf）
#   LLAMA_MODEL_ALIAS 对外模型名（默认 hy-mt2:latest，保持旧配置兼容）
#   LLAMA_URL         llama-server API 地址（默认 http://127.0.0.1:11434）
#   LLAMA_PORT        服务端口（默认 11434）
#   LLAMA_THREADS     CPU 线程数（默认 4，低消耗）
#   LLAMA_CTX         上下文长度（默认 4096，兼容模型卡 max_tokens=4096）
#   LLAMA_BATCH       批大小（默认 512，兼顾响应与占用）
#   LLAMA_LOG_FILE    llama-server 日志文件（默认 $SCRIPT_DIR/llama-server.log，方便排查拉起失败）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5000}"
LLAMA_PORT="${LLAMA_PORT:-11434}"
LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:${LLAMA_PORT}}"
if [ -d /mnt/d/llama ]; then
  DEFAULT_LLAMA_DIR="/mnt/d/llama"
else
  DEFAULT_LLAMA_DIR="D:\\llama"
fi
LLAMA_DIR="${LLAMA_DIR:-$DEFAULT_LLAMA_DIR}"
LLAMA_SERVER="${LLAMA_SERVER:-$LLAMA_DIR/llama-server.exe}"
LLAMA_MODEL="${LLAMA_MODEL:-$LLAMA_DIR/Hy-MT2-1.8B-Q6_K.gguf}"
LLAMA_MODEL_ALIAS="${LLAMA_MODEL_ALIAS:-hy-mt2:latest}"
LLAMA_THREADS="${LLAMA_THREADS:-4}"
LLAMA_CTX="${LLAMA_CTX:-4096}"
LLAMA_BATCH="${LLAMA_BATCH:-512}"
LLAMA_PID_FILE="${LLAMA_PID_FILE:-$SCRIPT_DIR/.llama-server.pid}"
LLAMA_LOG_FILE="${LLAMA_LOG_FILE:-$SCRIPT_DIR/llama-server.log}"
LLAMA_ONLY=0
STARTED_BY_US=0

# 解析参数
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port)
      PORT="${2:-$PORT}"
      shift 2
      ;;
    --llama-port)
      LLAMA_PORT="${2:-$LLAMA_PORT}"
      LLAMA_URL="http://127.0.0.1:${LLAMA_PORT}"
      shift 2
      ;;
    --llama-only|--ollama-only)
      LLAMA_ONLY=1
      shift
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n[local-translate] %s\n' "$*"; }

# WSL2 下自动发现 Windows 宿主机 IP，用于访问 Windows 侧 llama-server
wsl_host_ip() {
  local ip=""
  ip="$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)"
  if [ -z "$ip" ]; then
    ip="$(grep nameserver /etc/resolv.conf 2>/dev/null | awk '{print $2}' | head -1)"
  fi
  printf '%s' "$ip"
}

resolve_llama_url() {
  # WSL 且默认 127.0.0.1 连不通时，尝试 Windows 宿主机 IP
  if [ -d /mnt/c ] && [ -x /mnt/c/Windows/System32/cmd.exe ]; then
    if ! curl -fsS --max-time 2 "$LLAMA_URL/health" >/dev/null 2>&1; then
      local host_ip
      host_ip="$(wsl_host_ip)"
      if [ -n "$host_ip" ]; then
        local candidate="http://$host_ip:$LLAMA_PORT"
        if curl -fsS --max-time 2 "$candidate/health" >/dev/null 2>&1; then
          say "Windows 宿主机 llama-server 可达，使用 $candidate"
          LLAMA_URL="$candidate"
        fi
      fi
    fi
  fi
}

llama_ready() {
  curl -fsS --max-time 3 "$LLAMA_URL/health" >/dev/null 2>&1
}

start_llama_windows() {
  # WSL 里启动 Windows 侧 llama-server。
  # 使用 PowerShell Start-Process 启动独立的 Windows 进程，能正常返回且进程可存活。
  local exe="${LLAMA_SERVER:-}"
  if [ -z "$exe" ] && [ -x "/mnt/d/llama/llama-server.exe" ]; then
    exe="/mnt/d/llama/llama-server.exe"
  fi
  if [ -n "$exe" ] && [ -x "$exe" ]; then
    local win_exe win_model win_log_file
    win_exe="$(wslpath -w "$exe" 2>/dev/null || echo "$exe")"
    win_model="$(wslpath -w "$LLAMA_MODEL" 2>/dev/null || echo "$LLAMA_MODEL")"
    win_log_file="$(wslpath -w "$LLAMA_LOG_FILE" 2>/dev/null || echo "$LLAMA_LOG_FILE")"
    say "尝试启动 Windows llama-server: $win_exe"
    powershell.exe -NoProfile -Command "Start-Process -FilePath '$win_exe' -ArgumentList '-m','$win_model','--host','0.0.0.0','--port','$LLAMA_PORT','--ctx-size','$LLAMA_CTX','--batch-size','$LLAMA_BATCH','--ubatch-size','$LLAMA_BATCH','--threads','$LLAMA_THREADS','--parallel','1','--no-webui','--jinja','--alias','$LLAMA_MODEL_ALIAS','--log-file','$win_log_file' -WindowStyle Hidden" >/dev/null 2>&1 || true
  fi
}

start_llama_linux() {
  if [ -x "$LLAMA_SERVER" ]; then
    say "尝试启动本机 llama-server: $LLAMA_SERVER"
    nohup "$LLAMA_SERVER" -m "$LLAMA_MODEL" --host 0.0.0.0 --port "$LLAMA_PORT" \
      --ctx-size "$LLAMA_CTX" --batch-size "$LLAMA_BATCH" --ubatch-size "$LLAMA_BATCH" \
      --threads "$LLAMA_THREADS" --parallel 1 --no-webui --jinja --alias "$LLAMA_MODEL_ALIAS" \
      --log-file "$LLAMA_LOG_FILE" >/dev/null 2>&1 &
  fi
}

write_llama_pid() {
  local pid
  pid="$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort $LLAMA_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)" 2>/dev/null | tr -d '\r' | head -1)"
  if [ -n "$pid" ] && [ "$pid" -gt 0 ] 2>/dev/null; then
    if ! echo "$pid" > "$LLAMA_PID_FILE" 2>/dev/null; then
      say "警告：无法写入 PID 文件 $LLAMA_PID_FILE（VS Code 关闭时可能不会自动停止）"
    else
      say "已记录本次自动拉起的 llama-server PID: $pid"
    fi
  fi
}

ensure_llama() {
  resolve_llama_url
  if llama_ready; then
    # 服务本来就在运行：不保留自动停止句柄，避免关闭 VS Code 时误杀用户手动启动的服务
    rm -f "$LLAMA_PID_FILE" 2>/dev/null || true
    return 0
  fi
  say "llama-server 未响应，尝试拉起..."
  STARTED_BY_US=1
  if [ -d /mnt/c ] && [ -x /mnt/c/Windows/System32/cmd.exe ]; then
    start_llama_windows
  else
    start_llama_linux
  fi
  # 启动后循环重新探测：Windows llama-server 监听 0.0.0.0 后，WSL2 可从宿主机 IP 访问
  for _ in $(seq 1 60); do
    resolve_llama_url
    if llama_ready; then
      if [ "$STARTED_BY_US" -eq 1 ]; then
        write_llama_pid
      fi
      return 0
    fi
    sleep 1
  done
  echo "错误：llama-server 服务仍不可用（$LLAMA_URL）。" >&2
  echo "请确认 D:\\llama 下存在 llama-server.exe 与 Hy-MT2-1.8B-Q6_K.gguf。" >&2
  echo "如仍失败，请查看 llama-server 日志：$LLAMA_LOG_FILE" >&2
  exit 1
}

ensure_model() {
  if ! curl -fsS --max-time 3 "$LLAMA_URL/v1/models" 2>/dev/null | grep -q "$LLAMA_MODEL_ALIAS"; then
    echo "错误：llama-server 中未找到模型别名 $LLAMA_MODEL_ALIAS。" >&2
    echo "请确认启动参数含 --alias $LLAMA_MODEL_ALIAS，或设置 LLAMA_MODEL_ALIAS。" >&2
    exit 1
  fi
}

ensure_llama
ensure_model

if [ "$LLAMA_ONLY" -eq 1 ]; then
  say "llama-server 已就绪：$LLAMA_URL / $LLAMA_MODEL_ALIAS"
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

say "启动本地翻译 HTTP 服务：端口 $PORT，后端 llama-server $LLAMA_MODEL_ALIAS"
exec "$PYTHON_BIN" "$SCRIPT_DIR/local_translate_server.py" --host 127.0.0.1 --port "$PORT" --model "$LLAMA_MODEL_ALIAS" --llama-url "$LLAMA_URL"
