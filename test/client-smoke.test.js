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
  assert.ok(source.includes('setPending(model.nextAction)'))
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

test('顶栏显示卡点数与更新时间（totals / generatedAt 不再是死数据）', async () => {
  const source = await read('client.js')
  assert.ok(source.includes('totals.blocking'))
  assert.ok(source.includes('generatedAt'))
  assert.ok(source.includes('卡点'))
  assert.ok(source.includes('更新于'))
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
  assert.ok(source.includes('只显示前 200 个'))
})
