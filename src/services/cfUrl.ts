/**
 * CF 题目 URL 解析（V0.23 通过 URL 导入）
 *
 * 支持格式：
 *   https://codeforces.com/problemset/problem/1791/E
 *   https://codeforces.com/contest/1791/problem/E
 *   https://codeforces.com/gym/104053/problem/A
 * 兼容尾部 ?query / #hash / 尾斜杠；题号字母规范化大写（支持 F2 / H1 等）。
 * 解析失败抛出带具体原因的 Error（前端直接展示）。
 */

export interface CfProblemUrl {
  platform: 'codeforces';
  /** 比赛 ID 或 Gym ID（字符串，保留原样） */
  contestId: string;
  /** 题目字母（大写，如 A / F2） */
  index: string;
  /** 规范化后的题目 URL（去掉 query/hash/尾斜杠） */
  url: string;
  /** 本地题目 ID：contestId + index（如 1791E、104053A） */
  id: string;
}

/** 题号：1~3 位大写字母，允许数字后缀（F2/H1） */
const INDEX_RE = /^[A-Za-z]{1,3}\d?$/;

export function parseCfProblemUrl(raw: string): CfProblemUrl {
  const input = String(raw || '').trim();
  if (!input) {
    throw new Error('链接为空，请粘贴 CF 题目完整 URL');
  }

  // 域名校验：必须 http(s)://codeforces.com
  const hostMatch = /^https?:\/\/codeforces\.com\//i.exec(input);
  if (!hostMatch) {
    throw new Error('仅支持 Codeforces 题目链接（https://codeforces.com/...）');
  }

  // 去掉 query / hash / 尾斜杠，统一小写域名后匹配路径
  const clean = input.replace(/[?#].*$/, '').replace(/\/+$/, '');
  // 三种结构不同（problemset 无第二个 /problem），独立分支分别捕获
  const m = /\/(?:problemset\/problem\/(\d+)\/([A-Za-z0-9]+)|contest\/(\d+)\/problem\/([A-Za-z0-9]+)|gym\/(\d+)\/problem\/([A-Za-z0-9]+))$/i.exec(clean);
  if (!m) {
    throw new Error(
      '无法识别的 CF 链接格式（支持：\n' +
      '· .../problemset/problem/1791/E\n' +
      '· .../contest/1791/problem/E\n' +
      '· .../gym/104053/problem/A）'
    );
  }

  const contestId = m[1] || m[3] || m[5];
  const index = (m[2] || m[4] || m[6]).toUpperCase();
  if (!INDEX_RE.test(index)) {
    throw new Error(`无法识别的题号「${m[2] || m[4] || m[6]}」（应为 A/B/C 或 F2 等）`);
  }

  const kind = m[1] ? 'problemset/problem' : m[3] ? 'contest' : 'gym';
  // problemset 结构是 /problemset/problem/{id}/{index}，其余是 /{kind}/{id}/problem/{index}
  const url = kind === 'problemset/problem'
    ? `https://codeforces.com/problemset/problem/${contestId}/${index}`
    : `https://codeforces.com/${kind}/${contestId}/problem/${index}`;
  return {
    platform: 'codeforces',
    contestId,
    index,
    url,
    id: `${contestId}${index}`
  };
}
