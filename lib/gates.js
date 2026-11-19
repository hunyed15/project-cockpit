const NAMES = ['想清楚', '定规格', '搭骨架', '写代码', '挑毛病', '验效果', '发出去']

export function deriveGates(evidence) {
  const blocking = Number.isInteger(evidence.blocking) ? evidence.blocking : 0
  const reviewed = evidence.rounds > 0
  const done = [
    {
      hit: evidence.hasPrd,
      // 第一版没有解析 prd.md，是拿 spec 文件数近似的 —— 文案必须说"近似"，
      // 不能断言"prd.md 存在"（那会是一句会被当事实读的假话）。
      basis: evidence.hasPrd ? '按 spec 文件数近似判断 PRD 已建立' : '还没有 prd.md 或 spec',
    },
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
      // 审过 ≠ 挑完毛病。还有未处置的 blocking 时这一门没结束，
      // 否则 chip 说"待修 3"、阶段门却说"下一阶段：验效果"，两个答案打架。
      hit: reviewed && blocking === 0,
      basis: !reviewed
        ? '还没有审核轮次'
        : blocking > 0
          ? `账本有 ${evidence.rounds} 个审核轮次，但还有 ${blocking} 个 blocking 未处置`
          : `账本有 ${evidence.rounds} 个审核轮次，无未处置 blocking`,
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
