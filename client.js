window.__ModuleLoader__.load({
  id: '@hunyed15/project-cockpit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 左栏入口 id 与中央面板 key 必须严格同名，否则 selectPanel 会抛错。
    // 单一常量，测试断言二者同源。
    const PANEL_ID = 'project-cockpit'
    const API = '/project-cockpit/api'

    const CSS = `
.pc-root { height:100%; overflow:auto; padding:0 0 32px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base);
  font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; font-size:13px; line-height:1.55; }
.pc-head { position:sticky; top:0; z-index:2; background:var(--dsw-alias-bg-base); border-bottom:1px solid var(--dsw-alias-border-l1); }
.pc-head-inner { max-width:1120px; margin:0 auto; padding:16px 24px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.pc-body { max-width:1120px; margin:0 auto; padding:16px 24px; display:flex; flex-direction:column; gap:12px; }
.pc-name { font-size:16px; font-weight:600; }
.pc-muted { color:var(--dsw-alias-label-secondary); }
.pc-card { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:14px 16px; }
.pc-card-title { font-size:12px; letter-spacing:.02em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); margin-bottom:8px; }
.pc-action-label { font-size:15px; font-weight:600; color:var(--dsw-alias-brand-primary); }
.pc-action-text { margin:6px 0 4px; }
.pc-gates { display:flex; flex-wrap:wrap; gap:8px; }
.pc-gate { display:flex; flex-direction:column; gap:2px; border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:4px 12px; }
.pc-gate-current { border-color:var(--dsw-alias-state-warn-primary); }
.pc-gate-done { color:var(--dsw-alias-state-success-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); }
.pc-gate-pending { color:var(--dsw-alias-label-secondary); }
.pc-gate-basis { font-size:11px; color:var(--dsw-alias-label-secondary); }
.pc-table { width:100%; border-collapse:collapse; }
.pc-table th { text-align:left; font-weight:600; font-size:12px; color:var(--dsw-alias-label-secondary); padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.pc-table td { padding:8px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.pc-bad { color:var(--dsw-alias-state-error-primary); font-weight:600; }
.pc-ok { color:var(--dsw-alias-state-success-primary); }
.pc-btn { border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary);
  border-radius:6px; padding:5px 12px; cursor:pointer; font-size:12px; }
.pc-btn:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
.pc-select { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:inherit; border-radius:6px; padding:4px 8px; font-size:12px; }
`

    function Icon(props) {
      const size = props && props.size ? props.size : 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M1.5 6.5h13', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M5 9.5h3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    async function getJson(url) {
      const response = await fetch(url, { credentials: 'same-origin' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error((body && body.error) || `HTTP ${response.status}`)
      return body
    }

    function useCockpit() {
      const [workspaces, setWorkspaces] = React.useState([])
      const [selected, setSelected] = React.useState('')
      const [model, setModel] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)

      const loadPanel = React.useCallback(async (path) => {
        try {
          const query = path ? `?path=${encodeURIComponent(path)}` : ''
          const next = await getJson(`${API}/panel${query}`)
          setModel(next)
          setError('')
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        getJson(`${API}/workspaces`)
          .then((list) => {
            if (!alive) return
            const items = Array.isArray(list) ? list : []
            setWorkspaces(items)
            const first = items.length > 0 ? items[0].path : ''
            setSelected(first)
            return loadPanel(first)
          })
          .catch((failure) => {
            if (!alive) return
            setError(String(failure && failure.message ? failure.message : failure))
            setLoading(false)
          })
        const timer = setInterval(() => {
          if (alive) loadPanel(selected)
        }, 8000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [loadPanel, selected])

      const refresh = React.useCallback(() => {
        setLoading(true)
        loadPanel(selected)
      }, [loadPanel, selected])

      return { workspaces, selected, setSelected, model, error, loading, refresh }
    }

    function Gate(props) {
      const gate = props.gate
      return h(
        'div',
        { className: `pc-gate pc-gate-${gate.state}` },
        h('span', null, gate.name),
        h('span', { className: 'pc-gate-basis' }, gate.basis),
      )
    }

    function TaskRow(props) {
      const task = props.task
      const bugs = task.bugs || {}
      return h(
        'tr',
        null,
        h('td', null, task.title || task.id),
        h('td', null, task.status),
        h('td', null, task.priority || '—'),
        h('td', { className: bugs.blocking > 0 ? 'pc-bad' : 'pc-ok' }, String(bugs.blocking == null ? 0 : bugs.blocking)),
        h('td', null, bugs.lastRound == null ? '—' : `#${bugs.lastRound} ${bugs.lastVerdict || ''}`),
      )
    }

    function Page() {
      const { workspaces, selected, setSelected, model, error, loading, refresh } = useCockpit()
      const style = h('style', { key: 'pc-css' }, CSS)

      const header = h(
        'div',
        { className: 'pc-head' },
        h(
          'div',
          { className: 'pc-head-inner' },
          h('span', { className: 'pc-name' }, model && model.project ? model.project.name : '项目'),
          workspaces.length > 1
            ? h(
                'select',
                {
                  className: 'pc-select',
                  value: selected,
                  onChange: (event) => setSelected(event.target.value),
                },
                workspaces.map((item) => h('option', { key: item.path, value: item.path }, item.title || item.path)),
              )
            : null,
          model && model.trellis
            ? h(
                'span',
                { className: 'pc-muted' },
                model.trellis.initialized
                  ? `trellis ${model.trellis.version || ''} · spec ${model.trellis.specFiles} · ${model.tasks.length} 个任务`
                  : '未初始化 trellis',
              )
            : null,
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'pc-btn', onClick: refresh }, loading ? '刷新中…' : '刷新'),
        ),
      )

      let body
      if (error) {
        body = h(
          'div',
          { className: 'pc-body' },
          h('div', { className: 'pc-card' }, h('div', { className: 'pc-card-title' }, '读取失败'), h('div', null, error)),
        )
      } else if (!model) {
        body = h('div', { className: 'pc-body' }, h('div', { className: 'pc-card pc-muted' }, '加载中…'))
      } else {
        body = h(
          'div',
          { className: 'pc-body' },
          h(
            'div',
            { className: 'pc-card' },
            h('div', { className: 'pc-card-title' }, '下一步'),
            h('div', { className: 'pc-action-label' }, model.nextAction.label),
            h('div', { className: 'pc-action-text' }, model.nextAction.instruction),
            h('div', { className: 'pc-muted' }, model.nextAction.reason),
          ),
          h(
            'div',
            { className: 'pc-card' },
            h('div', { className: 'pc-card-title' }, '阶段门（推断，非声明）'),
            h(
              'div',
              { className: 'pc-gates' },
              model.gates.map((gate) => h(Gate, { key: gate.name, gate })),
            ),
          ),
          h(
            'div',
            { className: 'pc-card' },
            h('div', { className: 'pc-card-title' }, '任务'),
            h(
              'table',
              { className: 'pc-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, '任务'),
                  h('th', null, '状态'),
                  h('th', null, '优先级'),
                  h('th', null, 'blocking'),
                  h('th', null, '最近轮次'),
                ),
              ),
              h(
                'tbody',
                null,
                model.tasks.length === 0
                  ? h('tr', null, h('td', { colSpan: 5, className: 'pc-muted' }, '还没有任务'))
                  : model.tasks.map((task) => h(TaskRow, { key: task.id, task })),
              ),
            ),
          ),
          model.warnings && model.warnings.length > 0
            ? h(
                'div',
                { className: 'pc-card' },
                h('div', { className: 'pc-card-title' }, `数据异常 ${model.warnings.length} 处`),
                model.warnings.slice(0, 5).map((line, index) => h('div', { key: index, className: 'pc-muted' }, line)),
              )
            : null,
        )
      }

      return h(React.Fragment, null, style, h('div', { className: 'pc-root' }, header, body))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Page))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '项目' },
            Icon,
          ),
        )
      },
    }
  },
})
