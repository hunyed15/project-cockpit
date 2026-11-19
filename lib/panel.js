import { countBugs, summarizeBlocking } from './count.js'
import { deriveGates } from './gates.js'
import { nextAction } from './next-action.js'

const MAX_TASKS = 200
const MAX_ISSUES = 3

function withBugs(task, now) {
  const ledger = task.ledger ?? { rounds: [], dispositions: [], latest: null, warnings: [] }
  const counts = countBugs(ledger.latest, ledger.dispositions)
  const rounds = ledger.rounds ?? []
  const lastRound = rounds.length > 0 ? Math.max(...rounds.map((item) => item.round)) : null
  const lastEntry = rounds.find((item) => item.round === lastRound) ?? null
  const { ledgerDir, ledger: _ignored, ...rest } = task
  return {
    ...rest,
    bugs: {
      blocking: counts.blocking,
      open: counts.open,
      fixed: counts.fixed,
      lastRound,
      lastVerdict: lastEntry?.verdict ?? null,
      lastAt: lastEntry?.at ?? null,
      // 面板要能说清"卡在哪"，只给计数不够
      issues: summarizeBlocking(ledger.latest, ledger.dispositions, MAX_ISSUES),
    },
    rounds: rounds.length,
  }
}

function aggregate(tasks) {
  const total = {
    blocking: 0,
    fixed: 0,
    open: 0,
    rounds: 0,
    lastRound: null,
    lastVerdict: null,
    issues: [],
    // 元信息要说"一共多少任务"，不能拿截断后的列表长度冒充
    taskCount: tasks.length,
  }
  for (const task of tasks) {
    total.blocking += task.bugs.blocking
    total.fixed += task.bugs.fixed
    total.open += task.bugs.open
    total.rounds += task.rounds
    if (task.bugs.lastRound !== null) {
      if (total.lastRound === null || task.bugs.lastRound > total.lastRound) {
        total.lastRound = task.bugs.lastRound
        total.lastVerdict = task.bugs.lastVerdict
      }
    }
    for (const issue of task.bugs.issues ?? []) {
      if (total.issues.length >= MAX_ISSUES) break
      total.issues.push({ ...issue, task: task.title || task.id })
    }
  }
  return total
}

export function buildPanelModel(evidence, now = new Date()) {
  const warnings = [...(evidence.warnings ?? [])]
  const allTasks = evidence.tasks ?? []
  // 任务表全量渲染会拖垮 8 秒轮询；超过 200 个任务就截断并明确标出来，
  // 不能让人以为看到的 200 个就是全部。
  const truncated = allTasks.length > MAX_TASKS
  // 先全量计数再切片：截断只影响列表体积，卡点数与阶段门必须仍按全部任务算，
  // 否则界面上的汇总数字会跟着列表一起变小（那就是假数据）。
  const computed = allTasks.map((task) => withBugs(task, now))
  const tasks = computed.slice(0, MAX_TASKS)
  const totals = aggregate(computed)
  const gates = deriveGates({
    hasPrd: (evidence.trellis?.specFiles ?? 0) > 0,
    specFiles: evidence.trellis?.specFiles ?? 0,
    codeFiles: evidence.trellis?.initialized ? 1 : 0,
    hasActiveTask: computed.some((task) => ['in_progress', 'completed'].includes(task.status)),
    rounds: totals.rounds,
    // 阶段门必须知道还有多少 blocking 没处置，否则"挑毛病"会被误判为已完成。
    blocking: totals.blocking,
  })
  return {
    project: evidence.project,
    trellis: evidence.trellis,
    tasks,
    totals,
    gates,
    nextAction: nextAction({
      initialized: evidence.trellis?.initialized === true,
      blocking: totals.blocking,
      fixed: totals.fixed,
      lastRound: totals.lastRound,
      lastVerdict: totals.lastVerdict,
    }),
    warnings,
    truncated,
    // 客户端不要自己写死 200：上限由模型给出，只有一处事实源。
    taskLimit: MAX_TASKS,
    generatedAt: now.toISOString(),
  }
}
