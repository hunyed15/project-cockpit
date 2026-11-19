# 本地预览与截图工具

DSH 的 Web GUI 需要鉴权 token，agent 打不开，因此**看不到自己写的界面**——只靠读 CSS 猜效果，
会漏掉溢出、对比度、换行、层级这类只有渲染才暴露的问题。

这组脚本绕开鉴权：用真实 React + 真实 CSS 在 localhost 渲染 `client.js`，
面板数据由本包自己的 `lib/` 现算（不是去连正在跑的 DSH，所以看到的就是当前代码），
再用 CDP 在**精确的 CSS 宽度**下截图。

## 用法

```powershell
# 第一次：装预览用的 React（不进入插件包依赖）
npm --prefix tools/preview install

# 起预览服务（默认 4711，PROJECT_DIR 指定用哪个项目的数据）
node tools/preview/server.mjs
```

浏览器打开 `http://127.0.0.1:4711/`，或直接截图：

```powershell
# 宽屏全页
node tools/preview/shot.mjs "http://127.0.0.1:4711/?scenario=real" 1200 800 shot-wide.png full
# 窄屏（真实 CSS 像素）
node tools/preview/shot.mjs "http://127.0.0.1:4711/?scenario=blocking" 360 900 shot-narrow.png full
# 只量溢出，不截图
node tools/preview/shot.mjs "http://127.0.0.1:4711/?scenario=blocking" 360 --measure
```

## 场景

`?scenario=` 决定后端返回什么：

| 值 | 用途 |
|---|---|
| `real` | 真实项目数据 |
| `blocking` | 伪造 3 个未处置 blocking（验证 chip / 阶段门 / 下一步是否自洽） |
| `warnings` | 4 条账本异常（验证降级横幅与 chip 三态） |
| `truncated` | 任务超上限（验证提示文案） |
| `manytasks` | 12 行任务，含一个超长标题（验证表格换行） |
| `error` | 500 + `workspace-not-allowed`（验证错误翻译与重试） |
| `nonjson` | 200 + HTML（验证"非 JSON 必须报错"） |
| `empty` | 没有工作区（验证空态，不是故障态） |

`&slot=main|dock|both` 选择渲染哪个插槽；`both` 会额外渲染对话常驻条并**自动点一次"去对话发送"→"发送"**，
用来验证「面板按钮 → 模块槽位 → dock → inputActions」这条链路。

## 两个坑（都踩过）

1. **不要用 `chrome --screenshot`**：在 125% DPI 的机器上它会缩放页面，布局正确看起来也被裁掉，
   真正的溢出反而看着正常。必须用 CDP 的 `Emulation.setDeviceMetricsOverride` 把
   `deviceScaleFactor` 钉成 1。
2. **预览服务必须发 `cache-control: no-store`**：否则同一 user-data-dir 会复用缓存的旧
   `client.js`，改了代码截图却还是旧样子。

## 限制（必须说清）

- `tokens.css` 里的 `--dsw-alias-*` 是**近似值**。排版、换行、溢出可信；
  **颜色对比度不可信**，必须在真机用真实 token 复核。
- 这里渲染的是组件本身，不含 DSH 的外壳（侧栏、主面板容器、真实滚动容器），
  所以"sticky 头是否生效""宿主给的宽度"这类问题仍要真机确认。
- 不覆盖鼠标/键盘交互，只覆盖静态渲染与一次预设点击链路。

## 移植到别的 DSH UI 插件

复制 `tools/preview/` 整个目录，改三处：

1. `server.mjs` 的 `PKG` 自动指向包根（不用改），`PROJECT` 改成你要预览的项目；
2. `server.mjs` 里 `/project-cockpit/api/*` 两个分支换成你插件的路由与返回形状；
3. 场景列表按你的插件状态改（降级态、空态、错误态、超长内容四类基本通用）。
