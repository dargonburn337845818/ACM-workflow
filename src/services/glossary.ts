/**
 * 算法术语表（ADR 0002）：
 * 从 OI-Wiki（中文）与 oiwiki-english（英文）提炼的竞赛常用术语映射。
 * 本文件不是翻译模型，也不是训练语料；它作为翻译后处理步骤，
 * 把机器翻译里常见的错误/不统一中文术语替换为 OI-Wiki 的规范说法。
 */

interface GlossaryEntry {
  /** 英文触发词（小写）；原文命中任一词时启用该条术语替换 */
  keys: string[];
  /** 规范中文术语 */
  zh: string;
  /** 机器翻译中常见的错误/不统一中文写法，会被替换为 zh */
  aliases: string[];
}

const GLOSSARY: GlossaryEntry[] = [
  {
    keys: ['dynamic programming', 'dp'],
    zh: '动态规划',
    aliases: ['动态编程', '动态程序', '动规']
  },
  {
    keys: ['shortest path', 'shortest paths', 'shortest-path'],
    zh: '最短路',
    aliases: ['最短路径', '最短路线']
  },
  {
    keys: ['binary search', 'binary searching'],
    zh: '二分',
    aliases: ['二分搜索', '二分查找', '二元搜索']
  },
  {
    keys: ['depth-first search', 'dfs'],
    zh: '深度优先搜索',
    aliases: ['深度优先遍历', '深度优先']
  },
  {
    keys: ['breadth-first search', 'bfs'],
    zh: '广度优先搜索',
    aliases: ['广度优先遍历', '广度优先']
  },
  {
    keys: ['greedy algorithm', 'greedy'],
    zh: '贪心',
    aliases: ['贪心算法', '贪婪算法']
  },
  {
    keys: ['segment tree', 'segment trees'],
    zh: '线段树',
    aliases: ['段树', '分段树']
  },
  {
    keys: ['fenwick tree', 'binary indexed tree', 'bit'],
    zh: '树状数组',
    aliases: ['二进制索引树', '芬威克树']
  },
  {
    keys: ['disjoint set union', 'dsu', 'union find'],
    zh: '并查集',
    aliases: ['不相交集合', '联合查找', '合并查找']
  },
  {
    keys: ['topological sort', 'topological sorting', 'topo sort'],
    zh: '拓扑排序',
    aliases: ['拓扑分类', '拓扑顺序']
  },
  {
    keys: ['minimum spanning tree', 'mst'],
    zh: '最小生成树',
    aliases: ['最小跨度树', '最小生成树问题']
  },
  {
    keys: ['greatest common divisor', 'gcd'],
    zh: '最大公约数',
    aliases: ['最大公因数', '最大公约数 GCD']
  },
  {
    keys: ['least common multiple', 'lcm'],
    zh: '最小公倍数',
    aliases: ['最小公倍数 LCM', '最小公共倍数']
  },
  {
    keys: ['prime sieve', 'sieve of eratosthenes', 'sieve'],
    zh: '素数筛',
    aliases: ['质数筛', '筛法求素数', '埃拉托斯特尼筛法']
  },
  {
    keys: ['combinatorics', 'combinatorial'],
    zh: '组合数学',
    aliases: ['组合计数', '组合学']
  },
  {
    keys: ['number theory'],
    zh: '数论',
    aliases: ['数字理论', '数论理论']
  },
  {
    keys: ['computational geometry'],
    zh: '计算几何',
    aliases: ['计算几何学', '计算几何问题']
  },
  {
    keys: ['string matching', 'string matching algorithm'],
    zh: '字符串匹配',
    aliases: ['串匹配', '字符串匹配算法']
  },
  {
    keys: ['knapsack', 'knapsack problem'],
    zh: '背包',
    aliases: ['背包问题', '背包 DP']
  },
  {
    keys: ['longest increasing subsequence', 'lis'],
    zh: '最长上升子序列',
    aliases: ['最长递增子序列', '最长上升子序列 LIS']
  },
  {
    keys: ['longest common subsequence', 'lcs'],
    zh: '最长公共子序列',
    aliases: ['最长公共子序列 LCS']
  },
  {
    keys: ['sliding window'],
    zh: '滑动窗口',
    aliases: ['滑窗', '滑动窗']
  },
  {
    keys: ['prefix sum', 'prefix sums'],
    zh: '前缀和',
    aliases: ['前缀和数组', '前缀求和']
  },
  {
    keys: ['difference array', 'difference arrays'],
    zh: '差分数组',
    aliases: ['差分', '差分数列']
  },
  {
    keys: ['two pointers', 'two pointer'],
    zh: '双指针',
    aliases: ['双指针法', '双指针算法']
  },
  {
    keys: ['hash', 'hashing', 'hash table'],
    zh: '哈希',
    aliases: ['散列', '哈希表']
  }
];

/** 按英文单词边界匹配术语，避免 'dp' 误中 'udp'、'bit' 误中 'orbit' 这类情况。 */
function includesTerm(lowerText: string, key: string): boolean {
  if (!key) return false;
  if (/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/.test(key)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(lowerText);
  }
  return lowerText.includes(key);
}

/** 翻译后处理：仅当原文命中英文术语时，把译文中的常见错误/别名替换为规范中文。 */
export function applyGlossary(en: string, zh: string): string {
  const lower = en.toLowerCase();
  let out = zh;
  for (const entry of GLOSSARY) {
    const hit = entry.keys.some((key) => includesTerm(lower, key));
    if (!hit) continue;
    for (const alias of entry.aliases) {
      if (alias && out.includes(alias)) {
        out = out.split(alias).join(entry.zh);
      }
    }
  }
  return out;
}

/** 供测试/诊断查看当前术语表规模 */
export function glossarySize(): number {
  return GLOSSARY.length;
}
