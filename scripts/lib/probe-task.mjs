import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const taskId = process.argv[3]
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })
const task = await client.getTask(taskId)
const keys = Object.keys(task)
console.log('task keys:', keys.join(', '))
for (const key of ['id', 'number', 'title', 'status', 'assigneeId', 'assigneeName', 'userId', 'createdById', 'createdAt', 'updatedAt', 'projectId', 'columnId', 'priority']) {
  console.log(`${key}: ${JSON.stringify(task[key])}`)
}
console.log('all non-empty fields:', JSON.stringify(Object.fromEntries(Object.entries(task).filter(([, value]) =>
  value !== null && value !== undefined && value !== '' && typeof value !== 'object'))))
