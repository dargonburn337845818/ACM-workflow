# -*- coding: utf-8 -*-
"""生成指定档位的 HTML 质量报告。

用法：
    python generate_report.py 1
    python generate_report.py 1 --open
"""

import html
import os
import sys
from datetime import datetime

from info_framework import INFO_OPS
from knowledge_data import ALGORITHM_BY_NAME
from tiers_data import TIERS

QUALITY_NAMES = {
    "complete": "完整",
    "skeleton": "骨架",
    "todo": "待补",
}


def collect_tier_algorithms(tier):
    names = []
    for tag in tier["tags"]:
        for alg_name in tag.get("algorithms", []):
            if alg_name not in names:
                names.append(alg_name)
    return [ALGORITHM_BY_NAME[n] for n in names]


def build_report(tier_id: int) -> str:
    tier = next(t for t in TIERS if t["id"] == tier_id)
    algs = collect_tier_algorithms(tier)
    counts = {"complete": 0, "skeleton": 0, "todo": 0}
    op_counts = {op: 0 for op in INFO_OPS}
    for a in algs:
        q = a.get("quality", "todo")
        counts[q] = counts.get(q, 0) + 1
        for op in a.get("info", {}).get("ops", []):
            if op in op_counts:
                op_counts[op] += 1

    tag_rows = []
    for tag in tier["tags"]:
        tag_rows.append(f"""
        <tr>
          <td>{html.escape(tag['name'])}</td>
          <td>{html.escape(tag.get('desc', ''))}</td>
          <td>{html.escape(str(tag.get('cf_tag') or ''))}</td>
          <td>{len(tag.get('algorithms', []))}</td>
        </tr>""")

    rows = []
    for a in algs:
        q = a.get("quality", "todo")
        q_name = QUALITY_NAMES.get(q, q)
        cpp_len = len(a.get("cpp", ""))
        rows.append(f"""
        <tr>
          <td>{html.escape(a['name'])}</td>
          <td>{html.escape(a.get('category', ''))} / {html.escape(a.get('sub', ''))}</td>
          <td><span class="badge {html.escape(q)}">{html.escape(q_name)}</span></td>
          <td>{html.escape(a.get('intro', ''))}</td>
          <td>{html.escape(a.get('complexity', ''))}</td>
          <td>{cpp_len}</td>
        </tr>""")

    total = len(algs)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>第 {tier_id} 档内容质量报告</title>
<style>
  body {{ font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #f3f4f8; color: #1c1f26; margin: 0; padding: 32px; }}
  .wrap {{ max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 28px 32px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); }}
  h1 {{ margin: 0 0 4px; font-size: 24px; }}
  .meta {{ color: #6d7482; font-size: 13px; margin-bottom: 20px; }}
  .summary {{ display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }}
  .card {{ background: #f4f5f9; border: 1px solid #e2e5ec; border-radius: 12px; padding: 12px 18px; }}
  .card b {{ font-size: 22px; display: block; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th, td {{ text-align: left; padding: 10px 12px; border-bottom: 1px solid #eef0f4; vertical-align: top; }}
  th {{ background: #f4f5f9; font-weight: 600; }}
  .badge {{ display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }}
  .badge.complete {{ color: #2f9e6e; background: rgba(47,158,110,0.1); }}
  .badge.skeleton {{ color: #c77f2a; background: rgba(199,127,42,0.1); }}
  .badge.todo {{ color: #d65a5a; background: rgba(214,90,90,0.1); }}
  .note {{ margin-top: 20px; font-size: 12px; color: #6d7482; line-height: 1.7; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>{html.escape(tier['name'])} · 内容质量报告</h1>
  <div class="meta">{html.escape(tier['range'])} · {html.escape(tier['goal'])} · 生成时间：{now}</div>

  <div class="summary">
    <div class="card"><b>{total}</b>算法节点</div>
    <div class="card"><b>{counts['complete']}</b>完整</div>
    <div class="card"><b>{counts['skeleton']}</b>骨架</div>
    <div class="card"><b>{counts['todo']}</b>待补</div>
  </div>

  <h2 style="margin-top: 22px; font-size: 18px;">信息论操作分布</h2>
  <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
    {''.join(f'<div class="card"><b>{v}</b>{html.escape(op)}</div>' for op, v in op_counts.items())}
  </div>

  <h2 style="margin-top: 8px; font-size: 18px;">档位知识点</h2>
  <table>
    <thead>
      <tr><th>标签</th><th>说明</th><th>CF 标签</th><th>关联模板数</th></tr>
    </thead>
    <tbody>
      {''.join(tag_rows)}
    </tbody>
  </table>

  <h2 style="margin-top: 28px; font-size: 18px;">算法节点明细</h2>
  <table>
    <thead>
      <tr><th>算法</th><th>分类</th><th>质量</th><th>简介</th><th>复杂度</th><th>模板长度</th></tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>

  <div class="note">
    说明：质量标记为「完整」表示简介、复杂度、C++ 模板都已具备；「骨架」表示仅有核心思路或不完整代码；「待补」表示尚未处理。
    本批次主要参考 OI-Wiki 与 CP-Algorithms 进行核对。
  </div>
</div>
</body>
</html>
"""


def main():
    tier_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"tier{tier_id}_report.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(build_report(tier_id))
    print(f"Report generated: {out_path}")
    if "--open" in sys.argv:
        os.startfile(out_path)  # Windows only


if __name__ == "__main__":
    main()
