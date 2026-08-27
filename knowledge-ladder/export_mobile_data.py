# -*- coding: utf-8 -*-
"""导出移动端数据：把 Python 知识树转成前端可加载的 data.js。"""
import json
import os

from info_framework import ANATOMY_STEPS, INFO_OPS, INFO_OP_COLORS, PHASES, TOPOLOGIES
from knowledge_data import ALGORITHMS
from tiers_data import TIERS

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mobile", "www")
os.makedirs(OUT_DIR, exist_ok=True)

data = {
    "tiers": TIERS,
    "algorithms": ALGORITHMS,
    "infoOps": INFO_OPS,
    "infoOpColors": INFO_OP_COLORS,
    "topologies": TOPOLOGIES,
    "phases": {str(k): v for k, v in PHASES.items()},
    "anatomySteps": ANATOMY_STEPS,
}

out_path = os.path.join(OUT_DIR, "data.js")
with open(out_path, "w", encoding="utf-8") as f:
    f.write("// 由 export_mobile_data.py 自动生成，请勿手改。\n")
    f.write("window.KNOWLEDGE_DATA = ")
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write(";\n")

print(f"Written: {out_path}")
