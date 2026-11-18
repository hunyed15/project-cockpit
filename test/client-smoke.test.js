import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('client.js 用宿主的模块加载器注册，且 id 与包名一致', async () => {
  const source = await read('client.js')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id: '@hunyed15\/project-cockpit'/)
})

test('main key 与 sidebar.panellist id 同源常量', async () => {
  const source = await read('client.js')
  assert.match(source, /const PANEL_ID = 'project-cockpit'/)
  assert.ok(source.includes('key: PANEL_ID'), 'main 必须用 PANEL_ID')
  assert.ok(source.includes('id: PANEL_ID'), 'sidebar.panellist 必须用 PANEL_ID')
})

test('注册两个插槽：main 与 sidebar.panellist', async () => {
  const source = await read('client.js')
  for (const slot of ['main', 'sidebar.panellist']) {
    assert.ok(source.includes(`'${slot}'`), `未注册 ${slot}`)
  }
})

test('label 用 thunk 以跟随语言', async () => {
  const source = await read('client.js')
  assert.match(source, /label: \(\) =>/)
})

test('不追加 document.body、不建第二 React 根、不 require 宿主 UI 包', async () => {
  const source = await read('client.js')
  assert.ok(!source.includes('document.body.appendChild'))
  assert.ok(!source.includes('createRoot'))
  assert.ok(!/require\('@deepseek-ai\//.test(source))
})

test('只 fetch 本插件路由，不请求外部地址', async () => {
  const source = await read('client.js')
  assert.ok(source.includes("const API = '/project-cockpit/api'"), '路由前缀必须是本插件自己的')
  assert.ok(source.includes('${API}/panel'), '面板数据必须走 /panel')
  assert.ok(source.includes('${API}/workspaces'), '项目列表必须走 /workspaces')
  assert.ok(!/fetch\(\s*['"`]https?:/.test(source))
})

test('阶段门把 basis 投影成可读提示', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('gate.basis'), '阶段门必须展示 basis，否则推断会被当成事实')
})

test('注册对话常驻条作为行动层落点，并真的用 inputActions 发送', async () => {
  const source = await read('client.js')
  assert.ok(source.includes("'conversation.input.dock'"), '行动层必须注册到 session scope 的常驻条')
  assert.ok(source.includes('inputActions'), '必须从插槽 props 取 inputActions')
  assert.ok(source.includes('setDraft('), '必须把指令写进输入框')
  assert.ok(source.includes('submit()'), '必须真正提交，而不是只复制')
})

test('面板按钮先落槽位再跳回对话（面板是 root scope 拿不到 inputActions）', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('setPending({'), '必须把动作放进槽位')
  assert.ok(source.includes('...model.nextAction'), '槽位里要带完整动作信息')
  assert.ok(source.includes("selectPanel('conversation')"))
})

test('locale 文件含 meta.title 与 meta.description', async () => {
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const dict = JSON.parse(await read(file))
    assert.equal(typeof dict.meta.title, 'string')
    assert.ok(dict.meta.title.length > 0)
    assert.equal(typeof dict.meta.description, 'string')
    assert.ok(dict.meta.description.length > 0)
  }
})

test('工作区列表只拉一次，不覆盖用户选中的项目', async () => {
  const source = await read('client.js')
  assert.ok(
    source.includes('setSelected((prev) => prev ||'),
    '必须保留用户已选项目，否则下拉切换会被打回第一个',
  )
})

test('面板请求有序号守卫与超时，避免旧响应覆盖新响应', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('seq.current'), '缺少请求序号守卫')
  assert.ok(source.includes('AbortController'), '缺少超时中断')
  assert.ok(source.includes('请求超时'), '超时必须给用户可见的错误')
})

test('200 但非 JSON 时必须报错，不能永久停在加载中', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('响应不是 JSON'), '必须区分"非 JSON 响应"与"空数据"')
})

test('顶栏显示待修数与更新时间（totals / generatedAt 不再是死数据）', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('totals.blocking'))
  assert.ok(source.includes('generatedAt'))
  assert.ok(source.includes('待修'))
  assert.ok(source.includes('更新于'))
})

test('数据不完整时 chip 不能给绿色结论（首屏不许自相矛盾）', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('pc-chip-unknown'), '需要第三态')
  assert.ok(source.includes('状态待确认'))
  assert.ok(source.includes('const degraded'), '降级判断必须存在')
})

test('“验效果/发出去”是没接入的门，不能说成“卡在”', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('LATER_GATES'), '需要区分未接入的门')
  assert.ok(source.includes('第二版接入'), '必须说明是功能未接入而不是用户卡住')
})

test('时间戳不挂 aria-live（每 8 秒播报会变成噪音）', async () => {
  const source = await read('client.js')
  assert.ok(!/pc-time'?[^}]*aria-live/.test(source), '时间戳不得是 live region')
  assert.ok(source.includes("className: 'pc-sr', role: 'status' }, '正在刷新'"), '加载态应由独立的 sr-only 区域播报')
})

test('账本枚举翻成中文，缺失值不显示成绿色 0', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('TASK_STATUS'))
  assert.ok(source.includes('VERDICT'))
  assert.ok(source.includes("h('td', { className: 'pc-muted' }, '—')"), 'null 必须显示为 —')
  assert.ok(!source.includes('String(bugs.blocking == null ? 0'), '缺失值不得冒充 0')
})

test('主按钮文案承认它是两步中的第一步', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('去对话发送'), '文案必须与真实行为一致')
  assert.ok(!source.includes('让 AI 执行下一步'), '不得承诺它没做的事')
})

test('发送痕迹用可订阅 store，markSent 后同一次挂载就能显示', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('sentStore'))
  assert.ok(source.includes('useSent()'))
  assert.ok(source.includes('sentStore.listeners'))
})

test('待发送指令带项目身份，换项目即清空', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('projectPath:'), 'pending 必须带项目路径')
  assert.ok(source.includes('projectName:'), 'pending 必须带项目名')
  assert.ok(source.includes('setPending(null)\n      }, [selected])'), '换项目必须清空 pending')
})

test('常驻条可被聚焦并播报（跳转后焦点不落 body）', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('tabIndex: -1'))
  assert.ok(source.includes('boxRef.current.focus()'))
  assert.ok(source.includes("role: 'status',"))
})

test('空工作区是空态而不是故障：不给必然失败的重试', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('setEmpty(true)'))
  assert.ok(source.includes('还没有项目'), '需要独立空态文案')
  assert.ok(!source.includes('没有已注册的工作区，先在一个目录里打开会话'), '空态不得走 error 通道')
})

test('切换项目时标题跟下拉走，并声明下面是旧数据', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('const stale ='), '需要识别陈旧窗口')
  assert.ok(source.includes('正在切换到'), '必须声明当前展示的是上一个项目的数据')
  assert.ok(source.includes('pageTitle'), '标题必须跟选中项目走')
})

test('有 ErrorBoundary，字段缺失不会白屏', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('class Boundary extends React.Component'))
  assert.ok(source.includes('getDerivedStateFromError'))
  assert.ok(source.includes('PanelRoot'))
})

test('截断上限来自模型，不在客户端写死', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('model.taskLimit'))
  assert.ok(!source.includes('只显示前 200 个'), '不得写死 200')
})

test('展开按钮有 aria-controls，被展开内容是列表语义', async () => {
  const source = await read('client.js')
  assert.ok(source.includes("'aria-controls': 'pc-gate-details'"))
  assert.ok(source.includes("id: 'pc-gate-details'"))
  assert.ok(/h\(\s*'ol'/.test(source), '阶段门应为有序列表')
  assert.ok(/h\(\s*'li'/.test(source), '阶段门条目应为 li')
})

test('复制失败必须说出来，不能静默', async () => {
  const source = await read('client.js')
  assert.ok(source.includes("setCopyState('fail')"))
  assert.ok(source.includes('复制失败'))
  assert.ok(source.includes('copyTimer'), '定时器需要清理引用')
})

test('正文行长收窄，表格保持全宽', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('max-width:46em'))
})

test('更新区域带 aria-busy，而不是只在按钮上', async () => {
  const source = await read('client.js')
  assert.ok(source.includes("'aria-busy': loading ? 'true' : 'false' },") || source.includes("className: 'pc-body', 'aria-busy'"))
})

test('刷新失败时保留旧数据并给重试，不整页替换', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('刷新失败，下面是'), '必须有"旧数据 + 时间"的降级横幅')
  assert.ok(source.includes('重试'))
  assert.ok(source.includes("disabled: loading"), '刷新期间必须禁用，避免并发')
})

test('阶段门：一句话总结 + 进度线 + 可展开依据', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('卡在「'), '必须把当前门说成一句人话')
  assert.ok(source.includes('pc-seg'), '必须有进度线')
  assert.ok(source.includes('aria-expanded'), '展开状态必须对读屏可见')
  assert.ok(source.includes('aria-current'), '当前门必须有 aria-current')
})

test('无障碍：标题层级、表格 scope、select label、焦点样式', async () => {
  const source = await read('client.js')
  assert.ok(source.includes("h('h1'"), '项目名必须是 h1')
  assert.ok(source.includes("h('h2'"), '卡片标题必须是 h2')
  assert.ok(source.includes("scope: 'col'"), '表头必须有 scope')
  assert.ok(source.includes("'aria-label': '项目工作区'"), 'select 必须有可访问名')
  assert.ok(source.includes(':focus-visible'), '必须有键盘焦点样式')
  assert.ok(source.includes('pc-sr'), '表格需要 caption 用的视觉隐藏样式')
})

test('发送后留痕：本地记录发送时间用于区分"没做"与"做完待更新"', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('project-cockpit:last-sent'))
  assert.ok(source.includes('markSent('))
  assert.ok(source.includes('上次发送'))
})

test('warnings 超过 3 条要说明还有多少未显示', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('处未显示'), '截断后必须告知剩余数量')
})

test('表格放在自己的横向滚动容器里，窄屏不拖走整页', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('pc-table-wrap'), '缺少横向滚动容器')
  assert.ok(/\.pc-table-wrap\s*\{[^}]*overflow-x\s*:\s*auto/.test(source), '容器必须 overflow-x:auto')
})

test('卡片标题不用 uppercase 空转（中文无大小写）', async () => {
  const source = await read('client.js')
  const match = source.match(/h2\.pc-card-title\s*\{[^}]*\}/)
  assert.ok(match, '缺少卡片标题样式')
  assert.ok(!/text-transform\s*:\s*uppercase/.test(match[0]), '卡片标题不得再用 uppercase')
})

test('截断任务时给出明确提示，不让人以为看到的就是全部', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('model.truncated'))
  assert.ok(source.includes('只显示前 ${model.taskLimit'))
})
