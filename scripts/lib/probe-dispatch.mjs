import { sourceApiKey } from './store-read.mjs'
import { createClient, sleep } from './kaneo-client.mjs'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const project = process.argv[3] ?? 'dgctny8ibgpn72ei2j8qj2hc'
const assignee = process.argv[4]
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })

const card = await client.api('POST', `/task/${encodeURIComponent(project)}`, {
  title: `[probe ${Date.now()}] 派工行为观察`, description: '观察看板自身的自动化是否会移动这张卡。', priority: 'no-priority', status: 'to-do',
})
const id = card?.id ?? card?.task?.id
console.log('created', id, 'status=', (await client.getTask(id)).status)
await client.api('PUT', `/task/assignee/${encodeURIComponent(id)}`, { userId: assignee })
console.log('assigned; watching the column for 90s')
for (let round = 0; round < 18; round += 1) {
  await sleep(5000)
  const task = await client.getTask(id)
  console.log(`${round * 5}s status=${task.status} columnId=${task.columnId}`)
}
console.log('now moving it to ready and watching again')
await client.api('PUT', `/task/status/${encodeURIComponent(id)}`, { status: 'ready' })
for (let round = 0; round < 12; round += 1) {
  await sleep(5000)
  const task = await client.getTask(id)
  console.log(`${round * 5}s status=${task.status} columnId=${task.columnId}`)
}
