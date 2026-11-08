/**
 * Captures the execution screenshots used by GHI.md.
 *
 * GHI.md walks one Ticket through execution, so this script opens the panel and captures: the 提示词 page (what the
 * agents read), the 执行 settings (model, concurrency, prepare command, blocked commands, environment variables), the
 * 部署 page, the 清理 page, and one ended Ticket's page (reports, assignments, delivery). Images live in images/ghi/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9433
const outDir = 'images/ghi'
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'cdp-ghi-'))
const BROWSERS = ['C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
const browser = BROWSERS.find(path => existsSync(path)) ?? 'chrome'
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + profile,
  '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function target () {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('http://127.0.0.1:3080')}`, { method: 'PUT' })
      if (response.ok) return response.json()
    } catch { /* browser not up */ }
    await sleep(500)
  }
  throw new Error('no target')
}
const page = await target()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let id = 0
const pending = new Map()
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
}
const send = (method, params = {}) => new Promise(resolve => {
  const request = ++id
  pending.set(request, resolve)
  socket.send(JSON.stringify({ id: request, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails))
  return result.result?.result?.value
}
const capture = async (name, maxHeight, scale = 1.45) => {
  // The panel scrolls inside .dt-page; let it grow so captureBeyondViewport covers the whole page.
  await evaluate("(() => { const page = document.querySelector('.dt-page'); if (page) { page.style.height = 'auto'; page.style.overflow = 'visible' } })()")
  await sleep(300)
  const height = await evaluate(`Math.min(${maxHeight}, Math.max(905, Math.ceil(document.body.scrollHeight) + 20))`)
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 280, y: 0, width: 1304, height, scale } })
  const path = join(outDir, name)
  writeFileSync(path, Buffer.from(image.result.data, 'base64'))
  console.log('saved', path, `1304x${Math.round(height)}@${scale}`)
}
const clickText = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const el = [...document.querySelectorAll('button')].find(item => re.test((item.innerText || '').trim()) && item.offsetParent !== null)
  if (!el) return false
  el.click()
  await new Promise(r => setTimeout(r, 2500))
  return true
})()`)
const clickGroup = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const el = [...document.querySelectorAll('.dt-settings-link')].find(item => re.test((item.innerText || '').trim()))
  if (!el) return false
  el.click()
  await new Promise(r => setTimeout(r, 2500))
  return true
})()`)

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3080' })
  await evaluate(`(async () => {
    const find = () => [...document.querySelectorAll('button')].find(b => /智[慧能][體体]/.test(b.getAttribute('aria-label') || b.innerText || ''))
    for (let i = 0; i < 60 && !find(); i += 1) await new Promise(r => setTimeout(r, 1000))
    find()?.click()
    for (let i = 0; i < 40; i += 1) {
      if (/Team\\s*視角|Team\\s*视角/.test(document.body.innerText)) return true
      await new Promise(r => setTimeout(r, 1000))
    }
    return false
  })()`)
  console.log('settings tab:', await clickText('^(設定|设置)$'))
  await evaluate(`(async () => {
    for (let i = 0; i < 40; i += 1) { if (document.querySelector('.dt-settings-link')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)
  await sleep(500)

  // 提示词: the team sections and the built-in parts the agents read.
  console.log('prompts:', await clickGroup('^(提示詞|提示词)$'))
  await capture('g1-prompts.png', 1400)

  // 执行 settings: model, concurrency, directory, prepare, blocked commands, environment variables.
  console.log('execution settings:', await clickGroup('^(執行|执行)$'))
  await capture('g2-execution-settings.png', 1600)

  // 部署: state directory and the deployment check.
  console.log('deployment:', await clickGroup('^(部署)$'))
  await capture('g3-deployment.png', 1200)

  // 清理: what an ended duty leaves behind.
  console.log('maintenance tab:', await clickText('^(清理)$'))
  await capture('g4-maintenance.png', 1200)

  // One ended Ticket's page: stage, reports, assignments, delivery.
  console.log('execution tab:', await clickText('^(執行|执行)$'))
  console.log('ended filter:', await clickText('^(已結束|已结束)$'))
  const opened = await evaluate(`(async () => {
    const el = [...document.querySelectorAll('.dt-list .dt-ticket .dt-open')].find(item => (item.innerText || '').trim())
    if (!el) return false
    el.click()
    await new Promise(r => setTimeout(r, 3000))
    return true
  })()`)
  console.log('ticket opened:', opened)
  if (opened) {
    await capture('g5-ticket.png', 2400)
    // The page is taller than the viewport: a second shot at the bottom shows the delivery and assignment sections.
    await evaluate("(() => { const page = document.querySelector('.dt-page'); if (page) page.scrollTop = page.scrollHeight })()")
    await sleep(600)
    await capture('g5-ticket-bottom.png', 2400)
  }
} finally {
  socket.close()
  child.kill()
}
