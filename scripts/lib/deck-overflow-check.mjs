/** Checks every slide of both decks for content taller than the fixed 1280x720 canvas. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const port = 9479
const profile = mkdtempSync(join(tmpdir(), 'cdp-deck-'))
const BROWSERS = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
const browser = BROWSERS.find(path => existsSync(path)) ?? 'chrome'
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))
async function target(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
      if (response.ok) return response.json()
    } catch {}
    await sleep(500)
  }
  throw new Error('no target')
}
const evaluate = async (socket, expression) => {
  const id = ++evaluate.seq
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  for (;;) {
    const message = JSON.parse(await new Promise((res, rej) => {
      const onMessage = event => { socket.removeEventListener('message', onMessage); res(event.data) }
      socket.addEventListener('message', onMessage)
      setTimeout(() => rej(new Error('timeout')), 30_000)
    }))
    if (message.id === id) return message.result?.result?.value
  }
}
evaluate.seq = 0
try {
  for (const file of process.argv.slice(2)) {
    const page = await target(pathToFileURL(resolve(file)).href)
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(resolveOpen => socket.addEventListener('open', resolveOpen, { once: true }))
    await sleep(1500)
    console.log(file, await evaluate(socket, `(() => {
      const problems = []
      for (const [index, slide] of [...document.querySelectorAll('.slide')].entries()) {
        const bottom = el => el ? el.getBoundingClientRect().bottom : 0
        const overflow = Math.max(bottom(slide.querySelector('.content')), bottom(slide.querySelector('.head'))) - slide.getBoundingClientRect().bottom
        if (overflow > 2) problems.push({ slide: index + 1, overflow: Math.round(overflow) })
      }
      return JSON.stringify({ slides: document.querySelectorAll('.slide').length, problems })
    })()`))
    socket.close()
  }
} finally { child.kill() }
