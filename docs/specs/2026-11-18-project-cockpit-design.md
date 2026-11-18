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
  └─ fetch GET /project-cockpit/api/panel?workspacePath=<abs>
        │
Host 插件（bundle row）
  ├─ webServer.register：只读路由，peer 授权，路径白名单校验
  ├─ projectReader：解析 task.json / 审核账本 / trellis 环境
  ├─ gateDeriver：证据 → 阶段门（标注推断）
  ├─ nextAction：状态机 → 唯一动作 + 一句指令
  └─ dispatcher：把指令送进目标会话（见 §7）
```

### 4.1 Host 组件

- `index.js`：`export function apply(ctx, config)`；`export const Config` 暴露 `panelRoute`（默认 `/project-cockpit`）等少量配置。
- `panel.js`：纯函数模块（无 I/O），导出 `buildPanelModel(files)`、`deriveGates(...)`、`nextAction(...)`，便于单测。
- `reader.js`：唯一碰盘的地方；只接受绝对项目根，内部拼固定相对路径。

### 4.2 Client 组件

- `client.js`：注册 `main`（key `project-cockpit`）+ `sidebar.panellist`（id 同名），图标为 SVG，`label` 用 thunk 随语言切换。
- 页面三区：总览 / 详情 / 阶段门。只读 + 一个主按钮 + 刷新。

## 5. 数据契约

### 5.1 路由

`GET /project-cockpit/api/panel?workspacePath=<abs>`

```json
{
  "project": { "path": "D:/Coding/foo", "name": "foo" },
  "trellis": { "initialized": true, "version": "0.6.17", "source": "D:/Coding/foo/.trellis" },
  "tasks": [
    {
      "id": "00-bootstrap-guidelines",
      "title": "Bootstrap Guidelines",
      "status": "in_progress",
      "priority": "P1",
      "devType": "docs",
      "subtasks": { "done": 0, "total": 0 },
      "completedAt": null,
      "bugs": { "blocking": 2, "open": 3, "lastRound": 13, "lastVerdict": "fix", "lastAt": "2026-11-17T09:12:00+08:00" }
    }
  ],
  "gates": [
    { "name": "想清楚", "state": "done", "basis": "prd.md 存在且非模板" },
    { "name": "定规格", "state": "done", "basis": ".trellis/spec/ 有 12 个文件" },
    { "name": "写代码", "state": "current", "basis": "task 状态 in_progress + 17 个 commit" },
    { "name": "挑毛病", "state": "pending", "basis": "无审核轮次" }
  ],
  "nextAction": {
    "kind": "fix-findings",
    "label": "修复并复检",
    "instruction": "修完 review-13 的 2 个 important，然后跑 claude_review(mode:\"gate\") 复核。",
    "reason": "存在 2 个未处置的 blocking finding"
  },
  "generatedAt": "2026-11-18T18:20:00+08:00"
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

### 5.3 bug 计数口径（必须与审核插件一致）

- 只统计 `failOn` 命中的级别（默认 `critical/important`）；`failOn` 从该轮 `review-N.json` 的 `meta.failOn` 读取，**旧报告无该字段时回退默认 `critical/important`**。
- `blocking` = 该级别中未处置（无 `dispositions.jsonl` 条目，或处置状态不是 `fixed/deferred/counter-evidence`）的数量。
- `open` = 该级别未处置 + 已 `fixed` 待复检 的数量。
- **处置匹配规则**：disposition 的 `round` 必须等于该问题所在报告的 `meta.round`（跨轮处置不算）；优先按 `key` 匹配，无 `key` 时按该报告的 `issues` 原始下标匹配。与 claude-code-review 的轮次守卫一致。
- 这一口径直接照抄 claude-code-review 面板的实现语义，避免两个插件对同一个账本给出两个数字。

## 6. 阶段门推导（推断，不是声明）

| 阶段 | 判据 | 说明 |
|---|---|---|
| 想清楚 | 存在 `prd.md` 且非模板内容 | 模板可用"Bootstrap Task"特征识别 |
| 定规格 | `.trellis/spec/**` 文件数 > 0 | 显示数量 |
| 搭骨架 | 存在实现类文件（非 `.md`） | 用文件类型判定，不做语义判断 |
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

**待验证 API（实现第一步必须打通，否则降级）**：Host 侧如何向指定 session 注入一条用户消息/命令。候选路径：

1. `ctx.commands.execute(agent, line, [], signal)`（`user-actions.md` 推荐的客户端可达入口）——需要目标 Agent；
2. 若 1 不可用：注册插件自有命令 `/cockpit-next`，由会话内用户触发，面板只负责生成并复制指令（**降级但仍可用**）。

降级判定必须在实现首日给出结论，不留到 UI 做完才发现。

## 8. 错误处理

- 路由只接受绝对路径，且必须命中 `.trellis` 或 `.dsh/claude-review`；否则 403 + 明示原因。
- 项目未初始化：200 + `trellis.initialized=false` + 空任务表 + `nextAction.kind="init"`（**不是** 500）。
- 账本损坏：跳过坏行，`warnings[]` 带回行号；面板顶部显示"数据有 N 处异常"。
- 超过 200 个任务或单文件 > 2 MiB：截断并在响应里标 `truncated`。

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
| 注入消息的 Host API 不可用 | 行动层失效 | §7 的两级降级路径 |
| `.dsh/plugin-state/` 与 trellis 托管冲突 | 文件被覆盖 | 该目录只写不读关键状态；不与 `.dsh/DSH.md`、`.dsh/skills/*` 重叠 |

## 11. 里程碑（一条链路跑通再谈下一页）

1. **M1**：仓库骨架 + `panel.js`/`reader.js` + 单测（纯数据，无 UI）。
2. **M2**：Host 路由 + 真机 curl 校验 JSON 与真实账本一致。
3. **M3**：左栏图标 + 整页三区（只读）。
4. **M4**：`nextAction` 按钮打通（含 §7 降级判定结论）。
5. **M5**：真机验收 + README/插件详情页 + 打 tag 发布（`git+https` 安装）。

每完成一个 M 跑一轮 `claude-code-review` 审核，不跳步。
