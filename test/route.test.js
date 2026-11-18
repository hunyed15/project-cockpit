import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes } from '../lib/route.js'

const workspaces = [
  { id: 'w1', title: 'foo', path: 'D:/Coding/foo' },
  { id: 'w2', title: 'bar', path: 'D:/Coding/bar' },
]

function routes(overrides = {}) {
  return createRoutes({
    listWorkspaces: async () => workspaces,
    resolveWorkspace: async (path) =>
      workspaces.find((item) => item.path.toLowerCase() === String(path).toLowerCase()) ?? null,
    readProjectDir: async (path) => ({
      project: { path, name: 'foo' },
      trellis: { initialized: true, version: '0.6.17', specFiles: 1 },
      tasks: [],
      warnings: [],
    }),
    ...overrides,
  })
}

const get = (url) => new Request(`http://127.0.0.1${url}`)

test('GET /api/workspaces 返回注册工作区', async () => {
  const response = await routes().handle(get('/project-cockpit/api/workspaces'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.length, 2)
})

test('GET /api/panel 未传 path 时用第一个工作区', async () => {
  const response = await routes().handle(get('/project-cockpit/api/panel'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.project.path, 'D:/Coding/foo')
  assert.ok(Array.isArray(body.gates))
})

test('未知工作区路径返回 403', async () => {
  const response = await routes().handle(get('/project-cockpit/api/panel?path=D:/Coding/evil'))
  assert.equal(response.status, 403)
})

test('工作区路径大小写不同也能命中', async () => {
  const response = await routes().handle(get('/project-cockpit/api/panel?path=d:/coding/foo'))
  assert.equal(response.status, 200)
})

test('没有注册工作区时返回 404 而不是崩', async () => {
  const response = await routes({ listWorkspaces: async () => [] }).handle(
    get('/project-cockpit/api/panel'),
  )
  assert.equal(response.status, 404)
})

test('未知路径返回 404，非 GET 返回 405', async () => {
  const r = routes()
  assert.equal((await r.handle(get('/project-cockpit/api/nope'))).status, 404)
  assert.equal(
    (await r.handle(new Request('http://127.0.0.1/project-cockpit/api/panel', { method: 'POST' })))
      .status,
    405,
  )
})

test('读盘抛错时返回 500 并带原因', async () => {
  const response = await routes({
    readProjectDir: async () => {
      throw new Error('boom')
    },
  }).handle(get('/project-cockpit/api/panel'))
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.ok(body.error.includes('boom'))
})

test('本插件前缀之外的路径不接管', async () => {
  const response = await routes().handle(get('/other/api/panel'))
  assert.equal(response.status, 404)
})

test('工作区服务对不存在的路径抛 ENOENT 时回 403 而不是 500', async () => {
  const response = await routes({
    resolveWorkspace: async () => {
      const error = new Error("ENOENT: no such file or directory, realpath 'C:\\nope'")
      error.code = 'ENOENT'
      throw error
    },
  }).handle(get('/project-cockpit/api/panel?path=C:/nope'))
  assert.equal(response.status, 403)
})

test('工作区服务的真实故障仍然回 500', async () => {
  const response = await routes({
    resolveWorkspace: async () => {
      throw new Error('registry exploded')
    },
  }).handle(get('/project-cockpit/api/panel?path=D:/Coding/foo'))
  assert.equal(response.status, 500)
})

test('HEAD 与 GET 同样可用', async () => {
  const response = await routes().handle(
    new Request('http://127.0.0.1/project-cockpit/api/workspaces', { method: 'HEAD' }),
  )
  assert.equal(response.status, 200)
})
