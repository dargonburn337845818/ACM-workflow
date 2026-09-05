# ACM Workflow 0.24.3

VSCode 内 Codeforces 刷题全流程工作台：选题 → 题面翻译 → 测试 → 对拍 → 造数据 → 比赛 → 记录。

## 本次更新：约束范围真正应用

上一版只把 `n / m` 的范围用上了，`a_i`、`u/v` 这些**元素值范围**还没真正代入生成。

0.24.3 修复：

```text
第二行包含 n 个整数 a_i (0≤a_i≤10)
```
→ 生成：
```python
print(' '.join(str(random.randint(0, 10)) for _ in range(n)))
```

```text
接下来 m 行，每行两个整数 u v (1≤u≤5, 1≤v≤5)
```
→ 生成：
```python
for _ in range(m):
    print(random.randint(1, 5), random.randint(1, 5))
```

### 支持的范围写法
- `0≤a_i≤10`
- `1≤n≤10^5`
- `-10^9≤a_i≤10^9`
- `1≤u≤5` / `1≤v≤5`

### 原则
- 仍然是本地规则解析，不调用 LLM。
- 格式和范围都来自题面「输入格式」，不再只是形式上对。
- 优先：输入格式 → 样例规律 → 最小骨架。

## 安装

下载 `acm-workflow-0.24.3.vsix`，在 VS Code 扩展面板选择「从 VSIX 安装」。

## License

MIT
