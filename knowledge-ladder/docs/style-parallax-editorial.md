# Parallax Editorial 视差杂志风设计规范

> 适用产物：移动端拆题引导、桌面端拆题主界面、后续长内容叙事页面。
> 风格本质：印刷纸感 + 克制的视差深度 + 杂志式编辑排版。
> 一句话：**暖纸、墨字、一只砖红；滚动是翻页，深度是版面的第四维。**

---

## 1. 风格身份

| 项 | 值 |
| --- | --- |
| 风格名 | Parallax Editorial |
| 中文名 | 视差杂志风 |
| 气质 | 印刷质感、克制考究、文学性、电影感 |
| 核心介质 | 暖纸 + 近黑墨 + 唯一砖红强调 |
| 适合场景 | 引导式流程、长文叙事、章节化内容、品牌故事 |

---

## 2. 色彩体系

### 唯一允许的色板

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| 暖纸底色 | `#F5F0E6` | 页面背景 |
| 深纸色 | `#EBE3D3` | 次级背景、页脚、分隔区 |
| 墨黑正文 | `#1A1712` | 标题、正文 |
| 砖红强调 | `#B3401F` | 章节号、链接、首字下沉、关键引文 |
| 墨色透明层级 | `rgba(26,23,18,0.7)` | 次要文字 |
| 墨色透明层级 | `rgba(26,23,18,0.5)` | 辅助文字 |
| 墨色透明层级 | `rgba(26,23,18,0.2)` | 分隔线/边框 |

### 禁止色

- 禁止冷色：蓝、紫、青、灰蓝
- 禁止纯黑 `#000000`
- 禁止纯白 `#FFFFFF`
- 禁止霓虹/高饱和色
- 禁止多个强调色并存

---

## 3. 字体系统

### 标题

```css
font-family: "Fraunces", Georgia, "Songti SC", serif;
font-weight: 400;
letter-spacing: -0.02em;
```

- 大标题：`34px - 48px`
- 章节标题：`22px - 32px`
- 标题使用衬线展示字体，禁止加粗成为 `font-black`

### 正文

```css
font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
line-height: 1.7 - 1.8;
max-width: 68ch;
color: rgba(26,23,18,0.7);
```

### 小标签

```css
font-family: sans-serif;
font-size: 11px;
letter-spacing: 0.2em;
text-transform: uppercase;
color: #B3401F;
```

---

## 4. 布局规则

- 容器最大宽度：`620px`（移动）/ `1100px`（桌面）
- 页面留白：`24px - 32px`
- 章节之间用 `border-top: 1px solid rgba(26,23,18,0.2)` 分隔
- 内容区块以“章节”为单位，不是白色圆角卡片
- 分隔线是页面骨架，不是装饰
- 桌面可使用交错栏：图像列 `position: sticky`，文字列滚动
- 移动端取消强视差，保留排版和章节结构

---

## 5. 组件规范

### 5.1 提问/选项

- 问题标题：衬线、大号、不加粗
- 选项：无底色、无边框盒，使用底部细线分隔
- 选中/悬停：文字从墨黑过渡到砖红 `transition: color 300ms ease`
- 禁止圆角胶囊按钮、禁止阴影卡片

```html
<button class="option">
  线性
  <small>数组 / 字符串 / 区间</small>
</button>
```

### 5.2 结果拆解链路

- 使用章节式纵向节点
- 每步一个小标签 + 衬线结果
- 节点之间用细线或箭头
- 建议方向：砖红下划线文字标签，可点击
- “下一步”框保持为杂志式区块，点击进入引导式思考

### 5.3 引导式思考

- 顶部：返回 + 标题
- 每一章：`border-top` 细线 + 砖红小标签 + 衬线问题
- 正文：宽松行高，不用彩色块
- 最后汇总：墨黑边框顶部线 + 建议方向

### 5.4 解释弹窗

- 从底部滑出，但使用纸质表层
- 顶部 `border-top: 2px solid #B3401F`
- 标题砖红，正文墨黑
- 无圆角、无阴影、无玻璃态

---

## 6. 动效规范

### 原则

- 视差只使用 `transform: translate3d`
- 禁止在 `scroll` 事件里直接改 `top/margin/height`
- 所有视差用 rAF 节流
- 移动端视差关闭
- `prefers-reduced-motion` 下全部归零
- 普通交互只允许颜色、下划线、透明度变化
- 禁止 bounce / elastic 缓动
- 禁止短促急促动画

### 视差引擎（可直接复用）

```html
<div data-parallax="0.15">...</div>
```

```css
[data-parallax] {
  transform: translate3d(0, var(--pe-y, 0px), 0);
  will-change: transform;
}

@media (max-width: 768px) {
  [data-parallax] {
    transform: none !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-parallax] {
    transform: none !important;
  }
}
```

```js
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY || 0;
    document.querySelectorAll("[data-parallax]").forEach((el) => {
      const rate = parseFloat(el.dataset.parallax || "0");
      el.style.setProperty("--pe-y", `${-y * rate}px`);
    });
    ticking = false;
  });
}
window.addEventListener("scroll", onScroll, { passive: true });
```

---

## 7. 移动端适配

- 视差在移动端关闭：`max-width: 768px` 下 `transform: none`
- 内容保持单列，触控目标至少 `44px`
- 标题字号比桌面缩小
- 不引入复杂手势
- 不出现横向滚动

---

## 8. 无障碍

- `prefers-reduced-motion` 下视差和动态全部关闭
- 正文对比度满足 WCAG AA
- 所有可交互元素有清晰 focus / active
- 不使用颜色单独表达状态，必须配合下划线或图标

---

## 9. 绝对禁止

- ❌ 冷色调（蓝紫青灰蓝）
- ❌ 纯黑 / 纯白
- ❌ 渐变背景、渐变文字
- ❌ 玻璃态、霓虹、高饱和
- ❌ 大圆角、胶囊按钮、圆角卡片
- ❌ 厚重阴影
- ❌ 短促弹跳动画、上下乱跳
- ❌ 移动端强视差
- ❌ 多个强调色
- ❌ 在 scroll 事件里直接改 top / margin / height

---

## 10. 项目落点

当前这个风格已经应用在：

```
knowledge-ladder/mobile/www/index.html
knowledge-ladder/mobile/www/style.css
knowledge-ladder/mobile/www/app.js
```

后续桌面端若沿用此风格，建议：

- 主界面：暖纸背景 + 衬线大标题 + 章节细线
- 拆题流程：与移动端一致
- 信息/模板区域：以“杂志附录”形式出现，不用卡片堆叠
- 数据不改，只替换表现层

---

## 11. 自检清单

- [ ] 背景是 `#F5F0E6`，不是纯白
- [ ] 正文是 `#1A1712`，不是纯黑
- [ ] 强调色只有砖红 `#B3401F`
- [ ] 标题是衬线，正文行高 ≥ 1.7
- [ ] 页面没有大圆角、胶囊按钮、阴影卡片
- [ ] 视差只使用 transform + rAF
- [ ] 移动端和 reduced-motion 下视差归零
- [ ] 正文测度 ≤ 75 字符
- [ ] 没有玻璃态、渐变、霓虹
- [ ] 所有交互有反馈，且反馈不晃眼
