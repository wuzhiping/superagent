import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const project = process.argv[3] ?? 'dgctny8ibgpn72ei2j8qj2hc'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })
for (const status of ['ready', 'in-progress', 'blocked']) {
  const board = await client.api('GET', `/task/tasks/${encodeURIComponent(project)}?status=${status}&limit=100`)
  const columns = board?.data?.columns ?? board?.columns ?? []
  for (const column of columns) {
    for (const task of column.tasks ?? []) {
      const labels = await client.getLabels(task.id)
      console.log(`[${column.slug}] #${task.number ?? '?'} ${task.title} | assignee=${task.assigneeId ?? '-'} | labels=${labels.join(',') || '-'} | id=${task.id}`)
    }
  }
}
