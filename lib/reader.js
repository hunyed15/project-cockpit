import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

async function readText(path, warnings) {
  try {
    const info = await stat(path)
    const text = await readFile(path, 'utf8')
    if (info.size > MAX_BYTES) {
      warnings.push(`${path} 超过 2 MiB，已截断读取`)
      return text.slice(0, MAX_BYTES)
    }
    return text
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    warnings.push(`${path} 读取失败：${error?.code ?? error?.message ?? error}`)
    return null
  }
}

async function readJson(path, warnings) {
  const text = await readText(path, warnings)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    warnings.push(`${path} 不是合法 JSON，已忽略`)
    return null
  }
}

async function readJsonl(path, warnings) {
  const text = await readText(path, warnings)
  if (text === null) return []
  const rows = []
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    try {
      rows.push(JSON.parse(trimmed))
    } catch {
      warnings.push(`${path} 第 ${index + 1} 行不是合法 JSON，已跳过`)
    }
  })
  return rows
}

function toTask(raw) {
  const subtasks = Array.isArray(raw?.subtasks) ? raw.subtasks : []
  return {
    id: String(raw?.id ?? raw?.name ?? ''),
    title: String(raw?.title ?? raw?.name ?? raw?.id ?? ''),
    status: String(raw?.status ?? 'unknown'),
    priority: raw?.priority == null ? null : String(raw.priority),
    devType: raw?.dev_type == null ? null : String(raw.dev_type),
    completedAt: raw?.completedAt == null ? null : String(raw.completedAt),
    subtasksTotal: subtasks.length,
    subtasksDone: subtasks.filter((item) => item?.status === 'done').length,
  }
}

function normalizeRound(raw, fallbackRound) {
  const round = Number.isInteger(raw?.round) ? raw.round : fallbackRound
  return {
    round,
    failOn: Array.isArray(raw?.failOn) ? raw.failOn.filter((item) => typeof item === 'string') : null,
    verdict: raw?.verdict == null ? null : String(raw.verdict),
    mode: raw?.mode == null ? null : String(raw.mode),
    at: raw?.at == null ? null : String(raw.at),
  }
}

export async function readProject(root) {
  const warnings = []
  const trellisDir = join(root, '.trellis')
  const versionText = await readText(join(trellisDir, '.version'), warnings)
  const initialized = versionText !== null
  let specFiles = 0
  try {
    const entries = await readdir(join(trellisDir, 'spec'), { recursive: true })
    specFiles = entries.filter((name) => /\.[a-z0-9]+$/i.test(name)).length
  } catch {
    specFiles = 0
  }
  const tasks = []
  if (initialized) {
    let entries = []
    try {
      entries = await readdir(join(trellisDir, 'tasks'), { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const raw = await readJson(join(trellisDir, 'tasks', entry.name, 'task.json'), warnings)
      if (raw) {
        tasks.push({
          ...toTask(raw),
          ledgerDir: join(trellisDir, 'tasks', entry.name, 'review'),
        })
      }
    }
    tasks.sort((a, b) => a.id.localeCompare(b.id))
  }
  const localDir = join(root, '.dsh', 'claude-review', 'ledger', 'review')
  let ledger = { dir: null, kind: null }
  if (initialized && tasks.length > 0) {
    ledger = { dir: tasks[0].ledgerDir, kind: 'trellis' }
  } else {
    const probe = await readText(join(localDir, 'history.jsonl'), [])
    if (probe !== null) ledger = { dir: localDir, kind: 'local' }
  }
  return {
    trellis: {
      initialized,
      version: versionText === null ? null : versionText.trim(),
      specFiles,
    },
    tasks,
    ledger,
    warnings,
  }
}

export async function readLedger(dir) {
  const warnings = []
  if (!dir) return { rounds: [], dispositions: [], latest: null, warnings }
  const history = await readJsonl(join(dir, 'history.jsonl'), warnings)
  const rounds = history.map((row, index) => normalizeRound(row, index + 1))
  const maxRound = rounds.reduce((max, item) => (item.round > max ? item.round : max), 0)
  const latest = maxRound > 0 ? await readJson(join(dir, `review-${maxRound}.json`), warnings) : null
  const dispositions = (await readJsonl(join(dir, 'dispositions.jsonl'), warnings)).map((row) => ({
    round: Number.isInteger(row?.round) ? row.round : null,
    key: typeof row?.key === 'string' ? row.key : null,
    index: Number.isInteger(row?.index) ? row.index : null,
    status: row?.status == null ? null : String(row.status),
  }))
  return { rounds, dispositions, latest, warnings }
}
