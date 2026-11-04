/** Take a screenshot of the DSH web panel: launch Edge with a debug port, open the GUI, click into a panel tab and capture it. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [, , url = 'http://127.0.0.1:3080', out = 'shot.png', script = ''] = process.argv
const port = 9333
const profile = mkdtempSync(join(tmpdir(), 'cdp-'))
const BROWSERS = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
const browser = BROWSERS.find(path => existsSync(path)) ?? 'chrome'
const edge = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore', detached: false })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function target() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
      if (response.ok) return response.json()
    } catch { /* the browser is not up yet */ }
    await sleep(500)
  }
  throw new Error('Edge did not open a debug target')
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
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url })
await sleep(6000)
if (script) {
  const result = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })
  console.log('evaluate:', JSON.stringify(result.result?.result?.value ?? result.result?.exceptionDetails ?? null))
  await sleep(3000)
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log('saved', out)
socket.close()
edge.kill()
process.exit(0)
