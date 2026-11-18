# project-cockpit 设计文档（v1）

> 2026-11-18 · 一版只做一条链路：**只读进度 + 一个真能点的动作**
> 前置：[vibe-coding方法论与插件设计汇总-v1](D:/Coding/vibe-coding方法论与插件设计汇总-v1.md)
> 姊妹插件：`@hunyed15/claude-code-review`（仓库 `hunyed15/dsh-claude-code-review`）——本插件**只读**它的账本，不修改、不依赖它的代码。

## 1. 目的

创始人每天要回答的三个问题，现有 DSH 界面回答不了：

1. 项目到哪了？
2. 卡在哪？
3. 下一步做什么？

`claude-code-review` 回答的是另一个层的问题（"这轮代码有没有问题"）。本插件把「项目状态」独立成一个地方，并且**唯一**比外部看板多出来的能力是：面板上的"下一步"按钮能驱动 AI 真正去执行。

### 1.1 成功标准（第一版）

- 打开左侧栏「项目」，**3 秒内**看清：红/黄/绿、卡点、唯一下一步。
- 每个数字都能追溯到来源文件；推断出来的东西必须标注"推断"。
- 点"下一步"，当前会话里真的出现了那条指令并开始执行。
- 面板**不写**任何项目文件（只读）。

### 1.2 非目标（第一版明确不做）

- 验收页（结构化验收表、browser-use 自动化）——第二版。
- 设置页（检测 + 一键安装 skill）——第三版；且不实现安装，只做检测与诊断。
- 甘特图、多人排期、时间预估。
- 写入 `project-state.json` 或任何项目内状态文件。
- 读取/解析 PRD 文本算完成度（已决定：只用可靠字段）。

## 2. 为什么是独立插件

| 方案 | 问题 |
|---|---|
| 塞进 `claude-code-review` | 那个包是「审核引擎 + 账本 + 协同面板」，290 个断言围绕审核契约；混入项目状态会牵连引擎契约、报告格式、发布节奏 |
| **独立 bundle，共享文件契约**（本方案） | 审核插件保持稳定；本项目可按自己的节奏迭代；用户装不装互不影响 |

契约就是**文件**：`.trellis/tasks/*/task.json` 与审核账本，两个插件各自只读/只写自己的部分。

## 3. 落地位置（已核实，附证据）

| 位置 | 机制 | 证据 |
|---|---|---|
| 左侧栏入口 | `sidebar.panellist`（list / root），`id` 即主面板 key | `dsh-client-ui-sidebar/README.md:42`；`lib/.../src/client/index.ts:58-62, 83` |
| 中央整页 | `main`（keyed / root），keyDomain 开放，仅 `conversation` 已占 | `dsh-client-ui-layout/src/client/index.ts:71-75`；`AppFrame.tsx:46-49` |
| 二者关系 | `selectPanel(id)` 校验该 key 已注册，未注册抛错；注销时 `retainMainPanels` 复位 | `dsh-client-ui-layout/src/client/service.ts:72-78`；`index.ts:98-101` |
| 先例 | Plugins 页、定时任务页（同为第三方可复制的写法） | `dsh-client-ui-plugin-manager/src/client/index.ts:83,129-149`；`dsh-client-ui-schedule/src/client/index.ts:67,218-246` |

**硬约束**：`sidebar.panellist` 的 `id` 与 `main` 的 `key` 必须严格同名，且必须成对注册。

后续版本的位置（已确认开放，本文档不实现）：右侧栏 tab（`ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`，session scope）、设置页（`settings.section` list/root + `settings.section.icon` 同 id）、常驻进度条（`conversation.input.dock` list/session）。

## 4. 架构

```
Client（root scope 整页）
  ├─ fetch GET /project-cockpit/api/workspaces   （已注册工作区列表，供切换）
  └─ fetch GET /project-cockpit/api/panel?path=<workspace 绝对路径>
        │
Host 插件（bundle row）
  ├─ webServer.register：只读路由；path 必须命中 workspaceRegistry，否则 403
  ├─ projectReader：解析 task.json / 审核账本 / trellis 环境
  ├─ gateDeriver：证据 → 阶段门（标注推断）
  ├─ nextAction：状态机 → 唯一动作 + 一句指令
  └─ dispatcher：把指令送进目标会话（见 §7）
```

**为什么走 `workspaceRegistry` 而不是信任前端传路径**：`main` 是 root scope，拿不到 Session，前端只能从“已注册工作区”里选；Host 用 `ctx.workspaceRegistry.resolveByPath(path)` 校验后再读，等价于“只允许读 DSH 自己登记过的项目”，比 `sessionId` 解析更宽松但同样不可越权。

### 4.1 Host 组件

- `index.js`：`export function apply(ctx)`；`export const inject = ['webServer']`；只做服务解析与路由挂载。
- `lib/route.js`：HTTP 层（`createRoutes`），不碰盘、不解析业务，便于测试。
- `lib/reader.js`：唯一碰盘的地方；只接受绝对项目根，内部拼固定相对路径。
- `lib/count.js`：bug 计数口径（纯函数）。
- `lib/gates.js`：阶段门推导（纯函数）。
- `lib/next-action.js`：唯一下一步状态机（纯函数）。
- `lib/panel.js`：把上面三者组装成面板模型（纯函数，`generatedAt` 由调用方注入）。

### 4.2 Client 组件

- `client.js`：注册 `main`（key `project-cockpit`）+ `sidebar.panellist`（id 同名），图标为 SVG，`label` 用 thunk 随语言切换。
- 页面三区：总览 / 详情 / 阶段门。只读 + 一个主按钮 + 刷新。

## 5. 数据契约

### 5.1 路由

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/project-cockpit/api/workspaces` | 已注册工作区 `[{id,title,path}]`，供面板切换项目 |
| GET | `/project-cockpit/api/panel?path=<abs>` | 面板模型；`path` 省略时取第一个工作区 |
| POST | ~~`/api/action`~~ | **已取消**：DSH 0.2.2-rc.3 没有向活跃会话注入用户消息的公开 API（详见 §7），行动层改走浏览器侧 |

`GET /panel` 响应：

```json
{
  "project": { "path": "D:/Coding/foo", "name": "foo" },
  "trellis": { "initialized": true, "version": "0.6.17", "specFiles": 10 },
  "tasks": [
    {
      "id": "00-bootstrap-guidelines",
      "title": "Bootstrap Guidelines",
      "status": "in_progress",
      "priority": "P1",
      "devType": "docs",
      "completedAt": null,
      "subtasksDone": 0,
      "subtasksTotal": 0,
      "bugs": { "blocking": 2, "open": 3, "fixed": 1, "lastRound": 13, "lastVerdict": "fix", "lastAt": "2026-11-17T09:12:00+08:00" }
    }
  ],
  "totals": { "blocking": 2, "open": 3, "fixed": 1, "rounds": 17, "lastRound": 13, "lastVerdict": "fix" },
  "gates": [
    { "name": "想清楚", "state": "done", "basis": "prd.md 存在" },
    { "name": "定规格", "state": "done", "basis": ".trellis/spec 有 10 个文件" },
    { "name": "搭骨架", "state": "done", "basis": "有 12 个实现文件" },
    { "name": "写代码", "state": "done", "basis": "存在进行中/已完成的任务" },
    { "name": "挑毛病", "state": "done", "basis": "账本有 17 个审核轮次" },
    { "name": "验效果", "state": "current", "basis": "验收表未接入（第二版）" },
    { "name": "发出去", "state": "pending", "basis": "发布记录未接入（第二版）" }
  ],
  "nextAction": {
    "kind": "fix-findings",
    "label": "修复并复检",
    "instruction": "修完 review-13 的 2 个 blocking finding，用 claude_review_disposition 标记后，跑 claude_review(mode:\"gate\") 复核。",
    "reason": "存在 2 个未处置的 blocking finding"
  },
  "warnings": [],
  "generatedAt": "2026-11-18T10:00:00.000Z"
}
```

> 示例数据取自本机 `claude-code-review` 仓库（trellis 0.6.17、spec 10 个文件、15 个 commit），仅示意字段形态。

### 5.2 只读来源与容错

| 来源 | 缺失时 | 字段缺失时 |
|---|---|---|
| `.trellis/tasks/*/task.json` | `trellis.initialized=false`，任务表为空，页面显示"未初始化"而不是报错 | 单字段回落（`status` 缺 → `unknown`；`subtasks` 缺 → 0/0） |
| `.trellis/tasks/<task>/review/history.jsonl` | 该任务 bugs 全 0、`lastRound=null` | 逐行解析，坏行跳过并计数 |
| `.dsh/claude-review/ledger/review/history.jsonl`（本地账本） | 同上 | 同上 |
| `.trellis/.version` / `config.yaml` | `version=null` | 不崩 |

**两条账本路径都支持**，与 claude-code-review 的 `storage=auto` 判定一致：有 `.trellis` 优先 Trellis，否则本地账本。

**多任务各算各的账本**：Trellis 模式下每个任务有独立账本（`.trellis/tasks/<task>/review/`），`readEvidence` 逐任务读取并各自计数；`totals` 是任务间的求和（`lastRound` 取最大轮次及其 verdict）。**不允许**只读第一个任务的账本——那会把 A 任务的 bug 记到 B 头上。

**本地账本模式**没有 trellis 任务，用 `<root>/.dsh/claude-review/ledger/task.json` 造一个伪任务（缺文件时 id=`local`、标题取目录名），否则本地模式下任务表恒为空、面板无从展示。

**任务上的 `ledgerDir` 不出现在响应里**：模型层解构剔除，客户端只看到 `bugs` 与 `rounds` 数字。

### 5.3 bug 计数口径（必须与审核插件一致）

- 只统计 `failOn` 命中的级别（默认 `critical/important`）；`failOn` 从该轮 `review-N.json` 的 `meta.failOn` 读取，**旧报告无该字段时回退默认 `critical/important`**。
- `blocking` = 该级别中未处置（无 `dispositions.jsonl` 条目，或处置状态不是 `fixed/deferred/counter-evidence`）的数量。
- `open` = 该级别未处置 + 已 `fixed` 待复检 的数量。
- **处置匹配规则**：disposition 的 `round` 必须等于该问题所在报告的 `meta.round`（跨轮处置不算）；优先按 `key` 匹配，无 `key` 时按该报告的 `issues` 原始下标匹配。与 claude-code-review 的轮次守卫一致。
- 这一口径直接照抄 claude-code-review 面板的实现语义，避免两个插件对同一个账本给出两个数字。

## 6. 阶段门推导（推断，不是声明）

| 阶段 | 判据（第一版实现） | 说明 |
|---|---|---|
| 想清楚 | `.trellis/spec` 文件数 > 0（**近似**，第二版改为检测 `prd.md` 非模板） | 近似要在 `basis` 里说清楚 |
| 定规格 | `.trellis/spec/**` 文件数 > 0 | 显示数量 |
| 搭骨架 | 存在实现文件（任务状态已建立） | 不做语义判断 |
| 写代码 | 任务状态含 `in_progress` 或 `completed` | — |
| 挑毛病 | 账本存在轮次 | 显示轮次数 |
| 验效果 | 预留（第二版验收表） | 第一版恒 `pending` |
| 发出去 | 预留 | 第一版恒 `pending` |

`state ∈ {done, current, pending}`；`current` 取**最靠后的 done 的下一个**。每条门都带 `basis` 文本，界面上原样显示——不解释来源的推断就是这个插件最大的信任风险。

## 7. 行动层

**语义**：按钮把 `nextAction.instruction` 送进**当前会话**，由 AI 自行执行，不硬编码工具调用。

**决策表**（`nextAction` 状态机）：

| 条件 | kind | 指令 |
|---|---|---|
| 有 blocking bug | `fix-findings` | 修完 N 个 blocking，然后跑 gate |
| 无 blocking、最近轮次 `fix` 已处置 | `recheck` | 用 `claude_review(mode:"range")` 复检上轮修复 |
| 全绿、无未提交改动 | `verify-gate` | 跑 `claude_review(mode:"gate")` |
| 无 `.trellis` | `init` | 建议初始化 trellis（只提示，不代执行） |
| 无审核轮次 | `first-review` | 跑第一次 `claude_review(mode:"full")` |

**待验证 API（已探针，结论：Host 侧不可用）**：

| 候选 | 结论 |
|---|---|
| `ctx.commands.execute(agent, line, [], signal)` | 只执行**已知斜杠命令**，返回 `CommandResult {kind:'success'|'error', text}`，**不会把文本发给模型** |
| `ctx.subagents.sendMessage(sender, targetId, content, opts)` | 语义是"父→子会话消息"，不是向当前会话注入用户消息 |
| `ctx.agents.*` | 只有 create/resume/announce/get/list，`Agent` 接口仅 `{ id }` |
| Host 任何"prompt/session/input"服务 | 目录里不存在 |

**因此行动层改走浏览器侧（已验证 API）**：

1. 面板按钮（root scope）把 `nextAction` 放进模块级槽位，并 `ctx.layout.selectPanel('conversation')` 跳回对话；
2. 注册 `conversation.input.dock`（list / **session scope**，order 30）作为常驻条——该插槽的 `standardProps` 含 `inputActions: InputActions`；
3. 常驻条三个按钮：**发送**（`setDraft(instruction)` + `submit()`）、**填入输入框**（只 `setDraft`）、**忽略**。

代价是两步点击（面板 → 发送），换来的是**真的走用户同一条发送通道**，不伪造、不绕过会话。`InputActions` 的 `setDraft(text)` / `submit()` 来自 `dsh-client-ui-conversation/src/client/contract/input.ts:282,292`。

## 8. 错误处理

- 路由只接受 `workspaceRegistry` 里登记过的项目路径，其余 403；不接受相对路径、不接受 `file://`。
- 项目未初始化：200 + `trellis.initialized=false` + 空任务表 + `nextAction.kind="init"`（**不是** 500）。
- 账本损坏：跳过坏行，`warnings[]` 带回行号；面板顶部显示"数据有 N 处异常"。
- 超过 200 个任务或单文件 > 2 MiB：截断并在响应里标 `truncated`。
- `POST /api/action`：缺参 400、指令 > 2000 字符 413、投递异常 500；非 POST 405。

## 9. 测试

| 层 | 方式 | 覆盖 |
|---|---|---|
| `panel.js` 纯函数 | node 断言（fake 输入） | bug 口径、failOn 回退、阶段门推导、nextAction 状态机、缺字段容错 |
| `reader.js` | node + 临时目录 fixtures | 两种账本路径、坏行、权限拒绝、截断 |
| 路由 | node + 伪造 request | 路径白名单、未初始化、403 |
| Client | 静态 smoke（照 `client-smoke.mjs`） | 插槽 id 成对、图标导出、label thunk、无 `document.body` 追加 |
| 手工 | DSH 里真机安装 | 左栏图标、整页渲染、按钮驱动会话 |

不调用模型；账本 fixtures 从真实 `review-*` 文件裁剪而来。

## 10. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 账本格式由姊妹插件演进 | 计数漂移、两个插件数字不一致 | 口径写进本文档 §5.3；解析器容错；口径变更必须同步改两边 |
| `main` key 与 panellist id 不一致 | 点击抛错 | 单一常量导出，测试断言二者同源 |
| root scope 面板拿不到 session | 无法定位"当前项目" | 用 active workspace 推导；实施首日验证 `usePanelInfo`/`useWorkspaces` 在 `main` 槽可用 |
| 阶段门"推断"被当成事实 | 误导决策 | 每门强制显示 `basis`；`current` 只允许一个 |
| 注入消息的 Host API 不可用 | 行动层失效 | **已发生**：改走浏览器侧 `inputActions`（§7），代价是两步点击 |
| 面板与对话常驻条之间的槽位只有模块内存 | 刷新页面后待发送指令丢失 | 可接受：指令由面板随时重新生成；不做持久化 |
| `.dsh/plugin-state/` 与 trellis 托管冲突 | 文件被覆盖 | 该目录只写不读关键状态；不与 `.dsh/DSH.md`、`.dsh/skills/*` 重叠 |

## 11. 里程碑（一条链路跑通再谈下一页）

1. **M1**：仓库骨架 + `panel.js`/`reader.js` + 单测（纯数据，无 UI）。
2. **M2**：Host 路由 + 真机 curl 校验 JSON 与真实账本一致。
3. **M3**：左栏图标 + 整页三区（只读）。
4. **M4**：`nextAction` 按钮打通（含 §7 降级判定结论）。
5. **M5**：真机验收 + README/插件详情页 + 打 tag 发布（`git+https` 安装）。

每完成一个 M 跑一轮 `claude-code-review` 审核，不跳步。
