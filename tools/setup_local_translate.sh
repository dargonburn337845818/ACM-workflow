#!/usr/bin/env bash
#
# ACM Workflow 本地翻译环境安装/检查脚本（Ollama hy-mt2:latest）
#
# 功能：
#   1. 检查 Ollama 服务是否可用，不可用时尝试拉起
#   2. 检查 hy-mt2:latest 模型是否存在，不存在时提示/尝试拉取
#   3. 输出 VS Code 设置建议
#
# 用法：
#   bash tools/setup_local_translate.sh
#
# 环境变量：
#   OLLAMA_URL       Ollama API 地址（默认 http://127.0.0.1:11434）
#   OLLAMA_MODEL     翻译模型名（默认 hy-mt2:latest）
#   OLLAMA_EXE       Windows 侧 ollama.exe 路径（WSL 自动探测时可用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-hy-mt2:latest}"

# 优先使用 PATH 中的 ollama；否则在 WSL 里尝试 Windows 侧 ollama.exe
OLLAMA_CLI=""
if command -v ollama >/dev/null 2>&1; then
  OLLAMA_CLI="$(command -v ollama)"
elif [ -n "${OLLAMA_EXE:-}" ] && [ -x "$OLLAMA_EXE" ]; then
  OLLAMA_CLI="$OLLAMA_EXE"
elif [ -x "/mnt/c/Users/ru/AppData/Local/Programs/Ollama/ollama.exe" ]; then
  OLLAMA_CLI="/mnt/c/Users/ru/AppData/Local/Programs/Ollama/ollama.exe"
fi

say() { printf '\n[setup] %s\n' "$*"; }

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
  # 不要用 `cmd.exe /c start ...`（WSL 互操作下会挂起）。
  # 改用 PowerShell Start-Process 启动独立的 Windows 进程。
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

echo "==> 1/3 检查 Ollama 服务"
resolve_ollama_url
if ollama_ready; then
  say "Ollama API 可用：$OLLAMA_URL"
else
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
      break
    fi
    sleep 1
  done
  resolve_ollama_url
  if ! ollama_ready; then
    echo "错误：Ollama 服务仍不可用（$OLLAMA_URL）。" >&2
    echo "请先在 Windows 启动 Ollama 托盘，或安装 Ollama：https://ollama.com" >&2
    exit 1
  fi
fi

echo "==> 2/3 检查翻译模型 $OLLAMA_MODEL"
if curl -fsS --max-time 3 "$OLLAMA_URL/api/tags" 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
  say "模型已存在：$OLLAMA_MODEL"
else
  say "未找到 $OLLAMA_MODEL，尝试拉取..."
  if [ -n "$OLLAMA_CLI" ]; then
    "$OLLAMA_CLI" pull "$OLLAMA_MODEL"
  else
    echo "错误：未找到 ollama 命令，无法自动拉取模型。" >&2
    echo "请先在 Windows Ollama 中拉取：ollama pull $OLLAMA_MODEL" >&2
    exit 1
  fi
fi

echo "==> 3/3 输出配置建议"
echo
echo "==========================================================="
echo " 本地翻译环境已就绪。启动服务："
echo
echo "   bash tools/start_local_translate.sh --port 5000"
echo
echo " 然后在 VS Code 设置中填写："
echo '   "acmWorkflow.translateProvider": "local"'
echo '   "acmWorkflow.localEndpoint": "http://127.0.0.1:5000/translate"'
echo '   "acmWorkflow.localAutoStart": true'
echo
echo " 扩展会在首次翻译时自动拉起该服务，并在 VS Code 关闭时自动停止。"
echo "==========================================================="
