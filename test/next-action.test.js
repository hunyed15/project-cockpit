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
