import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPanelModel } from '../lib/panel.js'

const ledger = (overrides = {}) => ({
  rounds: [{ round: 1, verdict: 'fix', mode: 'full', at: '2026-11-01T00:00:00Z' }],
  dispositions: [],
  // 真实形状：issues 在 review 下（顶层 issues 曾经被误读为空）
  latest: { meta: { round: 1 }, review: { issues: [{ severity: 'important', key: 'k1', issue: '问题一', file: 'a.js', line: 3 }], verdict: 'fix' } },
  warnings: [],
  ...overrides,
})

const task = (id, overrides = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'in_progress',
  priority: 'P1',
  devType: 'docs',
  completedAt: null,
  subtasksDone: 0,
  subtasksTotal: 0,
  ledger: ledger(),
  ...overrides,
})

function evidence(overrides = {}) {
  return {
    project: { path: 'D:/Coding/foo', name: 'foo' },
    trellis: { initialized: true, version: '0.6.17', specFiles: 2 },
    tasks: [task('t1')],
    warnings: [],
    ...overrides,
  }
}

test('模型包含 spec 约定的顶层字段', () => {
  const model = buildPanelModel(evidence(), new Date('2026-11-18T10:00:00Z'))
  for (const key of ['project', 'trellis', 'tasks', 'totals', 'gates', 'nextAction', 'generatedAt', 'warnings']) {
    assert.ok(key in model, `缺少 ${key}`)
  }
  assert.equal(model.generatedAt, '2026-11-18T10:00:00.000Z')
})

test('单任务的 bug 计数来自它自己的账本', () => {
  const model = buildPanelModel(evidence())
  assert.equal(model.tasks[0].bugs.blocking, 1)
  assert.equal(model.tasks[0].bugs.lastRound, 1)
  assert.equal(model.tasks[0].bugs.lastVerdict, 'fix')
  assert.equal(model.tasks[0].rounds, 1)
})

test('真实 review.issues 形状能算出 blocking，并带出要修的那几条', () => {
  const model = buildPanelModel(evidence())
  assert.equal(model.totals.blocking, 1, '真实形状下 blocking 不能恒为 0')
  assert.equal(model.totals.issues.length, 1)
  assert.equal(model.totals.issues[0].severity, 'important')
  assert.ok(model.totals.issues[0].title.includes('问题一'))
  assert.equal(model.totals.issues[0].task, 'Task t1')
})

test('多任务各算各的账本，不互相串', () => {
  const model = buildPanelModel(
    evidence({
      tasks: [
        task('a', {
          ledger: ledger({
            latest: {
              meta: { round: 5 },
              issues: [
                { severity: 'critical', key: 'x1' },
                { severity: 'important', key: 'x2' },
              ],
            },
            rounds: [{ round: 5, verdict: 'fix', mode: 'full', at: '2026-11-05T00:00:00Z' }],
          }),
        }),
        task('b', {
          ledger: ledger({
            latest: { meta: { round: 2 }, issues: [] },
            rounds: [{ round: 2, verdict: 'pass', mode: 'range', at: '2026-11-02T00:00:00Z' }],
          }),
        }),
      ],
    }),
  )
  assert.equal(model.tasks[0].bugs.blocking, 2)
  assert.equal(model.tasks[1].bugs.blocking, 0)
  assert.equal(model.totals.blocking, 2)
  assert.equal(model.totals.rounds, 2)
  assert.equal(model.totals.lastRound, 5)
  assert.equal(model.totals.lastVerdict, 'fix')
})

test('聚合 blocking 决定 nextAction 且指令带总数', () => {
  const model = buildPanelModel(
    evidence({
      tasks: [
        task('a', {
          ledger: ledger({
            latest: { meta: { round: 3 }, issues: [{ severity: 'critical', key: 'x1' }] },
            rounds: [{ round: 3, verdict: 'fix', mode: 'full', at: '2026-11-03T00:00:00Z' }],
          }),
        }),
        task('b', {
          ledger: ledger({
            latest: { meta: { round: 4 }, issues: [{ severity: 'important', key: 'y1' }] },
            rounds: [{ round: 4, verdict: 'fix', mode: 'full', at: '2026-11-04T00:00:00Z' }],
          }),
        }),
      ],
    }),
  )
  assert.equal(model.nextAction.kind, 'fix-findings')
  assert.ok(model.nextAction.instruction.includes('2'))
})

test('未初始化时 nextAction 是 init 且任务为空', () => {
  const model = buildPanelModel(
    evidence({
      trellis: { initialized: false, version: null, specFiles: 0 },
      tasks: [],
    }),
  )
  assert.equal(model.nextAction.kind, 'init')
  assert.deepEqual(model.tasks, [])
  assert.equal(model.gates.filter((g) => g.state === 'current').length, 1)
})

test('warnings 冒泡到模型', () => {
  const model = buildPanelModel(evidence({ warnings: ['坏行 x'] }))
  assert.ok(model.warnings.includes('坏行 x'))
})

test('任务没有 ledger 时 bugs 全 0 且不崩', () => {
  const model = buildPanelModel(evidence({ tasks: [{ id: 'z', title: 'z', status: 'planning' }] }))
  assert.equal(model.tasks[0].bugs.blocking, 0)
  assert.equal(model.tasks[0].bugs.lastRound, null)
  assert.equal(model.tasks[0].rounds, 0)
  assert.equal(model.totals.rounds, 0)
  assert.equal(model.nextAction.kind, 'first-review')
})

test('响应不泄漏内部账本路径', () => {
  const model = buildPanelModel(evidence({ tasks: [task('t1', { ledgerDir: 'D:/secret/review' })] }))
  const flat = JSON.stringify(model)
  assert.ok(!flat.includes('secret'))
  assert.ok(!flat.includes('ledgerDir'))
})

test('任务超过 200 个时截断并标 truncated', () => {
  const many = Array.from({ length: 260 }, (_, index) => task(`t${index}`))
  const model = buildPanelModel(evidence({ tasks: many }))
  assert.equal(model.tasks.length, 200)
  assert.equal(model.truncated, true)
})

test('截断只压列表，卡点数与阶段门仍按全部任务算', () => {
  const many = Array.from({ length: 260 }, (_, index) => task(`t${index}`))
  const model = buildPanelModel(evidence({ tasks: many }))
  // 每个任务 1 个未处置 important → 全部 260 个都应计入 totals
  assert.equal(model.totals.blocking, 260)
  assert.equal(model.totals.rounds, 260)
})

test('任务未超限时 truncated 为 false', () => {
  const model = buildPanelModel(evidence())
  assert.equal(model.truncated, false)
  assert.equal(model.taskLimit, 200)
})
