import { buildPanelModel } from './panel.js'

const BASE = '/project-cockpit/api'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * HTTP 层：只做路由、参数与错误码，不碰盘、不解析业务。
 *
 * 授权策略：`path` 必须能被 `resolveWorkspace` 认出来（即 DSH 自己登记过的项目）。
 * `main` 是 root scope，客户端拿不到 Session，因此不能用 sessionId 推导项目，
 * 只能从「已注册工作区」里选——这也保证了本机任意进程都无法让面板去读任意目录。
 */
export function createRoutes({
  listWorkspaces,
  resolveWorkspace,
  readProjectDir,
  buildModel = buildPanelModel,
}) {
  return {
    async handle(request) {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (!url.pathname.startsWith(`${BASE}/`)) return new Response('not found', { status: 404 })
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'method-not-allowed' }, 405)
      }
      try {
        if (url.pathname === `${BASE}/workspaces`) {
          const all = await listWorkspaces()
          return json(Array.isArray(all) ? all : [])
        }
        if (url.pathname === `${BASE}/panel`) {
          const all = await listWorkspaces()
          if (!Array.isArray(all) || all.length === 0) {
            return json({ ok: false, error: 'no-workspace' }, 404)
          }
          const requested = url.searchParams.get('path')
          let target = null
          if (requested) {
            try {
              target = await resolveWorkspace(requested)
            } catch (error) {
              // 工作区服务对不存在的路径可能抛 ENOENT（Windows realpath）。
              // 那是"不是已登记工作区"，不是服务端故障：回 403，别回 500。
              const message = String(error?.code ?? error?.message ?? error)
              if (!/ENOENT|ENOTDIR|not found|no such file/i.test(message)) throw error
              target = null
            }
          } else {
            target = all[0]
          }
          if (!target) return json({ ok: false, error: 'workspace-not-allowed' }, 403)
          const evidence = await readProjectDir(target.path)
          return json(buildModel(evidence))
        }
        return new Response('not found', { status: 404 })
      } catch (error) {
        return json({ ok: false, error: String(error?.message ?? error) }, 500)
      }
    },
  }
}
