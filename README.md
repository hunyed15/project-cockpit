> **⚠️ 已并入 [`@hunyed15/claude-code-review`](https://github.com/hunyed15/dsh-claude-code-review) v2.0.0**
>
> 本仓库不再单独维护。项目驾驶舱现在是审核插件的左侧栏「项目」整页，
> 安装那一个插件即可（不要与本包同时安装，两者抢同一个面板 id `project-cockpit`）。
> 本仓库保留作为历史与设计文档。
# @hunyed15/project-cockpit

> 源码：<https://github.com/hunyed15/project-cockpit>

DSH 插件：在左侧栏加一个**项目驾驶舱**整页，只读回答三个问题——**到哪了 / 卡在哪 / 下一步做什么**，并把"下一步"一键交给当前会话里的 AI 去执行。

## 它是什么 / 不是什么

- **是**：一个 Cordis Host 插件（bundle）+ 一个 Web 客户端半。安装后当前 profile 多一个左侧栏入口和一张整页，数据全部只读。
- **不是**：不写任何项目文件，不修改审核账本，不做验收自动化，不画甘特图。
- **和 `@hunyed15/claude-code-review` 的关系**：只**读**它写的账本（`review/*.json`、`dispositions.jsonl`），不依赖它的代码，也不改它。"代码这轮有没有问题"归它；"项目整体到哪了"归这里。

## 安装

只通过 GitHub 分发（没有发布到 npm）。

```powershell
plugin_manager(action: "install_bundle", target: "git+https://github.com/hunyed15/project-cockpit.git")
```

固定版本：`git+https://github.com/hunyed15/project-cockpit.git#v0.1.0`。

也可以 `git clone` 后用 **Plugins → Add plugin** 选目录，或直接 `install_bundle` 传本地路径。

> 链接安装的 bundle 名是 `@local/<目录名>`；从链接安装切到 git 安装前先 `remove_bundle`，否则两个 bundle 抢同一个面板 id `project-cockpit`。

## 数据从哪来（全部只读）

| 数据 | 来源 | 口径 |
|---|---|---|
| 任务状态、优先级、子任务、完成时间 | `<project>/.trellis/tasks/*/task.json` | 精确字段，直接读 |
| 待处置 bug、最近轮次 | 每个任务自己的账本 `.trellis/tasks/<task>/review/`，或本地账本 `.dsh/claude-review/ledger/review/` | 见下 |
| 环境 | `.trellis/.version`、`.trellis/spec/**` | 只做"在/不在/数量" |
| 阶段门 | 由上面三项**推断** | 每道门都显示依据，不隐藏 |

**多任务各算各的账本**：每个任务读自己的 `review/`，不会把 A 的 bug 记到 B 头上；`totals` 是任务间求和。

**bug 口径（必须与审核插件一致）**：

- `failOn` 取该轮 `review-N.json` 的 `meta.failOn`，缺失时回退 `critical/important`；
- 处置必须 `round` 匹配（跨轮处置不算），优先按 `key`、无 `key` 时按问题在 `issues` 里的原始下标；
- `fixed` / `deferred` / `counter-evidence` 视为已处置；`blocking` = 该级别未处置数，`open` = 未处置 + 已 fixed 待复检。

**阶段门是推断，不是声明**：`想清楚 / 定规格 / 搭骨架 / 写代码 / 挑毛病` 五道由证据推出（prd 存在、spec 文件数、任务状态、账本轮次），`验效果 / 发出去` 留到第二版，第一版恒 `pending`。每道门都带一行 `basis` 说明依据，界面上原样显示。

## 下一步与行动层

面板按状态机给出**唯一**动作：

| 条件 | 动作 | 指令 |
|---|---|---|
| 有未处置 blocking | 修复并复检 | 修完 N 个 blocking，标记处置后跑 `claude_review(mode:"gate")` |
| 有已修待复检 | 复检本轮修复 | 用 `claude_review(mode:"range")` 复检 |
| 从没审过 | 跑第一次审核 | `claude_review(mode:"full")` |
| 全绿 | 跑提交门禁 | `claude_review(mode:"gate")` |
| 没有 `.trellis` | 初始化 | 提示先建 trellis 项目 |

点「让 AI 执行下一步」→ 跳回对话，输入框上方出现通栏，右侧三个按钮：**发送** / **填入输入框** / **忽略**。

> 为什么是两步：DSH 0.2.2-rc.3 **没有**向活跃会话注入用户消息的公开 API（`commands.execute` 只执行斜杠命令、不发给模型；`subagents.sendMessage` 是父子会话语义）。所以行动层走浏览器侧已验证的 `inputActions.setDraft()` + `submit()`——代价是多一次点击，好处是走的就是**用户自己的发送通道**，你能看见将要发出去的原文。

## 平台与权限边界

- 需要 DSH `>=0.2.2-rc.3 <0.3.0`（`engines.dsh`，不满足时 `install_bundle` 拒绝）。
- 只有 Web profile 有意义：`export const inject = ['webServer']`，没有 Web 的行保持 inactive。
- 面板是 **root scope**，拿不到会话；项目来自**已注册工作区**，路由只接受 `workspaceRegistry` 里登记过的路径，其余 403——本机任何进程都无法让面板去读任意目录。
- **鉴权边界（重要）**：插件路由是用 `webServer.register({ kind: 'prefix' })` 注册的，**不受 DSH Web 的令牌闸门保护**——未登录的 `GET /` 会返回 401，但同进程的 `GET /project-cockpit/api/panel` 返回 200。它只在 `127.0.0.1` 上监听，读的也只是已登记工作区的 trellis 元数据（任务标题、审核结论），不返回文件内容、不提供写操作。**不要把这个端口的地址暴露到局域网或公网。**
- 只读：路由只有 `GET`（`POST` 会被 405 拒），不写项目文件、不写缓存。

## 自测

```powershell
node --test        # 54 个断言：计数口径、读取器、阶段门、下一步、模型、路由、客户端 smoke
```

## 限制（第一版）

- 面板每 8 秒轮询一次，没有增量推送。
- 验收页 / 设置页未实现（设计文档 §1.2 的非目标）。
- 待发送指令只存在浏览器内存里，刷新页面即丢失（指令可随时从面板重新生成）。
- 记住上次看的项目存在浏览器 localStorage；换机器或清缓存后会回到第一个工作区。

## 开发：看不到界面时怎么办

DSH 的 GUI 需要鉴权 token，agent 打不开它。`tools/preview/` 提供了本地预览 + 截图：

```powershell
npm --prefix tools/preview install
node tools/preview/server.mjs                          # http://127.0.0.1:4711/
node tools/preview/shot.mjs "http://127.0.0.1:4711/?scenario=blocking" 360 900 narrow.png full
node tools/preview/shot.mjs "http://127.0.0.1:4711/?scenario=manytasks" 340 --measure
```

用真实 React + 真实 CSS 渲染 `client.js`，数据由本包 `lib/` 现算，支持 blocking / warnings /
truncated / error / empty 等场景，并能在精确 CSS 宽度下量出横向溢出元素。
细节与两个坑见 [tools/preview/README.md](tools/preview/README.md)。

## License

MIT · Copyright 2026 hunyed15
