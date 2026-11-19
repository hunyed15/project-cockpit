// Local preview harness for this plugin's client half.
//
// Why: the DSH Web GUI requires an auth token, so an agent cannot open it. This
// serves the real client.js with real React and real CSS on localhost, computes
// the panel model with the package's own lib/, and lets you screenshot 360px /
// 1200px / degraded states without touching the running DSH.
//
// Usage:
//   npm --prefix tools/preview install   # once: react + react-dom
//   node tools/preview/server.mjs        # then open http://127.0.0.1:4711/
//
// Query params:
//   scenario=real|blocking|warnings|truncated|manytasks|error|nonjson|empty
//   slot=main|dock|both     (both also exercises the panel → dock action chain)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '../..')
const PREVIEW_DEPS = HERE
const PROJECT = process.env.PROJECT_DIR || 'D:/Coding/dsh-plugins/claude-code-review'
const PORT = Number(process.env.PORT || 4711)

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><title>cockpit-preview</title>
<link rel="stylesheet" href="/tokens.css">
<style>html,body{margin:0;background:var(--dsw-alias-bg-base)}#root{min-height:420px}#dock{padding:0 0 8px}</style>
</head><body>
<div id="root"></div>
<div id="dock"></div>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/harness.js"></script>
<script src="/client.js"></script>
<script>window.__harness.boot(new URLSearchParams(location.search).get('slot') || 'main')</script>
</body></html>`

const harness = `(function () {
  var captured = null
  window.__ModuleLoader__ = { load: function (def) { captured = def } }
  var regs = []
  var slots = {
    inject: function (name, cb) { cb(); return function () {} },
    register: function (opts, Comp) { regs.push({ opts: opts, Comp: Comp }); return function () {} },
  }
  window.__harness = {
    fakeInput: { inserted: null, submitted: false,
      setDraft: function (t) { this.inserted = t }, submit: function () { this.submitted = true } },
    boot: function (which) {
      var ctx = {
        slots: slots,
        layout: { selectPanel: function () {}, openRightbar: function () {}, closeRightbar: function () {} },
        get: function () { return undefined }, logger: { warn: function () {} },
        effect: function (fn) { return fn() },
      }
      var mod = captured.factory(function (id) {
        if (id === 'react') return window.React
        throw new Error('unknown module ' + id)
      })
      mod.apply(ctx)
      function find(name) { return regs.filter(function (r) { return r.opts.name === name })[0] }
      if (which === 'main' || which === 'both') {
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(find('main').Comp, {}))
      }
      if (which === 'dock' || which === 'both') {
        ReactDOM.createRoot(document.getElementById('dock')).render(
          React.createElement(find('conversation.input.dock').Comp, { inputActions: window.__harness.fakeInput }))
        setTimeout(function () {
          var btn = document.querySelector('.pc-btn-primary')
          if (btn) { btn.click(); setTimeout(function () {
            var dock = document.querySelector('.pc-dock')
            var send = dock && dock.querySelectorAll('.pc-btn')[0]
            if (send) send.click()
          }, 1200) }
        }, 1500)
      }
      document.title = 'ready:' + regs.map(function (r) { return r.opts.name }).join(',')
    },
  }
})()`

// 近似的 DSH 浅色主题变量。只用于本地预览排版；
// 颜色对比度结论必须在真机上用真实 token 复核。
const tokens = `:root{
--dsw-alias-bg-base:#ffffff; --dsw-alias-bg-layer-1:#fbfbfc; --dsw-alias-bg-layer-2:#f2f3f5;
--dsw-alias-border-l1:#e3e5e8; --dsw-alias-border-l2:#cfd3d8;
--dsw-alias-label-primary:#1b1d21; --dsw-alias-label-secondary:#6b7280;
--dsw-alias-brand-primary:#2f6fed;
--dsw-alias-state-success-primary:#17864a; --dsw-alias-state-warn-primary:#a86a00;
--dsw-alias-state-error-primary:#c9302c; --dsw-alias-state-idle-primary:#9aa0a6;
}`

let currentScenario = 'real'

async function loadModel() {
  const reader = await import(pathToFileURL(join(PKG, 'lib/reader.js')).href)
  const panel = await import(pathToFileURL(join(PKG, 'lib/panel.js')).href)
  const evidence = await reader.readEvidence(PROJECT)
  return { model: panel.buildPanelModel(evidence), panel, reader }
}

const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate')
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/') currentScenario = url.searchParams.get('scenario') || 'real'
  const scenario = currentScenario

  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }
    if (url.pathname === '/harness.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return res.end(harness)
    }
    if (url.pathname === '/tokens.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      return res.end(tokens)
    }
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return res.end(await readFile(join(PKG, 'client.js'), 'utf8'))
    }
    if (url.pathname === '/react.js' || url.pathname === '/react-dom.js') {
      const file = url.pathname === '/react.js'
        ? 'node_modules/react/umd/react.production.min.js'
        : 'node_modules/react-dom/umd/react-dom.production.min.js'
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return res.end(await readFile(join(PREVIEW_DEPS, file), 'utf8'))
    }

    if (url.pathname === '/project-cockpit/api/workspaces') {
      if (scenario === 'empty') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        return res.end('[]')
      }
      const name = PROJECT.split(/[\\/]/).filter(Boolean).pop() || 'project'
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify([{ id: 'w1', title: name, path: PROJECT }]))
    }

    if (url.pathname === '/project-cockpit/api/panel') {
      if (scenario === 'error') {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ ok: false, error: 'workspace-not-allowed' }))
      }
      if (scenario === 'nonjson') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end('<html>login page</html>')
      }
      const { model, panel } = await loadModel()
      if (scenario === 'warnings') {
        model.warnings = [
          'review-3.json 第 12 行不是合法 JSON，已跳过',
          'dispositions.jsonl 第 4 行不是合法 JSON，已跳过',
          '账本目录被锁定',
          '旧报告缺少 meta.failOn',
        ]
      }
      if (scenario === 'truncated') {
        model.truncated = true
        model.taskLimit = 200
      }
      if (scenario === 'blocking') {
        const gates = await import(pathToFileURL(join(PKG, 'lib/gates.js')).href)
        const next = await import(pathToFileURL(join(PKG, 'lib/next-action.js')).href)
        model.totals = { ...model.totals, blocking: 3, fixed: 1, open: 4, lastVerdict: 'fix' }
        model.gates = gates.deriveGates({
          hasPrd: true,
          specFiles: model.trellis.specFiles,
          codeFiles: 1,
          hasActiveTask: true,
          rounds: model.totals.rounds,
          blocking: 3,
        })
        model.nextAction = next.nextAction({
          initialized: true, blocking: 3, fixed: 1,
          lastRound: model.totals.lastRound, lastVerdict: 'fix',
        })
        model.tasks = model.tasks.map((task) => ({
          ...task,
          status: 'in_progress',
          bugs: { ...task.bugs, blocking: 3, fixed: 1, open: 4, lastVerdict: 'fix' },
        }))
      }
      if (scenario === 'manytasks') {
        const base = model.tasks[0] || { id: 'x', title: '任务', status: 'in_progress', priority: 'P1' }
        model.tasks = Array.from({ length: 12 }, (_, index) => ({
          ...base,
          id: `t${index}`,
          title: index === 2
            ? '一个特别特别长的任务标题用来测试表格在窄屏下的换行与溢出行为是否会把整页拖宽'
            : `任务 ${index + 1}`,
          status: index % 3 === 0 ? 'in_progress' : index % 3 === 1 ? 'completed' : 'planning',
          bugs: { blocking: index % 4 === 0 ? 2 : 0, open: 0, fixed: 0, lastRound: 12, lastVerdict: 'fix' },
        }))
      }
      void panel
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify(model))
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${PORT}/   project=${PROJECT}`)
})
