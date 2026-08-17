/**
 * 知识导论（V0.7：全量汉化 + 完整体系）
 *
 * 结构：一级分类（中文）→ 二级细分 → 具体算法（可点击）
 * 每个算法节点：简介一句话 / 时间复杂度 / C++ 精简模板（可直接复制）。
 * 全部模板以 bits/stdc++.h + C++17 编写，与刷题环境一致。
 * 覆盖：基础算法 / 数据结构 / 图论 / 动态规划 / 字符串 / 数论 /
 *       计算几何 / 其他（博弈论、概率期望、莫队、主席树）。
 */

export interface AlgorithmDef {
  name: string;
  /** 中文名 / 别名（搜索命中用） */
  aliases?: string[];
  intro: string;
  complexity: string;
  cpp: string;
}

export interface KnowledgeSub {
  name: string;
  def: string;
  algorithms: AlgorithmDef[];
}

export interface KnowledgeCategory {
  name: string;
  def: string;
  subs: KnowledgeSub[];
}

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  // ============================================================
  // 一、基础算法
  // ============================================================
  {
    name: '基础算法',
    def: '枚举、模拟、贪心、二分、分治——一切算法的基础思想。',
    subs: [
      {
        name: '枚举',
        def: '遍历所有候选答案，验证合法性。',
        algorithms: [
          {
            name: '暴力枚举',
            aliases: ['枚举', 'brute force'],
            intro: '数据范围小或答案空间有限时，直接枚举所有情况并验证。模板：枚举所有子区间求最大子段和。',
            complexity: 'O(n²)（本例）',
            cpp: `int maxSubarray(const vector<int>& a) {
  int n = (int)a.size(), ans = INT_MIN;
  for (int l = 0; l < n; l++) {
    int s = 0;
    for (int r = l; r < n; r++) {
      s += a[r];
      ans = max(ans, s);
    }
  }
  return ans;
}`
          }
        ]
      },
      {
        name: '模拟',
        def: '按题意逐步执行，注意边界与格式。',
        algorithms: [
          {
            name: '约瑟夫环（模拟）',
            aliases: ['约瑟夫问题', 'simulation'],
            intro: 'n 个人围成一圈报数，每数到 k 出列。直接用 vector 模拟删除过程。',
            complexity: 'O(nk)',
            cpp: `int josephus(int n, int k) {
  vector<int> v(n);
  iota(v.begin(), v.end(), 1);
  int idx = 0;
  while (v.size() > 1) {
    idx = (idx + k - 1) % (int)v.size();
    v.erase(v.begin() + idx);
  }
  return v[0];
}`
          }
        ]
      },
      {
        name: '贪心',
        def: '每一步做当前最优选择，证明整体最优。',
        algorithms: [
          {
            name: '区间调度（贪心）',
            aliases: ['贪心', 'greedy', '区间选点'],
            intro: '选择尽量多的互不相交区间：按右端点升序，能取就取。',
            complexity: 'O(n log n)（排序）',
            cpp: `int intervalSchedule(vector<pair<int,int>>& seg) {
  sort(seg.begin(), seg.end(),
       [](auto& a, auto& b) { return a.second < b.second; });
  int cnt = 0, last = INT_MIN;
  for (auto [l, r] : seg)
    if (l > last) { cnt++; last = r; }
  return cnt;
}`
          }
        ]
      },
      {
        name: '二分',
        def: '单调性 + 折半：查找与答案判定。',
        algorithms: [
          {
            name: '二分查找',
            aliases: ['二分', 'binary search'],
            intro: '有序数组折半查找目标；`l + (r - l) / 2` 防溢出。',
            complexity: 'O(log n)',
            cpp: `int binarySearch(const vector<int>& a, int target) {
  int l = 0, r = (int)a.size() - 1;
  while (l <= r) {
    int m = l + (r - l) / 2;
    if (a[m] == target) return m;
    if (a[m] < target) l = m + 1; else r = m - 1;
  }
  return -1;
}`
          },
          {
            name: '二分答案',
            aliases: ['二分答案', '最大化最小值', '最小化最大值'],
            intro: '答案具有单调性时，直接二分答案并 O(n) 验证；check 随题目实现。',
            complexity: 'O(n log V)（V 为答案值域）',
            cpp: `bool check(long long x); // 按题目实现：x 是否可行

long long binaryAnswer() {
  long long lo = 0, hi = 1e18, ans = hi;
  while (lo <= hi) {
    long long mid = (lo + hi) / 2;
    if (check(mid)) { ans = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return ans;
}`
          }
        ]
      },
      {
        name: '分治',
        def: '拆半求解，合并时统计跨区间贡献。',
        algorithms: [
          {
            name: '归并排序求逆序对',
            aliases: ['分治', '逆序对', 'merge sort'],
            intro: '经典分治：左半与右半分别有序后，统计跨左右逆序对并归并。',
            complexity: 'O(n log n)',
            cpp: `long long mergeSort(vector<int>& a, int l, int r) {
  if (l >= r) return 0;
  int m = (l + r) / 2;
  long long cnt = mergeSort(a, l, m) + mergeSort(a, m + 1, r);
  vector<int> t;
  int i = l, j = m + 1;
  while (i <= m && j <= r) {
    if (a[i] <= a[j]) t.push_back(a[i++]);
    else { t.push_back(a[j++]); cnt += m - i + 1; }
  }
  while (i <= m) t.push_back(a[i++]);
  while (j <= r) t.push_back(a[j++]);
  for (int k = 0; k < (int)t.size(); k++) a[l + k] = t[k];
  return cnt;
}`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 二、数据结构
  // ============================================================
  {
    name: '数据结构',
    def: '组织数据以支持高效的查询与修改。',
    subs: [
      {
        name: '栈',
        def: '后进先出；单调栈维护最值候选。',
        algorithms: [
          {
            name: '单调栈',
            aliases: ['栈', 'next greater', '下一个更大元素'],
            intro: '维护单调递减栈，O(n) 求每个元素右侧第一个更大元素（存下标）。',
            complexity: 'O(n)',
            cpp: `vector<int> nextGreater(const vector<int>& a) {
  int n = (int)a.size();
  vector<int> res(n, -1);
  stack<int> st; // 存下标，栈内值单调递减
  for (int i = 0; i < n; i++) {
    while (!st.empty() && a[st.top()] < a[i]) {
      res[st.top()] = a[i];
      st.pop();
    }
    st.push(i);
  }
  return res;
}`
          }
        ]
      },
      {
        name: '队列',
        def: '先进先出；单调队列维护窗口最值。',
        algorithms: [
          {
            name: '单调队列（滑动窗口）',
            aliases: ['队列', '滑动窗口', 'deque'],
            intro: '窗口滑过数组，队头为窗口最大值；过期下标从队头弹出。',
            complexity: 'O(n)',
            cpp: `vector<int> maxSlidingWindow(const vector<int>& a, int k) {
  deque<int> q; // 存下标，值单调递减
  vector<int> res;
  for (int i = 0; i < (int)a.size(); i++) {
    while (!q.empty() && a[q.back()] <= a[i]) q.pop_back();
    q.push_back(i);
    if (q.front() <= i - k) q.pop_front();   // 过期
    if (i >= k - 1) res.push_back(a[q.front()]);
  }
  return res;
}`
          }
        ]
      },
      {
        name: '堆',
        def: '优先队列：快速取最值。',
        algorithms: [
          {
            name: '堆（Top-K）',
            aliases: ['堆', '优先队列', 'priority queue'],
            intro: '小根堆维护前 K 大：比堆顶大就替换，堆内即答案。',
            complexity: 'O(n log k)',
            cpp: `vector<int> topK(vector<int> a, int k) {
  priority_queue<int, vector<int>, greater<int>> pq;
  for (int x : a) {
    pq.push(x);
    if ((int)pq.size() > k) pq.pop();
  }
  vector<int> res;
  while (!pq.empty()) { res.push_back(pq.top()); pq.pop(); }
  return res;
}`
          }
        ]
      },
      {
        name: '并查集',
        def: '集合合并与连通性判定。',
        algorithms: [
          {
            name: '并查集 (DSU)',
            aliases: ['union find', 'disjoint set'],
            intro: '近似 O(1) 的合并/查找；路径压缩 + 按秩合并保证摊还复杂度。',
            complexity: 'O(α(n)) 摊还',
            cpp: `struct DSU {
  vector<int> p, sz;
  DSU(int n) : p(n), sz(n, 1) { iota(p.begin(), p.end(), 0); }
  int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
  void unite(int a, int b) {
    a = find(a); b = find(b);
    if (a == b) return;
    if (sz[a] < sz[b]) swap(a, b);
    p[b] = a; sz[a] += sz[b];
  }
  bool same(int a, int b) { return find(a) == find(b); }
};`
          }
        ]
      },
      {
        name: '线段树',
        def: '区间查询 + 区间修改的通用结构。',
        algorithms: [
          {
            name: '线段树（区间和 + 懒标记）',
            aliases: ['segment tree', '懒标记'],
            intro: '四倍空间存区间和与懒标记；区间加、区间求和均 O(log n)。',
            complexity: 'O(log n) 每次操作',
            cpp: `struct SegTree {
  int n; vector<long long> sum, lazy;
  SegTree(int n) : n(n), sum(4 * n), lazy(4 * n) {}
  void apply(int p, long long v, int len) { sum[p] += v * len; lazy[p] += v; }
  void push(int p, int l, int r) {
    if (lazy[p] && l != r) {
      int m = (l + r) / 2;
      apply(p*2, lazy[p], m - l + 1);
      apply(p*2+1, lazy[p], r - m);
      lazy[p] = 0;
    }
  }
  void add(int p, int l, int r, int ql, int qr, long long v) {
    if (ql <= l && r <= qr) { apply(p, v, r - l + 1); return; }
    push(p, l, r);
    int m = (l + r) / 2;
    if (ql <= m) add(p*2, l, m, ql, qr, v);
    if (qr > m) add(p*2+1, m+1, r, ql, qr, v);
    sum[p] = sum[p*2] + sum[p*2+1];
  }
  long long query(int p, int l, int r, int ql, int qr) {
    if (ql <= l && r <= qr) return sum[p];
    push(p, l, r);
    int m = (l + r) / 2; long long res = 0;
    if (ql <= m) res += query(p*2, l, m, ql, qr);
    if (qr > m) res += query(p*2+1, m+1, r, ql, qr);
    return res;
  }
};`
          },
          {
            name: 'ST 表（静态区间最值）',
            aliases: ['RMQ', '稀疏表', 'sparse table'],
            intro: '预处理 2^k 区间最值，O(1) 回答静态区间最小值；不可修改。',
            complexity: 'O(n log n) 预处理 / O(1) 查询',
            cpp: `struct SparseTable {
  int n, K;
  vector<vector<long long>> st;
  SparseTable(const vector<long long>& a) : n(a.size()) {
    K = 32 - __builtin_clz(n);
    st.assign(K, vector<long long>(n));
    st[0] = a;
    for (int k = 1; k < K; k++)
      for (int i = 0; i + (1 << k) <= n; i++)
        st[k][i] = min(st[k-1][i], st[k-1][i + (1 << (k-1))]);
  }
  long long query(int l, int r) {  // [l, r] 最小值
    int k = 31 - __builtin_clz(r - l + 1);
    return min(st[k][l], st[k][r - (1 << k) + 1]);
  }
};`
          }
        ]
      },
      {
        name: '树状数组',
        def: '单点修改 + 前缀查询的轻量结构。',
        algorithms: [
          {
            name: '树状数组 (BIT)',
            aliases: ['Fenwick', 'binary indexed tree'],
            intro: '单点修改 + 前缀和查询，常数极小；区间和 = 两次前缀和之差。',
            complexity: 'O(log n) 每次操作',
            cpp: `struct Fenwick {
  int n; vector<long long> bit;
  Fenwick(int n) : n(n), bit(n + 1) {}
  void add(int i, long long v) { for (; i <= n; i += i & -i) bit[i] += v; }
  long long sum(int i) {
    long long r = 0;
    for (; i > 0; i -= i & -i) r += bit[i];
    return r;
  }
  long long range(int l, int r) { return sum(r) - sum(l - 1); }
};`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 三、图论
  // ============================================================
  {
    name: '图论',
    def: '用点和边建模关系，求解最短路、连通性、生成树、网络流等问题。',
    subs: [
      {
        name: '最短路',
        def: '单源/全源最短路。',
        algorithms: [
          {
            name: 'Dijkstra',
            aliases: ['迪杰斯特拉', '单源最短路'],
            intro: '非负权图单源最短路；优先队列取当前最近点，松弛邻边。',
            complexity: 'O((V+E) log V)',
            cpp: `vector<long long> dijkstra(int s, const vector<vector<pair<int,int>>>& g) {
  int n = g.size();
  vector<long long> d(n, LLONG_MAX);
  priority_queue<pair<long long,int>, vector<pair<long long,int>>, greater<>> pq;
  d[s] = 0; pq.push({0, s});
  while (!pq.empty()) {
    auto [du, u] = pq.top(); pq.pop();
    if (du > d[u]) continue;
    for (auto [v, w] : g[u])
      if (d[u] + w < d[v]) { d[v] = d[u] + w; pq.push({d[v], v}); }
  }
  return d;
}`
          },
          {
            name: 'Bellman-Ford',
            aliases: ['贝尔曼福特', '负权边', '负环'],
            intro: '可处理负权边，并检测负环：第 n 轮仍能松弛说明存在负环。',
            complexity: 'O(V·E)',
            cpp: `bool bellmanFord(int s, int n, const vector<array<int,3>>& e, vector<long long>& d) {
  d.assign(n, LLONG_MAX); d[s] = 0;
  for (int i = 0; i < n - 1; i++) {
    bool changed = false;
    for (auto [u, v, w] : e)
      if (d[u] != LLONG_MAX && d[u] + w < d[v]) { d[v] = d[u] + w; changed = true; }
    if (!changed) break;
  }
  for (auto [u, v, w] : e)
    if (d[u] != LLONG_MAX && d[u] + w < d[v]) return false;  // 有负环
  return true;
}`
          },
          {
            name: 'Floyd-Warshall',
            aliases: ['弗洛伊德', '全源最短路'],
            intro: '全源最短路，三重循环枚举中转点；负权可行（无负环）。',
            complexity: 'O(V³)',
            cpp: `void floyd(vector<vector<long long>>& d) {
  int n = d.size();
  for (int k = 0; k < n; k++)
    for (int i = 0; i < n; i++)
      for (int j = 0; j < n; j++)
        if (d[i][k] != LLONG_MAX && d[k][j] != LLONG_MAX)
          d[i][j] = min(d[i][j], d[i][k] + d[k][j]);
}`
          }
        ]
      },
      {
        name: '最小生成树',
        def: '连通所有点的最小边权和。',
        algorithms: [
          {
            name: 'Kruskal',
            aliases: ['克鲁斯卡尔', 'MST', '最小生成树'],
            intro: '按边权升序加入，并查集判环；边少（稀疏图）时优先。',
            complexity: 'O(E log E)',
            cpp: `struct DSU {
  vector<int> p, sz;
  DSU(int n) : p(n), sz(n, 1) { iota(p.begin(), p.end(), 0); }
  int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
  bool unite(int a, int b) {
    a = find(a); b = find(b);
    if (a == b) return false;
    if (sz[a] < sz[b]) swap(a, b);
    p[b] = a; sz[a] += sz[b]; return true;
  }
};
long long kruskal(int n, vector<array<int,3>>& edges) {
  sort(edges.begin(), edges.end(), [](auto& x, auto& y){ return x[2] < y[2]; });
  DSU dsu(n); long long cost = 0;
  for (auto [u, v, w] : edges)
    if (dsu.unite(u, v)) cost += w;
  return cost;
}`
          }
        ]
      },
      {
        name: '网络流',
        def: '容量网络上的最大流。',
        algorithms: [
          {
            name: 'Dinic 最大流',
            aliases: ['网络流', 'max flow', 'ISAP 替代'],
            intro: 'BFS 分层 + DFS 多路增广（当前弧优化），最坏 O(V²E)，实际飞快。',
            complexity: 'O(V²E)',
            cpp: `struct Dinic {
  struct Edge { int to, rev; long long cap; };
  vector<vector<Edge>> g; vector<int> level, it;
  Dinic(int n) : g(n), level(n), it(n) {}
  void add(int u, int v, long long c) {
    g[u].push_back({v, (int)g[v].size(), c});
    g[v].push_back({u, (int)g[u].size() - 1, 0});
  }
  bool bfs(int s, int t) {
    fill(level.begin(), level.end(), -1);
    queue<int> q; level[s] = 0; q.push(s);
    while (!q.empty()) {
      int u = q.front(); q.pop();
      for (auto& e : g[u])
        if (e.cap > 0 && level[e.to] < 0) {
          level[e.to] = level[u] + 1; q.push(e.to);
        }
    }
    return level[t] >= 0;
  }
  long long dfs(int u, int t, long long f) {
    if (u == t) return f;
    for (int& i = it[u]; i < (int)g[u].size(); i++) {
      auto& e = g[u][i];
      if (e.cap > 0 && level[e.to] == level[u] + 1) {
        long long d = dfs(e.to, t, min(f, e.cap));
        if (d > 0) { e.cap -= d; g[e.to][e.rev].cap += d; return d; }
      }
    }
    return 0;
  }
  long long maxFlow(int s, int t) {
    long long flow = 0;
    while (bfs(s, t)) {
      fill(it.begin(), it.end(), 0);
      while (long long d = dfs(s, t, LLONG_MAX)) flow += d;
    }
    return flow;
  }
};`
          }
        ]
      },
      {
        name: '强连通分量',
        def: '有向图环的压缩与判定。',
        algorithms: [
          {
            name: 'Tarjan 求 SCC',
            aliases: ['强连通分量', '缩点', 'scc', 'tarjan'],
            intro: 'low 值与 dfn 相等即找到一个强连通分量；缩点后图是 DAG。',
            complexity: 'O(V+E)',
            cpp: `struct SCC {
  int n, timer = 0, cnt = 0;
  vector<vector<int>> g;
  vector<int> dfn, low, belong;
  vector<int> stk; vector<char> inStk;
  SCC(int n, const vector<vector<int>>& g)
    : n(n), g(g), dfn(n), low(n), belong(n), inStk(n) {}
  void dfs(int u) {
    dfn[u] = low[u] = ++timer;
    stk.push_back(u); inStk[u] = 1;
    for (int v : g[u]) {
      if (!dfn[v]) { dfs(v); low[u] = min(low[u], low[v]); }
      else if (inStk[v]) low[u] = min(low[u], dfn[v]);
    }
    if (low[u] == dfn[u]) {
      int x;
      do {
        x = stk.back(); stk.pop_back();
        inStk[x] = 0; belong[x] = cnt;
      } while (x != u);
      cnt++;
    }
  }
  void run() { for (int i = 0; i < n; i++) if (!dfn[i]) dfs(i); }
};`
          }
        ]
      },
      {
        name: '拓扑序',
        def: 'DAG 的线性排序。',
        algorithms: [
          {
            name: '拓扑排序 (Kahn)',
            aliases: ['topo', '拓扑'],
            intro: '入度为零的结点入队，删除其出边；返回序长 < n 说明有环。',
            complexity: 'O(V+E)',
            cpp: `vector<int> topoSort(int n, const vector<vector<int>>& g) {
  vector<int> indeg(n);
  for (int u = 0; u < n; u++)
    for (int v : g[u]) indeg[v]++;
  queue<int> q;
  for (int i = 0; i < n; i++) if (indeg[i] == 0) q.push(i);
  vector<int> order;
  while (!q.empty()) {
    int u = q.front(); q.pop();
    order.push_back(u);
    for (int v : g[u]) if (--indeg[v] == 0) q.push(v);
  }
  return order;  // size < n 说明有环
}`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 四、动态规划
  // ============================================================
  {
    name: '动态规划',
    def: '把问题拆成重叠子问题，用状态转移方程记忆化求解。',
    subs: [
      {
        name: '线性 DP',
        def: '状态沿序列线性推进。',
        algorithms: [
          {
            name: 'LIS（最长上升子序列）',
            aliases: ['最长上升子序列', 'lis'],
            intro: '求序列中最长的严格递增子序列长度；tail 数组维护各长度末尾最小值。',
            complexity: 'O(n log n)',
            cpp: `int lis(const vector<int>& a) {
  vector<int> tail;
  for (int x : a) {
    auto it = lower_bound(tail.begin(), tail.end(), x);
    if (it == tail.end()) tail.push_back(x);
    else *it = x;
  }
  return (int)tail.size();
}`
          },
          {
            name: 'LCS（最长公共子序列）',
            aliases: ['最长公共子序列', 'lcs'],
            intro: '求两个序列的最长公共子序列长度，经典二维 DP。',
            complexity: 'O(n·m)',
            cpp: `int lcs(const string& a, const string& b) {
  int n = a.size(), m = b.size();
  vector<vector<int>> dp(n + 1, vector<int>(m + 1));
  for (int i = 1; i <= n; i++)
    for (int j = 1; j <= m; j++)
      dp[i][j] = a[i-1] == b[j-1]
        ? dp[i-1][j-1] + 1
        : max(dp[i-1][j], dp[i][j-1]);
  return dp[n][m];
}`
          },
          {
            name: '0/1 背包',
            aliases: ['背包', 'knapsack'],
            intro: '每件物品最多选一次，滚动数组倒序枚举容量实现一维空间。',
            complexity: 'O(n·W)',
            cpp: `int knapsack01(int W, const vector<int>& w, const vector<int>& v) {
  vector<int> dp(W + 1);
  for (int i = 0; i < (int)w.size(); i++)
    for (int j = W; j >= w[i]; j--)   // 倒序：保证每件最多一次
      dp[j] = max(dp[j], dp[j - w[i]] + v[i]);
  return dp[W];
}`
          }
        ]
      },
      {
        name: '区间 DP',
        def: '区间为状态，从小区间合并到大区间。',
        algorithms: [
          {
            name: '石子合并',
            aliases: ['区间 DP 模板', 'interval dp'],
            intro: '合并相邻石子堆的最小代价；先枚举区间长度，再枚举分割点。',
            complexity: 'O(n³)（四边形不等式可优化到 O(n²)）',
            cpp: `int stoneMerge(const vector<int>& a) {
  int n = a.size();
  vector<int> pre(n + 1);
  for (int i = 0; i < n; i++) pre[i+1] = pre[i] + a[i];
  vector<vector<int>> dp(n, vector<int>(n, INT_MAX));
  for (int i = 0; i < n; i++) dp[i][i] = 0;
  for (int len = 2; len <= n; len++)
    for (int i = 0; i + len - 1 < n; i++) {
      int j = i + len - 1;
      for (int k = i; k < j; k++)
        dp[i][j] = min(dp[i][j], dp[i][k] + dp[k+1][j] + pre[j+1] - pre[i]);
    }
  return dp[0][n-1];
}`
          }
        ]
      },
      {
        name: '树形 DP',
        def: '树上做 DP，先子树后根。',
        algorithms: [
          {
            name: '树上最大权独立集',
            aliases: ['树形 DP', 'tree dp'],
            intro: '每个点选/不选两种状态；选了则子树根不能选。',
            complexity: 'O(n)',
            cpp: `vector<vector<int>> g;
vector<int> w;
vector<array<long long, 2>> f; // f[u][0] 不选 u，f[u][1] 选 u
void dfs(int u, int fa) {
  f[u][1] = w[u];
  for (int v : g[u]) if (v != fa) {
    dfs(v, u);
    f[u][0] += max(f[v][0], f[v][1]);
    f[u][1] += f[v][0];
  }
}
// 答案：max(f[root][0], f[root][1])，需先 f.resize(n) 并 dfs(root, -1)`
          }
        ]
      },
      {
        name: '状压 DP',
        def: '集合状态压成二进制位。',
        algorithms: [
          {
            name: 'TSP（状压）',
            aliases: ['状态压缩', 'bitmask dp'],
            intro: 'dp[s][i]：已访问集合 s、停在 i 的最短路径；从 0 出发回到 0。',
            complexity: 'O(2ⁿ·n²)',
            cpp: `int tsp(int n, const vector<vector<int>>& d) {
  int m = 1 << n;
  vector<vector<int>> dp(m, vector<int>(n, 1e9));
  dp[1][0] = 0;
  for (int s = 1; s < m; s++)
    for (int i = 0; i < n; i++)
      if (s >> i & 1)
        for (int j = 0; j < n; j++)
          if (!(s >> j & 1))
            dp[s | 1 << j][j] = min(dp[s | 1 << j][j], dp[s][i] + d[i][j]);
  int ans = 1e9;
  for (int i = 0; i < n; i++) ans = min(ans, dp[m - 1][i] + d[i][0]);
  return ans;
}`
          }
        ]
      },
      {
        name: '数位 DP',
        def: '按位枚举数字，统计满足条件的数。',
        algorithms: [
          {
            name: '数位 DP（不含 4）',
            aliases: ['digit dp', '数位统计'],
            intro: '从高位到低位记忆化搜索；tight 表示是否贴上界。统计 [L,R] = f(R) - f(L-1)。',
            complexity: 'O(位数 × 状态数)',
            cpp: `long long countNoFour(long long n) {
  string s = to_string(n);
  int len = s.size();
  long long memo[20][2];
  memset(memo, -1, sizeof(memo));
  function<long long(int,int)> dfs = [&](int pos, int tight) -> long long {
    if (pos == len) return 1;
    if (!tight && memo[pos][0] != -1) return memo[pos][0];
    int up = tight ? s[pos] - '0' : 9;
    long long res = 0;
    for (int d = 0; d <= up; d++) {
      if (d == 4) continue;
      res += dfs(pos + 1, tight && d == up);
    }
    if (!tight) memo[pos][0] = res;
    return res;
  };
  return dfs(0, 1);
}
// 答案：[L,R] = countNoFour(R) - countNoFour(L-1)`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 五、字符串
  // ============================================================
  {
    name: '字符串',
    def: '模式匹配与文本结构的算法家族。',
    subs: [
      {
        name: '模式匹配',
        def: '在文本中查找模式串。',
        algorithms: [
          {
            name: 'KMP',
            aliases: ['克努特-莫里斯-普拉特', 'kmp'],
            intro: '利用失配时已匹配前缀的信息（next 数组）线性匹配，不回溯文本指针。',
            complexity: 'O(n + m)',
            cpp: `vector<int> buildNext(const string& p) {
  int m = p.size();
  vector<int> nxt(m);
  for (int i = 1, j = 0; i < m; i++) {
    while (j > 0 && p[i] != p[j]) j = nxt[j-1];
    if (p[i] == p[j]) j++;
    nxt[i] = j;
  }
  return nxt;
}
vector<int> kmp(const string& t, const string& p) {
  vector<int> nxt = buildNext(p), pos;
  for (int i = 0, j = 0; i < (int)t.size(); i++) {
    while (j > 0 && t[i] != p[j]) j = nxt[j-1];
    if (t[i] == p[j]) j++;
    if (j == (int)p.size()) { pos.push_back(i - j + 1); j = nxt[j-1]; }
  }
  return pos;
}`
          },
          {
            name: 'Z-function',
            aliases: ['Z 算法', 'z 函数'],
            intro: '对每个位置求与串前缀的最长公共前缀长度，可替代 KMP 做模式匹配。',
            complexity: 'O(n)',
            cpp: `vector<int> zFunction(const string& s) {
  int n = s.size();
  vector<int> z(n);
  for (int i = 1, l = 0, r = 0; i < n; i++) {
    if (i <= r) z[i] = min(r - i + 1, z[i - l]);
    while (i + z[i] < n && s[z[i]] == s[i + z[i]]) z[i]++;
    if (i + z[i] - 1 > r) { l = i; r = i + z[i] - 1; }
  }
  return z;
}`
          }
        ]
      },
      {
        name: '多模式匹配',
        def: '同时匹配多个模式串。',
        algorithms: [
          {
            name: 'AC 自动机',
            aliases: ['ac automaton', '多模式匹配'],
            intro: 'Trie + fail 指针：把多个模式串建成自动机，一次扫描统计全部出现。',
            complexity: 'O(总长度 × 字符集 + 文本长度)',
            cpp: `struct Aho {
  struct Node { int ch[26]; int fail = 0, cnt = 0;
    Node() { memset(ch, 0, sizeof(ch)); } };
  vector<Node> t{1};
  void insert(const string& s) {
    int u = 0;
    for (char c : s) {
      int k = c - 'a';
      if (!t[u].ch[k]) { t[u].ch[k] = (int)t.size(); t.emplace_back(); }
      u = t[u].ch[k];
    }
    t[u].cnt++;
  }
  void build() {
    queue<int> q;
    for (int k = 0; k < 26; k++) if (t[0].ch[k]) q.push(t[0].ch[k]);
    while (!q.empty()) {
      int u = q.front(); q.pop();
      for (int k = 0; k < 26; k++) {
        int v = t[u].ch[k];
        if (v) { t[v].fail = t[t[u].fail].ch[k]; q.push(v); }
        else t[u].ch[k] = t[t[u].fail].ch[k];
      }
    }
  }
  int query(const string& s) { // 统计模式串出现次数（每个串最多计一次）
    int u = 0, res = 0;
    for (char c : s) {
      u = t[u].ch[c - 'a'];
      for (int v = u; v && t[v].cnt != -1; v = t[v].fail) {
        res += t[v].cnt; t[v].cnt = -1;
      }
    }
    return res;
  }
};`
          }
        ]
      },
      {
        name: '后缀结构',
        def: '后缀排序与回文处理。',
        algorithms: [
          {
            name: '后缀数组 (SA)',
            aliases: ['suffix array', 'sa'],
            intro: '倍增法对后缀排序；配合 height 数组可做 LCP、子串统计等问题。',
            complexity: 'O(n log n)',
            cpp: `vector<int> buildSA(const string& s) {
  int n = (int)s.size();
  vector<int> sa(n), rk(n), tmp(n);
  iota(sa.begin(), sa.end(), 0);
  for (int i = 0; i < n; i++) rk[i] = s[i];
  for (int k = 1; k < n; k <<= 1) {
    auto cmp = [&](int i, int j) {
      if (rk[i] != rk[j]) return rk[i] < rk[j];
      int ri = i + k < n ? rk[i + k] : -1;
      int rj = j + k < n ? rk[j + k] : -1;
      return ri < rj;
    };
    sort(sa.begin(), sa.end(), cmp);
    tmp[sa[0]] = 0;
    for (int i = 1; i < n; i++)
      tmp[sa[i]] = tmp[sa[i-1]] + (cmp(sa[i-1], sa[i]) ? 1 : 0);
    rk = tmp;
  }
  return sa; // sa[i]：排名第 i 的后缀起点
}`
          },
          {
            name: 'Manacher',
            aliases: ['马拉车', '最长回文'],
            intro: '线性求每个位置的最长回文半径（# 填充统一奇偶长度）。',
            complexity: 'O(n)',
            cpp: `vector<int> manacher(const string& s) {
  string t = "#";
  for (char c : s) { t += c; t += '#'; }
  int n = t.size();
  vector<int> r(n);
  for (int i = 0, c = 0, R = 0; i < n; i++) {
    r[i] = i < R ? min(R - i, r[2 * c - i]) : 1;
    while (i - r[i] >= 0 && i + r[i] < n && t[i - r[i]] == t[i + r[i]]) r[i]++;
    if (i + r[i] > R) { c = i; R = i + r[i]; }
  }
  return r;  // 原串以 i/2 为中心的回文半径 = r[i]/2（下取整）
}`
          }
        ]
      },
      {
        name: '哈希与字典树',
        def: '字符串快速比较与集合存储。',
        algorithms: [
          {
            name: 'Trie（字典树）',
            aliases: ['前缀树', 'trie'],
            intro: '用共享前缀的树存储字符串集合，支持插入与查询 O(长度)。',
            complexity: 'O(|S|) 每次操作',
            cpp: `struct Trie {
  struct Node { int ch[26]{}; int cnt = 0; };
  vector<Node> t{1};
  void insert(const string& s) {
    int u = 0;
    for (char c : s) {
      int k = c - 'a';
      if (!t[u].ch[k]) { t[u].ch[k] = (int)t.size(); t.emplace_back(); }
      u = t[u].ch[k];
    }
    t[u].cnt++;
  }
  int count(const string& s) const {
    int u = 0;
    for (char c : s) {
      int k = c - 'a';
      if (!t[u].ch[k]) return 0;
      u = t[u].ch[k];
    }
    return t[u].cnt;
  }
};`
          },
          {
            name: '字符串哈希（Rolling Hash）',
            aliases: ['哈希', '双哈希'],
            intro: '把字符串映射为多项式哈希，O(1) 比较任意子串（配合前缀哈希）。',
            complexity: 'O(n) 预处理 / O(1) 子串比较',
            cpp: `struct StrHash {
  static constexpr long long MOD = 1e9 + 7, BASE = 911382323;
  vector<long long> h, pw;
  StrHash(const string& s) : h(s.size()+1), pw(s.size()+1) {
    pw[0] = 1;
    for (int i = 0; i < (int)s.size(); i++) {
      h[i+1] = (h[i] * BASE + s[i]) % MOD;
      pw[i+1] = pw[i] * BASE % MOD;
    }
  }
  long long get(int l, int r) {  // [l, r)
    return (h[r] - h[l] * pw[r - l] % MOD + MOD) % MOD;
  }
};`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 六、数论
  // ============================================================
  {
    name: '数论',
    def: '研究整数性质：素数、同余、逆元、整除与 GCD。',
    subs: [
      {
        name: '素数筛',
        def: '素数判定与筛选。',
        algorithms: [
          {
            name: '线性筛（欧拉筛）',
            aliases: ['素数筛', '线性筛', 'euler sieve'],
            intro: '每个合数只被最小质因子筛掉一次，同时可求最小质因子与欧拉函数。',
            complexity: 'O(n)',
            cpp: `vector<int> linearSieve(int n) {
  vector<int> primes, minp(n + 1);
  for (int i = 2; i <= n; i++) {
    if (!minp[i]) { minp[i] = i; primes.push_back(i); }
    for (int p : primes) {
      if (p > minp[i] || 1LL * i * p > n) break;
      minp[i * p] = p;
    }
  }
  return primes;
}`
          }
        ]
      },
      {
        name: '欧拉函数',
        def: '与 n 互质的数的个数。',
        algorithms: [
          {
            name: '欧拉函数',
            aliases: ['phi', '欧拉'],
            intro: 'φ(n) = n × ∏(1 - 1/p)；分解质因数 O(√n) 单点求，线性筛可批量求。',
            complexity: 'O(√n) 单点 / O(n) 批量',
            cpp: `long long phi(long long n) {
  long long res = n;
  for (long long p = 2; p * p <= n; p++) {
    if (n % p == 0) {
      res = res / p * (p - 1);
      while (n % p == 0) n /= p;
    }
  }
  if (n > 1) res = res / n * (n - 1);
  return res;
}
vector<int> phiAll(int N) { // 线性筛求 1..N 全部欧拉函数
  vector<int> phi(N + 1), primes;
  vector<bool> is(N + 1, false);
  phi[1] = 1;
  for (int i = 2; i <= N; i++) {
    if (!is[i]) { is[i] = true; primes.push_back(i); phi[i] = i - 1; }
    for (int p : primes) {
      if (1LL * i * p > N) break;
      is[i * p] = true;
      if (i % p == 0) { phi[i * p] = phi[i] * p; break; }
      phi[i * p] = phi[i] * (p - 1);
    }
  }
  return phi;
}`
          }
        ]
      },
      {
        name: '快速幂与逆元',
        def: '模运算下的幂与除法。',
        algorithms: [
          {
            name: '快速幂',
            aliases: ['modpow', '幂'],
            intro: '二进制拆分指数，O(log n) 求 a^b mod m；m 为素数时 a^(m-2) 即逆元。',
            complexity: 'O(log b)',
            cpp: `long long modpow(long long a, long long b, long long m) {
  long long r = 1;
  while (b > 0) {
    if (b & 1) r = r * a % m;
    a = a * a % m;
    b >>= 1;
  }
  return r;
}`
          },
          {
            name: '扩展欧几里得 (exgcd)',
            aliases: ['exgcd', '逆元'],
            intro: '求解 ax + by = gcd(a,b) 的一组整数解；x 即 a 模 b 的逆元（互素时）。',
            complexity: 'O(log min(a,b))',
            cpp: `long long exgcd(long long a, long long b, long long& x, long long& y) {
  if (b == 0) { x = 1; y = 0; return a; }
  long long g = exgcd(b, a % b, y, x);
  y -= a / b * x;
  return g;
}
// 逆元：exgcd(a, m, x, y) 后 x 为 a 模 m 的逆（需 gcd(a,m)==1）`
          }
        ]
      },
      {
        name: '组合数学',
        def: '组合数、排列与计数。',
        algorithms: [
          {
            name: '组合数（预处理阶乘）',
            aliases: ['组合数学', 'comb', 'C(n,k)'],
            intro: '预处理阶乘与逆元阶乘，O(1) 回答组合数；p 为大素数。',
            complexity: 'O(n) 预处理 / O(1) 查询',
            cpp: `struct Comb {
  vector<long long> fac, ifac; long long mod;
  Comb(int n, long long m) : fac(n+1), ifac(n+1), mod(m) {
    fac[0] = 1;
    for (int i = 1; i <= n; i++) fac[i] = fac[i-1] * i % mod;
    ifac[n] = modpow(fac[n], mod - 2, mod);
    for (int i = n; i > 0; i--) ifac[i-1] = ifac[i] * i % mod;
  }
  long long C(int a, int b) {
    if (a < 0 || b < 0 || b > a) return 0;
    return fac[a] * ifac[b] % mod * ifac[a - b] % mod;
  }
};`
          },
          {
            name: '中国剩余定理 (CRT)',
            aliases: ['crt', '同余方程组'],
            intro: '求解同余方程组 x ≡ a_i (mod m_i)，模数两两互素；答案对 M=∏m_i 唯一。',
            complexity: 'O(k log m)（k 为方程个数）',
            cpp: `long long crt(const vector<long long>& a, const vector<long long>& m) {
  long long M = 1, x = 0;
  for (long long v : m) M *= v;
  for (size_t i = 0; i < a.size(); i++) {
    long long Mi = M / m[i], t, y;
    exgcd(Mi % m[i], m[i], t, y);
    t = (t % m[i] + m[i]) % m[i];
    x = (x + a[i] * Mi % M * t) % M;
  }
  return (x % M + M) % M;
}`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 七、计算几何
  // ============================================================
  {
    name: '计算几何',
    def: '用向量与叉积处理点、线、多边形的关系。',
    subs: [
      {
        name: '凸包',
        def: '点集的最小凸多边形。',
        algorithms: [
          {
            name: 'Andrew 单调链凸包',
            aliases: ['安德鲁凸包', '凸包', 'convex hull'],
            intro: '按 x 排序后分别构造上下链；叉积判断转向，O(n log n) 求凸包。',
            complexity: 'O(n log n)',
            cpp: `struct P { long long x, y; };
long long cross(const P& a, const P& b, const P& c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
vector<P> convexHull(vector<P> p) {
  sort(p.begin(), p.end(), [](auto& a, auto& b){ return a.x != b.x ? a.x < b.x : a.y < b.y; });
  vector<P> h;
  for (int pass = 0; pass < 2; pass++) {
    int start = (int)h.size();
    for (auto& q : p) {
      while (h.size() >= start + 2 &&
             cross(h[h.size()-2], h.back(), q) <= 0) h.pop_back();
      h.push_back(q);
    }
    h.pop_back();
    reverse(p.begin(), p.end());
  }
  return h;
}`
          }
        ]
      },
      {
        name: '最近点对',
        def: '点集中距离最近的两点。',
        algorithms: [
          {
            name: '最近点对（分治）',
            aliases: ['closest pair'],
            intro: '按 x 分治，跨中线候选点按 y 排序后只检查邻近点，O(n log n)。',
            complexity: 'O(n log n)',
            cpp: `struct Pt { double x, y; };
double dist(const Pt& a, const Pt& b) {
  return hypot(a.x - b.x, a.y - b.y);
}
double closestPair(vector<Pt> p) {
  sort(p.begin(), p.end(), [](auto& a, auto& b){ return a.x < b.x; });
  function<double(int,int)> solve = [&](int l, int r) -> double {
    if (r - l <= 1) return 1e18;
    int m = (l + r) / 2;
    double d = min(solve(l, m), solve(m, r));
    double midx = p[m].x;
    vector<Pt> strip;
    for (int i = l; i < r; i++)
      if (fabs(p[i].x - midx) < d) strip.push_back(p[i]);
    sort(strip.begin(), strip.end(), [](auto& a, auto& b){ return a.y < b.y; });
    for (int i = 0; i < (int)strip.size(); i++)
      for (int j = i + 1; j < (int)strip.size() && strip[j].y - strip[i].y < d; j++)
        d = min(d, dist(strip[i], strip[j]));
    return d;
  };
  return solve(0, (int)p.size());
}`
          }
        ]
      },
      {
        name: '线段相交',
        def: '判断两条线段是否相交。',
        algorithms: [
          {
            name: '线段相交判定',
            aliases: ['segment intersection', '叉积'],
            intro: '跨立实验：两端点分居对方线段两侧；再补共线端点情况。',
            complexity: 'O(1)',
            cpp: `struct Pt { long long x, y; };
long long cross(const Pt& a, const Pt& b, const Pt& c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
bool onSeg(const Pt& p, const Pt& a, const Pt& b) {
  return cross(a, b, p) == 0
    && min(a.x, b.x) <= p.x && p.x <= max(a.x, b.x)
    && min(a.y, b.y) <= p.y && p.y <= max(a.y, b.y);
}
bool segInter(const Pt& a, const Pt& b, const Pt& c, const Pt& d) {
  long long d1 = cross(c, d, a), d2 = cross(c, d, b);
  long long d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0) != (d2 > 0)) && ((d3 > 0) != (d4 > 0))) return true;
  return onSeg(a, c, d) || onSeg(b, c, d) || onSeg(c, a, b) || onSeg(d, a, b);
}`
          }
        ]
      }
    ]
  },

  // ============================================================
  // 八、其他
  // ============================================================
  {
    name: '其他',
    def: '博弈论、概率期望与高级离线/可持久化数据结构。',
    subs: [
      {
        name: '博弈论',
        def: '公平组合游戏的胜负判定。',
        algorithms: [
          {
            name: 'Nim 游戏与 SG 函数',
            aliases: ['博弈', 'nim', 'sg'],
            intro: 'Nim：异或和为零先手必败。一般公平游戏用 SG 函数记忆化求解。',
            complexity: 'O(n)（Nim）/ O(状态×转移)（SG）',
            cpp: `// Nim 游戏：所有堆异或和为零 → 先手必败
bool nimWins(const vector<long long>& piles) {
  long long x = 0;
  for (long long v : piles) x ^= v;
  return x != 0;
}
// SG 函数（moves(x) 返回可达状态，sgMemo 初始 -1）
int sgMemo[100005];
int sg(int x) {
  if (sgMemo[x] != -1) return sgMemo[x];
  set<int> s;
  for (int y : moves(x)) s.insert(sg(y));
  int g = 0;
  while (s.count(g)) g++;
  return sgMemo[x] = g;
}`
          }
        ]
      },
      {
        name: '概率期望',
        def: '期望 = 概率加权求和，常用逆推。',
        algorithms: [
          {
            name: '期望 DP（掷骰子）',
            aliases: ['概率', '期望', 'expected'],
            intro: '从终点逆推：f[i] 表示从 i 到终点还需的期望步数，f[i] = Σ f[下一步]/6 + 1。',
            complexity: 'O(n)',
            cpp: `double expectedSteps(int n) {
  vector<double> f(n + 7);
  for (int i = n - 1; i >= 0; i--) {
    double s = 0;
    for (int k = 1; k <= 6; k++) s += f[min(n, i + k)];
    f[i] = s / 6 + 1;
  }
  return f[0];
}`
          }
        ]
      },
      {
        name: '莫队',
        def: '离线处理区间询问。',
        algorithms: [
          {
            name: '莫队（区间不同数）',
            aliases: ['mo algorithm', '离线区间'],
            intro: '分块排序询问，指针左右移动维护答案；修改代价必须 O(1)。',
            complexity: 'O((n+q)√n)',
            cpp: `struct Query { int l, r, id; };
vector<int> mo(const vector<int>& a, vector<Query>& qs) {
  int n = (int)a.size(), B = max(1, (int)sqrt(n));
  sort(qs.begin(), qs.end(), [&](auto& x, auto& y) {
    if (x.l / B != y.l / B) return x.l < y.l;
    return ((x.l / B) & 1) ? x.r > y.r : x.r < y.r;
  });
  vector<int> cnt(1000005), ans(qs.size());
  int cur = 0, L = 1, R = 0;
  auto add = [&](int p) { if (cnt[a[p]]++ == 0) cur++; };
  auto del = [&](int p) { if (--cnt[a[p]] == 0) cur--; };
  for (auto& q : qs) {
    while (L > q.l) add(--L);
    while (R < q.r) add(++R);
    while (L < q.l) del(L++);
    while (R > q.r) del(R--);
    ans[q.id] = cur;
  }
  return ans;
}`
          }
        ]
      },
      {
        name: '主席树',
        def: '可持久化线段树：历史版本查询。',
        algorithms: [
          {
            name: '主席树（区间第 k 小）',
            aliases: ['可持久化线段树', 'pst', '第k小'],
            intro: '每个前缀一棵权值线段树，差分求区间内第 k 小；值域离散化。',
            complexity: 'O((n+q) log n)',
            cpp: `struct PST {
  struct Node { int l = 0, r = 0, sum = 0; };
  vector<Node> t{{0, 0, 0}};
  int update(int pre, int l, int r, int pos) {
    int cur = (int)t.size();
    t.push_back(t[pre]);
    t[cur].sum++;
    if (l != r) {
      int m = (l + r) / 2;
      if (pos <= m) t[cur].l = update(t[pre].l, l, m, pos);
      else t[cur].r = update(t[pre].r, m + 1, r, pos);
    }
    return cur;
  }
  int query(int u, int v, int l, int r, int k) { // 返回第 k 小（离散化下标）
    if (l == r) return l;
    int m = (l + r) / 2;
    int leftSum = t[t[v].l].sum - t[t[u].l].sum;
    if (k <= leftSum) return query(t[u].l, t[v].l, l, m, k);
    return query(t[u].r, t[v].r, m + 1, r, k - leftSum);
  }
};`
          }
        ]
      }
    ]
  }
];

/** 全部算法（扁平），供搜索 */
export function allAlgorithms(): { category: string; sub: string; def: AlgorithmDef }[] {
  const out: { category: string; sub: string; def: AlgorithmDef }[] = [];
  for (const c of KNOWLEDGE_CATEGORIES) {
    for (const s of c.subs) {
      for (const a of s.algorithms) out.push({ category: c.name, sub: s.name, def: a });
    }
  }
  return out;
}
