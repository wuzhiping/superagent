/**
 * Captures the scenario screenshots used by the INDEX.md story: the four Sources, the Team posts (PM + workers),
 * the scenario Thread, its Decisions, and the Ticket page. Images live in images/scenario/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9465
const outDir = 'images/scenario'
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'cdp-scenario-'))
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
const snapshots = {}
const capture = async name => {
  snapshots[name] = await evaluate("document.body.innerText.slice(0, 1200)")
  const image = await send('Page.captureScreenshot', { format: 'png', clip: { x: 280, y: 0, width: 1304, height: 905, scale: 1.45 } })
  writeFileSync(join(outDir, name), Buffer.from(image.result.data, 'base64'))
  console.log('saved', join(outDir, name))
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
      if (/Team\\s*(视角|視角)/.test(document.body.innerText)) return true
      await new Promise(r => setTimeout(r, 1000))
    }
    return false
  })()`)

  // Settings: the Team posts (PM + two Workers) and the four Sources.
  console.log('settings tab:', await clickText('^(设置|設定)$'))
  await evaluate(`(async () => {
    for (let i = 0; i < 40; i += 1) { if (document.querySelector('.dt-settings-link')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)
  console.log('posts group:', await clickGroup('(项目与岗位|專案與崗位|項目與崗位)'))
  await capture('s2-team-posts.png')
  console.log('sources group:', await clickGroup('^(来源|來源)$'))
  await capture('s1-sources.png')

  // Trigger page: the scenario Thread detail.
  console.log('trigger tab:', await clickText('^(触发|觸發)$'))
  console.log('all threads:', await clickText('^(全部线程|全部線程)$'))
  const openedThread = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.dt-open')].find(item => /场景|場景/.test(item.innerText || ''))
    if (!row) return false
    row.click()
    await new Promise(r => setTimeout(r, 3000))
    return true
  })()`)
  console.log('thread opened:', openedThread)
  if (openedThread) await capture('s3-trigger.png')

  // Evaluation page: all decisions, including the first refusal and the accepted retry.
  console.log('eval tab:', await clickText('^(评估|評估)$'))
  await clickText('^(全部)$')
  await capture('s4-eval.png')

  // Execution page: ended Tickets, then the scenario Ticket's page.
  console.log('execution tab:', await clickText('^(执行|執行)$'))
  console.log('ended filter:', await clickText('^(已结束|已結束)$'))
  const openedTicket = await evaluate(`(async () => {
    const el = [...document.querySelectorAll('.dt-list .dt-ticket .dt-open')].find(item => /场景|場景/.test(item.innerText || ''))
    if (!el) return false
    el.click()
    await new Promise(r => setTimeout(r, 3000))
    return true
  })()`)
  console.log('ticket opened:', openedTicket)
  if (openedTicket) {
    await capture('s5-ticket-top.png')
    await evaluate("(() => { const page = document.querySelector('.dt-page'); if (page) page.scrollTop = page.scrollHeight })()")
    await sleep(800)
    await capture('s6-ticket-bottom.png')
  }
} finally {
  writeFileSync(join(outDir, 'snapshots.json'), JSON.stringify(snapshots, null, 2), 'utf8')
  socket.close()
  child.kill()
}
