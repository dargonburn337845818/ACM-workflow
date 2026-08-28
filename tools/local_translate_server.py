#!/usr/bin/env python3
"""
ACM Workflow 本地翻译服务（Ollama hy-mt2:latest）

一个轻量的本地 HTTP 翻译服务，把 ACM Workflow 扩展的 LibreTranslate 兼容请求
转发给本机 Ollama 的 hy-mt2:latest 翻译模型。

端点：
  GET  /languages
  POST /translate     body: {"q": "...", "source": "en", "target": "zh", "format": "text"}

用法示例：
  python3 tools/local_translate_server.py --port 5000

然后在 VS Code 设置中：
  "acmWorkflow.translateProvider": "local",
  "acmWorkflow.localEndpoint": "http://127.0.0.1:5000/translate"

依赖：
  - Python 3（仅标准库）
  - 本机 Ollama 服务（http://127.0.0.1:11434）
  - Ollama 已安装 hy-mt2:latest 模型
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "hy-mt2:latest"

# 翻译用参数：按 Codeforces 题面段落翻译的实际需要设置，尽量降低显存/内存占用。
#   num_ctx   2048 足够覆盖单段题面；Ollama 模型自身 context 为 4096，这里调低减少占用。
#   num_predict 512 足够输出一段中文译文。
#   temperature 0.3 保持术语/公式稳定，减少机翻幻觉。
OLLAMA_OPTIONS = {
    "temperature": 0.3,
    "num_ctx": 2048,
    "num_predict": 512,
    "repeat_penalty": 1.1,
}


def ollama_url(base: str) -> str:
    return base.rstrip("/")


def ollama_available(base: str, model: str = DEFAULT_MODEL) -> bool:
    """检查 Ollama 是否在线且包含翻译模型。"""
    try:
        req = urllib.request.Request(ollama_url(base) + "/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models = data.get("models") or []
        return any(m.get("name") == model for m in models)
    except Exception:
        return False


def ollama_translate(text: str, source: str, target: str, base: str, model: str) -> str:
    """调用 Ollama chat API 完成 en -> zh 翻译。"""
    system = (
        "You are a professional competitive-programming translator. "
        f"Translate the given {source} text into {target}. "
        "Keep math expressions (like $x$, $a_i$), code identifiers, numbers, "
        "LaTeX and placeholder tokens (like MATH0, MATH1) unchanged. "
        "Output only the translation, no explanations."
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ],
        "stream": False,
        "keep_alive": "3m",
        "options": OLLAMA_OPTIONS,
    }
    req = urllib.request.Request(
        ollama_url(base) + "/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama HTTP {exc.code}: {body[:300]}") from exc
    except Exception as exc:
        raise RuntimeError(f"Ollama 请求失败: {exc}") from exc

    content = ((data.get("message") or {}).get("content") or "").strip()
    if not content:
        raise RuntimeError("Ollama 返回空翻译")
    return content


def translate_text(text: str, source: str, target: str, base: str, model: str) -> str:
    # 目前只服务 en -> zh；其他方向也交给模型尝试，但保持接口兼容。
    return ollama_translate(text, source, target, base, model)


class TranslateHandler(BaseHTTPRequestHandler):
    base = DEFAULT_OLLAMA_URL
    model = DEFAULT_MODEL

    def log_message(self, fmt: str, *args: Any) -> None:
        pass

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:
        if self.path.split("?")[0].rstrip("/") == "/languages":
            if not ollama_available(self.base, self.model):
                self._send_json(503, {"error": "Ollama 不可用或未安装 hy-mt2:latest"})
                return
            self._send_json(200, [{"code": "en", "name": "English", "targets": ["zh"]}])
            return
        self._send_json(404, {"error": "Not Found"})

    def do_POST(self) -> None:
        if self.path.split("?")[0].rstrip("/") != "/translate":
            self._send_json(404, {"error": "Not Found"})
            return
        data = self._read_body()
        q = data.get("q")
        if q is None:
            self._send_json(400, {"error": "Missing 'q' field"})
            return
        source = str(data.get("source") or "en")
        target = str(data.get("target") or "zh")
        try:
            if not ollama_available(self.base, self.model):
                self._send_json(503, {"error": "Ollama 不可用或未安装 hy-mt2:latest"})
                return
            if isinstance(q, list):
                result = [
                    translate_text(str(item), source=source, target=target, base=self.base, model=self.model)
                    for item in q
                ]
            else:
                result = translate_text(str(q), source=source, target=target, base=self.base, model=self.model)
            self._send_json(200, {"translatedText": result})
        except Exception as exc:  # noqa: BLE001 - 返回给客户端可读错误
            self._send_json(500, {"error": str(exc)})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    args = parser.parse_args()

    TranslateHandler.base = args.ollama_url
    TranslateHandler.model = args.model

    if not ollama_available(args.ollama_url, args.model):
        print(
            f"错误：无法连接 Ollama 或未找到模型 {args.model}。\n"
            f"请先启动 Ollama（{args.ollama_url}），并确认已安装模型：\n"
            f"  ollama pull {args.model}\n"
            f"或运行 tools/setup_local_translate.sh 自动检查。",
            file=sys.stderr,
        )
        return 1

    server = ThreadingHTTPServer((args.host, args.port), TranslateHandler)
    print(
        f"ACM Workflow 本地翻译服务已启动：http://{args.host}:{args.port}\n"
        f"后端：Ollama {args.model}（{args.ollama_url}）\n"
        f"方向：en -> zh\n"
        f"按 Ctrl+C 停止。"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
