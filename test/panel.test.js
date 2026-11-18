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

test('账本 warnings 冒泡到模型', () => {
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
