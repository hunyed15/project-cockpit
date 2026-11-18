import { countBugs } from './count.js'
import { deriveGates } from './gates.js'
import { nextAction } from './next-action.js'

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
    },
    rounds: rounds.length,
  }
}

function aggregate(tasks) {
  const total = { blocking: 0, fixed: 0, open: 0, rounds: 0, lastRound: null, lastVerdict: null }
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
  }
  return total
}

export function buildPanelModel(evidence, now = new Date()) {
  const warnings = [...(evidence.warnings ?? [])]
  const tasks = (evidence.tasks ?? []).map((task) => withBugs(task, now))
  const totals = aggregate(tasks)
  const gates = deriveGates({
    hasPrd: (evidence.trellis?.specFiles ?? 0) > 0,
    specFiles: evidence.trellis?.specFiles ?? 0,
    codeFiles: evidence.trellis?.initialized ? 1 : 0,
    hasActiveTask: tasks.some((task) => ['in_progress', 'completed'].includes(task.status)),
    rounds: totals.rounds,
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
    generatedAt: now.toISOString(),
  }
}
