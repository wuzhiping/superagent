import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const project = process.argv[3] ?? 'dgctny8ibgpn72ei2j8qj2hc'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })
const board = await client.api('GET', `/task/tasks/${encodeURIComponent(project)}`)
const columns = board?.data?.columns ?? board?.columns ?? []
for (const column of columns) {
  console.log(`${column.slug} (${column.name ?? ''}): ${(column.tasks ?? []).length} tasks`)
}
const me = await client.api('GET', '/user/me')
console.log('me:', me?.id, me?.name ?? me?.username)
