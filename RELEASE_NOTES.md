# ACM Workflow 0.24.1

VSCode 内 Codeforces 刷题全流程工作台：选题 → 题面翻译 → 测试 → 对拍 → 造数据 → 比赛 → 记录。

## 本次更新：样例形式规律推断

### 先理解样例规律，再生成数据
「按样例生成」不再只是逐行照抄样例形状，而是先尝试理解样例结构：

- `首行 N + 下一行 N 个数` → **数组/序列**
  ```text
  5
  1 2 3 4 5
  ```
  生成：
  ```python
  n = 5
  print(n)
  print(randint, randint, randint, randint, randint)
  ```

- `首行 N + 后续 N 行` → **矩阵/边列表**
  ```text
  3
  1 2
  3 4
  5 6
  ```
  生成：
  ```python
  n = 3
  print(n)
  for _ in range(n):
      print(randint, randint)
  ```

- 无法识别时，按样例逐行 token 形状兜底。

### 依然轻量
- 不调用 LLM、不加载模型。
- 毫秒级生成。
- 本地部署参数保持轻量：ctx 8192 / batch 256 / threads 8 / GPU 0 / max_tokens 1024 / 默认不自动拉起 Spark。

## 安装

下载 `acm-workflow-0.24.1.vsix`，在 VS Code 扩展面板选择「从 VSIX 安装」。

## License

MIT
