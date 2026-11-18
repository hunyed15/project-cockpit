window.__ModuleLoader__.load({
  id: '@hunyed15/project-cockpit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 左栏入口 id 与中央面板 key 必须严格同名，否则 selectPanel 会抛错。
    // 单一常量，测试断言二者同源。
    const PANEL_ID = 'project-cockpit'
    const API = '/project-cockpit/api'
    const SENT_KEY = 'project-cockpit:last-sent'
    const POLL_MS = 8000
    const REQUEST_TIMEOUT_MS = 10000

    const STATE_TEXT = { done: '已完成', current: '当前', pending: '未开始' }
    const TASK_STATUS = { in_progress: '进行中', completed: '已完成', planning: '未开始', unknown: '未知' }
    const VERDICT = { fix: '有需修复项', pass: '通过', fail: '未通过', 'gate-blocked': '门禁未过' }
    // 第一版里这两道门恒为 pending：说"卡在"会让人以为是自己没做完，
    // 实际是功能还没接入。
    const LATER_GATES = new Set(['验效果', '发出去'])

    // 面板是 root scope，拿不到 session，也没有任何公开的「向会话注入用户消息」API
    // （Host 侧 commands.execute 只跑斜杠命令、不会把文本发给模型）。
    // 所以行动层走已验证的路径：面板把指令放进这个模块级槽位 → 跳到对话 →
    // 由 conversation.input.dock 上的常驻条用 inputActions.setDraft/submit 真正发出去。
    const pending = { value: null, listeners: new Set() }
    const setPending = (value) => {
      pending.value = value
      for (const listener of pending.listeners) listener()
    }
    const usePending = () => {
      const [value, setValue] = React.useState(pending.value)
      React.useEffect(() => {
        const listener = () => setValue(pending.value)
        pending.listeners.add(listener)
        return () => pending.listeners.delete(listener)
      }, [])
      return value
    }

    // apply 里注入的 layout 服务；面板按钮用它跳回对话。
    let layout = null

    // 发送痕迹：只在本地记「什么时候点过发送」，不伪造账本状态。
    // 用可订阅的模块级 store，否则 markSent 只写 localStorage，
    // 同一次挂载内界面永远显示不出「上次发送」。
    const readSent = () => {
      try {
        return JSON.parse(window.localStorage.getItem(SENT_KEY) || '{}') || {}
      } catch {
        return {}
      }
    }
    const sentStore = { value: readSent(), listeners: new Set() }
    const markSent = (kind) => {
      if (!kind) return
      try {
        const all = { ...sentStore.value, [kind]: new Date().toISOString() }
        window.localStorage.setItem(SENT_KEY, JSON.stringify(all))
        sentStore.value = all
        for (const listener of sentStore.listeners) listener()
      } catch {
        // 隐私模式/配额满：痕迹功能失效，但不影响发送
      }
    }
    const useSent = () => {
      const [value, setValue] = React.useState(sentStore.value)
      React.useEffect(() => {
        const listener = () => setValue(sentStore.value)
        sentStore.listeners.add(listener)
        return () => sentStore.listeners.delete(listener)
      }, [])
      return value
    }
    const formatTime = (value) => {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    const CSS = `
.pc-root { height:100%; overflow:auto; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base);
  font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; font-size:13px; line-height:1.55; }
.pc-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.pc-head { position:sticky; top:0; z-index:2; background:var(--dsw-alias-bg-base); border-bottom:1px solid var(--dsw-alias-border-l1); }
.pc-head-inner { max-width:1120px; margin:0 auto; padding:14px 24px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.pc-body { max-width:1120px; margin:0 auto; padding:16px 24px 32px; display:flex; flex-direction:column; gap:12px; }
h1.pc-name { margin:0; font-size:16px; font-weight:600; }
.pc-muted { color:var(--dsw-alias-label-secondary); }
.pc-chip { border:1px solid currentColor; border-radius:6px; padding:1px 8px; font-size:12px; font-weight:600; white-space:nowrap; }
.pc-chip-bad { color:var(--dsw-alias-state-error-primary); }
.pc-chip-ok { color:var(--dsw-alias-state-success-primary); }
.pc-chip-unknown { color:var(--dsw-alias-label-secondary); border-style:dashed; }
.pc-time { font-variant-numeric:tabular-nums; }
.pc-spacer { flex:1 1 auto; }
.pc-banner { max-width:1120px; margin:12px auto 0; padding:8px 14px; border-radius:8px; display:flex; gap:12px;
  align-items:flex-start; justify-content:space-between; flex-wrap:wrap; font-size:12px;
  border:1px solid var(--dsw-alias-state-warn-primary); color:var(--dsw-alias-state-warn-primary); }
.pc-card { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:14px 16px; }
h2.pc-card-title { margin:0 0 10px; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary);
  padding-left:8px; border-left:2px solid var(--dsw-alias-border-l2); line-height:1.4; }
.pc-action-label { font-size:16px; font-weight:600; color:var(--dsw-alias-brand-primary); }
.pc-action-text { margin:6px 0 4px; white-space:pre-wrap; overflow-wrap:anywhere; }
.pc-action-row { display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap; }
.pc-gate-summary { font-size:14px; font-weight:600; margin-bottom:10px; }
.pc-progress { display:flex; gap:4px; margin:0 0 8px; }
.pc-seg { flex:1 1 0; height:6px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); }
.pc-seg-done { background:var(--dsw-alias-state-success-primary); }
.pc-seg-current { background:var(--dsw-alias-state-warn-primary); }
.pc-gate-list { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
.pc-gate { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; padding:6px 8px; border-radius:6px; }
.pc-gate-current { background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.pc-gate-name { font-weight:600; }
.pc-gate-state { font-size:11px; color:var(--dsw-alias-label-secondary); }
.pc-gate-basis { font-size:12px; color:var(--dsw-alias-label-secondary); line-height:1.45; }
.pc-table-wrap { overflow-x:auto; }
.pc-table { width:100%; border-collapse:collapse; }
.pc-table caption { text-align:left; }
.pc-table th { text-align:left; font-weight:600; font-size:12px; color:var(--dsw-alias-label-secondary);
  padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); white-space:nowrap; }
.pc-table td { padding:8px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.pc-table th:first-child, .pc-table td:first-child { width:100%; overflow-wrap:anywhere; }
.pc-table th + th, .pc-table td + td { white-space:nowrap; }
.pc-bad { color:var(--dsw-alias-state-error-primary); font-weight:600; }
.pc-ok { color:var(--dsw-alias-state-success-primary); }
.pc-btn { border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary);
  border-radius:6px; padding:5px 12px; cursor:pointer; font-size:12px; font-family:inherit; }
.pc-btn:hover:not(:disabled) { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
.pc-btn:disabled { opacity:.55; cursor:default; }
.pc-btn-primary { background:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-bg-base); font-weight:600; }
.pc-btn-primary:hover:not(:disabled) { color:var(--dsw-alias-bg-base); filter:brightness(1.06); }
.pc-btn-link { border:0; background:transparent; color:var(--dsw-alias-brand-primary); cursor:pointer;
  font-size:12px; padding:2px 4px; font-family:inherit; }
.pc-btn:focus-visible, .pc-btn-link:focus-visible, .pc-select:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.pc-select { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:inherit;
  border-radius:6px; padding:4px 8px; font-size:12px; font-family:inherit; max-width:100%; }
.pc-dock { max-width:1120px; margin:0 auto 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px;
  background:var(--dsw-alias-bg-layer-1); padding:10px 14px; display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.pc-dock-main { flex:1 1 320px; min-width:0; }
.pc-dock-label { font-weight:600; color:var(--dsw-alias-brand-primary); }
.pc-dock-actions { display:flex; gap:8px; flex-wrap:wrap; }
@media (max-width:640px) {
  .pc-head-inner, .pc-body { padding-left:14px; padding-right:14px; }
}
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
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          ...(controller ? { signal: controller.signal } : {}),
        })
        const text = await response.text()
        let body = null
        try {
          body = text === '' ? null : JSON.parse(text)
        } catch {
          body = null
        }
        if (!response.ok) throw new Error((body && body.error) || `HTTP ${response.status}`)
        // 200 + 非 JSON（登录页拦截、代理改写）必须报错，否则界面会永远停在"加载中"。
        if (body === null) throw new Error('响应不是 JSON，可能被登录页或代理拦截')
        return body
      } catch (error) {
        if (error && error.name === 'AbortError') throw new Error('请求超时')
        throw error
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    function useCockpit() {
      const [workspaces, setWorkspaces] = React.useState([])
      const [selected, setSelected] = React.useState('')
      const [model, setModel] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [goodAt, setGoodAt] = React.useState(null)
      const seq = React.useRef(0)

      // 序号守卫：轮询与手动刷新并发时，旧响应不许覆盖新响应。
      const loadPanel = React.useCallback(async (path, silent) => {
        const mine = ++seq.current
        if (!silent) setLoading(true)
        try {
          const next = await getJson(`${API}/panel${path ? `?path=${encodeURIComponent(path)}` : ''}`)
          if (mine !== seq.current) return
          setModel(next)
          setError('')
          setGoodAt(Date.now())
        } catch (failure) {
          if (mine !== seq.current) return
          setError(String(failure && failure.message ? failure.message : failure))
        } finally {
          if (mine === seq.current) setLoading(false)
        }
      }, [])

      // 列表只拉一次：绝不覆盖用户已经选中的项目。
      React.useEffect(() => {
        let alive = true
        getJson(`${API}/workspaces`)
          .then((list) => {
            if (!alive) return
            const items = Array.isArray(list) ? list : []
            setWorkspaces(items)
            setSelected((prev) => prev || (items[0] ? items[0].path : ''))
            if (items.length === 0) {
              setError('没有已注册的工作区，先在一个目录里打开会话')
              setLoading(false)
            }
          })
          .catch((failure) => {
            if (!alive) return
            setError(String(failure && failure.message ? failure.message : failure))
            setLoading(false)
          })
        return () => {
          alive = false
        }
      }, [])

      // 面板与轮询只跟随选中的项目。
      React.useEffect(() => {
        if (!selected) return undefined
        let alive = true
        loadPanel(selected, false)
        const timer = setInterval(() => {
          if (alive) loadPanel(selected, true)
        }, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [selected, loadPanel])

      const refresh = React.useCallback(() => {
        if (selected) loadPanel(selected, false)
      }, [loadPanel, selected])

      return { workspaces, selected, setSelected, model, error, loading, goodAt, refresh }
    }

    function GateList(props) {
      const gates = props.gates
      return h(
        'div',
        { className: 'pc-gate-list' },
        gates.map((gate) =>
          h(
            'div',
            {
              key: gate.name,
              className: `pc-gate pc-gate-${gate.state}`,
              'aria-current': gate.state === 'current' ? 'step' : undefined,
            },
            h('span', { className: 'pc-gate-name' }, gate.name),
            h('span', { className: 'pc-gate-state' }, STATE_TEXT[gate.state] || gate.state),
            h('span', { className: 'pc-gate-basis' }, gate.basis),
          ),
        ),
      )
    }

    function TaskRow(props) {
      const task = props.task
      const bugs = task.bugs || {}
      const blocking = bugs.blocking
      const verdict = bugs.lastVerdict ? VERDICT[bugs.lastVerdict] || bugs.lastVerdict : ''
      return h(
        'tr',
        null,
        h('td', null, task.title || task.id),
        h('td', null, TASK_STATUS[task.status] || task.status),
        h('td', null, task.priority || '—'),
        // 读不到就当"未统计"（—），不能显示成绿色的 0：
        // "账本里没问题"和"根本没读到账本"是两件事。
        blocking == null
          ? h('td', { className: 'pc-muted' }, '—')
          : h('td', { className: blocking > 0 ? 'pc-bad' : 'pc-ok' }, String(blocking)),
        h('td', null, bugs.lastRound == null ? '—' : `#${bugs.lastRound}${verdict ? ` ${verdict}` : ''}`),
      )
    }

    /**
     * 对话输入框上方的常驻条：只有面板点过「去对话发送」才出现。
     * 这里才拿得到 inputActions（session scope），面板拿不到。
     */
    function NextActionDock(props) {
      const value = usePending()
      if (!value) return null
      const actions = props.inputActions
      const fill = () => {
        if (actions) actions.setDraft(value.instruction)
        setPending(null)
      }
      const send = () => {
        if (!actions) return
        actions.setDraft(value.instruction)
        actions.submit()
        markSent(value.kind)
        setPending(null)
      }
      return h(
        'div',
        { className: 'pc-dock' },
        h(
          'div',
          { className: 'pc-dock-main' },
          h('div', { className: 'pc-dock-label' }, `项目驾驶舱 · ${value.label}`),
          h('div', null, value.instruction),
          h('div', { className: 'pc-muted' }, value.reason),
        ),
        h(
          'div',
          { className: 'pc-dock-actions' },
          h('button', { className: 'pc-btn pc-btn-primary', onClick: send }, '发送'),
          h('button', { className: 'pc-btn', onClick: fill }, '填入输入框'),
          h('button', { className: 'pc-btn', onClick: () => setPending(null) }, '忽略'),
        ),
      )
    }

    function Page() {
      const { workspaces, selected, setSelected, model, error, loading, goodAt, refresh } = useCockpit()
      const [gatesOpen, setGatesOpen] = React.useState(false)
      const [copied, setCopied] = React.useState(false)
      const sent = useSent()

      const copyInstruction = () => {
        if (!model) return
        const write = navigator.clipboard && navigator.clipboard.writeText
        if (!write) return
        write.call(navigator.clipboard, model.nextAction.instruction).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          },
          () => setCopied(false),
        )
      }

      const sendToAgent = () => {
        if (!model) return
        setPending(model.nextAction)
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('conversation')
      }

      const style = h('style', { key: 'pc-css' }, CSS)
      const totals = model && model.totals ? model.totals : null
      const blocking = totals ? totals.blocking : 0
      const current = model ? model.gates.find((gate) => gate.state === 'current') : null
      const lastSent = model && model.nextAction ? sent[model.nextAction.kind] : null

      // 数据不完整时不能给绿色结论：warnings 说"数字可能偏低"、error 说"这是旧数据"，
      // 而 chip 却显示"无阻塞"，就是首屏自相矛盾。
      const degraded = Boolean(error) || (model && model.warnings && model.warnings.length > 0)
      const chipClass = degraded
        ? 'pc-chip pc-chip-unknown'
        : blocking > 0
          ? 'pc-chip pc-chip-bad'
          : 'pc-chip pc-chip-ok'
      const chipText = degraded
        ? '状态待确认'
        : blocking > 0
          ? `待修 ${blocking}`
          : '无待修问题'

      // "验效果/发出去"第一版恒 pending：那是功能没接入，不是用户卡住了。
      const gateSummary = !current
        ? '七道门全部完成'
        : LATER_GATES.has(current.name)
          ? `下一阶段：${current.name}（第二版接入，当前不影响）`
          : `卡在「${current.name}」：${current.basis}`

      const header = h(
        'header',
        { className: 'pc-head' },
        h(
          'div',
          { className: 'pc-head-inner' },
          h('h1', { className: 'pc-name' }, model && model.project ? model.project.name : '项目'),
          model ? h('span', { className: chipClass, role: 'status' }, chipText) : null,
          workspaces.length > 1
            ? h(
                'select',
                {
                  className: 'pc-select',
                  value: selected,
                  'aria-label': '项目工作区',
                  onChange: (event) => setSelected(event.target.value),
                },
                workspaces.map((item) => h('option', { key: item.path, value: item.path }, item.title || item.path)),
              )
            : null,
          h('span', { className: 'pc-spacer' }),
          // 时间戳不挂 aria-live：generatedAt 每 8 秒都变，会把读屏变成节拍器。
          model && model.generatedAt
            ? h('span', { className: 'pc-muted pc-time' }, `更新于 ${formatTime(model.generatedAt)}`)
            : null,
          loading ? h('span', { className: 'pc-sr', role: 'status' }, '正在刷新') : null,
          h(
            'button',
            { className: 'pc-btn', onClick: refresh, disabled: loading, 'aria-busy': loading ? 'true' : 'false' },
            '刷新',
          ),
        ),
      )

      // 错误不换掉整页：有旧数据时降级为横幅，并明确标出数据时间。
      const banner = error
        ? h(
            'div',
            { className: 'pc-banner', role: 'status', 'aria-live': 'polite' },
            h(
              'span',
              null,
              model && goodAt
                ? `刷新失败，下面是 ${formatTime(goodAt)} 的数据：${error}`
                : `读取面板失败：${error}`,
            ),
            h('button', { className: 'pc-btn', onClick: refresh, disabled: loading }, '重试'),
          )
        : null

      let cards = null
      if (model) {
        cards = h(
          React.Fragment,
          null,
          model.warnings && model.warnings.length > 0
            ? h(
                'section',
                { className: 'pc-banner', role: 'status' },
                h(
                  'span',
                  null,
                  `数据有 ${model.warnings.length} 处异常，下面的数字可能偏低：${model.warnings.slice(0, 3).join('；')}` +
                    (model.warnings.length > 3 ? `（还有 ${model.warnings.length - 3} 处未显示）` : ''),
                ),
              )
            : null,
          model.truncated
            ? h(
                'section',
                { className: 'pc-banner', role: 'status' },
                h('span', null, '任务过多，只显示前 200 个；卡点数与阶段门仍按全部任务计算。'),
              )
            : null,
          h(
            'section',
            { className: 'pc-card' },
            h('h2', { className: 'pc-card-title' }, '下一步'),
            h('div', { className: 'pc-action-label' }, model.nextAction.label),
            h('div', { className: 'pc-action-text' }, model.nextAction.instruction),
            h('div', { className: 'pc-muted' }, model.nextAction.reason),
            lastSent ? h('div', { className: 'pc-muted' }, `上次发送 ${formatTime(lastSent)} · 等账本更新`) : null,
            h(
              'div',
              { className: 'pc-action-row' },
              h('button', { className: 'pc-btn pc-btn-primary', onClick: sendToAgent }, '去对话发送'),
              h('button', { className: 'pc-btn', onClick: copyInstruction }, copied ? '已复制' : '复制指令'),
            ),
          ),
          h(
            'section',
            { className: 'pc-card' },
            h(
              'h2',
              {
                className: 'pc-card-title',
                title: `trellis ${model.trellis.version || '?'} · spec ${model.trellis.specFiles} 个文件 · ${model.tasks.length} 个任务`,
              },
              '阶段门（推断，非声明）',
            ),
            h('div', { className: 'pc-gate-summary' }, gateSummary),
            h(
              'div',
              { className: 'pc-progress', 'aria-hidden': 'true' },
              model.gates.map((gate) => h('span', { key: gate.name, className: `pc-seg pc-seg-${gate.state}` })),
            ),
            h(
              'button',
              {
                className: 'pc-btn-link',
                onClick: () => setGatesOpen((open) => !open),
                'aria-expanded': gatesOpen ? 'true' : 'false',
              },
              gatesOpen ? '收起七道门的依据' : '展开七道门的依据',
            ),
            gatesOpen ? h(GateList, { gates: model.gates }) : null,
          ),
          h(
            'section',
            { className: 'pc-card' },
            h('h2', { className: 'pc-card-title' }, '任务'),
            // 窄屏时让表格自己横向滚动，而不是把整页（连同 sticky 头）拖走
            h(
              'div',
              { className: 'pc-table-wrap' },
              h(
                'table',
                { className: 'pc-table' },
                h('caption', { className: 'pc-sr' }, '项目任务与审核状态'),
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { scope: 'col' }, '任务'),
                    h('th', { scope: 'col' }, '状态'),
                    h('th', { scope: 'col' }, '优先级'),
                    h('th', { scope: 'col' }, '待修'),
                    h('th', { scope: 'col' }, '最近轮次'),
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
          ),
        )
      }

      return h(
        React.Fragment,
        null,
        style,
        h(
          'div',
          { className: 'pc-root' },
          header,
          banner,
          h(
            'main',
            { className: 'pc-body' },
            loading && !model ? h('div', { className: 'pc-card pc-muted', role: 'status' }, '加载中…') : null,
            cards,
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        layout = ctx.layout || null
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Page))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '项目' },
            Icon,
          ),
        )
        // 行动层的落点：session scope 才有 inputActions
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            { name: 'conversation.input.dock', id: 'project-cockpit-next', order: 30, label: () => '项目下一步' },
            NextActionDock,
          ),
        )
      },
    }
  },
})
