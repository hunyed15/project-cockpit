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
  const r = countBugs(report([{ severity: 'important', key: 'k1' }]), [
    { round: 3, key: 'k1', status: 'fixed' },
  ])
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
  const r = countBugs(report([{ severity: 'critical', key: 'k1' }]), [
    { round: 2, key: 'k1', status: 'fixed' },
  ])
  assert.equal(r.blocking, 1)
})

test('没有 key 时按原始下标匹配处置', () => {
  const r = countBugs(report([{ severity: 'important' }, { severity: 'important' }]), [
    { round: 3, index: 1, status: 'fixed' },
  ])
  assert.equal(r.blocking, 1)
  assert.equal(r.fixed, 1)
})

test('issues 里的 null 不产生幻影条目', () => {
  const r = countBugs(report([null, { severity: 'critical', key: 'k' }]), [])
  assert.equal(r.total, 1)
  assert.equal(r.blocking, 1)
})
