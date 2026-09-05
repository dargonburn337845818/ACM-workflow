# ACM Workflow 0.24.2

VSCode 内 Codeforces 刷题全流程工作台：选题 → 题面翻译 → 测试 → 对拍 → 造数据 → 比赛 → 记录。

## 本次更新：读题面输入格式指导生成

不只是看样例，现在会先提取题面中的「**输入格式**」小节，再生成脚本：

### 已支持的格式规律
- `第一行包含一个整数 n` + `第二行包含 n 个整数` → 数组/序列
  ```python
  n = random.randint(1, 100000)
  print(n)
  print(' '.join(str(random.randint(...)) for _ in range(n)))
  ```
- `第一行包含两个整数 n 和 m` + `接下来 m 行，每行两个整数` → 行列/边列表
  ```python
  n = random.randint(...)
  m = random.randint(...)
  print(n, m)
  for _ in range(m):
      print(random.randint(...), random.randint(...))
  ```
- 尝试识别约束范围：`1≤n≤10^5`、`0≤a_i≤10^9` 等，用于随机范围。
- 识别不了时依次降级：
  ```text
  输入格式 → 样例形式规律 → 最小骨架
  ```

### 说明
- SPJ / 交互题属于例外，不自动生成。
- 全程不调用 LLM、不加载模型，毫秒级完成。

## 安装

下载 `acm-workflow-0.24.2.vsix`，在 VS Code 扩展面板选择「从 VSIX 安装」。

## License

MIT
