#!/usr/bin/env bash
#
# 启动 ACM Workflow 的 Spark 本地模型（llama.cpp / Windows 侧 llama-server.exe + Spark GGUF）。
# 与 tools/start_local_translate.sh 并列，但使用独立端口与 PID 文件，便于空闲自动释放。
#
# 用法：
#   bash tools/start_spark.sh
#
# 环境变量：
#   SPARK_SERVER       llama-server.exe 路径（默认 /mnt/d/llama-spark/build/bin/llama-server.exe 或 D:\llama-spark\build\bin\llama-server.exe）
#   SPARK_MODEL        GGUF 模型路径（默认 D:\llama\Spark-X2.5-4B-Q8_0\Spark-X2.5-4B-Q8_0.gguf）
#   SPARK_MODEL_ALIAS  对外模型名（默认 spark:latest）
#   SPARK_PORT         服务端口（默认 8080）
#   SPARK_CTX          上下文长度（默认 8192）
#   SPARK_BATCH        批大小（默认 256）
#   SPARK_THREADS      CPU 线程数（默认 8）
#   SPARK_GPU_LAYERS   GPU 层数（默认 0 = CPU 轻量）
#   SPARK_LOG_FILE     llama-server 日志文件（默认 tools/spark-server.log）
#   SPARK_PID_FILE     PID 文件（默认 tools/.spark-server.pid）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARK_PORT="${SPARK_PORT:-8080}"
SPARK_URL="${SPARK_URL:-http://127.0.0.1:${SPARK_PORT}}"
SPARK_MODEL_ALIAS="${SPARK_MODEL_ALIAS:-spark:latest}"
SPARK_CTX="${SPARK_CTX:-8192}"
SPARK_BATCH="${SPARK_BATCH:-256}"
SPARK_THREADS="${SPARK_THREADS:-8}"
SPARK_GPU_LAYERS="${SPARK_GPU_LAYERS:-0}"
SPARK_CACHE_TYPE="${SPARK_CACHE_TYPE:-q4_0}"
SPARK_PID_FILE="${SPARK_PID_FILE:-$SCRIPT_DIR/.spark-server.pid}"
SPARK_LOG_FILE="${SPARK_LOG_FILE:-$SCRIPT_DIR/spark-server.log}"

if [ -d /mnt/d/llama-spark/build/bin ]; then
  DEFAULT_SPARK_SERVER="/mnt/d/llama-spark/build/bin/llama-server.exe"
else
  DEFAULT_SPARK_SERVER="D:\\llama-spark\\build\\bin\\llama-server.exe"
fi
if [ -f /mnt/d/llama/Spark-X2.5-4B-Q8_0/Spark-X2.5-4B-Q8_0.gguf ]; then
  DEFAULT_SPARK_MODEL="/mnt/d/llama/Spark-X2.5-4B-Q8_0/Spark-X2.5-4B-Q8_0.gguf"
else
  DEFAULT_SPARK_MODEL="D:\\llama\\Spark-X2.5-4B-Q8_0\\Spark-X2.5-4B-Q8_0.gguf"
fi
SPARK_SERVER="${SPARK_SERVER:-$DEFAULT_SPARK_SERVER}"
SPARK_MODEL="${SPARK_MODEL:-$DEFAULT_SPARK_MODEL}"

say() { printf '\n[spark] %s\n' "$*"; }

wsl_host_ip() {
  local ip=""
  ip="$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)"
  if [ -z "$ip" ]; then
    ip="$(grep nameserver /etc/resolv.conf 2>/dev/null | awk '{print $2}' | head -1)"
  fi
  printf '%s' "$ip"
}

resolve_spark_url() {
  if [ -d /mnt/c ] && [ -x /mnt/c/Windows/System32/cmd.exe ]; then
    if ! curl -fsS --max-time 2 "$SPARK_URL/health" >/dev/null 2>&1; then
      local host_ip
      host_ip="$(wsl_host_ip)"
      if [ -n "$host_ip" ]; then
        local candidate="http://$host_ip:$SPARK_PORT"
        if curl -fsS --max-time 2 "$candidate/health" >/dev/null 2>&1; then
          say "Windows 宿主机 llama-server 可达，使用 $candidate"
          SPARK_URL="$candidate"
        fi
      fi
    fi
  fi
}

spark_ready() {
  curl -fsS --max-time 3 "$SPARK_URL/health" >/dev/null 2>&1
}

write_spark_pid() {
  local pid
  pid="$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort $SPARK_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)" 2>/dev/null | tr -d '\r' | head -1)"
  if [ -n "$pid" ] && [ "$pid" -gt 0 ] 2>/dev/null; then
    if ! echo "$pid" > "$SPARK_PID_FILE" 2>/dev/null; then
      say "警告：无法写入 PID 文件 $SPARK_PID_FILE（VS Code 关闭/空闲释放时可能不会自动停止）"
    else
      say "已记录本次自动拉起的 llama-server PID: $pid"
    fi
  fi
}

start_spark_windows() {
  local exe="$SPARK_SERVER"
  if [ -z "$exe" ] || [ ! -e "$exe" ]; then
    say "找不到 llama-server: $exe"
    return 1
  fi
  local win_exe win_model win_log_file
  win_exe="$(wslpath -w "$exe" 2>/dev/null || echo "$exe")"
  win_model="$(wslpath -w "$SPARK_MODEL" 2>/dev/null || echo "$SPARK_MODEL")"
  win_log_file="$(wslpath -w "$SPARK_LOG_FILE" 2>/dev/null || echo "$SPARK_LOG_FILE")"
  say "尝试启动 Windows llama-server: $win_exe"
  powershell.exe -NoProfile -Command "Start-Process -FilePath '$win_exe' -ArgumentList '-m','$win_model','--host','0.0.0.0','--port','$SPARK_PORT','--ctx-size','$SPARK_CTX','--batch-size','$SPARK_BATCH','--ubatch-size','$SPARK_BATCH','--threads','$SPARK_THREADS','--parallel','1','--no-webui','--jinja','--alias','$SPARK_MODEL_ALIAS','-ngl','$SPARK_GPU_LAYERS','--flash-attn','on','--cache-type-k','$SPARK_CACHE_TYPE','--cache-type-v','$SPARK_CACHE_TYPE','--reasoning','off','--log-file','$win_log_file' -WindowStyle Hidden" >/dev/null 2>&1 || true
}

start_spark_linux() {
  if [ -x "$SPARK_SERVER" ]; then
    say "尝试启动本机 llama-server: $SPARK_SERVER"
    nohup "$SPARK_SERVER" -m "$SPARK_MODEL" --host 0.0.0.0 --port "$SPARK_PORT" \
      --ctx-size "$SPARK_CTX" --batch-size "$SPARK_BATCH" --ubatch-size "$SPARK_BATCH" \
      --threads "$SPARK_THREADS" --parallel 1 --no-webui --jinja --alias "$SPARK_MODEL_ALIAS" \
      -ngl "$SPARK_GPU_LAYERS" --flash-attn on --cache-type-k "$SPARK_CACHE_TYPE" --cache-type-v "$SPARK_CACHE_TYPE" --reasoning off --log-file "$SPARK_LOG_FILE" >/dev/null 2>&1 &
  fi
}

resolve_spark_url
if spark_ready; then
  # 服务本来就在运行：不保留自动停止句柄，避免空闲时误杀用户手动启动的服务
  rm -f "$SPARK_PID_FILE" 2>/dev/null || true
  say "llama-server 已在运行：$SPARK_URL"
  exit 0
fi

say "llama-server 未响应，尝试拉起..."
if [ -d /mnt/c ] && [ -x /mnt/c/Windows/System32/cmd.exe ]; then
  start_spark_windows
else
  start_spark_linux
fi

for _ in $(seq 1 120); do
  resolve_spark_url
  if spark_ready; then
    write_spark_pid
    say "llama-server 已就绪：$SPARK_URL / $SPARK_MODEL_ALIAS"
    exit 0
  fi
  sleep 0.5
done

echo "错误：llama-server 服务仍不可用（$SPARK_URL）。" >&2
echo "请确认 $SPARK_SERVER 与 $SPARK_MODEL 存在。" >&2
echo "如仍失败，请查看日志：$SPARK_LOG_FILE" >&2
exit 1
