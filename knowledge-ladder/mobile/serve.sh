#!/usr/bin/env bash
# 本地预览移动端（服务 www 目录）
cd "$(dirname "$0")/www"
python3 -m http.server 8000
