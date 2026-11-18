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
