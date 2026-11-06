/**
 * Captures the SuperAgent panel screenshots used by ABC.md.
 *
 * It opens the panel in headless Chrome, switches to the Team/post perspective and navigates the pages the quick guide
 * walks through, saving cropped, 2x captures of the relevant cards so the small panel text stays readable in the doc.
 * Re-run it when the panel copy or layout changes; the images live in images/abc/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9397
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
const click = pattern => evaluate(`(async () => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const els = [...document.querySelectorAll('button, a, [role=tab], [role=menuitem], [role=button]')]
  const el = els.find(item => re.test((item.innerText || '').trim()) && item.offsetParent !== null)
  if (!el) return false
  el.click()
  await new Promise(r => setTimeout(r, 2200))
  return true
})()`)
/** The page rect of the first visible element matching `pattern` (scrolled into view so the clip covers it). */
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

  // A. Team perspective: the panel at a glance.
  await capture('a1-panel-team.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  // B. Settings -> project & posts: the exchange fields, the charter, the duties and the post card.
  console.log('settings:', await click('^(設定|设置)$'))
  console.log('project group:', await click('項目與崗位|项目与岗位'))
  await sleep(1200)
  await capture('a2-project-fields.png', await clipFromText('選擇項目…|选择项目…', 360, '.dt-archive-card'))
  await capture('a3-charter.png', await clipFromText('憲章正文|宪章正文', 760, '.dt-section'))
  await capture('a4-duties.png', await clipFromText('職責說明|职责说明', 700, '.dt-section'))
  await capture('a5-posts.png', await clipFromText('Kanban 賬號（登入郵箱）|Kanban 账号（登录邮箱）', 720, '.dt-section'))

  // C. Sources: the four system cards.
  console.log('sources:', await click('^(來源|来源)$'))
  await sleep(1500)
  await capture('a6-sources.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)

  // D. Post perspective: the worker's own seat.
  console.log('post perspective:', await click('崗位視角|岗位视角'))
  await sleep(2500)
  await capture('b1-panel-post.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)
  console.log('my post:', await click('我的崗位|我的岗位'))
  await sleep(1500)
  await capture('b2-my-post.png', await clipFromText('監聽列|监听列', 620, '.dt-page'))
  console.log('my duties:', await click('我的職責|我的职责'))
  await sleep(1500)
  await capture('b3-my-duties.png', { x: 280, y: 0, width: 1304, height: 905 }, 1.45)
} finally {
  socket.close()
  child.kill()
}
