/** Probe helper: prints the shape of the deployment's store tables and the KanEO source config keys (never values). */
import { DatabaseSync } from 'node:sqlite'

const stateDir = process.argv[2] ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const db = new DatabaseSync(`${stateDir.replace(/\\/g, '/')}/orchestrator.sqlite`, { readOnly: true })
const tables = db.prepare("select name from sqlite_master where type='table'").all().map(row => row.name)
console.log('tables:', tables.join(', '))
for (const table of tables) {
  const columns = db.prepare(`pragma table_info(${table})`).all().map(row => row.name)
  const count = db.prepare(`select count(*) as n from ${table}`).get().n
  console.log(`${table}: ${count} rows [${columns.join(', ')}]`)
}
const settings = tables.find(name => name.includes('setting'))
if (settings) {
  for (const row of db.prepare(`select * from ${settings}`).all()) {
    const text = JSON.stringify(row)
    console.log(`row keys: ${Object.keys(row).join(', ')} | length ${text.length} | mentions kaneo: ${text.includes('kaneo')}`)
  }
}
db.close()
