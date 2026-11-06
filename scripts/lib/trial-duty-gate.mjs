/**
 * The duty gate on the live Host, plus the evidence of the finished trial: the deliverable, the brief in the worker's
 * session log, and a card that names an undefined duty being refused with `dutyUndefined` and no ticket.
 *
 *   node scripts/lib/trial-duty-gate.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createClient, sleep } from './kaneo-client.mjs'
import { sourceApiKey } from './store-read.mjs'

const STATE_DIR = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PANEL = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${PANEL}/${path}`, { method: init.method ?? 'GET', headers,
    body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}
const waitFor = async (read, accept, timeoutMs = 900_000, stepMs = 5_000, label = 'condition') => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const value = await read(); if (value && accept(value)) return value } catch {}
    await sleep(stepMs)
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const record = { stamp, verifiedAt: new Date().toISOString(), ticketId: '0272751b01f60ddae0cca01c1b7c9adb' }

// ---- The finished trial's evidence ----------------------------------------------------------------
const ticket = await panel(`tickets/${record.ticketId}`)
const card = ticket.card ?? ticket
const assignments = ticket.assignments ?? card.assignments ?? []
const report = assignments.map(item => item.report).filter(Boolean).at(-1)
record.ticket = { state: card.state, postId: card.postId ?? ticket.postId, projectId: card.projectId ?? ticket.projectId,
  duty: card.duty ?? ticket.duty, charterVersion: card.charterVersion ?? ticket.charterVersion }
record.report = { state: report?.state, summary: String(report?.summary ?? '').slice(0, 2500) }
record.deliverableReferenced = /deliverables\/[^`\s]+\/duty-trial\.md/.test(record.report.summary ?? '')
record.briefConfirmedByWorker = /Duty brief/.test(record.report.summary ?? '')

const prefix = `deliverables/${record.ticket.projectId}/${record.ticketId}/`
const objects = await fetch(`http://127.0.0.1:3080/plugins/dsh-minio-s3/objects?bucket=ateam&prefix=${encodeURIComponent(prefix)}&delimiter=`)
  .then(response => response.json())
record.deliverable = { prefix, keys: (objects.objects ?? []).map(item => item.key ?? item.name) }

const decodeSession = file => {
  const bytes = readFileSync(file)
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts = []
  for (let at = bytes.indexOf(MAGIC); at >= 0; at = bytes.indexOf(MAGIC, at + 1)) starts.push(at)
  let text = ''
  for (let index = 0; index < starts.length; index += 1) {
    try { text += zstdDecompressSync(bytes.subarray(starts[index], starts[index + 1] ?? bytes.length)).toString('utf8') } catch {}
  }
  return text
}
const findSession = id => {
  for (const root of [STATE_DIR, 'D:/Refine/Books/ntop/AI/dsh/state', 'D:/Refine/Books/ntop/AI/dsh/profiles']) {
    const stack = [[root, 0]]
    while (stack.length) {
      const [dir, depth] = stack.pop()
      if (depth > 7) continue
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) { stack.push([path, depth + 1]); continue }
        if (entry.name.includes(id) && entry.name.endsWith('.zstd')) return path
      }
    }
  }
  return undefined
}
const sessionFile = findSession(record.ticketId)
const sessionText = sessionFile ? decodeSession(sessionFile) : ''
record.session = { file: sessionFile ?? null, briefInPrompt: /Duty brief/.test(sessionText),
  dutyNamed: /文档交付/.test(sessionText), charterToolUsed: /orchestrator_read/.test(sessionText) }

// ---- The gate on the live Host: a normal-looking card whose duty is not defined --------------------
const settings = await panel('settings')
const kaneoConfig = settings.sources.find(source => source.id === 'kaneo').value.config
process.env.KANEO_API_KEY = sourceApiKey(STATE_DIR, 'kaneo')
const kaneo = createClient({ base: kaneoConfig.baseUrl || 'https://pl.feg.cn' })
const label = async (name, color = '#0969da') => {
  const workspaces = await kaneo.api('GET', '/workspace')
  const workspaceId = workspaces[0]?.id
  const existing = await kaneo.api('GET', `/label/workspace/${encodeURIComponent(workspaceId)}`)
  const found = (Array.isArray(existing) ? existing : []).find(item => item.name === name)
  return (found ?? await kaneo.api('POST', '/label', { name, color, workspaceId }))?.id
}
const attach = async (name, taskId, color) => { const id = await label(name, color); if (id) await kaneo.api('PUT', `/label/${encodeURIComponent(id)}/task`, { taskId }) }
const archive = (await panel('project-archive')).archive
const project = archive.projects.find(item => item.id === kaneoConfig.projectId)
const pm = project?.posts.find(item => item.role === 'pm' && item.kaneoUserId)
const watched = String(kaneoConfig.watchColumns).split(',')[0].trim()
const staging = watched === 'to-do' ? 'in-review' : 'to-do'
const before = (await panel('tickets?state=open')).items?.length ?? 0
const bad = await kaneo.api('POST', `/task/${encodeURIComponent(kaneoConfig.projectId)}`, {
  title: `[duty-trial ${stamp}] 夜间例检：给这份文档做一次校对`,
  description: '按常规文档类卡处理：读项目宪章，产出一份简短的校对说明交付到 MinIO。',
  priority: 'no-priority', status: staging,
})
const badId = bad?.id ?? bad?.task?.id
await attach('kind:doc', badId)
await attach('duty:no-such-duty', badId)
await attach('duty-trial', badId)
if (pm?.kaneoUserId) await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(badId)}`, { userId: pm.kaneoUserId })
await kaneo.api('PUT', `/task/status/${encodeURIComponent(badId)}`, { status: watched })
record.gate = { cardId: badId, title: `[duty-trial ${stamp}] 夜间例检：给这份文档做一次校对` }
const refused = await waitFor(async () => {
  const list = await panel('decisions?limit=15')
  return (list.items ?? []).find(item => JSON.stringify(item.reason ?? '').includes('dutyUndefined'))
}, value => !!value, 420_000, 6_000, 'the dutyUndefined refusal')
record.gate.decision = { id: refused.id, outcome: refused.outcome,
  reason: (refused.reason ?? []).map(item => item.code), at: refused.at, threadTitle: refused.threadTitle }
record.gate.openTicketsBefore = before
record.gate.openTicketsAfter = (await panel('tickets?state=open')).items?.length ?? 0
record.gate.noTicketInThread = !((await panel('tickets?limit=30')).items ?? []).some(item => String(item.title).includes(stamp))
await kaneo.api('DELETE', `/task/${encodeURIComponent(badId)}`).catch(() => {})

writeFileSync(`TDD/artifacts/duty-gate-${stamp}.json`, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  ticket: record.ticket, deliverable: record.deliverable.keys, briefInPrompt: record.session.briefInPrompt,
  briefConfirmedByWorker: record.briefConfirmedByWorker,
  gate: { decision: record.gate.decision, openTicketsBefore: record.gate.openTicketsBefore,
    openTicketsAfter: record.gate.openTicketsAfter, noTicketInThread: record.gate.noTicketInThread },
}, null, 2))
