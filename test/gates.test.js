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
  const gates = deriveGates({
    hasPrd: true,
    specFiles: 3,
    codeFiles: 5,
    hasActiveTask: true,
    rounds: 4,
  })
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

test('“想清楚”的 basis 不能断言 prd.md 存在（第一版只是近似）', () => {
  const gates = deriveGates({ ...empty, hasPrd: true, specFiles: 4 })
  assert.ok(!gates[0].basis.includes('prd.md 存在'), `basis 不得断言 prd 存在：${gates[0].basis}`)
  assert.ok(gates[0].basis.includes('近似'), '必须标明是近似判断')
})
