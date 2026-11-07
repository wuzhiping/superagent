/**
 * Captures the Trigger → Eval → Ticket screenshots used by DEF.md.
 *
 * DEF.md walks one request from the board to a Ticket, so this script opens the panel in the Team perspective and
 * captures: the 触发 (Thread) list, the 评估 (Decision) list, the 执行 list of ended Tickets, and one Ticket's page.
 * Images live in images/def/. Re-run after UI copy or layout changes.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9431
const outDir = 'images/def'
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'cdp-def-'))
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
const capture = async (name, clip, scale = 2) => {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale } })
  const path = join(outDir, name)
  writeFileSync(path, Buffer.from(image.result.data, 'base64'))
  console.log('saved', path, `${Math.round(clip.width)}x${Math.round(clip.height)}@${scale}`)
}
const clickTab = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const el = [...document.querySelectorAll('button')].find(item => re.test((item.innerText || '').trim()) && item.offsetParent !== null)
  if (!el) return false
  el.click()
  await new Promise(r => setTimeout(r, 2500))
  return true
})()`)
const clickText = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const el = [...document.querySelectorAll('button')].find(item => re.test((item.innerText || '').trim()) && item.offsetParent !== null)
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

  // 触发: the Thread list (one card or chat is one Thread).
  console.log('trigger tab:', await clickTab('^(觸發|触发)$'))
  await capture('d1-trigger.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  // 评估: the Decision log.
  console.log('eval tab:', await clickTab('^(評估|评估)$'))
  await capture('d2-eval.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  // 执行: ended Tickets, so the list is not empty on a quiet deployment.
  console.log('execution tab:', await clickTab('^(執行|执行)$'))
  console.log('ended filter:', await clickText('^(已結束|已结束)$'))
  await capture('d3-execution.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  // One Ticket's page: its stage line, Mandate details, Threads and history.
  const opened = await evaluate(`(async () => {
    const el = [...document.querySelectorAll('.dt-list .dt-ticket .dt-open')].find(item => (item.innerText || '').trim())
    if (!el) return false
    el.click()
    await new Promise(r => setTimeout(r, 3000))
    return true
  })()`)
  console.log('ticket opened:', opened)
  if (opened) await capture('d4-ticket.png', { x: 280, y: 0, width: 1304, height: 1250 }, 1.45)
} finally {
  socket.close()
  child.kill()
}
