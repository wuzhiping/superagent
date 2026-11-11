/**
 * Builds FLOW.html from FLOW.md: a document in the AIOS deck's dark visual language, with every Mermaid diagram
 * pre-rendered to inline SVG by a headless Chrome, so the HTML is self-contained and the PDF printer needs no network.
 *
 *   node scripts/build-flow-doc.mjs            # writes FLOW.html
 *
 * The PDF is made from the HTML by scripts/html-to-pdf.mjs (Chrome printToPDF, A4 via the document's @page rule).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BROWSERS = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
const browser = BROWSERS.find(path => existsSync(path))
if (!browser) throw new Error('No Chrome or Edge found')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const source = readFileSync('FLOW.md', 'utf8')
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = raw => escapeHtml(raw)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\*([^*]+)\*/g, '<i>$1</i>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => `<a href="${href.replace(/\.md$/, '.html')}">${text}</a>`)

/** Splits the Markdown into a small HTML document; the only constructs FLOW.md uses are headings, tables, lists,
 * blockquotes, fenced code (Mermaid collected separately), rules and paragraphs. */
function markdown (text) {
  const lines = text.split(/\r?\n/)
  const out = []
  const mermaid = []
  let index = 0
  const flushParagraph = buffer => { if (buffer.length) out.push(`<p>${inline(buffer.join(' '))}</p>`); buffer.length = 0 }
  const paragraph = []
  while (index < lines.length) {
    const line = lines[index]
    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      index += 1
      const body = []
      while (index < lines.length && !/^```/.test(lines[index])) { body.push(lines[index]); index += 1 }
      index += 1
      if (fence[1] === 'mermaid') {
        const id = mermaid.length
        mermaid.push(body.join('\n'))
        out.push(`<figure class="diagram" data-diagram="${id}"><div class="svg-wrap">{{DIAGRAM:${id}}}</div></figure>`)
      } else {
        out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      }
      continue
    }
    if (/^\s*$/.test(line)) { flushParagraph(paragraph); index += 1; continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph(paragraph)
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index += 1
      continue
    }
    if (/^---+$/.test(line.trim())) { flushParagraph(paragraph); out.push('<hr />'); index += 1; continue }
    if (/^\|/.test(line)) {
      flushParagraph(paragraph)
      const rows = []
      while (index < lines.length && /^\|/.test(lines[index])) { rows.push(lines[index]); index += 1 }
      const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      const header = cells(rows[0] ?? '')
      const body = rows.slice(1).filter(row => !/^\|?[\s:|-]+\|?$/.test(row))
      out.push('<div class="table-wrap"><table><thead><tr>' + header.map(cell => `<th>${inline(cell)}</th>`).join('') +
        '</tr></thead><tbody>' + body.map(row => '<tr>' + cells(row).map(cell => `<td>${inline(cell)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>')
      continue
    }
    if (/^>/.test(line)) {
      flushParagraph(paragraph)
      const quote = []
      while (index < lines.length && /^>/.test(lines[index])) { quote.push(lines[index].replace(/^>\s?/, '')); index += 1 }
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushParagraph(paragraph)
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items = []
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        index += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>` + items.map(item => `<li>${inline(item)}</li>`).join('') + `</${tag}>`)
      continue
    }
    paragraph.push(line)
    index += 1
  }
  flushParagraph(paragraph)
  return { html: out.join('\n'), mermaid }
}

const parsed = markdown(source)

/** Renders the Mermaid blocks to standalone SVG in headless Chrome, with a dark theme that matches the document. */
async function renderDiagrams (codes) {
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{background:#ffffff;margin:0;padding:24px;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
    .mermaid{background:transparent}
  </style></head><body>
  <script>${readFileSync('.tmp-flow/mermaid.min.js', 'utf8')}</script>
  <script>
    const codes = ${JSON.stringify(codes)};
    window.__svgs = [];
    window.__error = '';
    mermaid.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'loose',
      fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif',
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
      sequence: { useMaxWidth: false, mirrorActors: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      themeVariables: {
        darkMode: false, background: '#ffffff', fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif',
        primaryColor: '#eef2ff', primaryTextColor: '#1c2742', primaryBorderColor: '#98a7d8',
        secondaryColor: '#e8eeff', secondaryTextColor: '#1c2742', tertiaryColor: '#f6f8ff', tertiaryTextColor: '#2a3550',
        lineColor: '#5a6aa8', textColor: '#1c2742', mainBkg: '#eef2ff', nodeBorder: '#98a7d8',
        clusterBkg: '#f6f8ff', clusterBorder: '#c3cce4', titleColor: '#1c2742',
        edgeLabelBackground: '#ffffff', labelBackground: '#ffffff', labelTextColor: '#1c2742',
        noteBkgColor: '#fff7e0', noteTextColor: '#5a4a20', noteBorderColor: '#d9c48a',
        actorBkg: '#eef2ff', actorBorder: '#98a7d8', actorTextColor: '#1c2742', actorLineColor: '#98a7d8',
        signalColor: '#5a6aa8', signalTextColor: '#1c2742', labelBoxBkgColor: '#eef2ff',
        labelBoxBorderColor: '#98a7d8', labelTextColor: '#1c2742', loopTextColor: '#1c2742',
        activationBkgColor: '#e3e9ff', activationBorderColor: '#98a7d8', sequenceNumberColor: '#ffffff',
        classText: '#1c2742', classBorder: '#98a7d8', classTitleBkg: '#e3e9ff',
        stateBkg: '#eef2ff', stateText: '#1c2742', stateBorder: '#98a7d8',
        compositeBackground: '#f6f8ff', compositeTitleBackground: '#eef2ff', compositeBorder: '#c3cce4'
      }
    });
    (async () => {
      for (let i = 0; i < codes.length; i += 1) {
        try {
          const { svg } = await mermaid.render('flow-diagram-' + i, codes[i]);
          window.__svgs.push(svg);
        } catch (error) {
          window.__svgs.push('<pre class="render-error">' + String(error).replace(/</g, '&lt;') + '</pre>');
        }
      }
      window.__ready = true;
    })();
  </script></body></html>`
  const file = join(process.cwd(), '.tmp-flow', 'render.html')
  writeFileSync(file, page, 'utf8')
  const profile = mkdtempSync(join(tmpdir(), 'flow-render-'))
  const port = 9500 + Math.floor(Math.random() * 400)
  const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' })
  try {
    let target
    for (let attempt = 0; attempt < 120 && !target; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(file).href)}`, { method: 'PUT' })
        if (response.ok) target = await response.json()
      } catch { /* still starting */ }
      if (!target) await sleep(250)
    }
    if (!target) throw new Error('the browser did not open the render page')
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    let id = 0
    const pending = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    }
    const send = (method, params = {}) => new Promise(resolve => {
      const requestId = ++id
      pending.set(requestId, resolve)
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    await send('Runtime.enable')
    let svgs
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const result = await send('Runtime.evaluate', { expression: 'JSON.stringify({ ready: !!window.__ready, svgs: window.__svgs || [], error: window.__error || "" })', returnByValue: true })
      const value = JSON.parse(result.result?.result?.value ?? '{}')
      if (value.ready) { svgs = value.svgs; break }
      await sleep(500)
    }
    socket.close()
    if (!svgs) throw new Error('diagram rendering timed out')
    return svgs
  } finally {
    child.kill()
  }
}

const svgs = await renderDiagrams(parsed.mermaid)
console.log(`rendered ${svgs.length}/${parsed.mermaid.length} diagrams`)

const toc = [...source.matchAll(/^## (.+)$/gm)].map(match => match[1].replace(/[*`]/g, ''))
const nav = toc.map(section => `<a href="#${encodeURIComponent(section)}">${escapeHtml(section)}</a>`).join('')
const body = parsed.html.replace(/\{\{DIAGRAM:(\d+)\}\}/g, (_match, id) => svgs[Number(id)] ?? '<p class="render-error">diagram failed</p>')

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FLOW · 从来源到执行的数据与决策流</title>
<style>
  :root{
    --bg0:#ffffff; --bg1:#f6f8ff; --panel:rgba(28,39,66,.035);
    --line:rgba(28,39,66,.13); --text:#1c2742; --dim:#4a5675; --faint:#6b7793;
    --kaneo:#4f5fd0; --gitea:#1f9d63; --ntfy:#c47f0a; --accent:#5b5bd6; --danger:#c62f45;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:
      radial-gradient(1200px 800px at 82% -10%, rgba(124,140,255,.10), transparent 60%),
      radial-gradient(1000px 700px at -10% 110%, rgba(65,201,138,.08), transparent 55%),
      #ffffff;
    background-attachment:fixed;
    color:var(--text);
    font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",system-ui,sans-serif;
    font-size:15.5px;line-height:1.75;
  }
  .page{max-width:1120px;margin:0 auto;padding:52px 40px 80px}
  .cover{border:1px solid var(--line);border-radius:22px;padding:40px 44px;margin-bottom:34px;
    background:linear-gradient(160deg,#ffffff,#f7f9ff);
    box-shadow:0 18px 46px rgba(28,39,66,.10), inset 0 1px 0 #ffffff;position:relative;overflow:hidden}
  .kicker{display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase;font-weight:700}
  .kicker .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px rgba(91,91,214,.45)}
  h1{font-size:46px;line-height:1.1;letter-spacing:-.02em;font-weight:800;margin:14px 0 10px;color:#0e1730}
  h2{font-size:27px;line-height:1.2;font-weight:800;margin:44px 0 14px;padding-top:22px;border-top:1px solid var(--line);color:#111a33}
  h3{font-size:18.5px;font-weight:700;margin:26px 0 10px;color:#1c2742}
  h4{font-size:16px;font-weight:700;margin:20px 0 8px;color:#2a3550}
  .accent{background:linear-gradient(100deg,#6a5ae0,#4f5fd0 45%,#1f9d63);-webkit-background-clip:text;background-clip:text;color:transparent}
  .lead{font-size:16px;line-height:1.7;color:var(--dim);max-width:62em}
  .tags{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 14px}
  .tag{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:999px;font-size:13px;font-weight:600;
    border:1px solid var(--line);background:var(--panel);color:var(--dim)}
  .tag.kaneo{color:#3b4bb5;border-color:rgba(79,95,208,.40);background:rgba(79,95,208,.09)}
  .tag.gitea{color:#157a4c;border-color:rgba(31,157,99,.38);background:rgba(31,157,99,.09)}
  .tag.ntfy{color:#9a6208;border-color:rgba(196,127,10,.38);background:rgba(196,127,10,.09)}
  .tag.s3{color:#156a8f;border-color:rgba(21,106,143,.35);background:rgba(21,106,143,.08)}
  .meta{display:flex;gap:34px;flex-wrap:wrap;margin-top:18px;font-size:13px;color:var(--faint)}
  .meta b{display:block;color:var(--text);font-size:14px;margin-top:2px}
  .toc{margin:0 0 12px;padding:20px 24px;border:1px solid var(--line);border-radius:16px;background:#fafbff;
    columns:2;column-gap:34px;font-size:13.5px}
  .toc a{display:block;color:var(--dim);text-decoration:none;padding:3px 0}
  .toc a:hover{color:#3b4bb5}
  p{margin:10px 0;color:#34405c}
  a{color:#2f4fd0;text-decoration:none;border-bottom:1px dotted rgba(47,79,208,.35)}
  ul,ol{margin:10px 0 10px 1.4em}
  li{margin:5px 0;color:#34405c}
  code{font-family:"Cascadia Mono","Consolas",monospace;font-size:.88em;background:#eef2ff;
    border:1px solid rgba(79,95,208,.20);border-radius:6px;padding:1px 6px;color:#26325a;white-space:nowrap}
  pre{background:#f6f8ff;border:1px solid #e2e7f5;border-radius:12px;padding:16px 18px;overflow:auto;margin:14px 0}
  pre code{background:none;border:0;padding:0;white-space:pre;color:#26325a}
  blockquote{margin:14px 0;padding:14px 18px;border-left:3px solid var(--accent);border-radius:0 12px 12px 0;
    background:#f5f7ff;color:#37425e}
  blockquote p{margin:0}
  hr{border:0;border-top:1px solid var(--line);margin:26px 0}
  .table-wrap{overflow-x:auto;margin:14px 0;border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;line-height:1.55}
  thead th{background:#eef2fb;color:#1c2742;text-align:left;font-weight:700;padding:9px 12px;
    border-bottom:1px solid var(--line);white-space:nowrap}
  tbody td{padding:8px 12px;border-bottom:1px solid rgba(28,39,66,.09);color:#37425e;vertical-align:top}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:nth-child(even) td{background:#fafbff}
  .diagram{margin:18px 0;padding:16px;border:1px solid #e2e7f5;border-radius:14px;
    background:#ffffff;overflow:hidden}
  .diagram .svg-wrap{display:flex;justify-content:center}
  .diagram svg{max-width:100%;height:auto}
  .render-error{color:var(--danger);font-size:13px}
  .footer{margin-top:46px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--faint)}
  @page{size:A4 portrait;margin:13mm 11mm}
  @media print{
    body{background:#ffffff !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:11pt;line-height:1.62}
    .page{max-width:none;padding:0}
    .cover{padding:26px 28px;margin-bottom:20px;box-shadow:none}
    h1{font-size:30pt}h2{font-size:17pt;margin:20px 0 8px;padding-top:12px}h3{font-size:12.5pt;margin:12px 0 6px}
    .toc{columns:2;font-size:9.5pt;padding:12px 14px;margin-bottom:8px}
    .diagram{break-inside:avoid;page-break-inside:avoid;padding:8px;margin:10px 0;display:flex;justify-content:center}
    .diagram svg{max-width:100%;max-height:880px;width:auto;height:auto;display:block}
    .table-wrap{break-inside:auto}
    table{font-size:8.6pt}thead th{padding:5px 7px}tbody td{padding:4px 7px}
    pre{break-inside:avoid}blockquote{break-inside:avoid}
    .tag,.tag.kaneo,.tag.gitea,.tag.ntfy,.tag.s3{color:#25314f !important}
  }
</style>
</head>
<body>
<div class="page">
  <header class="cover">
    <div class="kicker"><span class="dot"></span>FLOW · SOURCE → DECISION → EXECUTION</div>
    <h1>从来源到执行<br><span class="accent">数据与决策流</span></h1>
    <p class="lead">来源只把外部事实变成 Trigger；Intake 去重与扇出；Evals 与主 Session 决定接不接；Tickets 用 Mandate 授权；DshExecutor 派发 worker Session；Replies 把结果写回来源。14 张图 + 逐字段的 UI 设置映射。</p>
    <div class="tags">
      <span class="tag kaneo">Kanban 看板</span><span class="tag gitea">Gitea 宪章</span>
      <span class="tag ntfy">ntfy 主题</span><span class="tag s3">MinIO 资产</span>
      <span class="tag">14 diagrams</span><span class="tag">settings → code</span>
    </div>
    <div class="meta">
      <div>文档<b>FLOW.md</b></div>
      <div>相关<b>BLK.md · docs/005 · docs/007</b></div>
      <div>生成方式<b>node scripts/build-flow-doc.mjs</b></div>
    </div>
  </header>
  <nav class="toc">${nav}</nav>
  ${body}
  <footer class="footer">由 FLOW.md 生成：Markdown → HTML（AIOS 同款深色主题），Mermaid 图在无头 Chrome 中预渲染为内联 SVG；PDF 由 scripts/html-to-pdf.mjs 打印。</footer>
</div>
</body>
</html>`

writeFileSync('FLOW.html', html, 'utf8')
console.log(`FLOW.html written: ${(html.length / 1024).toFixed(0)} KB, ${toc.length} sections, ${svgs.length} diagrams`)
