const NAMES = ['想清楚', '定规格', '搭骨架', '写代码', '挑毛病', '验效果', '发出去']

export function deriveGates(evidence) {
  const done = [
    { hit: evidence.hasPrd, basis: evidence.hasPrd ? 'prd.md 存在（第一版按 spec 文件数近似）' : '没有 prd.md' },
    {
      hit: evidence.specFiles > 0,
      basis:
        evidence.specFiles > 0
          ? `.trellis/spec 有 ${evidence.specFiles} 个文件`
          : '.trellis/spec 为空',
    },
    {
      hit: evidence.codeFiles > 0,
      basis: evidence.codeFiles > 0 ? '项目已初始化（未逐文件计数）' : '还没有实现文件',
    },
    {
      hit: evidence.hasActiveTask,
      basis: evidence.hasActiveTask ? '存在进行中/已完成的任务' : '没有进行中的任务',
    },
    {
      hit: evidence.rounds > 0,
      basis: evidence.rounds > 0 ? `账本有 ${evidence.rounds} 个审核轮次` : '还没有审核轮次',
    },
    { hit: false, basis: '验收表未接入（第二版）' },
    { hit: false, basis: '发布记录未接入（第二版）' },
  ]
  const firstPending = done.findIndex((item) => !item.hit)
  return NAMES.map((name, index) => ({
    name,
    state: done[index].hit ? 'done' : index === firstPending ? 'current' : 'pending',
    basis: done[index].basis,
  }))
}
