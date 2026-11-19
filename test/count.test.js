import test from 'node:test'
import assert from 'node:assert/strict'
import { countBugs, resolveFailOn, reportIssues, summarizeBlocking, DEFAULT_FAIL_ON } from '../lib/count.js'

// 真实报告形状（取自 review-1.json）：
// { meta: { round, failOn }, review: { summary, issues, verdict } }
const real = (issues, meta = {}) => ({
  meta: { task: 't', round: 3, failOn: ['critical', 'important'], ...meta },
  review: { summary: '', strengths: [], recommendations: [], assessment: '', issues, verdict: 'fix' },
})
const issue = (severity, key, extra = {}) => ({
  severity,
  file: 'lib/x.js',
  line: 10,
  issue: `${severity} 问题 ${key}`,
  why: '原因',
  fix: '改法',
  key,
  ...extra,
})

test('默认 failOn 是 critical/important', () => {
  assert.deepEqual(resolveFailOn({ meta: {} }), DEFAULT_FAIL_ON)
  assert.deepEqual(resolveFailOn(null), DEFAULT_FAIL_ON)
})

test('报告自带 failOn 时覆盖默认值', () => {
  assert.deepEqual(resolveFailOn({ meta: { failOn: ['critical'] } }), ['critical'])
})

test('真实形状 review.issues 能被读到（顶层 issues 曾经读成空）', () => {
  const report = real([issue('important', 'k1')])
  assert.equal(reportIssues(report).length, 1, 'reportIssues 必须读 review.issues')
  assert.equal(countBugs(report, []).blocking, 1, '真实形状下 blocking 不能恒为 0')
})

test('顶层 issues 仍兼容（历史 fixtures / 其他来源）', () => {
  const report = { meta: { round: 3 }, issues: [issue('critical', 'k1')] }
  assert.equal(countBugs(report, []).blocking, 1)
})

test('minor 不阻断', () => {
  const r = countBugs(real([issue('minor', 'm1')]), [])
  assert.equal(r.blocking, 0)
  assert.equal(r.total, 1)
})

test('未处置的 important 计入 blocking 与 open', () => {
  const r = countBugs(real([issue('important', 'k1')]), [])
  assert.equal(r.blocking, 1)
  assert.equal(r.open, 1)
})

test('fixed 的处置从 blocking 移到 open', () => {
  const r = countBugs(real([issue('important', 'k1')]), [{ round: 3, key: 'k1', status: 'fixed' }])
  assert.equal(r.blocking, 0)
  assert.equal(r.fixed, 1)
  assert.equal(r.open, 1)
})

test('deferred 与 counter-evidence 都算已处置且不计入 open', () => {
  const r = countBugs(
    real([issue('critical', 'k1'), issue('important', 'k2')]),
    [
      { round: 3, key: 'k1', status: 'deferred' },
      { round: 3, key: 'k2', status: 'counter-evidence' },
    ],
  )
  assert.equal(r.blocking, 0)
  assert.equal(r.open, 0)
})

test('跨轮处置不生效', () => {
  const r = countBugs(real([issue('critical', 'k1')]), [{ round: 2, key: 'k1', status: 'fixed' }])
  assert.equal(r.blocking, 1)
})

test('没有 key 时按原始下标匹配处置', () => {
  const noKey1 = { severity: 'important', issue: 'a' }
  const noKey2 = { severity: 'important', issue: 'b' }
  const r = countBugs(real([noKey1, noKey2]), [{ round: 3, index: 1, status: 'fixed' }])
  assert.equal(r.blocking, 1)
  assert.equal(r.fixed, 1)
})

test('issues 里的 null 不产生幻影条目', () => {
  const r = countBugs(real([null, issue('critical', 'k')]), [])
  assert.equal(r.total, 1)
  assert.equal(r.blocking, 1)
})

test('summarizeBlocking 给出 severity/文件/行/标题，供面板说清"卡在哪"', () => {
  const r = summarizeBlocking(real([issue('important', 'k1'), issue('minor', 'm')]), [], 3)
  assert.equal(r.length, 1, '只列 blocking 级别')
  assert.equal(r[0].severity, 'important')
  assert.equal(r[0].file, 'lib/x.js')
  assert.equal(r[0].line, 10)
  assert.ok(r[0].title.includes('k1'))
})

test('summarizeBlocking 跳过已处置的，并按 limit 截断', () => {
  const issues = [issue('critical', 'a'), issue('critical', 'b'), issue('critical', 'c'), issue('critical', 'd')]
  const r = summarizeBlocking(real(issues), [{ round: 3, key: 'a', status: 'deferred' }], 2)
  assert.equal(r.length, 2)
  assert.deepEqual(r.map((x) => x.key), ['b', 'c'])
})

test('缺 issue 文本时给可读占位，不抛错', () => {
  const r = summarizeBlocking(real([{ severity: 'critical', key: 'z' }]), [], 3)
  assert.equal(r[0].title, '（未命名问题）')
})
