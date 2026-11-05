/**
 * Prints a slide deck to PDF through Chrome's DevTools protocol, keeping the deck's own print rules: the stylesheet
 * declares `@page { size: 1280px 720px }` and one slide per page, so the PDF has exactly the deck's pages, with its
 * dark backgrounds. A fresh browser per file, and the whole attempt is retried, because a debug browser occasionally
 * dies while starting.
 *
 *   node scripts/html-to-pdf.mjs SOP.html SOP.pdf [STORY.html STORY.pdf ...]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pairs = []
for (let index = 2; index + 1 < process.argv.length; index += 2) pairs.push([process.argv[index], process.argv[index + 1]])
if (pairs.length === 0) { console.error('usage: html-to-pdf.mjs <input.html> <output.pdf> [...]'); process.exit(1) }

const BROWSERS = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
const browser = BROWSERS.find(path => existsSync(path)) ?? 'chrome'
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

/** One browser, one page, one print. Every wait has a deadline, so a dead browser fails instead of hanging. */
async function printOnce (input, output) {
  const port = 9401 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), 'cdp-pdf-'))
  const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore', detached: false })
  try {
    let page
    for (let attempt = 0; attempt < 40 && !page; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(resolve(input)).href)}`, { method: 'PUT' })
        if (response.ok) page = await response.json()
      } catch { /* the browser is still starting */ }
      if (!page) await sleep(250)
    }
    if (!page) throw new Error('the browser did not open a page')

    const socket = new WebSocket(page.webSocketDebuggerUrl)
    const closed = new Promise((resolveClosed, rejectClosed) => {
      socket.addEventListener('open', resolveClosed, { once: true })
      socket.addEventListener('error', rejectClosed, { once: true })
      socket.addEventListener('close', () => rejectClosed(new Error('the debug connection closed')), { once: true })
    })
    await closed
    let nextId = 0
    const pending = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    }
    const send = (method, params = {}) => new Promise(resolveSend => {
      const id = ++nextId
      pending.set(id, resolveSend)
      socket.send(JSON.stringify({ id, method, params }))
    })

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Page.navigate', { url: pathToFileURL(resolve(input)).href })
    // Wait for the deck's own script to have counted its slides, then a moment for fonts and layout.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(300)
      const ready = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({ state: document.readyState, slides: document.querySelectorAll(".slide").length })',
        returnByValue: true,
      })
      const value = JSON.parse(ready.result?.result?.value ?? '{}')
      if (value.state === 'complete' && value.slides > 0) break
    }
    await sleep(800)

    const printed = await send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    })
    if (!printed.result?.data) throw new Error(`printToPDF failed: ${JSON.stringify(printed).slice(0, 300)}`)
    writeFileSync(output, Buffer.from(printed.result.data, 'base64'))
    socket.close()
  } finally {
    child.kill()
  }
}

/** Pages and page size of a PDF, read from its own objects, so the report is checkable. */
function pdfSummary (path) {
  const text = readFileSync(path).toString('latin1')
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  const box = /\/(?:MediaBox|CropBox)\s*\[([^\]]+)\]/.exec(text)?.[1]?.trim() ?? '?'
  return { pages, box }
}

for (const [input, output] of pairs) {
  let done = false
  for (let attempt = 1; attempt <= 3 && !done; attempt += 1) {
    try {
      await printOnce(input, output)
      const { pages, box } = pdfSummary(output)
      console.log(`${output}: ${pages} page(s), page box ${box}`)
      done = true
    } catch (error) {
      if (attempt === 3) { console.error(`${input}: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 }
      else await sleep(2000)
    }
  }
}
