import { resolve } from 'node:path'
import { createRoutes } from './lib/route.js'
import { readEvidence } from './lib/reader.js'
import { buildPanelModel } from './lib/panel.js'

// 没有 Web 就没有面板：非 Web profile 下这一行保持 inactive 即可，不要假装能用。
export const inject = ['webServer']

function toWorkspace(item) {
  return {
    id: String(item?.id ?? item?.path ?? ''),
    title: String(item?.title ?? item?.path ?? ''),
    path: String(item?.path ?? ''),
  }
}

function samePath(a, b) {
  try {
    const left = resolve(String(a))
    const right = resolve(String(b))
    return process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase()
      : left === right
  } catch {
    return false
  }
}

export function apply(ctx) {
  const logWarn = (message) => {
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn(`[project-cockpit] ${message}`)
      } else {
        console.warn(`[project-cockpit] ${message}`)
      }
    } catch {
      // 日志不能影响插件
    }
  }

  // 未解析的服务在 cordis 的 Proxy 上可能抛错而不是返回 undefined，取服务必须包住。
  const registry = () => {
    try {
      return ctx.get('workspaceRegistry')
    } catch {
      return undefined
    }
  }

  const routes = createRoutes({
    listWorkspaces: async () => {
      const service = registry()
      if (!service || typeof service.list !== 'function') return []
      const list = await service.list()
      return list.map(toWorkspace).filter((item) => item.path !== '')
    },
    resolveWorkspace: async (path) => {
      const service = registry()
      if (!service) return null
      if (typeof service.resolveByPath === 'function') {
        const hit = await service.resolveByPath(String(path))
        if (hit) return toWorkspace(hit)
      }
      if (typeof service.list === 'function') {
        const all = await service.list()
        const hit = all.find((item) => samePath(item?.path, path))
        if (hit) return toWorkspace(hit)
      }
      return null
    },
    readProjectDir: (projectPath) => readEvidence(projectPath),
    buildModel: (evidence) => buildPanelModel(evidence),
  })

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/project-cockpit',
      resource: (request) => routes.handle(request),
    }),
  )

  logWarn('panel route registered at /project-cockpit/api/panel')
}
