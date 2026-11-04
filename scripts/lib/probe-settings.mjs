import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('D:/Refine/Books/ntop/AI/dsh/state/superagent/orchestrator.sqlite', { readOnly: true })
const rows = db.prepare("select key, value from kv where key like 'settings-version:%' order by cast(substr(key, 18) as integer) desc limit 1").all()
const parsed = JSON.parse(rows[0].value)
console.log('key:', rows[0].key)
console.log('top:', Object.keys(parsed).join(', '))
console.log('block:', parsed.block, 'source:', parsed.source)
console.log('settings keys:', Object.keys(parsed.settings ?? {}).join(', '))
for (const [id, source] of Object.entries(parsed.settings?.sources ?? {})) {
  console.log(`source ${id}: keys [${Object.keys(source ?? {}).join(', ')}]`)
  console.log(`  config keys: [${Object.keys(source?.config ?? {}).join(', ')}] apiKeyLen=${(source?.config?.apiKey ?? '').length}`)
}
console.log('eval:', JSON.stringify(parsed.settings?.eval))
db.close()
