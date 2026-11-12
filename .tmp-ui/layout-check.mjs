/** Opens the Superagent panel in the live GUI and reports the main Session row's layout. */
const { spawn } = await import('node:child_process')
const { mkdtempSync, writeFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'panel-'))
const port = 9600 + Math.floor(Math.random() * 200)
const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-gpu', '--window-size=1600,1100', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let target
for (let attempt = 0; attempt < 120 && !target; attempt += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find(item => item.type === 'page')
  } catch { /* starting */ }
  if (!target) await sleep(250)
}
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
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
  return result.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:3080/' })
await sleep(13000)
await evaluate(`(() => { const node = [...document.querySelectorAll('button,[role="button"],a')].find(item => /超級智慧體|超级智能体|Superagent/i.test(item.textContent || '')); node?.click(); return true })()`)
await sleep(16000)
const report = await evaluate(`(() => {
  const title = document.querySelector('.dt-section-title')
  const row = document.querySelector('.dt-session-state')
  const dot = document.querySelector('.dt-session-state .dt-dot')
  const label = document.querySelector('.dt-session-state .dt-status-text')
  const box = node => { const r = node?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) } : null }
  return JSON.stringify({
    title: title?.textContent, titleBox: box(title), rowBox: box(row), dotBox: box(dot), labelBox: box(label),
    label: label?.textContent, dotColor: dot ? getComputedStyle(dot).color : null, labelColor: label ? getComputedStyle(label).color : null,
    overlaps: title && row ? row.getBoundingClientRect().top < title.getBoundingClientRect().bottom : null,
    detail: document.querySelector('.dt-session-detail')?.textContent ?? null
  })
})()`)
console.log(report)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('.tmp-ui/session-fixed.png', Buffer.from(shot.result.data, 'base64'))
socket.close(); child.kill()
process.exit(0)
