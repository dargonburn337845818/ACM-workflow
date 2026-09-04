# 拆题引导 · Knowledge Ladder

> 不背模板，练拆题。
> 移动端：打开就拆题，四步引导，不给代码。
> 桌面端：同一设计，多一个「算法模板」导航。
> 视觉：Parallax Editorial（暖纸、墨黑、砖红、衬线）。

---

## 这个项目是什么

刷题时真正缺的不是模板，而是**别走弯路**。  
这个工具把题目拆解变成一条固定思考链：

```text
数据形状 → 数据是否变化 → 运算规则 → 数据规模
                         ↓
                    建议方向
                         ↓
               引导式思考 / 下一步
```

- 移动端：只做拆题，快速、简洁、无模板
- 桌面端：同样的拆题主界面，额外提供算法信息与 C++ 模板
- 使用场景：不能写代码时练拆解；写代码前先确认方向

---

## 风格

**Parallax Editorial（视差杂志风）**

- 暖纸底色 `#F5F0E6`
- 墨黑正文 `#1A1712`
- 唯一砖红强调 `#B3401F`
- 衬线标题、宽松行高、无圆角、无阴影、无冷色

完整设计规范见：

```text
docs/style-parallax-editorial.md
```

---

## 功能

### 移动端（PWA / APK）

- 打开直接进入四步拆题
- 一步一屏，点选自动前进
- 建议方向标签可点击查看解释
- 下一步进入「引导式思考」界面，可返回
- 不包含 C++ 模板

### 桌面端（Python / PySide6）

- 启动即拆题，与移动端一致
- 左侧「算法模板」进入算法信息与 C++ 模板
- 保留 8 档难度、掌握进度、信息论微缩模块
- 同一套玻璃拟态视觉
- 支持连接 Steam Wallpaper Engine：壁纸按钮自动扫描本地壁纸库，可选壁纸作为背景

---

## 快速开始

### 移动端网页预览

```bash
cd mobile
./serve.sh
```

浏览器打开：

```text
http://localhost:8000
```

### Android APK

方式一：GitHub Actions（当前 monorepo）

- 推送到根仓库 `main` 时，根目录 `.github/workflows/build-apk.yml` 自动构建 APK，下载 artifact
- 打 tag（如 `v1.0.0`）会触发根目录 Release 工作流；当前会自动发布 VSIX，APK 仍以 artifact 形式提供（后续可扩展为同一 Release 附带 APK）

方式二：本地构建

```bash
cd mobile
npm install
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

### 桌面端

```bash
python -m pip install -r requirements.txt
python main.py
```

Windows 便携版：

```bat
build_windows.bat
```

---

## 项目结构

```text
.
├── main.py                    # 桌面端（PySide6）
├── mobile/                    # 移动端 PWA + Capacitor
│   └── www/                   # 移动端前端
├── docs/
│   └── style-parallax-editorial.md
├── info_framework.py          # 信息论标签数据
├── knowledge_data.py          # 120 个算法数据
├── tiers_data.py              # 8 档难度数据
├── export_mobile_data.py      # 导出移动端 data.js
└── style.qss                  # 桌面端 Parallax Editorial 主题

> 若把本目录抽成独立 GitHub 仓库，可参考 `mobile/build-apk.yml` 与根目录
> `.github/workflows/build-apk.yml` 作为 Actions 模板；当前 monorepo 中由根 `.github/workflows` 统一执行。
```

---

## Release

在根仓库（monorepo）中：

- 根目录 `.github/workflows/build-apk.yml`：push 到 `main` 自动构建 Android APK
- 根目录 `.github/workflows/release.yml`：VS Code 扩展 tag 自动构建 VSIX Release
- 如果后续把 `knowledge-ladder` 抽成独立仓库，再从 `mobile/build-apk.yml` 模板恢复子项目自己的 Actions

本地打 tag 示例：

```bash
git tag v1.0.0
git push origin main --tags
```

---

## License

MIT
