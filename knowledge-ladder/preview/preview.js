// CF 难度阶梯 · UI 预览交互（仅用于预览确认）

const themeToggle = document.getElementById('themeToggle');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalClose = document.getElementById('modalClose');
const modalClose2 = document.getElementById('modalClose2');
const modalTitle = document.getElementById('modalTitle');
const modalPath = document.getElementById('modalPath');
const modalAlgName = document.getElementById('modalAlgName');
const modalIntro = document.getElementById('modalIntro');
const modalComplexity = document.getElementById('modalComplexity');
const modalCode = document.getElementById('modalCode');
const modalTabs = document.getElementById('modalTabs');

// 预览用示例数据
const samples = {
  brute: {
    title: '暴力枚举',
    quality: 'complete',
    path: '基础算法 / 枚举',
    tabs: ['暴力枚举', '位掩码子集枚举'],
    intro: '数据范围小或答案空间有限时，直接枚举所有情况并验证。模板：枚举所有子区间求最大子段和。',
    complexity: '复杂度：O(n²)（本例）',
    code: `int maxSubarray(const vector<int>& a) {
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
  },
  sort: {
    title: '排序',
    quality: 'complete',
    path: '基础算法 / 排序',
    tabs: ['结构体排序（重载运算符）'],
    intro: '自定义结构体排序：重载 < 运算符或传入比较函数，按多关键字排序。',
    complexity: '复杂度：O(n log n)',
    code: `struct Node { int a, b; };
bool cmp(const Node& x, const Node& y) {
  if (x.a != y.a) return x.a < y.a;
  return x.b < y.b;
}
// sort(v.begin(), v.end(), cmp);`
  },
  greedy: {
    title: '基础贪心',
    quality: 'complete',
    path: '基础算法 / 贪心',
    tabs: ['排序后取最值（基础贪心）'],
    intro: '先按某个关键字排序，再顺序取当前最优值。',
    complexity: '复杂度：O(n log n)（排序）',
    code: `long long maxAfterSort(vector<int>& profits, int k) {
  sort(profits.rbegin(), profits.rend());
  long long ans = 0;
  for (int i = 0; i < k && i < (int)profits.size(); i++) ans += profits[i];
  return ans;
}`
  },
  binary: {
    title: '二分答案',
    quality: 'complete',
    path: '基础算法 / 二分',
    tabs: ['二分答案'],
    intro: '答案具有单调性时，直接二分答案并 O(n) 验证。',
    complexity: '复杂度：O(n log V)（V 为答案值域）',
    code: `bool check(long long x); // 按题目实现：x 是否可行

long long binaryAnswer() {
  long long lo = 0, hi = 1e18, ans = hi;
  while (lo <= hi) {
    long long mid = (lo + hi) / 2;
    if (check(mid)) { ans = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return ans;
}`
  },
  math: {
    title: '基础数学',
    quality: 'complete',
    path: '基础算法 / 数学',
    tabs: ['GCD / LCM', '快速幂'],
    intro: 'GCD/LCM、素数判定、埃氏筛、快速幂等基础数论工具。',
    complexity: '复杂度：O(log min(a,b)) / O(log n)',
    code: `long long gcd(long long a, long long b) {
  return b == 0 ? a : gcd(b, a % b);
}
long long lcm(long long a, long long b) {
  return a / gcd(a, b) * b;
}`
  },
  impl: {
    title: '纯模拟',
    quality: 'complete',
    path: '基础算法 / 模拟',
    tabs: ['约瑟夫环（模拟）'],
    intro: '按题意直接复现流程，注意边界和取模。',
    complexity: '复杂度：O(nk)',
    code: `int josephus(int n, int k) {
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
};

// 主题切换
themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.contains('theme-dark');
  document.body.classList.toggle('theme-dark', !isDark);
  document.body.classList.toggle('theme-light', isDark);
  themeToggle.textContent = isDark ? '风格：浅色现代' : '风格：深色现代';
});

// 打开弹窗
document.querySelectorAll('[data-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const sample = samples[btn.dataset.modal] || samples.brute;
    modalTitle.textContent = sample.title;
    modalPath.textContent = sample.path;
    modalAlgName.textContent = sample.title;
    modalIntro.textContent = sample.intro;
    modalComplexity.textContent = sample.complexity;
    modalCode.textContent = sample.code;

    const badge = document.querySelector('.quality-badge');
    badge.className = 'quality-badge ' + sample.quality;
    badge.textContent = sample.quality === 'complete' ? '完整' : sample.quality === 'skeleton' ? '骨架' : '待补';

    modalTabs.innerHTML = '';
    sample.tabs.forEach((tabName, i) => {
      const tab = document.createElement('button');
      tab.className = 'tab' + (i === 0 ? ' active' : '');
      tab.textContent = tabName;
      tab.addEventListener('click', () => {
        modalTabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
      });
      modalTabs.appendChild(tab);
    });

    modalBackdrop.classList.add('open');
  });
});

function closeModal() {
  modalBackdrop.classList.remove('open');
}

modalClose.addEventListener('click', closeModal);
modalClose2.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
