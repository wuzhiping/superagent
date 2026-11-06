/** Reports layout defects: boxes past their card/slide/footer, overlapping cards, and text clipped with visible content. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const port = 9499
const profile = mkdtempSync(join(tmpdir(), 'cdp-deck5-'))
const BROWSERS = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
const browser = BROWSERS.find(path => existsSync(path)) ?? 'chrome'
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + profile,
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
const expression = `(() => {
  const slides = [...document.querySelectorAll('.slide')]
  const problems = []
  slides.forEach((slide, index) => {
    slides.forEach(other => other.classList.toggle('active', other === slide))
    void slide.offsetHeight
    const sr = slide.getBoundingClientRect()
    const title = String((slide.querySelector('h1, h2') || {}).textContent || '').slice(0, 36)
    const issues = []
    const pageno = slide.querySelector('.pageno')
    const footerTop = pageno ? pageno.getBoundingClientRect().top : sr.bottom
    for (const el of slide.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      const inHead = !!el.closest('.head')
      const clipped = el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2
      const beyond = r.bottom > sr.bottom + 1
      const card = el.closest('.card')
      const pastCard = card && el !== card ? Math.round(r.bottom - card.getBoundingClientRect().bottom) : 0
      const footerHit = !inHead && r.bottom > footerTop - 2 && !el.classList.contains('pageno') && !el.classList.contains('brand')
        && !el.classList.contains('ghost')
      // The timeline's rail line deliberately runs 20px past its row, and cover ghosts are decoration.
      const rail = el.classList.contains('rail') || (el.classList.contains('tl') && el.querySelector('.rail'))
      const realClip = clipped && !inHead && !el.classList.contains('ghost') && !rail && el.scrollHeight - el.clientHeight > 12
      if (realClip || beyond || pastCard > 2 || footerHit) {
        issues.push({ kind: realClip ? 'clipped' : beyond ? 'beyond' : pastCard > 2 ? 'past-card' : 'footer-hit',
          tag: el.tagName, cls: String(el.className).slice(0, 30),
          over: realClip ? el.scrollHeight - el.clientHeight : beyond ? Math.round(r.bottom - sr.bottom) : pastCard > 2 ? pastCard : Math.round(r.bottom - footerTop),
          text: String(el.textContent || '').replace(/\\s+/g, ' ').slice(0, 44) })
      }
    }
    const cards = [...slide.querySelectorAll('.card')]
    for (let a = 0; a < cards.length; a += 1) for (let b = a + 1; b < cards.length; b += 1) {
      const ra = cards[a].getBoundingClientRect(), rb = cards[b].getBoundingClientRect()
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ox > 4 && oy > 4) issues.push({ kind: 'overlap', cls: 'cards', over: Math.round(oy), text: '' })
    }
    if (issues.length) problems.push({ slide: index + 1, title, issues: issues.slice(0, 6) })
  })
  return JSON.stringify(problems)
})()`
try {
  for (const file of process.argv.slice(2)) {
    const page = await target(pathToFileURL(resolve(file)).href)
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(resolveOpen => socket.addEventListener('open', resolveOpen, { once: true }))
    await sleep(1600)
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    const data = await new Promise((resolveMessage) => {
      const onMessage = event => { const message = JSON.parse(event.data); if (message.id === 1) { socket.removeEventListener('message', onMessage); resolveMessage(message.result.result.value) } }
      socket.addEventListener('message', onMessage)
    })
    console.log('###', file)
    for (const problem of JSON.parse(data)) {
      console.log(`slide ${problem.slide} ${problem.title}`)
      for (const issue of problem.issues) console.log(`  ${issue.kind} <${issue.tag}.${issue.cls}> +${issue.over} ${issue.text}`)
    }
    socket.close()
  }
} finally { child.kill() }
