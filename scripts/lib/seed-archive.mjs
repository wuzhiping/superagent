/**
 * Moves the deployment's project archive to the slim shape: the charter becomes a document the PM publishes in the
 * panel (the board's charter card is read once, as the starting text), and each post carries the columns it takes.
 */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const base = process.env.PANEL ?? 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }
const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })

const current = await fetch(`${base}/project-archive`, { headers }).then(response => response.json())
const archive = current.archive
for (const project of archive.projects) {
  const carrier = project.charterTaskId
  if (carrier && !project.charter?.text) {    const task = await client.getTask(carrier)
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
    console.log(`project ${project.id}: charter taken from the carrier card (v${version})`)
  }
  for (const post of project.posts) {
    if (!post.watchColumns) post.watchColumns = project.watchColumns ?? 'ready'
  }
}
const answer = await fetch(`${base}/project-archive`, {
  method: 'PUT', headers, body: JSON.stringify({ archive, revision: current.revision }),
}).then(response => response.json())
console.log('archive written:', JSON.stringify(answer))
