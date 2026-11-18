export function nextAction(input) {
  if (!input.initialized) {
    return {
      kind: 'init',
      label: '初始化 trellis',
      instruction:
        '这个项目还没有 .trellis。先用 trellis 初始化并建第一个任务，再回来打开项目面板。',
      reason: '未找到 .trellis',
    }
  }
  if (input.blocking > 0) {
    return {
      kind: 'fix-findings',
      label: '修复并复检',
      instruction: `修完 review-${input.lastRound ?? '?'} 的 ${input.blocking} 个 blocking finding，用 claude_review_disposition 标记后，跑 claude_review(mode:"gate") 复核。`,
      reason: `存在 ${input.blocking} 个未处置的 blocking finding`,
    }
  }
  if (input.fixed > 0) {
    return {
      kind: 'recheck',
      label: '复检本轮修复',
      instruction: `用 claude_review(mode:"range") 复检 review-${input.lastRound ?? '?'} 中已标记 fixed 的 ${input.fixed} 条问题。`,
      reason: `${input.fixed} 条问题已标记 fixed，等待复检`,
    }
  }
  if (input.lastRound === null) {
    return {
      kind: 'first-review',
      label: '跑第一次审核',
      instruction: '跑 claude_review(mode:"full")，对本轮改动做第一次完整审核。',
      reason: '账本里还没有审核轮次',
    }
  }
  return {
    kind: 'verify-gate',
    label: '跑提交门禁',
    instruction: '跑 claude_review(mode:"gate") 确认可以提交。',
    reason: `最近一轮（review-${input.lastRound}）verdict=${input.lastVerdict ?? '未知'} 且无待处置问题`,
  }
}
