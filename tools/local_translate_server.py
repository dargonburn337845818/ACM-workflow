#!/usr/bin/env python3
"""
ACM Workflow 本地离线翻译服务（LibreTranslate 兼容接口）

一个尽量轻量的本地 HTTP 翻译服务，直接调用 Argos Translate（argos-translate-lt）。
它只实现 ACM Workflow 扩展需要的两个端点：

  GET  /languages
  POST /translate     body: {"q": "...", "source": "en", "target": "zh", "format": "text"}

用法示例（在已安装 argos-translate-lt 的 Python 环境中）：

  python tools/local_translate_server.py --port 5000

然后在 VS Code 设置中：

  "acmWorkflow.translateProvider": "local",
  "acmWorkflow.localEndpoint": "http://127.0.0.1:5000/translate"

依赖：
  pip install argos-translate-lt

还需要安装 en -> zh 模型与 MiniSBD 的 en.onnx（参见同目录 setup_local_translate.sh）。
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from argostranslate import translate
except ImportError:
    translate = None  # type: ignore[assignment]

# Argos 语言代码与 LibreTranslate/扩展常用代码的映射
CODE_ALIASES = {
    "zh": "zh",
    "zh-Hans": "zh",
    "zh-CN": "zh",
    "en": "en",
}


def normalize_code(code: str) -> str:
    return CODE_ALIASES.get(code, code)


def get_translation(source: str, target: str):
    """返回 Argos 的 translation 对象；没有可用翻译时返回 None。"""
    if translate is None:
        return None
    langs = {lang.code: lang for lang in translate.get_installed_languages()}
    src = langs.get(normalize_code(source))
    dst = langs.get(normalize_code(target))
    if src is None or dst is None:
        return None
    return src.get_translation(dst)


def translate_text(text: str, source: str = "en", target: str = "zh") -> str:
    tr = get_translation(source, target)
    if tr is None:
        raise RuntimeError(
            f"No installed translation from {source!r} to {target!r}. "
            "Install the Argos en->zh package first."
        )
    return tr.translate(text)


class TranslateHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        # 保持控制台干净；需要调试时改为 print(fmt % args)
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
            langs = []
            if translate is not None:
                for lang in translate.get_installed_languages():
                    targets = sorted(
                        {t.to_lang.code for t in lang.translations_from}
                    )
                    langs.append(
                        {
                            "code": lang.code,
                            "name": lang.name,
                            "targets": targets,
                        }
                    )
            self._send_json(200, langs)
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
            if isinstance(q, list):
                result = [
                    translate_text(str(item), source=source, target=target)
                    for item in q
                ]
            else:
                result = translate_text(str(q), source=source, target=target)
            self._send_json(200, {"translatedText": result})
        except Exception as exc:  # noqa: BLE001 - 返回给客户端可读错误
            self._send_json(
                500,
                {"error": str(exc)},
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    if translate is None:
        print(
            "错误：未安装 argos-translate-lt。\n"
            "请先运行：pip install argos-translate-lt",
            file=sys.stderr,
        )
        return 1

    # 启动前先验证 en -> zh 是否可用（避免请求时才报错）
    try:
        tr = get_translation("en", "zh")
        if tr is None:
            print(
                "错误：未安装 en -> zh 翻译模型。\n"
                "请运行 tools/setup_local_translate.sh 安装模型。",
                file=sys.stderr,
            )
            return 1
    except Exception as exc:  # noqa: BLE001
        print(f"错误：初始化 Argos 翻译失败：{exc}", file=sys.stderr)
        return 1

    server = ThreadingHTTPServer((args.host, args.port), TranslateHandler)
    print(
        f"ACM Workflow 本地翻译服务已启动：http://{args.host}:{args.port}\n"
        f"语言方向：en -> zh（模型已就绪）\n"
        f"按 Ctrl+C 停止。"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
