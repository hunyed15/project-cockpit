import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProject, readLedger, readEvidence } from '../lib/reader.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  await mkdir(join(root, '.trellis', 'tasks', 't1', 'review'), { recursive: true })
  await mkdir(join(root, '.trellis', 'spec'), { recursive: true })
  await writeFile(join(root, '.trellis', '.version'), '0.6.17\n')
  await writeFile(join(root, '.trellis', 'spec', 'a.md'), '# a')
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'task.json'),
    JSON.stringify({
      id: 't1',
      title: 'Task one',
      status: 'in_progress',
      priority: 'P1',
      dev_type: 'docs',
      completedAt: null,
      subtasks: [{ status: 'done' }, { status: 'open' }],
    }),
  )
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'review', 'history.jsonl'),
    [
      JSON.stringify({ round: 1, verdict: 'fix', mode: 'full', at: '2026-11-01T00:00:00Z' }),
      'not-json',
      JSON.stringify({ round: 2, verdict: 'pass', mode: 'range', at: '2026-11-02T00:00:00Z' }),
    ].join('\n'),
  )
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'review', 'review-2.json'),
    JSON.stringify({ meta: { round: 2, failOn: ['critical'] }, issues: [] }),
  )
  await writeFile(
    join(root, '.trellis', 'tasks', 't1', 'review', 'dispositions.jsonl'),
    JSON.stringify({ round: 1, key: 'k1', status: 'fixed' }) + '\n',
  )
  return root
}

test('读取 trellis 任务与版本', async () => {
  const root = await fixture()
  try {
    const project = await readProject(root)
    assert.equal(project.trellis.initialized, true)
    assert.equal(project.trellis.version, '0.6.17')
    assert.equal(project.trellis.specFiles, 1)
    assert.equal(project.tasks.length, 1)
    assert.equal(project.tasks[0].id, 't1')
    assert.equal(project.tasks[0].status, 'in_progress')
    assert.equal(project.tasks[0].subtasksTotal, 2)
    assert.equal(project.tasks[0].subtasksDone, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('坏 jsonl 行被跳过并记入 warnings', async () => {
  const root = await fixture()
  try {
    const project = await readProject(root)
    const ledger = await readLedger(project.tasks[0].ledgerDir)
    assert.equal(ledger.rounds.length, 2)
    assert.equal(ledger.dispositions.length, 1)
    assert.ok(ledger.warnings.some((line) => line.includes('第 2 行')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('latest 取最大轮次的 review-N.json', async () => {
  const root = await fixture()
  try {
    const project = await readProject(root)
    const ledger = await readLedger(project.tasks[0].ledgerDir)
    assert.equal(ledger.latest.meta.round, 2)
    assert.deepEqual(ledger.latest.meta.failOn, ['critical'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('没有 .trellis 时回落到本地账本且不抛错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  try {
    await mkdir(join(root, '.dsh', 'claude-review', 'ledger', 'review'), { recursive: true })
    await writeFile(
      join(root, '.dsh', 'claude-review', 'ledger', 'review', 'history.jsonl'),
      JSON.stringify({ round: 1, verdict: 'pass', mode: 'full', at: '2026-11-03T00:00:00Z' }) + '\n',
    )
    const project = await readProject(root)
    assert.equal(project.trellis.initialized, false)
    assert.equal(project.tasks.length, 1)
    assert.equal(project.tasks[0].id, 'local')
    assert.equal(project.ledger.kind, 'local')
    const ledger = await readLedger(project.ledger.dir)
    assert.equal(ledger.rounds.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('空目录返回未初始化而不是异常', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  try {
    const project = await readProject(root)
    assert.equal(project.trellis.initialized, false)
    assert.equal(project.ledger.dir, null)
    assert.deepEqual(project.tasks, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('多任务各自读自己的账本，不串轮次', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  try {
    const tasksDir = join(root, '.trellis', 'tasks')
    await mkdir(join(root, '.trellis'), { recursive: true })
    await writeFile(join(root, '.trellis', '.version'), '0.6.17\n')
    for (const [id, rounds] of [
      ['t1', [1, 2, 3]],
      ['t2', [1]],
    ]) {
      await mkdir(join(tasksDir, id, 'review'), { recursive: true })
      await writeFile(join(tasksDir, id, 'task.json'), JSON.stringify({ id, title: id, status: 'in_progress' }))
      await writeFile(
        join(tasksDir, id, 'review', 'history.jsonl'),
        rounds
          .map((round) => JSON.stringify({ round, verdict: 'pass', mode: 'full', at: '2026-11-01T00:00:00Z' }))
          .join('\n'),
      )
    }
    const evidence = await readEvidence(root)
    assert.equal(evidence.tasks.length, 2)
    const t1 = evidence.tasks.find((task) => task.id === 't1')
    const t2 = evidence.tasks.find((task) => task.id === 't2')
    assert.equal(t1.ledger.rounds.length, 3)
    assert.equal(t2.ledger.rounds.length, 1)
    assert.equal(evidence.project.name, root.split(/[\\/]/).filter(Boolean).pop())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('本地账本生成伪任务，标题取账本 task.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cockpit-'))
  try {
    const ledgerRoot = join(root, '.dsh', 'claude-review', 'ledger')
    await mkdir(join(ledgerRoot, 'review'), { recursive: true })
    await writeFile(join(ledgerRoot, 'task.json'), JSON.stringify({ id: 'local', title: '我的仓库' }))
    await writeFile(
      join(ledgerRoot, 'review', 'history.jsonl'),
      JSON.stringify({ round: 1, verdict: 'pass', mode: 'full', at: '2026-11-03T00:00:00Z' }) + '\n',
    )
    const evidence = await readEvidence(root)
    assert.equal(evidence.trellis.initialized, false)
    assert.equal(evidence.tasks.length, 1)
    assert.equal(evidence.tasks[0].title, '我的仓库')
    assert.equal(evidence.tasks[0].ledger.rounds.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
