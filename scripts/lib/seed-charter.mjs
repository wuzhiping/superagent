/**
 * Puts the charter into the archive as the published document the PM writes in the panel: the text comes from the
 * charter card on the board (the place it was written before), and the flow it declares is what the panel compares
 * with the board's columns.
 */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const base = process.env.PANEL ?? 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }
const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const carrier = process.argv[2] ?? 'vsrelqw8xbd9js0m13hb7qve'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })

const current = await fetch(`${base}/project-archive`, { headers }).then(response => response.json())
const archive = current.archive
for (const project of archive.projects) {
  if (project.charter?.text) continue
  const task = await client.getTask(carrier)
  const text = String(task.description ?? '')
  const version = Number(/version:\s*(\d+)/.exec(text)?.[1] ?? 1)
  const publishedBy = /publishedBy:\s*(\S+)/.exec(text)?.[1] ?? ''
  project.charter = {
    version,
    publishedAt: String(task.updatedAt ?? task.createdAt ?? ''),
    publishedBy,
    text,
    draft: text,
    history: [],
  }
  console.log(`project ${project.id}: charter v${version} published by ${publishedBy} (${text.length} chars)`)
}
const answer = await fetch(`${base}/project-archive`, {
  method: 'PUT', headers, body: JSON.stringify({ archive, revision: current.revision }),
}).then(response => response.json())
console.log('archive written:', JSON.stringify(answer))
