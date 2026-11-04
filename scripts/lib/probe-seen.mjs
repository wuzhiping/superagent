import { DatabaseSync } from 'node:sqlite'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const taskId = process.argv[3]
const db = new DatabaseSync(`${stateDir.replace(/\\/g, '/')}/orchestrator.sqlite`, { readOnly: true })
const rows = db.prepare('select key, value from kv where key like ?').all(`kaneo-seen:${taskId}`)
console.log('seen marker:', rows.length ? rows[0].value : '(none)')
for (const key of ['kaneo-bootstrap', 'kaneo-cursor:ready']) {
  const row = db.prepare('select value from kv where key = ?').get(key)
  console.log(`${key}:`, row ? row.value : '(none)')
}
const triggers = db.prepare("select id, value from trigger where value like ?").all(`%${taskId}%`)
console.log('triggers for the card:', triggers.map(row => row.id))
db.close()
