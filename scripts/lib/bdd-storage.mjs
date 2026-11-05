/**
 * Reads one service's connection out of the BDD storage record, the same way dsh-minio-s3 does: the local
 * `refs.<name>` credential is masked (`sk-` + base64(key@ISO8601)) and POSTed to the storage host, which answers with
 * that service's connection data. The masked key is only ever sent to the storage host; the answer is printed with the
 * secret-looking fields masked.
 *
 *   node scripts/lib/bdd-storage.mjs kaneo|ntfy|gitea|s3
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STORAGE_HOST = 'abc.feg.com.tw'
const REFS = ['AIFE_API_KEY', 'FEG_API_KEY', 'DEEPSEEK_API_KEY']
const SECRET_FIELDS = /pwd|pass|secret|token|key$|apikey|api_key/i

const credentialsFile = (env = process.env) => {
  const override = (env.DSH_CREDENTIALS_PATH ?? '').trim()
  if (override) return override
  return join(env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
}

const readRef = (text, name) => {
  let inRefs = false
  let refsIndent = -1
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (/^refs:\s*$/.test(trimmed)) { inRefs = true; refsIndent = indent; continue }
    if (!inRefs) continue
    if (indent <= refsIndent) { inRefs = false; continue }
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed)
    if (!match || match[1] !== name) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    return value || null
  }
  return null
}

const maskKey = key => `sk-${Buffer.from(`${key}@${new Date().toISOString()}`, 'utf8').toString('base64')}`

const file = credentialsFile()
let text
try { text = readFileSync(file, 'utf8') } catch (error) { console.error(`cannot read ${file}: ${error.message}`); process.exit(1) }
let masked
let refUsed
for (const ref of REFS) {
  const key = readRef(text, ref)
  if (!key) continue
  masked = maskKey(key)
  refUsed = ref
  break
}
if (!masked) { console.error(`no usable ref in ${file} (tried ${REFS.join(', ')})`); process.exit(1) }

const names = process.argv.slice(2).filter(name => /^[a-z0-9-]+$/i.test(name))
if (!names.length) { console.error('usage: bdd-storage.mjs <name> [name...]'); process.exit(1) }
for (const name of names) {
  const response = await fetch(`https://${STORAGE_HOST}/BDD/API/AI/dsh/storage/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: masked }), signal: AbortSignal.timeout(10_000),
  })
  const raw = await response.text()
  let payload
  try { payload = raw ? JSON.parse(raw) : null } catch { payload = null }
  const shown = payload && typeof payload === 'object'
    ? Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, SECRET_FIELDS.test(key) && typeof value === 'string'
      ? `${value.slice(0, 3)}…(${value.length} chars)` : value]))
    : raw.slice(0, 200)
  console.log(`\n/storage/${name}  HTTP ${response.status}  ref=${refUsed}`)
  console.log(typeof shown === 'string' ? shown : JSON.stringify(shown, null, 1))
}
