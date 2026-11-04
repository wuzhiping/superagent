import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })
for (const taskId of process.argv.slice(3)) {
  const task = await client.getTask(taskId)
  const comments = await client.getComments(taskId)
  console.log(`--- ${taskId} status=${task.status} assignee=${task.assigneeId ?? '-'} comments=${comments.length}`)
  for (const comment of comments) {
    console.log(`  [${comment.createdAt ?? ''}] ${String(comment.content ?? '').slice(0, 220).replace(/\n/g, ' | ')}`)
  }
}
