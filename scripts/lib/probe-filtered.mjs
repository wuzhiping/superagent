import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })
const project = 'dgctny8ibgpn72ei2j8qj2hc'
for (const query of ['', '?status=done&limit=100', '?status=ready&limit=100']) {
  const payload = await client.api('GET', `/task/tasks/${project}${query}`)
  const data = payload?.data ?? payload
  const keys = Object.keys(data ?? {})
  const columns = data?.columns ?? []
  const tasks = data?.tasks ?? []
  console.log(`query='${query}' keys=${keys.join(',')} columns=${columns.length} tasks=${tasks.length}`)
  for (const column of columns) console.log(`   column ${column.slug ?? column.id}: ${(column.tasks ?? []).length}`)
  for (const task of tasks.slice(0, 3)) console.log(`   task ${task.id} status=${task.status} number=${task.number}`)
}
