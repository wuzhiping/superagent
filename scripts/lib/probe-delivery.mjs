/** Inspects one Kanban card and one ticket: what the worker did, where the card sits, and whether the object is there. */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PANEL_BASE = process.env.PANEL_BASE ?? 'http://127.0.0.1:3080'
const PANEL = `${PANEL_BASE}/orchestrator/api`
const taskId = process.argv[2]
const ticketId = process.argv[3]
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const kaneo = createClient({ base: 'https://pl.feg.cn' })
const headers = { 'x-orchestrator-request': '1' }

if (taskId) {
  const task = await kaneo.getTask(taskId)
  console.log(`card ${taskId}: status=${task.status} title=${task.title}`)
  const comments = await kaneo.getComments(taskId)
  console.log(`comments: ${comments.length}`)
  for (const comment of comments) {
    console.log(`--- ${String(comment.createdAt ?? '').slice(0, 19)} ---`)
    console.log(String(comment.content ?? '').slice(0, 1200))
  }
}

if (ticketId) {
  const detail = await (await fetch(`${PANEL}/tickets/${ticketId}`, { headers })).json()
  console.log(`ticket: state=${detail.state} stage=${detail.stage?.stage ?? ''} result=${detail.stage?.result?.state ?? ''}`)
  console.log(`assignments: ${(detail.assignments ?? []).map(item => `${item.id}:${item.state}`).join(', ')}`)
}

// Every object under the project's deliverables prefix, so the store is checked independently of the report.
const listing = await (await fetch(`${PANEL_BASE}/plugins/dsh-minio-s3/objects?bucket=ateam&prefix=deliverables/&delimiter=`, { headers })).json()
const keys = (listing.objects ?? []).map(object => object.key ?? object.name)
console.log(`store deliverables/*: ${keys.length}`)
for (const key of keys.slice(0, 10)) console.log(`   ${key}`)
