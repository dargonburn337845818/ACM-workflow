# -*- coding: utf-8 -*-
"""信息论视角：四种信息操作 / 三种拓扑 / 拆题四步 / 算法标签。

这是知识导论的第二条认知轴：
- 第一条轴：8 档难度 + 算法模板（tiers_data.py / knowledge_data.py）
- 第二条轴：信息论操作、拓扑空间、动静、度量代数的跨档位归类
"""

# ── 信息操作 ──────────────────────────────────────────────
OP_ENCODE = "编码压缩"
OP_PROPAGATE = "传播松弛"
OP_PRUNE = "剪枝决策"
OP_TRANSFORM = "变换域映射"
OP_BASELINE = "基线/暴力"

INFO_OPS = [OP_ENCODE, OP_PROPAGATE, OP_PRUNE, OP_TRANSFORM, OP_BASELINE]

INFO_OP_COLORS = {
    OP_ENCODE: "#6C8CFF",
    OP_PROPAGATE: "#4EC9B0",
    OP_PRUNE: "#E0A458",
    OP_TRANSFORM: "#C678DD",
    OP_BASELINE: "#9AA1B0",
}

# ── 拓扑空间 ──────────────────────────────────────────────
TOPOLOGY_LINEAR = "线性"
TOPOLOGY_GRAPH = "树图"
TOPOLOGY_ALGEBRA = "抽象代数"
TOPOLOGIES = [TOPOLOGY_LINEAR, TOPOLOGY_GRAPH, TOPOLOGY_ALGEBRA]

# ── 动静 ──────────────────────────────────────────────────
DYN_STATIC = "静态"
DYN_DYNAMIC = "动态"

# ── 四阶段 ────────────────────────────────────────────────
PHASES = {
    1: {
        "name": "阶段一：线性结构 & 数值熵",
        "range": "约 1200 – 1600",
        "slogan": "把重体力活变成查字典",
        "description": (
            "在数组/序列上做前缀压缩、双指针剪枝、位运算编码；"
            "核心是先把信息压缩/排序，再让查询变快。"
        ),
    },
    2: {
        "name": "阶段二：拓扑传播 & 依赖熵",
        "range": "约 1600 – 2000",
        "slogan": "利用邻居依赖逐层消解不确定性",
        "description": (
            "树/图上利用无环性或非负性做确定传播；"
            "Dijkstra、树形 DP、KMP、Tarjan 都是把局部信息沿结构向上/向外合并。"
        ),
    },
    3: {
        "name": "阶段三：决策容量 & 剪枝熵",
        "range": "约 2000 – 2400",
        "slogan": "把逻辑推理变成容量/几何/代数",
        "description": (
            "最大流、凸包、斜率优化、AC 自动机、线性基："
            "通过容量对偶、凸壳剔除、线性无关降维来压缩决策空间。"
        ),
    },
    4: {
        "name": "阶段四：时空变换 & 纠缠熵",
        "range": "约 2400 – 3500+",
        "slogan": "现实太乱就旋转 90 度看",
        "description": (
            "FFT、LCT、SAM、插头 DP、时间轴分治："
            "换坐标系、动态重排、持久化历史，把纠缠结构解耦。"
        ),
    },
}

# ── 拆题四步 ──────────────────────────────────────────────
ANATOMY_STEPS = [
    {
        "step": "第一步：空间拓扑",
        "question": "数据长在什么形状上？",
        "choices": "线性 / 树图 / 抽象代数",
        "output": "决定信息传递的基本道路。",
    },
    {
        "step": "第二步：时间维度",
        "question": "数据在程序运行中变不变？",
        "choices": "静态 / 动态",
        "output": "静态走预处理/离线；动态走实时数据结构。",
    },
    {
        "step": "第三步：度量代数",
        "question": "累加/比较用哪种数学规则？",
        "choices": "加法最值 / 异或 / 卷积 / 计数 / 布尔 / 数论 / 几何",
        "output": "决定合并信息的代数结构：加法用松弛，异或用消元，乘法用卷积。",
    },
    {
        "step": "第四步：看数据规模",
        "question": "n 有多大？",
        "choices": "≤20 / ≤100 / ≤5000 / ≤1e5 / ≤1e9",
        "output": "直接决定枚举、O(n²)、O(n log n) 还是数学公式/矩阵幂。",
    },
]

# ── 每个算法的信息论标签 ─────────────────────────────────
# 值为 dict：
#   ops: 信息操作（可多选）
#   topology: 拓扑空间
#   metric: 度量代数
#   dynamic: 静态/动态
#   phase: 1-4
#   why: 一句话解释“为什么归到这些操作”

ALGORITHM_INFO = {
    "暴力枚举": {
        "ops": [OP_BASELINE], "topology": "抽象代数", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "状态空间有限时直接遍历，不做信息压缩。",
    },
    "约瑟夫环（模拟）": {
        "ops": [OP_BASELINE], "topology": "线性", "metric": "模拟",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "按题意复现过程，属于基线模拟。",
    },
    "区间调度（贪心）": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "按右端点排序，剪掉冲突区间。",
    },
    "排序后取最值（基础贪心）": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "排序后取前缀，等价于剪掉非最优候选。",
    },
    "反悔贪心（带堆维护）": {
        "ops": [OP_PRUNE, OP_PROPAGATE], "topology": "线性", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "用小根堆维护已选集合，允许剪枝后反悔替换。",
    },
    "二分查找": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "比较",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "有序性使每次比较砍掉一半搜索空间。",
    },
    "二分答案": {
        "ops": [OP_PRUNE], "topology": "抽象代数", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "把最优化问题变成可行性判定，单调性筛选。",
    },
    "归并排序求逆序对": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "线性", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "分治归并时利用有序性一次统计跨区间贡献。",
    },
    "结构体排序（重载运算符）": {
        "ops": [OP_ENCODE], "topology": "线性", "metric": "比较",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "排序把无序序列变成有序结构，后续查询/贪心可剪枝。",
    },
    "一维前缀和": {
        "ops": [OP_ENCODE], "topology": "线性", "metric": "加法",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "把区间累计信息压缩成两个端点差值。",
    },
    "二维前缀和": {
        "ops": [OP_ENCODE], "topology": "线性", "metric": "加法",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "用容斥把子矩阵信息压缩到四个角点。",
    },
    "差分数组": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "线性", "metric": "加法",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "区间加减转为端点差分，把连续操作降维成点操作。",
    },
    "双指针（滑动窗口）": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "加法/计数",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "利用单调性线性移动指针，剪掉不可能端点。",
    },
    "构造算法": {
        "ops": [OP_BASELINE], "topology": "抽象代数", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "利用奇偶/模性质直接给出解，绕过搜索。",
    },
    "位掩码子集枚举": {
        "ops": [OP_ENCODE], "topology": "抽象代数", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "集合选择编码进机器字，位运算并行处理。",
    },
    "状态压缩 + BFS": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "抽象代数", "metric": "步数/布尔",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "状态编码成二进制，BFS 沿状态图逐层扩散。",
    },
    "单调栈": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "最值/比较",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "利用单调性弹出永远不会成为答案的候选。",
    },
    "栈（基础）": {
        "ops": [OP_BASELINE], "topology": "线性", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "后进先出容器，作为括号匹配/表达式求值骨架。",
    },
    "单调队列（滑动窗口）": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "窗口内淘汰过期/劣势候选，O(n) 维护最值。",
    },
    "队列（基础）": {
        "ops": [OP_PROPAGATE], "topology": "线性", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "FIFO 容器，BFS/拓扑排序的信息传播通道。",
    },
    "堆（Top-K）": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "只保留前 K 大，堆顶即当前最小候选。",
    },
    "并查集 (DSU)": {
        "ops": [OP_PROPAGATE, OP_ENCODE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_DYNAMIC, "phase": 2,
        "why": "把连通关系用父指针压缩表示，路径压缩加速传播。",
    },
    "带权并查集": {
        "ops": [OP_PROPAGATE, OP_ENCODE], "topology": "树图", "metric": "加法/异或",
        "dynamic": DYN_DYNAMIC, "phase": 2,
        "why": "父指针同时编码到根的距离，合并时传播相对权值。",
    },
    "线段树（区间和 + 懒标记）": {
        "ops": [OP_PROPAGATE, OP_ENCODE], "topology": "线性", "metric": "加法/最值",
        "dynamic": DYN_DYNAMIC, "phase": 2,
        "why": "区间信息编码到线段节点，懒标记批量传播更新。",
    },
    "ST 表（静态区间最值）": {
        "ops": [OP_ENCODE], "topology": "线性", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "倍增预处理区间最值，静态查询 O(1)。",
    },
    "树状数组 (BIT)": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "线性", "metric": "加法",
        "dynamic": DYN_DYNAMIC, "phase": 2,
        "why": "前缀信息编码进树状数组，点改/前缀查实时传播。",
    },
    "树状数组求逆序对": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "线性", "metric": "计数",
        "dynamic": DYN_DYNAMIC, "phase": 2,
        "why": "按值域树状数组统计已出现元素，边扫描边传播计数。",
    },
    "FHQ Treap（无旋 Treap）": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "线性", "metric": "加法/最值",
        "dynamic": DYN_DYNAMIC, "phase": 3,
        "why": "随机优先级+分裂合并，把序列操作编码成平衡树。",
    },
    "线段树合并/分裂": {
        "ops": [OP_PROPAGATE, OP_TRANSFORM], "topology": "树图", "metric": "计数/最值",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "多棵线段树按树形合并，把信息从叶子向上聚合。",
    },
    "可撤销并查集": {
        "ops": [OP_PROPAGATE, OP_TRANSFORM], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "按秩合并+栈回滚，让连通信息在时间轴上可逆。",
    },
    "Dijkstra": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "树图", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "非负权下优先队列只扩展已确定最短路点，剪枝+传播。",
    },
    "Bellman-Ford": {
        "ops": [OP_PROPAGATE], "topology": "树图", "metric": "加法",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "沿所有边松弛 n-1 轮，可检测负环。",
    },
    "Floyd-Warshall": {
        "ops": [OP_PROPAGATE, OP_TRANSFORM], "topology": "树图", "metric": "加法",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "把所有点对最短路看成逐层插入中间点的传播。",
    },
    "Kruskal": {
        "ops": [OP_PRUNE, OP_PROPAGATE], "topology": "树图", "metric": "加法/布尔",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "边按权排序后贪心加入，剪掉成环边。",
    },
    "Prim": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "树图", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "从已选集合向外扩散最小割边。",
    },
    "Dinic 最大流": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "树图", "metric": "容量/加法",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "分层+BFS+增广路，在残余网络上传播流量。",
    },
    "最小割建模": {
        "ops": [OP_TRANSFORM, OP_PRUNE], "topology": "树图", "metric": "容量/布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "资源取舍转最小割，最大流=最小割对偶。",
    },
    "Tarjan 求 SCC": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "树图", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "dfn/low 压缩强连通块为超级点。",
    },
    "拓扑排序 (Kahn)": {
        "ops": [OP_PROPAGATE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "按入度逐层剥离，把 DAG 依赖线性化传播。",
    },
    "连通块染色": {
        "ops": [OP_PROPAGATE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "DFS/BFS 沿边扩散，给连通分量编码。",
    },
    "二分图染色判定": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "二色沿边交替传播，冲突则无解。",
    },
    "简单回溯": {
        "ops": [OP_PRUNE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "在决策树上深度搜索并剪掉不可能分支。",
    },
    "割点 / 桥": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "树图", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "DFS 树+low 值识别关键节点/边，压缩冗余环。",
    },
    "拓扑排序 + DAG DP": {
        "ops": [OP_PROPAGATE], "topology": "树图", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "按拓扑序传播状态，无后效性逐点合并。",
    },
    "二分图最大匹配（匈牙利）": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "树图", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "增广路沿交替图传播匹配，找最大匹配。",
    },
    "KM 算法": {
        "ops": [OP_PROPAGATE, OP_TRANSFORM], "topology": "树图", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "顶点标号+增广路找完美匹配，权值松弛。",
    },
    "2-SAT": {
        "ops": [OP_TRANSFORM, OP_PROPAGATE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "逻辑蕴含连边，SCC 判可行性。",
    },
    "LCA（倍增）": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "树图", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "祖先的 2^k 跳跃表，把树上路径查询压缩成二进制跳。",
    },
    "树上差分": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "树图", "metric": "加法/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "路径加减转为差分标记，一次 DFS 聚合。",
    },
    "树的直径 / 重心": {
        "ops": [OP_PROPAGATE], "topology": "树图", "metric": "最值/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "两次 BFS/树形聚合找最长链与重心。",
    },
    "基环树 DP": {
        "ops": [OP_TRANSFORM, OP_PROPAGATE], "topology": "树图", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "断环成链后做两次树形 DP，去除循环纠缠。",
    },
    "仙人掌 / 圆方树": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "树图", "metric": "布尔/最值",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "把环压缩成方点，还原成树结构。",
    },
    "LIS（最长上升子序列）": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "线性", "metric": "最值/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "dp+单调序列维护，二分更新上升子序列尾。",
    },
    "LCS（最长公共子序列）": {
        "ops": [OP_PROPAGATE], "topology": "线性", "metric": "计数/长度",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "二维 DP 沿两个序列传播匹配状态。",
    },
    "0/1 背包": {
        "ops": [OP_PROPAGATE], "topology": "抽象代数", "metric": "最值/加法",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "容量维度上的逐物品转移传播最优值。",
    },
    "完全背包": {
        "ops": [OP_PROPAGATE], "topology": "抽象代数", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "正序容量循环允许同物品多次传播。",
    },
    "石子合并": {
        "ops": [OP_PROPAGATE], "topology": "线性", "metric": "加法/最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "区间 DP 从小区间向大区间聚合代价。",
    },
    "树上最大权独立集": {
        "ops": [OP_PROPAGATE], "topology": "树图", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "子树选/不选两种状态向父节点聚合。",
    },
    "TSP（状压）": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "抽象代数", "metric": "最值/加法",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "访问集合编码为 mask，逐点转移。",
    },
    "数位 DP（不含 4）": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "线性", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "数位状态+limit/lead 编码进记忆化。",
    },
    "斜率优化（CHT）": {
        "ops": [OP_PRUNE, OP_TRANSFORM], "topology": "线性", "metric": "最值/加法",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "候选转移看作直线，用凸包剔除永不优的线。",
    },
    "四边形不等式优化": {
        "ops": [OP_PRUNE], "topology": "线性", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "决策单调性使 DP 分治/单调队列剪枝。",
    },
    "轮廓线 DP（简单棋盘状压）": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "抽象代数", "metric": "计数/布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "把二维棋盘连通性压到一维轮廓线状态。",
    },
    "KMP": {
        "ops": [OP_PRUNE, OP_ENCODE], "topology": "线性", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "利用前缀对称性失配跳转，文本指针不回退。",
    },
    "Z-function": {
        "ops": [OP_ENCODE, OP_PRUNE], "topology": "线性", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "预处理每个后缀与整体前缀的 LCP，压缩匹配信息。",
    },
    "AC 自动机": {
        "ops": [OP_ENCODE, OP_PRUNE], "topology": "树图", "metric": "计数/布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "多模式串前缀树+fail 跳跃，一次扫描多串命中。",
    },
    "AC 自动机 + 矩阵快速幂": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "树图", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "AC 自动机构造状态图，矩阵幂快速统计长串方案。",
    },
    "后缀数组 (SA)": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "线性", "metric": "排序/计数",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "把所有后缀排序成数组，子串信息变为区间查询。",
    },
    "Manacher": {
        "ops": [OP_ENCODE, OP_PRUNE], "topology": "线性", "metric": "最值/计数",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "利用回文对称性扩展，线性求回文半径。",
    },
    "SAM（后缀自动机）": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "树图", "metric": "计数/长度",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "子串等价类压缩成最小 DFA，O(n) 表示 O(n²) 信息。",
    },
    "Trie（字典树）": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "树图", "metric": "布尔/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "公共前缀共享节点，把字符串集合压缩成树。",
    },
    "字符串哈希（Rolling Hash）": {
        "ops": [OP_ENCODE], "topology": "线性", "metric": "布尔/比较",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "子串映射为整数，O(1) 比较等价信息。",
    },
    "线性筛（欧拉筛）": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "抽象代数", "metric": "数论/计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "每个合数只被最小质因子筛一次，压缩重复标记。",
    },
    "埃氏筛": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "抽象代数", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "质数的倍数批量标记，剪掉合数。",
    },
    "素数判定（试除法）": {
        "ops": [OP_BASELINE], "topology": "抽象代数", "metric": "布尔",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "直接试除小因子，作为基础判定。",
    },
    "欧拉函数": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "抽象代数", "metric": "计数/数论",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "质因数分解后公式计算与 n 互质个数。",
    },
    "快速幂": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "模乘法",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "二进制拆解指数，幂运算从 O(b) 变 O(log b)。",
    },
    "扩展欧几里得 (exgcd)": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "数论/模",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "辗转相除同时求线性组合系数。",
    },
    "费马小定理求逆元": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "模乘法",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "模素数的逆元转换为快速幂。",
    },
    "组合数（预处理阶乘）": {
        "ops": [OP_ENCODE], "topology": "抽象代数", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "阶乘/逆元预处理，组合数查询 O(1)。",
    },
    "中国剩余定理 (CRT)": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "模/数论",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "同余方程组合并，剩余定理压缩模空间。",
    },
    "Lucas 定理": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "计数/模",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "大组合数模质数拆成 p 进制逐位计算。",
    },
    "容斥原理": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "并集计数转为子集交的加减，对偶转化。",
    },
    "错排 / 卡特兰数": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "抽象代数", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "递推公式/生成函数压缩组合结构。",
    },
    "唯一分解定理": {
        "ops": [OP_ENCODE], "topology": "抽象代数", "metric": "数论",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "质因数分解作为数论问题的标准编码。",
    },
    "高斯消元（异或方程组 bitset）": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "异或/布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "线性方程组消元，把复杂约束压缩成行阶梯。",
    },
    "扩展中国剩余定理（EXCRT）": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "模",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "不互质同余方程逐步合并。",
    },
    "线性基": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "抽象代数", "metric": "异或",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "异或组合压缩成线性无关基，去冗余。",
    },
    "GCD / LCM": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "数论",
        "dynamic": DYN_STATIC, "phase": 1,
        "why": "辗转相除把大数问题映射到对数步。",
    },
    "矩阵快速幂优化递推": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "乘法/加法",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "线性递推编码为矩阵，快速幂压缩时间。",
    },
    "Andrew 单调链凸包": {
        "ops": [OP_PRUNE, OP_ENCODE], "topology": "抽象代数", "metric": "几何/极值",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "极角排序+栈维护凸壳，剔除凹点。",
    },
    "旋转卡壳": {
        "ops": [OP_PRUNE, OP_TRANSFORM], "topology": "抽象代数", "metric": "几何/极值",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "利用凸包单调性旋转对踵点，剪枝求直径。",
    },
    "最近点对（分治）": {
        "ops": [OP_PRUNE, OP_TRANSFORM], "topology": "抽象代数", "metric": "距离",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "按 x 分治+按 y 剪枝，只查附近点。",
    },
    "线段相交判定": {
        "ops": [OP_BASELINE], "topology": "抽象代数", "metric": "几何/布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "叉积/点积判断方位，几何基础判定。",
    },
    "叉积 / 点积判断方位": {
        "ops": [OP_BASELINE], "topology": "抽象代数", "metric": "几何",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "向量运算原子，作为几何判定基础。",
    },
    "Nim 游戏与 SG 函数": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "抽象代数", "metric": "异或/布尔",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "博弈状态压缩成 SG 值，异或和判定胜负。",
    },
    "期望 DP（掷骰子）": {
        "ops": [OP_PROPAGATE], "topology": "线性", "metric": "期望/加法",
        "dynamic": DYN_STATIC, "phase": 2,
        "why": "概率期望沿状态逆推传播。",
    },
    "莫队（区间不同数）": {
        "ops": [OP_TRANSFORM, OP_PRUNE], "topology": "线性", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 3,
        "why": "重排查询顺序使指针少走，离线降低移动熵。",
    },
    "主席树（区间第 k 小）": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "线性", "metric": "计数/最值",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "持久化前缀权值线段树，按版本差分查询。",
    },
    "Link-Cut Tree (LCT)": {
        "ops": [OP_TRANSFORM, OP_PROPAGATE], "topology": "树图", "metric": "最值/加法/异或",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "虚实链+Splay 动态剖分，让树形态实时重排。",
    },
    "树链剖分 (HLD)": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "树图", "metric": "最值/加法",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "树压成 DFS 序区间，配合线段树动态维护。",
    },
    "可持久化数据结构（主席树进阶）": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "线性", "metric": "计数/最值",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "每次更新新建节点保留历史版本，把时间轴编码进树。",
    },
    "后缀自动机（SAM）进阶": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "树图", "metric": "计数/长度",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "parent 树拓扑序聚合 endpos，统计子串信息。",
    },
    "广义 SAM": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "树图", "metric": "计数/长度",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "多串共用一个 SAM，压缩多串子串空间。",
    },
    "FFT": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "卷积",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "时域卷积映射到频域点乘。",
    },
    "NTT": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "卷积",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "模质数下做 NTT，避免浮点误差。",
    },
    "生成函数": {
        "ops": [OP_TRANSFORM, OP_ENCODE], "topology": "抽象代数", "metric": "卷积/计数",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "数列编码成形式幂级数，卷积对应组合计数。",
    },
    "莫比乌斯反演": {
        "ops": [OP_TRANSFORM], "topology": "抽象代数", "metric": "数论/计数",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "整除卷积经莫比乌斯函数反演，变换到互质计数。",
    },
    "线性基进阶": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "抽象代数", "metric": "异或",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "区间/离线合并线性基，扩展异或空间压缩。",
    },
    "半平面交": {
        "ops": [OP_PRUNE, OP_TRANSFORM], "topology": "抽象代数", "metric": "几何/布尔",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "极角排序+双端队列剔除无用半平面。",
    },
    "最小圆覆盖": {
        "ops": [OP_BASELINE, OP_PRUNE], "topology": "抽象代数", "metric": "几何/最值",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "随机增量法，期望下只处理少量关键点。",
    },
    "三维凸包": {
        "ops": [OP_BASELINE, OP_PRUNE], "topology": "抽象代数", "metric": "几何/布尔",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "增量法维护可见面，几何基础。",
    },
    "支配树": {
        "ops": [OP_PROPAGATE, OP_ENCODE], "topology": "树图", "metric": "布尔/路径",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "有向图必经过点压缩成树，Lengauer-Tarjan 传播。",
    },
    "点分治/边分治": {
        "ops": [OP_PRUNE, OP_TRANSFORM], "topology": "树图", "metric": "计数/最值",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "按重心分治，把路径统计分解到经过重心的子问题。",
    },
    "动态图连通性（离线）": {
        "ops": [OP_TRANSFORM, OP_PROPAGATE], "topology": "树图", "metric": "布尔",
        "dynamic": DYN_DYNAMIC, "phase": 4,
        "why": "时间轴线段树分治+可撤销并查集，批量处理边的生命周期。",
    },
    "插头 DP": {
        "ops": [OP_ENCODE, OP_TRANSFORM], "topology": "抽象代数", "metric": "计数/布尔",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "轮廓线状态编码二维连通性，逐格转移。",
    },
    "DP 套 DP": {
        "ops": [OP_ENCODE, OP_PROPAGATE], "topology": "抽象代数", "metric": "计数",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "内层 DP 状态作为外层状态，自动机式压缩。",
    },
    "分治 DP": {
        "ops": [OP_PRUNE, OP_TRANSFORM], "topology": "线性", "metric": "最值",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "决策单调性分治，把 O(n²) 剪枝到 O(n log n)。",
    },
    "上下界网络流": {
        "ops": [OP_TRANSFORM, OP_PROPAGATE], "topology": "树图", "metric": "容量/加法",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "下界先流+超级源汇转换，把上下界约束转普通网络流。",
    },
    "最小费用最大流": {
        "ops": [OP_PROPAGATE, OP_PRUNE], "topology": "树图", "metric": "费用/加法",
        "dynamic": DYN_STATIC, "phase": 4,
        "why": "最短路增广，沿最小费用路径传播流量。",
    },
}


def get_alg_info(name: str) -> dict:
    """按算法名获取信息论标签；缺省给一个中性标签。"""
    info = ALGORITHM_INFO.get(name)
    if info is None:
        return {
            "ops": [OP_BASELINE],
            "topology": "抽象代数",
            "metric": "通用",
            "dynamic": DYN_STATIC,
            "phase": 1,
            "why": "尚未标注信息论视角。",
        }
    return info
