import { countBugs } from './count.js'
import { deriveGates } from './gates.js'
import { nextAction } from './next-action.js'

export function buildPanelModel(evidence, now = new Date()) {
  const warnings = [...(evidence.ledger?.warnings ?? [])]
  const latest = evidence.ledger?.latest ?? null
  const rounds = evidence.ledger?.rounds ?? []
  const dispositions = evidence.ledger?.dispositions ?? []
  const counts = countBugs(latest, dispositions)
  const lastRound = rounds.length > 0 ? Math.max(...rounds.map((item) => item.round)) : null
  const lastEntry = rounds.find((item) => item.round === lastRound) ?? null
  const tasks = (evidence.tasks ?? []).map((task) => {
    const { ledgerDir, ...rest } = task
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
    }
  })
  const gates = deriveGates({
    hasPrd: (evidence.trellis?.specFiles ?? 0) > 0,
    specFiles: evidence.trellis?.specFiles ?? 0,
    codeFiles: evidence.trellis?.initialized ? 1 : 0,
    hasActiveTask: (evidence.tasks ?? []).some((task) =>
      ['in_progress', 'completed'].includes(task.status),
    ),
    rounds: rounds.length,
  })
  return {
    project: evidence.project,
    trellis: evidence.trellis,
    tasks,
    gates,
    nextAction: nextAction({
      initialized: evidence.trellis?.initialized === true,
      blocking: counts.blocking,
      fixed: counts.fixed,
      lastRound,
      lastVerdict: lastEntry?.verdict ?? null,
    }),
    warnings,
    generatedAt: now.toISOString(),
  }
}
