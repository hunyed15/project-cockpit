export const DEFAULT_FAIL_ON = ['critical', 'important']

const DISPOSED = new Set(['fixed', 'deferred', 'counter-evidence'])

/**
 * 真实报告形状是 `{ meta: { round, failOn, ... }, review: { summary, issues, verdict } }`。
 * 早期版本读的是顶层 `report.issues`，在真实账本上永远读到空数组 —— 也就是 blocking 恒为 0。
 * 这里同时兼容顶层 issues，但真实形状优先。
 */
export function reportIssues(report) {
  if (!report || typeof report !== 'object') return []
  const nested = report.review && Array.isArray(report.review.issues) ? report.review.issues : null
  const flat = Array.isArray(report.issues) ? report.issues : null
  const source = nested ?? flat ?? []
  return source.filter(Boolean)
}

export function reportVerdict(report) {
  if (!report || typeof report !== 'object') return null
  const nested = report.review && typeof report.review.verdict === 'string' ? report.review.verdict : null
  const flat = typeof report.verdict === 'string' ? report.verdict : null
  return nested ?? flat ?? null
}

export function resolveFailOn(report) {
  const meta = report && typeof report === 'object' && report.meta ? report.meta : {}
  const list = Array.isArray(meta.failOn) ? meta.failOn.filter((item) => typeof item === 'string') : []
  return list.length > 0 ? list : DEFAULT_FAIL_ON
}

function marksFor(report, dispositions) {
  const round = Number.isInteger(report?.meta?.round) ? report.meta.round : null
  return (Array.isArray(dispositions) ? dispositions : []).filter(
    (item) => item && (round === null || item.round === round),
  )
}

function dispositionFor(issue, index, byKey, byIndex) {
  return (typeof issue.key === 'string' && byKey.get(issue.key)) || byIndex.get(index) || null
}

export function countBugs(report, dispositions = []) {
  const issues = reportIssues(report)
  const failOn = resolveFailOn(report)
  const marks = marksFor(report, dispositions)
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
    const mark = dispositionFor(issue, index, byKey, byIndex)
    if (mark && DISPOSED.has(mark.status)) {
      if (mark.status === 'fixed') fixed += 1
      return
    }
    blocking += 1
  })
  return { blocking, fixed, open: blocking + fixed, total: issues.length }
}

/**
 * 面板要能说清"卡在哪"，光有计数不够 —— 还得给出那几条是什么。
 * 只回传展示所需的最小字段，不把整份报告塞给客户端。
 */
export function summarizeBlocking(report, dispositions = [], limit = 3) {
  const issues = reportIssues(report)
  const failOn = resolveFailOn(report)
  const marks = marksFor(report, dispositions)
  const byKey = new Map()
  const byIndex = new Map()
  for (const mark of marks) {
    if (typeof mark.key === 'string' && mark.key !== '') byKey.set(mark.key, mark)
    if (Number.isInteger(mark.index)) byIndex.set(mark.index, mark)
  }
  const out = []
  issues.forEach((issue, index) => {
    if (!failOn.includes(issue.severity)) return
    const mark = dispositionFor(issue, index, byKey, byIndex)
    if (mark && DISPOSED.has(mark.status)) return
    out.push({
      severity: String(issue.severity),
      key: typeof issue.key === 'string' ? issue.key : null,
      file: typeof issue.file === 'string' ? issue.file : null,
      line: Number.isInteger(issue.line) ? issue.line : null,
      title: String(issue.issue ?? issue.title ?? issue.summary ?? '（未命名问题）'),
    })
  })
  return out.slice(0, Math.max(0, limit))
}
