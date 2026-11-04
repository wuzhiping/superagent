import { DatabaseSync } from 'node:sqlite'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const taskId = process.argv[3]
const db = new DatabaseSync(`${stateDir.replace(/\\/g, '/')}/orchestrator.sqlite`, { readOnly: true })
console.log('threads:', db.prepare('select key from thread where key like ?').all(`%${taskId}%`).map(row => row.key))
console.log('outbox:', db.prepare('select id, value from outbox').all()
  .filter(row => String(row.value).includes(taskId)).map(row => ({ id: row.id, kind: JSON.parse(row.value).kind })))
console.log('decisions:', db.prepare('select id, value from decision').all()
  .filter(row => String(row.value).includes(taskId)).map(row => ({ id: row.id, kind: JSON.parse(row.value).kind })))
console.log('--- all threads ---')
for (const row of db.prepare('select key from thread').all()) console.log(' ', row.key)
console.log('--- outbox (all) ---')
for (const row of db.prepare('select id, value from outbox').all()) {
  const value = JSON.parse(row.value)
  console.log(`  ${row.id} kind=${value.kind} ticket=${value.ticketId ?? '-'} channel=${value.channel?.source}:${value.channel?.address?.taskId ?? value.channel?.thread ?? '-'}`)
}
db.close()
