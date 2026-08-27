# 知识阶梯 · 移动端（PWA / Capacitor）

这是从 `knowledge-ladder` 桌面版抽出的移动端版本。

- 手机浏览器直接打开 `www/index.html` 即可体验（建议用本地 http 服务，方便 Service Worker）。
- 进度保存在 `localStorage`，离线可用。
- 要生成 Android APK 时，用 Capacitor 把它包装成原生 WebView 应用。

## 数据更新

每次改了 Python 端的数据（算法、档位、信息论标签），在 `knowledge-ladder` 根目录执行：

```bash
python3 export_mobile_data.py
```

会重新生成 `mobile/www/data.js`。

## 本地预览

```bash
cd mobile
./serve.sh
# 或：cd www && npx serve .
```

浏览器打开 `http://localhost:8000`。

也可以直接双击 `www/index.html`（不启用 Service Worker，但功能可用）。

## 打包成 APK

前置条件：安装 Node.js、Java 17+、Android Studio / Android SDK。

```bash
cd mobile
npm install
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

生成结果：

```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## 云构建（不装 Android Studio）

仓库根目录已配置 `.github/workflows/build-apk.yml`。提交并推送到 GitHub 后，Actions 会自动：

1. 重新生成 `mobile/www/data.js`
2. 安装 Capacitor
3. 生成 Android 工程
4. 构建 `app-debug.apk`
5. 上传为 artifact

在 GitHub 仓库的 **Actions** 页面运行 `Build Knowledge Ladder APK`，下载 `knowledge-ladder-apk` 即可。

## 目录

```
mobile/
├── www/                # Web 资源（Capacitor 的 webDir）
│   ├── index.html      # 移动端页面
│   ├── style.css       # 移动端样式
│   ├── app.js          # 交互逻辑
│   ├── data.js         # 由 export_mobile_data.py 生成
│   ├── manifest.json   # PWA 清单
│   ├── sw.js           # 离线缓存
│   └── icon.svg
├── capacitor.config.json
├── package.json
└── build-apk.yml       # GitHub Actions 云构建模板
```
