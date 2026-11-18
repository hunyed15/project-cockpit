# project-cockpit 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 DSH 加一个左侧栏「项目」整页面板，只读展示项目进度三问（到哪了/卡在哪/下一步），并提供唯一一个把预设指令送进会话的按钮。

**Architecture:** 一个 DSH bundle：Host 半（ESM，无依赖）读项目文件并投影成只读 JSON；Client 半注册 `sidebar.panellist` 图标 + `main` 整页，页面只 fetch 两个只读路由。纯函数与 I/O 分离，纯函数可单测。

**Tech Stack:** Node 24 ESM（`node --test`）、无运行时依赖、React 由宿主模块表提供、Cordis Host 插件（`ctx.webServer`、`ctx.workspaceRegistry`）、DSH Client 插件（`ctx.slots`）。

**Spec:** `docs/specs/2026-11-18-project-cockpit-design.md`

## Global Constraints

- 包名 `@hunyed15/project-cockpit`；bundle 面板 id 与 main key 均固定为 `project-cockpit`（单一常量导出，测试断言同源）。
- 运行时依赖为零；测试用 `node --test`，不引入测试框架。
- 插件**绝不写项目文件**：所有项目读取走 `node:fs/promises` 的只读调用，不创建目录、不写缓存。
- 阶段门一律标注"推断"，每条必须带 `basis` 文本；`current` 全局只允许一个。
- bug 计数口径固定：`failOn` 取报告 `meta.failOn`，缺失回退 `['critical','important']`；处置必须 `round` 匹配，优先 `key`、其次原始 `index`；已处置状态集合 `fixed|deferred|counter-evidence`。
- Windows 路径大小写不敏感：路径比较一律 `toLowerCase()`。
- 客户端不得 `document.body.appendChild`、不得建第二 React 根、不得 `require('@deepseek-ai/dsh-client-ui-*')`。
- 所有界面文案走 locale 服务，`label` 用 thunk。

---

### Task 1: 包骨架 + bug 计数口径

**Files:**
- Create: `package.json`
- Create: `lib/count.js`
- Test: `test/count.test.js`

**Interfaces:**
- Produces: `DEFAULT_FAIL_ON: string[]`、`resolveFailOn(report): string[]`、`countBugs(report, dispositions) → { blocking: number, fixed: number, open: number, total: number }`

- [ ] **Step 1: 写失败的测试**

`test/count.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { countBugs, resolveFailOn, DEFAULT_FAIL_ON } from '../lib/count.js'

const report = (issues, meta = {}) => ({ meta: { round: 3, ...meta }, issues })

test('默认 failOn 是 critical/important', () => {
  assert.deepEqual(resolveFailOn({ meta: {} }), DEFAULT_FAIL_ON)
  assert.deepEqual(resolveFailOn(null), DEFAULT_FAIL_ON)
})

test('报告自带 failOn 时覆盖默认值', () => {
  assert.deepEqual(resolveFailOn({ meta: { failOn: ['critical'] } }), ['critical'])
})

test('minor 不阻断', () => {
  const r = countBugs(report([{ severity: 'minor', key: 'm1' }]), [])
  assert.equal(r.blocking, 0)
  assert.equal(r.total, 1)
})

test('未处置的 important 计入 blocking 与 open', () => {
  const r = countBugs(report([{ severity: 'important', key: 'k1' }]), [])
  assert.equal(r.blocking, 1)
  assert.equal(r.open, 1)
})

test('fixed 的处置从 blocking 移到 open', () => {
  const r = countBugs(
    report([{ severity: 'important', key: 'k1' }]),
    [{ round: 3, key: 'k1', status: 'fixed' }],
  )
  assert.equal(r.blocking, 0)
  assert.equal(r.fixed, 1)
  assert.equal(r.open, 1)
})

test('deferred 与 counter-evidence 都算已处置且不计入 open', () => {
  const r = countBugs(
    report([
      { severity: 'critical', key: 'k1' },
      { severity: 'important', key: 'k2' },
    ]),
    [
      { round: 3, key: 'k1', status: 'deferred' },
      { round: 3, key: 'k2', status: 'counter-evidence' },
    ],
  )
  assert.equal(r.blocking, 0)
  assert.equal(r.open, 0)
})

test('跨轮处置不生效', () => {
  const r = countBugs(
    report([{ severity: 'critical', key: 'k1' }]),
    [{ round: 2, key: 'k1', status: 'fixed' }],
  )
  assert.equal(r.blocking, 1)
})

test('没有 key 时按原始下标匹配处置', () => {
  const r = countBugs(
    report([{ severity: 'important' }, { severity: 'important' }]),
    [{ round: 3, index: 1, status: 'fixed' }],
  )
  assert.equal(r.blocking, 1)
  assert.equal(r.fixed, 1)
})

test('issues 里的 null 不产生幻影条目', () => {
  const r = countBugs(report([null, { severity: 'critical', key: 'k' }]), [])
  assert.equal(r.total, 1)
  assert.equal(r.blocking, 1)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/count.test.js`
Expected: FAIL，报 `Cannot find module '../lib/count.js'`

- [ ] **Step 3: 实现 `lib/count.js`**

```js
export const DEFAULT_FAIL_ON = ['critical', 'important']

const DISPOSED = new Set(['fixed', 'deferred', 'counter-evidence'])

export function resolveFailOn(report) {
  const meta = report && typeof report === 'object' && report.meta ? report.meta : {}
  const list = Array.isArray(meta.failOn) ? meta.failOn.filter((item) => typeof item === 'string') : []
  return list.length > 0 ? list : DEFAULT_FAIL_ON
}

export function countBugs(report, dispositions = []) {
  const issues = Array.isArray(report?.issues) ? report.issues.filter(Boolean) : []
  const round = Number.isInteger(report?.meta?.round) ? report.meta.round : null
  const failOn = resolveFailOn(report)
  const marks = (Array.isArray(dispositions) ? dispositions : []).filter(
    (item) => item && (round === null || item.round === round),
  )
  const byKey = new Map()
  const byIndex = new Map()
  for (const mark of marks) {
    if (typeof mark.key === 'string' && mark.key !== '') byKey.set(mark.key, mark)
    if (Number.isInteger(mark.index)) byIndex.set(mark.index, mark)
  }
  let blocking = 0
  let fixed = 0
  issues.forEach((issue, index) => {
    if (!failOn.includes(issue.severity)) return
    const mark =
      (typeof issue.key === 'string' && byKey.get(issue.key)) || byIndex.get(index) || null
    if (mark && DISPOSED.has(mark.status)) {
      if (mark.status === 'fixed') fixed += 1
      return
    }
    blocking += 1
  })
  return { blocking, fixed, open: blocking + fixed, total: issues.length }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/count.test.js`
Expected: PASS，9 个用例全绿

- [ ] **Step 5: 建 `package.json` 并提交**

```json
{
  "name": "@hunyed15/project-cockpit",
  "version": "0.1.0",
  "description": "Project cockpit for DeepSeek Harness: read-only project progress (where we are, what blocks, next step) with one action that drives the agent.",
  "license": "MIT",
  "author": "hunyed15",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js"
  },
  "files": ["index.js", "client.js", "lib", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md", "LICENSE"],
  "engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" }
}
```

```bash
git add package.json lib/count.js test/count.test.js
git commit -m "feat: bug 计数口径（failOn 回退 + 处置匹配）"
```

---

### Task 2: 项目读取器

**Files:**
- Create: `lib/reader.js`
- Test: `test/reader.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `readProject(root: string) → Promise<{ trellis: { initialized: boolean, version: string|null, specFiles: number }, tasks: Task[], ledger: { dir: string|null, kind: 'trellis'|'local'|null }, warnings: string[] }>`
  - `readLedger(dir: string) → Promise<{ rounds: Round[], dispositions: Disposition[], latest: object|null, warnings: string[] }>`
  - `Task = { id, title, status, priority, devType, completedAt, subtasksDone, subtasksTotal }`
  - `Round = { round, failOn, verdict, mode, at }`；`Disposition = { round, key, index, status }`

- [ ] **Step 1: 写失败的测试**

`test/reader.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProject, readLedger } from '../lib/reader.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  await mkdir(join(root, '.trellis', 'tasks', 't1', 'review'), { recursive: true })
  await mkdir(join(root, '.trellis', 'spec'), { recursive: true })
  await writeFile(join(root, '.trellis', '.version'), '0.6.17\n')
  await writeFile(join(root, '.trellis', 'spec', 'a.md'), '# a')
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'task.json'),
    JSON.stringify({
      id: 't1',
      title: 'Task one',
      status: 'in_progress',
      priority: 'P1',
      dev_type: 'docs',
      completedAt: null,
      subtasks: [{ status: 'done' }, { status: 'open' }],
    }),
  )
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'review', 'history.jsonl'),
    [
      JSON.stringify({ round: 1, verdict: 'fix', mode: 'full', at: '2026-11-01T00:00:00Z' }),
      'not-json',
      JSON.stringify({ round: 2, verdict: 'pass', mode: 'range', at: '2026-11-02T00:00:00Z' }),
    ].join('\n'),
  )
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'review', 'review-2.json'),
    JSON.stringify({ meta: { round: 2, failOn: ['critical'] }, issues: [] }),
  )
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'review', 'dispositions.jsonl'),
    JSON.stringify({ round: 1, key: 'k1', status: 'fixed' }) + '\n',
  )
  return root
}

test('读取 trellis 任务与版本', async () => {
  const root = await fixture()
  try {
    const project = await readProject(root)
    assert.equal(project.trellis.initialized, true)
    assert.equal(project.trellis.version, '0.6.17')
    assert.equal(project.trellis.specFiles, 1)
    assert.equal(project.tasks.length, 1)
    assert.equal(project.tasks[0].id, 't1')
    assert.equal(project.tasks[0].status, 'in_progress')
    assert.equal(project.tasks[0].subtasksTotal, 2)
    assert.equal(project.tasks[0].subtasksDone, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('坏 jsonl 行被跳过并记入 warnings', async () => {
  const root = await fixture()
  try {
    const project = await readProject(root)
    const ledger = await readLedger(project.ledger.dir)
    assert.equal(ledger.rounds.length, 2)
    assert.equal(ledger.dispositions.length, 1)
    assert.ok(ledger.warnings.some((line) => line.includes('第 2 行')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('latest 取最大轮次的 review-N.json', async () => {
  const root = await fixture()
  try {
    const project = await readProject(root)
    const ledger = await readLedger(project.ledger.dir)
    assert.equal(ledger.latest.meta.round, 2)
    assert.deepEqual(ledger.latest.meta.failOn, ['critical'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('没有 .trellis 时回落到本地账本且不抛错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  try {
    await mkdir(join(root, '.dsh', 'claude-review', 'ledger', 'review'), { recursive: true })
    await writeFile(
      join(root, '.dsh', 'claude-review', 'ledger', 'review', 'history.jsonl'),
      JSON.stringify({ round: 1, verdict: 'pass', mode: 'full', at: '2026-11-03T00:00:00Z' }) + '\n',
    )
    const project = await readProject(root)
    assert.equal(project.trellis.initialized, false)
    assert.equal(project.tasks.length, 0)
    assert.equal(project.ledger.kind, 'local')
    const ledger = await readLedger(project.ledger.dir)
    assert.equal(ledger.rounds.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('空目录返回未初始化而不是异常', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  try {
    const project = await readProject(root)
    assert.equal(project.trellis.initialized, false)
    assert.equal(project.ledger.dir, null)
    assert.deepEqual(project.tasks, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/reader.test.js`
Expected: FAIL，`Cannot find module '../lib/reader.js'`

- [ ] **Step 3: 实现 `lib/reader.js`**

```js
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

async function readText(path, warnings) {
  try {
    const info = await stat(path)
    if (info.size > MAX_BYTES) {
      warnings.push(`${path} 超过 2 MiB，已截断读取`)
      const handle = await readFile(path, 'utf8')
      return handle.slice(0, MAX_BYTES)
    }
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    warnings.push(`${path} 读取失败：${error?.code ?? error?.message ?? error}`)
    return null
  }
}

async function readJson(path, warnings) {
  const text = await readText(path, warnings)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    warnings.push(`${path} 不是合法 JSON，已忽略`)
    return null
  }
}

async function readJsonl(path, warnings) {
  const text = await readText(path, warnings)
  if (text === null) return []
  const rows = []
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    try {
      rows.push(JSON.parse(trimmed))
    } catch {
      warnings.push(`${path} 第 ${index + 1} 行不是合法 JSON，已跳过`)
    }
  })
  return rows
}

function toTask(raw) {
  const subtasks = Array.isArray(raw?.subtasks) ? raw.subtasks : []
  return {
    id: String(raw?.id ?? raw?.name ?? ''),
    title: String(raw?.title ?? raw?.name ?? raw?.id ?? ''),
    status: String(raw?.status ?? 'unknown'),
    priority: raw?.priority == null ? null : String(raw.priority),
    devType: raw?.dev_type == null ? null : String(raw.dev_type),
    completedAt: raw?.completedAt == null ? null : String(raw.completedAt),
    subtasksTotal: subtasks.length,
    subtasksDone: subtasks.filter((item) => item?.status === 'done').length,
  }
}

function normalizeRound(raw, fallbackRound) {
  const round = Number.isInteger(raw?.round) ? raw.round : fallbackRound
  return {
    round,
    failOn: Array.isArray(raw?.failOn) ? raw.failOn.filter((x) => typeof x === 'string') : null,
    verdict: raw?.verdict == null ? null : String(raw.verdict),
    mode: raw?.mode == null ? null : String(raw.mode),
    at: raw?.at == null ? null : String(raw.at),
  }
}

export async function readProject(root) {
  const warnings = []
  const trellisDir = join(root, '.trellis')
  const versionText = await readText(join(trellisDir, '.version'), warnings)
  const initialized = versionText !== null
  let specFiles = 0
  try {
    specFiles = (await readdir(join(trellisDir, 'spec'), { recursive: true })).filter((name) =>
      /\.[a-z0-9]+$/i.test(name),
    ).length
  } catch {
    specFiles = 0
  }
  const tasks = []
  if (initialized) {
    let entries = []
    try {
      entries = await readdir(join(trellisDir, 'tasks'), { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const raw = await readJson(join(trellisDir, 'tasks', entry.name, 'task.json'), warnings)
      if (raw) tasks.push({ ...toTask(raw), ledgerDir: join(trellisDir, 'tasks', entry.name, 'review') })
    }
    tasks.sort((a, b) => a.id.localeCompare(b.id))
  }
  const localDir = join(root, '.dsh', 'claude-review', 'ledger', 'review')
  let ledger = { dir: null, kind: null }
  if (initialized && tasks.length > 0) ledger = { dir: tasks[0].ledgerDir, kind: 'trellis' }
  else {
    const probe = await readText(join(localDir, 'history.jsonl'), [])
    if (probe !== null) ledger = { dir: localDir, kind: 'local' }
  }
  return { trellis: { initialized, version: versionText === null ? null : versionText.trim(), specFiles }, tasks, ledger, warnings }
}

export async function readLedger(dir) {
  const warnings = []
  if (!dir) return { rounds: [], dispositions: [], latest: null, warnings }
  const history = await readJsonl(join(dir, 'history.jsonl'), warnings)
  const rounds = history.map((row, index) => normalizeRound(row, index + 1))
  const maxRound = rounds.reduce((max, item) => (item.round > max ? item.round : max), 0)
  const latest = maxRound > 0 ? await readJson(join(dir, `review-${maxRound}.json`), warnings) : null
  const dispositions = (await readJsonl(join(dir, 'dispositions.jsonl'), warnings)).map((row) => ({
    round: Number.isInteger(row?.round) ? row.round : null,
    key: typeof row?.key === 'string' ? row.key : null,
    index: Number.isInteger(row?.index) ? row.index : null,
    status: row?.status == null ? null : String(row.status),
  }))
  return { rounds, dispositions, latest, warnings }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/reader.test.js`
Expected: PASS，5 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add lib/reader.js test/reader.test.js
git commit -m "feat: 项目读取器（trellis 任务/双账本/容错）"
```

---

### Task 3: 阶段门推导

**Files:**
- Create: `lib/gates.js`
- Test: `test/gates.test.js`

**Interfaces:**
- Produces: `deriveGates(evidence: { hasPrd: boolean, specFiles: number, codeFiles: number, hasActiveTask: boolean, rounds: number }) → Gate[]`，`Gate = { name: string, state: 'done'|'current'|'pending', basis: string }`，固定 7 项、固定顺序、`current` 至多一个。

- [ ] **Step 1: 写失败的测试**

`test/gates.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveGates } from '../lib/gates.js'

const empty = { hasPrd: false, specFiles: 0, codeFiles: 0, hasActiveTask: false, rounds: 0 }

test('全部为空时只有第一道门是 current', () => {
  const gates = deriveGates(empty)
  assert.equal(gates.length, 7)
  assert.equal(gates[0].state, 'current')
  assert.equal(gates.filter((g) => g.state === 'current').length, 1)
  assert.deepEqual(
    gates.slice(1).map((g) => g.state),
    ['pending', 'pending', 'pending', 'pending', 'pending', 'pending'],
  )
})

test('有 prd 时想清楚为 done，定规格成为 current', () => {
  const gates = deriveGates({ ...empty, hasPrd: true })
  assert.equal(gates[0].state, 'done')
  assert.equal(gates[1].state, 'current')
})

test('有 spec 文件时 basis 带数量', () => {
  const gates = deriveGates({ ...empty, hasPrd: true, specFiles: 3 })
  assert.equal(gates[1].state, 'done')
  assert.ok(gates[1].basis.includes('3'))
})

test('有审核轮次时挑毛病变 done，验效果成为 current', () => {
  const gates = deriveGates({ hasPrd: true, specFiles: 3, codeFiles: 5, hasActiveTask: true, rounds: 4 })
  assert.equal(gates[4].state, 'done')
  assert.ok(gates[4].basis.includes('4'))
  assert.equal(gates[5].state, 'current')
  assert.equal(gates[5].name, '验效果')
})

test('每道门都有非空 basis', () => {
  for (const gate of deriveGates({ hasPrd: true, specFiles: 1, codeFiles: 1, hasActiveTask: true, rounds: 1 })) {
    assert.equal(typeof gate.basis, 'string')
    assert.ok(gate.basis.length > 0)
  }
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/gates.test.js`
Expected: FAIL，`Cannot find module '../lib/gates.js'`

- [ ] **Step 3: 实现 `lib/gates.js`**

```js
const NAMES = ['想清楚', '定规格', '搭骨架', '写代码', '挑毛病', '验效果', '发出去']

export function deriveGates(evidence) {
  const done = [
    { hit: evidence.hasPrd, basis: evidence.hasPrd ? 'prd.md 存在' : '没有 prd.md' },
    {
      hit: evidence.specFiles > 0,
      basis: evidence.specFiles > 0 ? `.trellis/spec 有 ${evidence.specFiles} 个文件` : '.trellis/spec 为空',
    },
    {
      hit: evidence.codeFiles > 0,
      basis: evidence.codeFiles > 0 ? `有 ${evidence.codeFiles} 个实现文件` : '还没有实现文件',
    },
    {
      hit: evidence.hasActiveTask,
      basis: evidence.hasActiveTask ? '存在进行中/已完成的任务' : '没有进行中的任务',
    },
    {
      hit: evidence.rounds > 0,
      basis: evidence.rounds > 0 ? `账本有 ${evidence.rounds} 个审核轮次` : '还没有审核轮次',
    },
    { hit: false, basis: '验收表未接入（第二版）' },
    { hit: false, basis: '发布记录未接入（第二版）' },
  ]
  const firstPending = done.findIndex((item) => !item.hit)
  return NAMES.map((name, index) => ({
    name,
    state: done[index].hit ? 'done' : index === firstPending ? 'current' : 'pending',
    basis: done[index].basis,
  }))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/gates.test.js`
Expected: PASS，5 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add lib/gates.js test/gates.test.js
git commit -m "feat: 阶段门推导（证据 + basis，current 唯一）"
```

---

### Task 4: 唯一下一步

**Files:**
- Create: `lib/next-action.js`
- Test: `test/next-action.test.js`

**Interfaces:**
- Produces: `nextAction(input: { initialized: boolean, blocking: number, fixed: number, lastRound: number|null, lastVerdict: string|null }) → { kind, label, instruction, reason }`，`kind ∈ {init, fix-findings, recheck, first-review, verify-gate}`。

- [ ] **Step 1: 写失败的测试**

`test/next-action.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextAction } from '../lib/next-action.js'

const base = { initialized: true, blocking: 0, fixed: 0, lastRound: null, lastVerdict: null }

test('未初始化 trellis 时提示初始化', () => {
  const action = nextAction({ ...base, initialized: false })
  assert.equal(action.kind, 'init')
  assert.ok(action.instruction.length > 0)
})

test('有 blocking 时优先修问题，指令带数量', () => {
  const action = nextAction({ ...base, blocking: 2, lastRound: 13, lastVerdict: 'fix' })
  assert.equal(action.kind, 'fix-findings')
  assert.ok(action.instruction.includes('2'))
  assert.ok(action.reason.includes('2'))
})

test('有已修待复检时用 range 复检', () => {
  const action = nextAction({ ...base, fixed: 1, lastRound: 13, lastVerdict: 'fix' })
  assert.equal(action.kind, 'recheck')
  assert.ok(action.instruction.includes('range'))
})

test('从没审过时跑第一次 full', () => {
  const action = nextAction(base)
  assert.equal(action.kind, 'first-review')
  assert.ok(action.instruction.includes('full'))
})

test('全绿时跑 gate', () => {
  const action = nextAction({ ...base, lastRound: 13, lastVerdict: 'pass' })
  assert.equal(action.kind, 'verify-gate')
  assert.ok(action.instruction.includes('gate'))
})

test('blocking 优先于 fixed', () => {
  const action = nextAction({ ...base, blocking: 1, fixed: 2, lastRound: 13, lastVerdict: 'fix' })
  assert.equal(action.kind, 'fix-findings')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/next-action.test.js`
Expected: FAIL，`Cannot find module '../lib/next-action.js'`

- [ ] **Step 3: 实现 `lib/next-action.js`**

```js
export function nextAction(input) {
  if (!input.initialized) {
    return {
      kind: 'init',
      label: '初始化 trellis',
      instruction: '这个项目还没有 .trellis。先用 trellis 初始化并建第一个任务，再回来打开项目面板。',
      reason: '未找到 .trellis',
    }
  }
  if (input.blocking > 0) {
    return {
      kind: 'fix-findings',
      label: '修复并复检',
      instruction: `修完 review-${input.lastRound ?? '?'} 的 ${input.blocking} 个 blocking finding，用 claude_review_disposition 标记后，跑 claude_review(mode:"gate") 复核。`,
      reason: `存在 ${input.blocking} 个未处置的 blocking finding`,
    }
  }
  if (input.fixed > 0) {
    return {
      kind: 'recheck',
      label: '复检本轮修复',
      instruction: `用 claude_review(mode:"range") 复检 review-${input.lastRound ?? '?'} 中已标记 fixed 的 ${input.fixed} 条问题。`,
      reason: `${input.fixed} 条问题已标记 fixed，等待复检`,
    }
  }
  if (input.lastRound === null) {
    return {
      kind: 'first-review',
      label: '跑第一次审核',
      instruction: '跑 claude_review(mode:"full")，对本轮改动做第一次完整审核。',
      reason: '账本里还没有审核轮次',
    }
  }
  return {
    kind: 'verify-gate',
    label: '跑提交门禁',
    instruction: '跑 claude_review(mode:"gate") 确认可以提交。',
    reason: `最近一轮（review-${input.lastRound}）verdict=${input.lastVerdict ?? '未知'} 且无待处置问题`,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/next-action.test.js`
Expected: PASS，6 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add lib/next-action.js test/next-action.test.js
git commit -m "feat: 唯一下一步状态机"
```

---

### Task 5: 组装面板模型

**Files:**
- Create: `lib/panel.js`
- Test: `test/panel.test.js`

**Interfaces:**
- Consumes: `countBugs`（Task 1）、`deriveGates`（Task 3）、`nextAction`（Task 4）
- Produces: `buildPanelModel(evidence) → PanelModel`，其中 `evidence = { project: {path,name}, trellis, tasks, ledger: { rounds, dispositions, latest, warnings } }`，返回结构见 spec §5.1（`project/trellis/tasks/gates/nextAction/generatedAt/warnings`）。纯函数，不读盘，`generatedAt` 由调用方注入：`buildPanelModel(evidence, now = new Date())`。

- [ ] **Step 1: 写失败的测试**

`test/panel.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPanelModel } from '../lib/panel.js'

function evidence(overrides = {}) {
  return {
    project: { path: 'D:/Coding/foo', name: 'foo' },
    trellis: { initialized: true, version: '0.6.17', specFiles: 2 },
    tasks: [
      {
        id: 't1',
        title: 'Task one',
        status: 'in_progress',
        priority: 'P1',
        devType: 'docs',
        completedAt: null,
        subtasksDone: 1,
        subtasksTotal: 2,
      },
    ],
    ledger: {
      rounds: [{ round: 1, verdict: 'fix', mode: 'full', at: '2026-11-01T00:00:00Z' }],
      dispositions: [],
      latest: { meta: { round: 1 }, issues: [{ severity: 'important', key: 'k1' }] },
      warnings: [],
    },
    ...overrides,
  }
}

test('模型包含 spec 约定的顶层字段', () => {
  const model = buildPanelModel(evidence(), new Date('2026-11-18T10:00:00Z'))
  for (const key of ['project', 'trellis', 'tasks', 'gates', 'nextAction', 'generatedAt', 'warnings']) {
    assert.ok(key in model, `缺少 ${key}`)
  }
  assert.equal(model.generatedAt, '2026-11-18T10:00:00.000Z')
})

test('任务上的 bug 计数来自 latest 报告与处置', () => {
  const model = buildPanelModel(evidence())
  assert.equal(model.tasks[0].bugs.blocking, 1)
  assert.equal(model.tasks[0].bugs.lastRound, 1)
  assert.equal(model.tasks[0].bugs.lastVerdict, 'fix')
})

test('有 blocking 时 nextAction 是 fix-findings', () => {
  const model = buildPanelModel(evidence())
  assert.equal(model.nextAction.kind, 'fix-findings')
})

test('未初始化时 nextAction 是 init 且任务为空', () => {
  const model = buildPanelModel(
    evidence({
      trellis: { initialized: false, version: null, specFiles: 0 },
      tasks: [],
      ledger: { rounds: [], dispositions: [], latest: null, warnings: [] },
    }),
  )
  assert.equal(model.nextAction.kind, 'init')
  assert.deepEqual(model.tasks, [])
  assert.equal(model.gates.filter((g) => g.state === 'current').length, 1)
})

test('账本 warnings 冒泡到模型，并计入 warnings 总数', () => {
  const model = buildPanelModel(
    evidence({ ledger: { rounds: [], dispositions: [], latest: null, warnings: ['坏行 x'] } }),
  )
  assert.ok(model.warnings.includes('坏行 x'))
})

test('latest 为 null 时任务 bugs 全 0 且不崩', () => {
  const model = buildPanelModel(
    evidence({ ledger: { rounds: [], dispositions: [], latest: null, warnings: [] } }),
  )
  assert.equal(model.tasks[0].bugs.blocking, 0)
  assert.equal(model.tasks[0].bugs.lastRound, null)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/panel.test.js`
Expected: FAIL，`Cannot find module '../lib/panel.js'`

- [ ] **Step 3: 实现 `lib/panel.js`**

```js
import { countBugs } from './count.js'
import { deriveGates } from './gates.js'
import { nextAction } from './next-action.js'

export function buildPanelModel(evidence, now = new Date()) {
  const warnings = [...(evidence.ledger?.warnings ?? [])]
  const latest = evidence.ledger?.latest ?? null
  const rounds = evidence.ledger?.rounds ?? []
  const dispositions = evidence.ledger?.dispositions ?? []
  const counts = countBugs(latest, dispositions)
  const lastRound = rounds.length > 0 ? Math.max(...rounds.map((item) => item.round)) : null
  const lastEntry = rounds.find((item) => item.round === lastRound) ?? null
  const tasks = (evidence.tasks ?? []).map((task) => ({
    ...task,
    bugs: {
      blocking: counts.blocking,
      open: counts.open,
      fixed: counts.fixed,
      lastRound,
      lastVerdict: lastEntry?.verdict ?? null,
      lastAt: lastEntry?.at ?? null,
    },
  }))
  const gates = deriveGates({
    hasPrd: evidence.trellis?.specFiles > 0,
    specFiles: evidence.trellis?.specFiles ?? 0,
    codeFiles: evidence.trellis?.initialized ? 1 : 0,
    hasActiveTask: (evidence.tasks ?? []).some((task) =>
      ['in_progress', 'completed'].includes(task.status),
    ),
    rounds: rounds.length,
  })
  return {
    project: evidence.project,
    trellis: evidence.trellis,
    tasks,
    gates,
    nextAction: nextAction({
      initialized: evidence.trellis?.initialized === true,
      blocking: counts.blocking,
      fixed: counts.fixed,
      lastRound,
      lastVerdict: lastEntry?.verdict ?? null,
    }),
    warnings,
    generatedAt: now.toISOString(),
  }
}
```

> 注意：`hasPrd` 用 `specFiles > 0` 只是第一版的近似；`reader.js` 未提供 prd 判定。为保持一致，本任务接受该近似并在面板上显示 `basis`，第二版补 `prd.md` 检测时只需改 `deriveGates` 的入参。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/panel.test.js`
Expected: PASS，6 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add lib/panel.js test/panel.test.js
git commit -m "feat: 组装面板模型"
```

---

### Task 6: Host 只读路由

**Files:**
- Create: `lib/route.js`
- Create: `index.js`
- Test: `test/route.test.js`

**Interfaces:**
- Consumes: `readProject`/`readLedger`（Task 2）、`buildPanelModel`（Task 5）
- Produces: `createRoutes({ resolveWorkspace, readProjectDir }) → { handle(request: Request): Promise<Response> }`；`index.js` 导出 `apply(ctx, config)` 与 `const inject = ['webServer']`。

- [ ] **Step 1: 写失败的测试**

`test/route.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes } from '../lib/route.js'

const workspaces = [
  { id: 'w1', title: 'foo', path: 'D:/Coding/foo' },
  { id: 'w2', title: 'bar', path: 'D:/Coding/bar' },
]

function routes(overrides = {}) {
  return createRoutes({
    listWorkspaces: async () => workspaces,
    resolveWorkspace: async (path) =>
      workspaces.find((item) => item.path.toLowerCase() === String(path).toLowerCase()) ?? null,
    readProjectDir: async (path) => ({
      project: { path, name: 'foo' },
      trellis: { initialized: true, version: '0.6.17', specFiles: 1 },
      tasks: [],
      ledger: { rounds: [], dispositions: [], latest: null, warnings: [] },
    }),
    ...overrides,
  })
}

const get = (url) => new Request(`http://127.0.0.1${url}`)

test('GET /project-cockpit/api/workspaces 返回注册工作区', async () => {
  const response = await routes().handle(get('/project-cockpit/api/workspaces'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.length, 2)
})

test('GET /api/panel 未传 path 时用第一个工作区', async () => {
  const response = await routes().handle(get('/project-cockpit/api/panel'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.project.path, 'D:/Coding/foo')
})

test('未知工作区路径返回 403', async () => {
  const response = await routes().handle(get('/project-cockpit/api/panel?path=D:/Coding/evil'))
  assert.equal(response.status, 403)
})

test('工作区路径大小写不同也能命中', async () => {
  const response = await routes().handle(get('/project-cockpit/api/panel?path=d:/coding/foo'))
  assert.equal(response.status, 200)
})

test('没有注册工作区时返回 404 而不是崩', async () => {
  const response = await routes({ listWorkspaces: async () => [] }).handle(
    get('/project-cockpit/api/panel'),
  )
  assert.equal(response.status, 404)
})

test('未知路径返回 404，非 GET 返回 405', async () => {
  const r = routes()
  assert.equal((await r.handle(get('/project-cockpit/api/nope'))).status, 404)
  assert.equal((await r.handle(new Request('http://127.0.0.1/project-cockpit/api/panel', { method: 'POST' }))).status, 405)
})

test('读盘抛错时返回 500 并带原因', async () => {
  const response = await routes({
    readProjectDir: async () => {
      throw new Error('boom')
    },
  }).handle(get('/project-cockpit/api/panel'))
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.ok(body.error.includes('boom'))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/route.test.js`
Expected: FAIL，`Cannot find module '../lib/route.js'`

- [ ] **Step 3: 实现 `lib/route.js` 与 `index.js`**

`lib/route.js`：

```js
const BASE = '/project-cockpit/api'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function createRoutes({ listWorkspaces, resolveWorkspace, readProjectDir, buildModel }) {
  return {
    async handle(request) {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (!url.pathname.startsWith(`${BASE}/`)) return new Response('not found', { status: 404 })
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'method-not-allowed' }, 405)
      }
      try {
        if (url.pathname === `${BASE}/workspaces`) {
          return json(await listWorkspaces())
        }
        if (url.pathname === `${BASE}/panel`) {
          const all = await listWorkspaces()
          if (!Array.isArray(all) || all.length === 0) {
            return json({ ok: false, error: 'no-workspace' }, 404)
          }
          const requested = url.searchParams.get('path')
          const target = requested ? await resolveWorkspace(requested) : all[0]
          if (!target) return json({ ok: false, error: 'workspace-not-allowed' }, 403)
          const evidence = await readProjectDir(target.path)
          const model = buildModel
            ? buildModel(evidence)
            : (await import('./panel.js')).buildPanelModel(evidence)
          return json(model)
        }
        return new Response('not found', { status: 404 })
      } catch (error) {
        return json({ ok: false, error: String(error?.message ?? error) }, 500)
      }
    },
  }
}
```

`index.js`：

```js
import { join, resolve } from 'node:path'
import { createRoutes } from './lib/route.js'
import { readProject, readLedger } from './lib/reader.js'
import { buildPanelModel } from './lib/panel.js'

export const inject = ['webServer']

export function apply(ctx) {
  const logWarn = (message) => {
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(`[project-cockpit] ${message}`)
      else console.warn(`[project-cockpit] ${message}`)
    } catch {}
  }

  const workspaceRegistry = () => {
    try {
      return ctx.get('workspaceRegistry')
    } catch {
      return undefined
    }
  }
  const samePath = (a, b) =>
    process.platform === 'win32'
      ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
      : resolve(a) === resolve(b)

  const routes = createRoutes({
    listWorkspaces: async () => {
      const registry = workspaceRegistry()
      if (!registry) return []
      return (await registry.list()).map((item) => ({
        id: String(item.id),
        title: String(item.title ?? item.path),
        path: String(item.path),
      }))
    },
    resolveWorkspace: async (path) => {
      const registry = workspaceRegistry()
      if (!registry) return null
      const found = await registry.resolveByPath(path)
      if (found) return { id: String(found.id), title: String(found.title ?? found.path), path: String(found.path) }
      const all = await registry.list()
      const hit = all.find((item) => samePath(item.path, path))
      return hit ? { id: String(hit.id), title: String(hit.title ?? hit.path), path: String(hit.path) } : null
    },
    readProjectDir: async (projectPath) => {
      const project = await readProject(projectPath)
      const ledger = await readLedger(project.ledger.dir)
      return {
        project: { path: projectPath, name: projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath },
        trellis: project.trellis,
        tasks: project.tasks,
        ledger: { ...ledger, warnings: [...project.warnings, ...ledger.warnings] },
      }
    },
  })

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/project-cockpit',
      resource: (request) => routes.handle(request),
    }),
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/route.test.js`
Expected: PASS，7 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add lib/route.js index.js test/route.test.js
git commit -m "feat: Host 只读路由（工作区授权 + 面板投影）"
```

---

### Task 7: 客户端左栏入口 + 整页

**Files:**
- Create: `client.js`
- Create: `locale/zh.json`、`locale/en.json`（仅 `meta`）
- Test: `test/client-smoke.js`

**Interfaces:**
- Consumes: Host 路由 `/project-cockpit/api/panel`、`/project-cockpit/api/workspaces`
- Produces: `PANEL_ID = 'project-cockpit'`（`main` key 与 `sidebar.panellist` id 同源）

- [ ] **Step 1: 写失败的 smoke 测试**

`test/client-smoke.js`（静态检查，不启动浏览器）：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('client.js 用宿主的模块加载器注册，且 id 与包名一致', async () => {
  const source = await read('client.js')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id: '@hunyed15\/project-cockpit'/)
})

test('main key 与 sidebar.panellist id 同源常量', async () => {
  const source = await read('client.js')
  assert.match(source, /const PANEL_ID = 'project-cockpit'/)
  assert.ok(source.includes("key: PANEL_ID"), 'main 必须用 PANEL_ID')
  assert.ok(source.includes('id: PANEL_ID'), 'sidebar.panellist 必须用 PANEL_ID')
})

test('注册两个插槽：main 与 sidebar.panellist', async () => {
  const source = await read('client.js')
  for (const slot of ['main', 'sidebar.panellist']) {
    assert.ok(source.includes(`'${slot}'`), `未注册 ${slot}`)
  }
})

test('label 用 thunk 以跟随语言', async () => {
  const source = await read('client.js')
  assert.match(source, /label: \(\) =>/)
})

test('不追加 document.body、不建第二 React 根', async () => {
  const source = await read('client.js')
  assert.ok(!source.includes('document.body.appendChild'))
  assert.ok(!source.includes('createRoot'))
})

test('只 fetch 本插件路由', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('/project-cockpit/api/panel'))
  assert.ok(!/fetch\(\s*['"`]http/.test(source))
})

test('locale 文件含 meta.title 与 meta.description', async () => {
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const dict = JSON.parse(await read(file))
    assert.equal(typeof dict.meta.title, 'string')
    assert.ok(dict.meta.title.length > 0)
    assert.equal(typeof dict.meta.description, 'string')
  }
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/client-smoke.js`
Expected: FAIL，`ENOENT ... client.js`

- [ ] **Step 3: 写 `client.js`**

```js
window.__ModuleLoader__.load({
  id: '@hunyed15/project-cockpit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'project-cockpit'
    const API = '/project-cockpit/api'

    const CSS = `
.pc-root { height:100%; overflow:auto; padding:20px 24px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font-size:13px; }
.pc-bar { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.pc-title { font-size:15px; font-weight:600; }
.pc-sub { color:var(--dsw-alias-label-secondary); }
.pc-card { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:14px; background:var(--dsw-alias-bg-layer-1); margin-bottom:12px; }
.pc-state { font-weight:600; }
.pc-done { color:var(--dsw-alias-state-success-primary); }
.pc-current { color:var(--dsw-alias-state-warn-primary); }
.pc-pending { color:var(--dsw-alias-label-secondary); }
.pc-gates { display:flex; flex-wrap:wrap; gap:8px; }
.pc-gate { border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:3px 10px; }
.pc-btn { border:1px solid var(--dsw-alias-brand-primary); background:transparent; color:var(--dsw-alias-brand-primary); border-radius:6px; padding:6px 12px; cursor:pointer; }
.pc-table { width:100%; border-collapse:collapse; }
.pc-table th,.pc-table td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); }
`

    function Icon(props) {
      const size = props && props.size ? props.size : 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: 'currentColor' }),
        h('path', { d: 'M1.5 6.5h13', stroke: 'currentColor' }),
        h('path', { d: 'M5 9.5h3', stroke: 'currentColor' }),
      )
    }

    function usePanel() {
      const [state, setState] = React.useState({ status: 'loading', model: null, error: '' })
      const load = React.useCallback(async () => {
        try {
          const response = await fetch(`${API}/panel`, { credentials: 'same-origin' })
          const body = await response.json()
          if (!response.ok) setState({ status: 'error', model: null, error: body && body.error ? body.error : `HTTP ${response.status}` })
          else setState({ status: 'ready', model: body, error: '' })
        } catch (error) {
          setState({ status: 'error', model: null, error: String(error && error.message ? error.message : error) })
        }
      }, [])
      React.useEffect(() => {
        load()
        const timer = setInterval(load, 8000)
        return () => clearInterval(timer)
      }, [load])
      return { ...state, reload: load }
    }

    function Page() {
      const { status, model, error, reload } = usePanel()
      const style = h('style', { key: 'css' }, CSS)
      if (status === 'loading') return h(React.Fragment, null, style, h('div', { className: 'pc-root' }, '加载中…'))
      if (status === 'error') {
        return h(
          React.Fragment,
          null,
          style,
          h('div', { className: 'pc-root' }, h('div', { className: 'pc-card' }, `读取失败：${error}`)),
        )
      }
      const tone = model.nextAction.kind === 'fix-findings' ? 'pc-current' : 'pc-done'
      return h(
        React.Fragment,
        null,
        style,
        h(
          'div',
          { className: 'pc-root' },
          h(
            'div',
            { className: 'pc-bar' },
            h('span', { className: 'pc-title' }, model.project.name),
            h('span', { className: 'pc-sub' }, `trellis ${model.trellis.version || '未初始化'} · ${model.tasks.length} 个任务`),
            h('button', { className: 'pc-btn', onClick: reload }, '刷新'),
          ),
          h(
            'div',
            { className: 'pc-card' },
            h('div', { className: `pc-state ${tone}` }, model.nextAction.label),
            h('div', null, model.nextAction.instruction),
            h('div', { className: 'pc-sub' }, model.nextAction.reason),
          ),
          h(
            'div',
            { className: 'pc-card' },
            h('div', { className: 'pc-sub' }, '阶段门（推断）'),
            h(
              'div',
              { className: 'pc-gates' },
              model.gates.map((gate) =>
                h('span', { key: gate.name, className: `pc-gate pc-${gate.state}`, title: gate.basis }, gate.name),
              ),
            ),
          ),
          h(
            'div',
            { className: 'pc-card' },
            h(
              'table',
              { className: 'pc-table' },
              h('thead', null, h('tr', null, ['任务', '状态', '优先级', 'blocking', '最近轮次'].map((label) => h('th', { key: label }, label)))),
              h(
                'tbody',
                null,
                model.tasks.length === 0
                  ? h('tr', null, h('td', { colSpan: 5 }, '还没有任务'))
                  : model.tasks.map((task) =>
                      h(
                        'tr',
                        { key: task.id },
                        h('td', null, task.title),
                        h('td', null, task.status),
                        h('td', null, task.priority || '—'),
                        h('td', null, String(task.bugs.blocking)),
                        h('td', null, task.bugs.lastRound === null ? '—' : `#${task.bugs.lastRound} ${task.bugs.lastVerdict || ''}`),
                      ),
                    ),
              ),
            ),
          ),
          model.warnings.length > 0
            ? h('div', { className: 'pc-card pc-sub' }, `数据有 ${model.warnings.length} 处异常：${model.warnings.slice(0, 3).join('；')}`)
            : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, Page),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '项目' },
            Icon,
          ),
        )
      },
    }
  },
})
```

`locale/zh.json`：

```json
{ "meta": { "title": "项目驾驶舱", "description": "只读展示项目进度：到哪了、卡在哪、下一步做什么，并可一键把下一步交给 AI 执行。" } }
```

`locale/en.json`：

```json
{ "meta": { "title": "Project cockpit", "description": "Read-only project progress: where you are, what blocks you, and the next step — with one action that hands it to the agent." } }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/client-smoke.js`
Expected: PASS，7 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add client.js locale test/client-smoke.js
git commit -m "feat: 左栏入口 + 整页面板（只读）"
```

---

### Task 8: 行动层（先探针，再实现，可降级）

**Files:**
- Create: `lib/action.js`
- Modify: `lib/route.js`（加 POST 路由）
- Modify: `client.js`（按钮 + 回显）
- Test: `test/action.test.js`

**Interfaces:**
- Produces: `POST /project-cockpit/api/action`，body `{ sessionId: string, instruction: string }` → `{ ok: true, delivered: 'session'|'command'|'clipboard' }`；`createActionHandler({ deliver }) → (request) => Promise<Response>`

- [ ] **Step 1: 探针（只读，必须在本任务写实现之前完成）**

Run（Host 服务签名）：

```
cordis_inspect_query(platform:"host", provider:"Service", method:"listService", input:{service:"agents"})
cordis_inspect_query(platform:"host", provider:"Service", method:"listService", input:{service:"subagents"})
```

Run（客户端输入能力，确认 `InputActions` 可用方法）：

```
cordis_inspect_query(platform:"client", provider:"Slots", method:"listSubTree", input:{root:"conversation.input.left"})
```

判定规则（写进本任务的提交说明，二选一）：
- 若 Host 侧存在「向指定 session 追加一条用户消息并触发一轮」的合法入口 → 用 **路径 A**（`deliver: 'session'`）。
- 若不存在 → 用 **路径 B**：`POST /api/action` 只把指令落成 `{ ok:true, delivered:'command' }`，由客户端把指令带进对话（`ctx.layout.selectPanel(null)` 回到对话 + 在 `conversation.input.left` 注册的按钮把文本交给 `inputActions`），若 `InputActions` 也无写入能力 → 降级 `delivered:'clipboard'`（复制 + 提示粘贴）。

- [ ] **Step 2: 写失败的测试**

`test/action.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createActionHandler } from '../lib/action.js'

const post = (body) =>
  new Request('http://127.0.0.1/project-cockpit/api/action', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

test('缺参数返回 400', async () => {
  const handler = createActionHandler({ deliver: async () => 'session' })
  assert.equal((await handler(post({}))).status, 400)
  assert.equal((await handler(post({ sessionId: 's1' }))).status, 400)
  assert.equal((await handler(post({ instruction: 'go' }))).status, 400)
})

test('非 POST 返回 405', async () => {
  const handler = createActionHandler({ deliver: async () => 'session' })
  const response = await handler(new Request('http://127.0.0.1/project-cockpit/api/action'))
  assert.equal(response.status, 405)
})

test('投递成功返回 delivered 与 ok', async () => {
  const handler = createActionHandler({ deliver: async () => 'session' })
  const response = await handler(post({ sessionId: 's1', instruction: 'go' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.delivered, 'session')
})

test('投递抛错返回 500 并带原因', async () => {
  const handler = createActionHandler({
    deliver: async () => {
      throw new Error('no-agent')
    },
  })
  const response = await handler(post({ sessionId: 's1', instruction: 'go' }))
  assert.equal(response.status, 500)
  assert.ok((await response.json()).error.includes('no-agent'))
})

test('指令长度上限 2000 字符', async () => {
  const handler = createActionHandler({ deliver: async () => 'session' })
  const response = await handler(post({ sessionId: 's1', instruction: 'x'.repeat(2001) }))
  assert.equal(response.status, 413)
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test test/action.test.js`
Expected: FAIL，`Cannot find module '../lib/action.js'`

- [ ] **Step 4: 实现 `lib/action.js` 并挂进路由**

```js
const MAX_INSTRUCTION = 2000

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function createActionHandler({ deliver }) {
  return async function handle(request) {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405)
    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: 'invalid-json' }, 400)
    }
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
    const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
    if (sessionId === '' || instruction === '') return json({ ok: false, error: 'missing-params' }, 400)
    if (instruction.length > MAX_INSTRUCTION) return json({ ok: false, error: 'instruction-too-long' }, 413)
    try {
      const delivered = await deliver({ sessionId, instruction })
      return json({ ok: true, delivered })
    } catch (error) {
      return json({ ok: false, error: String(error?.message ?? error) }, 500)
    }
  }
}
```

`lib/route.js` 增加分支（放在 `/panel` 之后）：

```js
if (url.pathname === `${BASE}/action`) {
  if (!actionHandler) return json({ ok: false, error: 'action-unavailable' }, 503)
  return actionHandler(request)
}
```

`client.js` 按钮改为：

```js
h('button', {
  className: 'pc-btn',
  onClick: async () => {
    const response = await fetch(`${API}/action`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, instruction: model.nextAction.instruction }),
    })
    const body = await response.json()
    setHint(body.ok ? `已交给 AI（${body.delivered}）` : `失败：${body.error}`)
  },
}, '下一步')
```

- [ ] **Step 5: 运行全部测试并提交**

Run: `node --test test/`
Expected: 全部 PASS（含 Task 1-7 的用例）

```bash
git add lib/action.js lib/route.js client.js test/action.test.js
git commit -m "feat: 行动层（投递指令，含降级路径）"
```

---

### Task 9: 发布（manifest、详情页、真机验收、tag）

**Files:**
- Create: `cordis.patch.yml`
- Create: `icon.svg`
- Create: `README.md`
- Create: `LICENSE`
- Modify: `package.json`（`dsh` 段、`exports`、`files`）
- Create: `docs/DETAIL.md`

**Interfaces:**
- Produces: 可 `plugin_manager install_bundle` 的 bundle，`dsh.bundle.patch` 指向 `cordis.patch.yml`，行 id `project-cockpit`。

- [ ] **Step 1: 写 `cordis.patch.yml` 与 manifest**

`cordis.patch.yml`：

```yaml
- insert:
    - id: project-cockpit
      name: '@hunyed15/project-cockpit'
      config: {}
```

`package.json` 追加：

```json
{
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

- [ ] **Step 2: 写 icon、README、DETAIL、LICENSE**

`icon.svg`（16×16 线框，单色 currentColor）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16" fill="none">
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/>
  <path d="M1.5 6.5h13" stroke="currentColor" stroke-width="1.2"/>
  <path d="M5 9.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>
```

`README.md` 必须包含：安装命令（`git+https://github.com/hunyed15/dsh-project-cockpit.git`）、只读声明、三个数据来源、bug 口径、`engines.dsh` 版本区间、非目标清单。

`LICENSE`：MIT，`Copyright 2026 hunyed15`。

`docs/DETAIL.md`：功能、用法、限制（阶段门是推断；行动层依赖会话；第一版无验收/设置页）。

- [ ] **Step 3: 真机安装验证**

```powershell
plugin_manager(action: "install_bundle", target: "D:\\Coding\\dsh-plugins\\project-cockpit")
```

Expected：`application: applied`；左侧栏出现「项目」图标；点击后整页渲染；`GET /project-cockpit/api/panel` 返回的数字与 `.trellis/tasks/00-bootstrap-guidelines/review/review-*.json` 人工核对一致。

- [ ] **Step 4: 手工验收清单（逐条勾）**

- 左栏图标可点，不报 `selectPanel` 未注册错误。
- 未初始化项目（新建空目录并注册为工作区）显示 `init` 指引，不是白屏/500。
- 有 blocking 的项目显示 `fix-findings` 且数字与账本一致。
- 阶段门 `title` 悬停能看到 `basis`。
- 按钮点击后当前会话确实开始执行（或按降级路径给出明确提示）。
- 刷新页面 3 次，无重复注册报错。

- [ ] **Step 5: 提交并打 tag**

```bash
git add -A
git commit -m "feat: bundle 清单、图标、README、详情页与发布准备"
git tag v0.1.0
```

---

## Self-Review

**Spec 覆盖**：§1 目的/成功标准 → Task 5/7；§2 独立插件 → 全计划结构；§3 位置 → Task 7；§4 架构 → Task 6/7；§5 数据契约 → Task 2/5/6；§5.3 口径 → Task 1；§6 阶段门 → Task 3；§7 行动层 → Task 8；§8 错误处理 → Task 2/6/8；§9 测试 → 各任务；§10 风险 → Global Constraints + Task 8 探针；§11 里程碑 → Task 1-9 顺序。

**已知偏离**：`hasPrd` 在 Task 5 用 `specFiles > 0` 近似（见 Task 5 备注）；spec §4.1 的 `panel.js` 单文件在计划中拆成 `count/gates/next-action/panel` 四个纯函数模块，接口向后兼容。

## 执行变更记录

**2026-11-18（执行 Task 1-5 后，按用户要求补的洞）**：原计划 Task 2/5 让 `readProject` 返回单一 `ledger` 并取 `tasks[0].ledgerDir`，这在多任务项目上会把 A 的 bug 记到 B 头上。已改为：

- `readProject` 的 trellis 模式返回 `ledger = { dir: null, kind: 'trellis' }`，每个任务自带 `ledgerDir`；
- 新增 `readEvidence(root)`：逐任务读账本并挂在 `task.ledger` 上，同时生成 `project/tasks/warnings`；
- `buildPanelModel` 改为按任务计数 + `totals` 聚合（`lastRound` 取最大轮次），响应不含 `ledgerDir`；
- 本地账本模式生成伪任务（读 `ledger/task.json`，缺文件用 `id=local`）；
- 测试从 31 增至 35（新增多任务不串账本、伪任务、路径不泄漏）。
