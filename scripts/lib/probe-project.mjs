/**
 * Reads one kanban project as the panel will read it: the project itself (its description is where the charter lives) and
 * the board's columns (the value stream). Also proves the two endpoints the charter publisher and the flow-growth
 * verification use exist on this server.
 *
 *   node scripts/lib/probe-project.mjs <projectId>
 */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const projectId = process.argv[2]
if (!projectId) { console.error('usage: probe-project.mjs <projectId>'); process.exit(1) }
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })

const project = await client.api('GET', `/project/${encodeURIComponent(projectId)}`)
const body = project?.data ?? project
console.log(`project ${projectId}`)
console.log(`  name: ${body?.name}  slug: ${body?.slug}`)
console.log(`  description: ${String(body?.description ?? '').replace(/\s+/g, ' ').slice(0, 160) || '(empty)'}`)
console.log(`  columns (in project): ${(body?.columns ?? []).map(column => column.slug ?? column.name).join(', ') || '(none)'}`)

try {
  const columns = await client.api('GET', `/column/${encodeURIComponent(projectId)}`)
  const rows = Array.isArray(columns) ? columns : (columns?.data ?? [])
  console.log(`  GET /column/${projectId}: ${rows.length} column(s)`)
  for (const column of rows) console.log(`    ${column.position ?? '-'} ${column.slug} "${column.name}" final=${column.isFinal}`)
} catch (error) {
  console.log(`  GET /column -> ${String(error).slice(0, 160)}`)
}
