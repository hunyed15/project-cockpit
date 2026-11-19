// Screenshot and overflow measurement over CDP, with deviceScaleFactor pinned to 1.
//
// Why not `chrome --screenshot`: on a 125% DPI machine the CLI capture scales the
// page, so a correct layout looks cut off and a real overflow looks normal. Driving
// CDP with Emulation.setDeviceMetricsOverride removes that ambiguity.
//
// Usage:
//   node tools/preview/shot.mjs <url> <width> <height> <out.png> [full]
//   node tools/preview/shot.mjs <url> <width> --measure
import { spawn } from 'node:child_process'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const url = args[0] || 'http://127.0.0.1:4711/'
const width = Number(args[1] || 1200)
const measureOnly = args.includes('--measure')
const height = measureOnly ? 900 : Number(args[2] || 900)
const outPath = measureOnly ? null : args[3]
const fullPage = args.includes('full')

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334 + Math.floor(Math.random() * 200)

const profile = await mkdtemp(join(tmpdir(), 'dsh-shot-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 60; i++) {
  await sleep(250)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break }
  } catch {}
}
if (!wsUrl) { chrome.kill(); console.error('no CDP target'); process.exit(1) }

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const msgId = ++id
  pending.set(msgId, { resolve, reject })
  ws.send(JSON.stringify({ id: msgId, method, params }))
})
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
})
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(2600)

if (measureOnly) {
  const probe = await send('Runtime.evaluate', {
    expression: `(() => {
      const vw = innerWidth
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > vw + 1 || r.right > vw + 1) {
          offenders.push({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').slice(0, 40), w: Math.round(r.width) })
        }
      }
      return JSON.stringify({ viewport: vw, docScrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 10) }, null, 2)
    })()`,
    returnByValue: true,
  })
  console.log(probe.result.value)
} else {
  const params = { format: 'png', captureBeyondViewport: fullPage }
  if (fullPage) {
    const metrics = await send('Page.getLayoutMetrics')
    const size = metrics.cssContentSize || metrics.contentSize
    params.clip = { x: 0, y: 0, width, height: Math.ceil(size.height), scale: 1 }
  }
  const shot = await send('Page.captureScreenshot', params)
  await writeFile(outPath, Buffer.from(shot.data, 'base64'))
  const probe = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({vw: innerWidth, scroll: document.documentElement.scrollWidth})',
    returnByValue: true,
  })
  console.log(`saved ${outPath} ${probe.result.value}`)
}

ws.close()
chrome.kill()
