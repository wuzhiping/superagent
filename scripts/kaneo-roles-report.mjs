#!/usr/bin/env node
/**
 * Counts the role conventions that already live on the KanEO board, to compare the team's real practice with the
 * narrative in RD.md. Read-only: it lists tasks and comments and reports counts, never writes.
 *
 * Usage: node scripts/kaneo-roles-report.mjs --key-file <path> [--project <id>]
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const options = { base: 'https://pl.feg.cn', keyFile: '', project: '' }
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--key-file') options.keyFile = argv[++i]
  else if (arg === '--base') options.base = argv[++i]
  else if (arg === '--project') options.project = argv[++i]
  else if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0) }
  else { console.error(`unknown argument: ${arg}`); process.exit(2) }
}
const HELP = `kaneo-roles-report — count role conventions on a KanEO board (read-only)

  --key-file <path>   file containing the KanEO API key (or set KANEO_API_KEY / KANEO_KEY_FILE)
  --project <id>      project id (default: every project of the workspace)
`

const KEY = process.env.KANEO_API_KEY?.trim() || readFileSync(options.keyFile, 'utf8').trim()

async function api (method, path) {
  const response = await fetch(`${options.base}/api${path}`, { method, headers: { 'x-api-key': KEY } })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 120)}`)
  return text ? JSON.parse(text) : null
}

const roles = new Map()
const concepts = new Map()
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)

async function main () {
  const workspaces = await api('GET', '/workspace')
  const workspaceId = workspaces[0]?.id
  const projects = await api('GET', `/project?workspaceId=${encodeURIComponent(workspaceId ?? '')}`)
  const targets = options.project ? projects.filter(item => item.id === options.project) : projects
  const markers = ['領受人', 'WIP', '請求卡', '回合', '合流', '邊界', '交付物', '委託', '驗收']

  for (const project of targets) {
    const board = await api('GET', `/task/tasks/${encodeURIComponent(project.id)}`)
    const columns = board?.data?.columns ?? []
    const tasks = columns.flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
    let commentCount = 0
    for (const task of tasks) {
      const comments = await api('GET', `/comment/${encodeURIComponent(task.id)}`)
      for (const comment of comments ?? []) {
        const content = String(comment.content ?? '')
        commentCount += 1
        for (const match of content.matchAll(/【agent:([a-z0-9\-_]+)】/g)) bump(roles, match[1])
        for (const marker of markers) if (content.includes(marker)) bump(concepts, marker)
      }
    }
    console.log(`\n=== ${project.name} (${project.slug}) ===`)
    console.log(`tasks=${tasks.length} comments=${commentCount}`)
    console.log('roles in comments:', [...roles.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(', ') || '(none)')
    console.log('concepts:', [...concepts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(', ') || '(none)')
    const assigned = tasks.filter(task => task.assigneeId).length
    console.log(`tasks with assignee: ${assigned}/${tasks.length}`)
    console.log('columns:', columns.map(column => `${column.slug}(${(column.tasks ?? []).length})`).join(' '))
  }
}

main().catch(error => { console.error(`report failed: ${error.message}`); process.exit(1) })
