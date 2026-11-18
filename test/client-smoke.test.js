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

test('locale 文件含 meta.title 与 meta.description', async () => {
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const dict = JSON.parse(await read(file))
    assert.equal(typeof dict.meta.title, 'string')
    assert.ok(dict.meta.title.length > 0)
    assert.equal(typeof dict.meta.description, 'string')
    assert.ok(dict.meta.description.length > 0)
  }
})
