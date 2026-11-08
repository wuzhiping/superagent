/**
 * Captures the live rehearsal (card #45 → Ticket → MinIO delivery) for A-I.md.
 * Opens the panel and captures: the Trigger thread, the accepted Decision, the ended Ticket list, and the Ticket page
 * top/bottom (mandate, delivery report). Images live in images/rehearsal/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9445
const outDir = 'images/rehearsal'
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'cdp-rehearsal-'))
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
    } catch { /* not up */ }
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
const capture = async (name) => {
  const image = await send('Page.captureScreenshot', { format: 'png', clip: { x: 280, y: 0, width: 1304, height: 905, scale: 1.45 } })
  const path = join(outDir, name)
  writeFileSync(path, Buffer.from(image.result.data, 'base64'))
  console.log('saved', path)
}
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

  // 触发: the rehearsal card is a Thread.
  console.log('trigger tab:', await clickText('^(觸發|触发)$'))
  console.log('all threads:', await clickText('^(全部線程|全部线程)$'))
  await capture('r1-trigger.png')

  // 评估: the accepted decision.
  console.log('eval tab:', await clickText('^(評估|评估)$'))
  console.log('work filter:', await clickText('^(接單與續做|接单与续做)$'))
  await capture('r2-eval.png')

  // 执行: ended Tickets, then the rehearsal Ticket.
  console.log('execution tab:', await clickText('^(執行|执行)$'))
  console.log('ended filter:', await clickText('^(已結束|已结束)$'))
  await capture('r3-execution.png')
  const opened = await evaluate(`(async () => {
    const el = [...document.querySelectorAll('.dt-list .dt-ticket .dt-open')]
      .find(item => /A-I 演[練练]/.test((item.innerText || '').trim()))
    if (!el) return false
    el.click()
    await new Promise(r => setTimeout(r, 3000))
    return true
  })()`)
  console.log('rehearsal ticket opened:', opened)
  if (opened) {
    await capture('r4-ticket-top.png')
    await evaluate("(() => { const page = document.querySelector('.dt-page'); if (page) page.scrollTop = page.scrollHeight })()")
    await sleep(700)
    await capture('r5-ticket-bottom.png')
  }
} finally {
  socket.close()
  child.kill()
}
