/**
 * Captures the SuperAgent Settings screenshots used by ABC.md.
 *
 * ABC.md is organised by the Settings tabs, so this script opens the panel, goes to 设置 and walks the six group
 * links (项目与岗位 / 来源 / 评估 / 执行), saving cropped 2x captures of what each tab shows. Re-run after UI copy or
 * layout changes; images live in images/abc/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9405
const outDir = 'images/abc'
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'cdp-abc-'))
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
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { ...clip, scale } })
  const path = join(outDir, name)
  writeFileSync(path, Buffer.from(image.result.data, 'base64'))
  console.log('saved', path, `${Math.round(clip.width)}x${Math.round(clip.height)}@${scale}`)
}
/** Clicks the Settings group link whose text matches the pattern (NOT the top navigation with the same names). */
const clickGroup = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const el = [...document.querySelectorAll('.dt-settings-link')].find(item => re.test((item.innerText || '').trim()))
  if (!el) return false
  el.click()
  await new Promise(r => setTimeout(r, 2200))
  return true
})()`)
const clickTab = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const el = [...document.querySelectorAll('button')].find(item => re.test((item.innerText || '').trim()) && item.offsetParent !== null)
  if (!el) return false
  el.click()
  await new Promise(r => setTimeout(r, 2200))
  return true
})()`)
/** The page rect of the first visible element matching `pattern`, scrolled into view so the clip covers it. */
const rectOf = (pattern, ancestor) => evaluate(`(() => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const nodes = [...document.querySelectorAll('h1,h2,h3,h4,p,div,span,label,td')]
  const el = nodes.find(node => node.offsetParent !== null && node.children.length <= 2 && re.test((node.innerText || '').trim()))
  if (!el) return null
  let box = el
  ${ancestor ? `box = el.closest(${JSON.stringify(ancestor)}) || el` : ''}
  box.scrollIntoView({ block: 'center' })
  const r = box.getBoundingClientRect()
  return JSON.stringify({ x: Math.max(0, r.x + window.scrollX - 10), y: Math.max(0, r.y + window.scrollY - 10),
    width: Math.min(1564, r.width + 20), height: Math.min(2400, r.height + 20) })
})()`)
const clipFromText = async (pattern, height, ancestor = '') => {
  const raw = await rectOf(pattern, ancestor)
  if (!raw) return { x: 280, y: 0, width: 1304, height }
  const rect = JSON.parse(raw)
  return { x: 280, y: rect.y, width: 1304, height }
}

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
  // Team perspective at a glance (orientation).
  await capture('a1-panel-team.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  // Settings: the tab list, then the four tabs ABC.md walks through.
  console.log('settings tab:', await clickTab('^(設定|设置)$'))
  await sleep(1500)
  const navRect = await evaluate(`(() => {
    const first = document.querySelector('.dt-settings-link')
    if (!first) return null
    const box = first.closest('nav, aside, [class*=nav], [class*=group]') || first.parentElement
    const r = box.getBoundingClientRect()
    return JSON.stringify({ x: Math.max(0, r.x + window.scrollX - 8), y: Math.max(0, r.y + window.scrollY - 8),
      width: Math.min(320, r.width + 16), height: Math.min(600, r.height + 16) })
  })()`)
  if (navRect) await capture('a0-settings-tabs.png', JSON.parse(navRect), 2)

  console.log('project tab:', await clickGroup('項目與崗位|项目与岗位'))
  await sleep(1200)
  await capture('a2-project-fields.png', await clipFromText('選擇項目…|选择项目…', 360, '.dt-archive-card'))
  await capture('a3-charter.png', await clipFromText('憲章正文|宪章正文', 760, '.dt-section'))
  await capture('a4-duties.png', await clipFromText('職責說明|职责说明', 700, '.dt-section'))
  await capture('a5-posts.png', await clipFromText('Kanban 賬號（登入郵箱）|Kanban 账号（登录邮箱）', 720, '.dt-section'))

  console.log('sources tab:', await clickGroup('^(來源|来源)$'))
  await sleep(1200)
  await capture('a6-sources.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  console.log('evaluation tab:', await clickGroup('^(評估|评估)$'))
  await sleep(1200)
  await capture('a7-evaluation.png', await clipFromText('接單模式|接单模式', 800, '.dt-page'))

  console.log('execution tab:', await clickGroup('^(執行|执行)$'))
  await sleep(1200)
  await capture('a8-execution.png', await clipFromText('執行器模型|执行器模型', 760, '.dt-page'))

  // Worker perspective: confirm the seat (read-only).
  console.log('post perspective:', await clickTab('^(崗位視角|岗位视角)$'))
  await sleep(2500)
  await capture('b1-panel-post.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)
  console.log('my post:', await clickTab('我的崗位|我的岗位'))
  await sleep(1500)
  await capture('b2-my-post.png', await clipFromText('監聽列|监听列', 620, '.dt-page'))
} finally {
  socket.close()
  child.kill()
}
