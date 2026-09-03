#!/usr/bin/env python3
"""
ACM Workflow 本地翻译服务（llama.cpp Hy-MT2）

一个轻量的本地 HTTP 翻译服务，把 ACM Workflow 扩展的 LibreTranslate 兼容请求
转发给 Windows 侧 llama-server 的 OpenAI 兼容接口（/v1/chat/completions）。

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
  - Windows 侧 llama-server.exe（D:\\llama）已启动并加载 Hy-MT2 GGUF
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_LLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "hy-mt2:latest"

# 翻译用参数：按 Hy-MT2 模型卡推荐参数设置（1.8B / 7B）。
LLAMA_CHAT_OPTIONS = {
    "temperature": 0.7,
    "top_p": 0.6,
    "top_k": 20,
    "repetition_penalty": 1.05,
    "max_tokens": 4096,
    "stream": False,
}


def llama_url(base: str) -> str:
    return base.rstrip("/")


def llama_api_base(base: str) -> str:
    b = llama_url(base)
    return b if b.endswith("/v1") else b + "/v1"


def llama_available(base: str, model: str = DEFAULT_MODEL) -> bool:
    """检查 llama-server 是否在线且包含翻译模型别名。"""
    try:
        req = urllib.request.Request(llama_api_base(base) + "/models", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models = data.get("data") or []
        return any(m.get("id") == model for m in models)
    except Exception:
        return False


def llama_translate(text: str, source: str, target: str, base: str, model: str) -> str:
    """调用 llama-server OpenAI 兼容 chat API 完成 en -> zh 翻译。"""
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
        **LLAMA_CHAT_OPTIONS,
    }
    req = urllib.request.Request(
        llama_api_base(base) + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"llama-server HTTP {exc.code}: {body[:300]}") from exc
    except Exception as exc:
        raise RuntimeError(f"llama-server 请求失败: {exc}") from exc

    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    content = content.strip()
    if not content:
        raise RuntimeError("llama-server 返回空翻译")
    return content


def translate_text(text: str, source: str, target: str, base: str, model: str) -> str:
    # 目前只服务 en -> zh；其他方向也交给模型尝试，但保持接口兼容。
    return llama_translate(text, source, target, base, model)


class TranslateHandler(BaseHTTPRequestHandler):
    base = DEFAULT_LLAMA_URL
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
            if not llama_available(self.base, self.model):
                self._send_json(503, {"error": "llama-server 不可用或未加载 Hy-MT2 模型"})
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
            if not llama_available(self.base, self.model):
                self._send_json(503, {"error": "llama-server 不可用或未加载 Hy-MT2 模型"})
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
    parser.add_argument("--llama-url", "--ollama-url", dest="llama_url", default=DEFAULT_LLAMA_URL)
    args = parser.parse_args()

    TranslateHandler.base = args.llama_url
    TranslateHandler.model = args.model

    if not llama_available(args.llama_url, args.model):
        print(
            f"错误：无法连接 llama-server 或未找到模型别名 {args.model}。\n"
            f"请先启动 Windows 侧 D:\\llama\\llama-server.exe，并确认模型已加载：\n"
            f"  llama-server.exe -m D:\\llama\\Hy-MT2-1.8B-Q6_K.gguf --alias {args.model}\n"
            f"或运行 tools/setup_local_translate.sh 自动检查。",
            file=sys.stderr,
        )
        return 1

    server = ThreadingHTTPServer((args.host, args.port), TranslateHandler)
    print(
        f"ACM Workflow 本地翻译服务已启动：http://{args.host}:{args.port}\n"
        f"后端：llama-server {args.model}（{args.llama_url}）\n"
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
