import { DatabaseSync } from 'node:sqlite'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const ticketId = process.argv[3]
const db = new DatabaseSync(`${stateDir.replace(/\\/g, '/')}/orchestrator.sqlite`, { readOnly: true })
console.log('--- effects ---')
for (const row of db.prepare('select kind, key, value, seq, attempts, due from effect order by seq').all()) {
  console.log(`  ${row.kind} key=${row.key} attempts=${row.attempts} due=${row.due} value=${String(row.value).slice(0, 160)}`)
}
console.log('--- outbox ---')
for (const row of db.prepare('select id, value from outbox').all()) {
  const value = JSON.parse(row.value)
  console.log(`  ${row.id} kind=${value.kind} ticket=${value.ticketId ?? '-'} text=${String(value.text).slice(0, 60)}`)
}
if (ticketId) {
  const ticket = db.prepare('select value from ticket where id = ?').get(ticketId)
  console.log('--- ticket ---')
  console.log(ticket ? String(ticket.value).slice(0, 900) : '(none)')
}
db.close()
