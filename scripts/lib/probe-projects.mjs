/** Reads the Kanban project list the way the panel will read it (no secrets printed). */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const client = createClient({ base: 'https://pl.feg.cn' })

const workspaces = await client.api('GET', '/workspace')
const rows = Array.isArray(workspaces) ? workspaces : (workspaces?.data ?? [])
console.log(`workspaces: ${rows.length}`)
for (const workspace of rows) {
  console.log(`- ${workspace.name} (${workspace.id})`)
  for (const [label, path] of [
    ['projects?workspaceId', `/project?workspaceId=${encodeURIComponent(workspace.id)}`],
    ['projects (no filter)', '/project'],
  ]) {
    try {
      const answer = await client.api('GET', path)
      const list = Array.isArray(answer) ? answer : (answer?.data ?? answer?.projects ?? [])
      console.log(`    ${label}: ${Array.isArray(list) ? list.length : 0} project(s)` +
        (Array.isArray(list) ? ': ' + list.map(item => `${item.slug}/${item.name}(${item.id})`).join(', ') : ''))
    } catch (error) {
      console.log(`    ${label}: ${String(error.message)}`)
    }
  }
}
