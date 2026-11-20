> **⚠️ 已归档：本项目已并入 [`@hunyed15/project-cockpit`](https://github.com/hunyed15/dsh-project-cockpit)**
>
> 那个包原名 `@hunyed15/claude-code-review`，v2.0.0 把本项目的驾驶舱并了进去，v3.0.0 起改名为
> `@hunyed15/project-cockpit`（仓库 `hunyed15/dsh-project-cockpit`）。
> **请安装那一个包**，不要与本仓库的旧包同时安装（两者注册同一个面板 id `project-cockpit`，会互相顶掉）。
>
> 本仓库不再更新，保留作为设计文档与决策记录。

# @hunyed15/project-cockpit（已归档）

一个 DSH 插件：左侧栏一个整页，只读回答三个问题——**到哪了 / 卡在哪 / 下一步做什么**，
并把"下一步"交给当前会话里的 AI 执行。

> 版本停在 `v0.1.0`。代码与测试已合并进上游，见下方"代码去哪了"。

## 它当时要解决什么

`claude-code-review` 回答的是"这一轮代码有没有问题"。但每天打开 DSH 时真正要回答的是另外三个问题：

1. 项目到哪了？
2. 卡在哪？
3. 下一步做什么？

看板能展示，但只有插件能**把"下一步"真的交给 AI**。这是它存在的唯一理由。

## 为什么先拆开，后来又合并

**当初拆（2026-11-18）**的理由写在 [设计文档 §2](docs/specs/2026-11-18-project-cockpit-design.md)：

- 审核插件是 v1.2.0 已发布的商品，290 个断言围绕审核契约；
- 面板要频繁改配色/布局，不该拖着提交门禁一起发布；
- 两者依赖不同（审核要 ACP 两包 + PowerShell 引擎，驾驶舱零依赖）。

**后来并（2026-11-19，v2.0.0）**是使用者的直接要求：*"功能合并到一个插件中，不要安装很多插件。"*

合并时接受了这些代价，并做了对应处理：

| 代价 | 处理 |
|---|---|
| 依赖污染（驾驶舱用户被迫装 ACP 两包） | 无法避免，已在发布说明里写明 |
| 故障面变大 | `index.js` 里驾驶舱路由**独立 try/catch**；`client.js` 里驾驶舱包进 IIFE，注册失败不连累协同面板与 `claude_review` |
| 门禁版本与 UI 版本绑定 | 明确接受；引擎未变（`# claude-review-api: 3`），被审仓库的 `tools/claude-review/` 与 pre-commit hook 不受影响 |
| 面板 id 冲突 | 从 profile 移除旧包，并在两处 README/Release 写明"不要两个都装" |

## 代码去哪了

| 本仓库 | 上游位置（`claude-code-review`） |
|---|---|
| `lib/*.js`（6 个纯模块） | `lib/cockpit/*.js` |
| `client.js`（整页 + 通栏） | `client.js` 里的 `const PC = (() => { … })()` 段 |
| `index.js`（`/project-cockpit` 路由） | `index.js` 的 `registerCockpitRoute()` |
| `test/*.test.js` | `test/cockpit-*.test.js` |
| `tools/preview/` | 原样迁入 |
| `locale/*.json` | 并入上游的标题与描述 |

## 保留在这里的东西

- [设计文档](docs/specs/2026-11-18-project-cockpit-design.md) — 目的、非目标、落地位置（带源码行号证据）、数据契约、阶段门推导、行动层探针结论、风险表
- [实现计划](docs/plans/2026-11-18-project-cockpit.md) — TDD 九步任务 + **四轮执行变更记录**（包含每次为什么偏离原计划）
- [插件详情页文案](docs/DETAIL.md) — 功能、用法、限制
- [v0.1.0 发布说明](docs/RELEASE-v0.1.0.md)
- `.impeccable/critique/` — 三轮 `impeccable critique` 快照（20 → 24 → 22 / 40），第三轮起有真实截图证据

## 三条值得留下的经验

1. **fixtures 必须来自真实样本。**
   单测用自造的 `{ meta, issues }` 形状，全绿；真实报告却是 `{ meta, review: { issues } }`——
   于是**真实账本上 `blocking` 恒为 0**，面板永远说"无待修问题"。这个 bug 靠读代码和跑自造测试都发现不了，是拿真实 `review-1.json` 跑一遍才暴露的。

2. **看不到渲染就等于没验过 UI。**
   这个插件有 5 个 bug 是截图才发现的：CSS 声明顺序导致页内横幅缩成居中窄条、`[hidden]` 被 `display:flex` 覆盖导致折叠失效、首列改成 `th` 后 `td + td` 失配把"进行中"挤成竖排、常驻条露出反引号、窄屏整页横向溢出。
   DSH GUI 需要鉴权 token，agent 打不开——所以做了 `tools/preview/`（真实 React + 真实 CSS + CDP 精确视口截图），这套工具已经进上游。

3. **"读到的不完整"不能翻译成"你没问题"。**
   降级要整屏一致：chip、下一步卡、主按钮、阶段门、表格数字必须一起降级。只改其中一处，首屏就会自相矛盾——绿色「无待修问题」配一句「卡在验效果」。

## 现在怎么装

```powershell
plugin_manager(action: "install_bundle", target: "git+https://github.com/hunyed15/dsh-project-cockpit.git")
```

需要 DSH `>=0.2.2-rc.3 <0.3.0`、Claude Code CLI（鉴权）、PowerShell 7。

## License

MIT · Copyright 2026 hunyed15
