#!/usr/bin/env node
/**
 * Post accounts: verifies the KanEO bot account of every post and emits the post profiles (岗位档案) that the
 * superagent instances need. Accounts themselves are created in the KanEO UI (the REST API has no create-user
 * route for API keys), so this script starts from the roster and the API keys the admin issued.
 *
 * Usage:
 *   node scripts/post-accounts.mjs --roster <file.json> [--out <file.json>]
 *
 * Roster shape:
 * {
 *   "workspaceId": "...",
 *   "posts": [
 *     { "postId": "pm-pipeline", "role": "pm", "projectId": "...", "name": "...",
 *       "email": "...", "kaneoUserId": "", "apiKeyFile": "keys/sa-pm-pipeline.key",
 *       "giteaUser": "...", "ntfySender": "#...", "watchColumns": "to-do,in-progress",
 *       "claimColumn": "in-progress" }
 *   ]
 * }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const argv = process.argv.slice(2)
const options = { roster: '', out: '' }
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--roster') options.roster = argv[++i]
  else if (arg === '--out') options.out = argv[++i]
  else if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0) }
  else { console.error(`unknown argument: ${arg}`); process.exit(2) }
}
const HELP = `post-accounts — verify post accounts and emit post profiles

  --roster <file>   roster JSON describing every post
  --out <file>      write the post profiles JSON here (default: stdout only)
`

async function whoami (base, key) {
  const response = await fetch(`${base}/api/user/me`, { headers: { 'x-api-key': key } })
  if (!response.ok) return { ok: false, status: response.status }
  const body = await response.json()
  return { ok: true, id: body.id, name: body.name, email: body.email, role: body.role }
}

async function main () {
  if (!options.roster) { console.error('--roster <file> is required'); process.exit(2) }
  const roster = JSON.parse(readFileSync(options.roster, 'utf8'))
  const base = roster.baseUrl ?? 'https://pl.feg.cn'
  const rosterDir = dirname(resolve(options.roster))

  const profiles = []
  const checklist = []
  for (const post of roster.posts ?? []) {
    const keyFile = post.apiKeyFile ? resolve(rosterDir, post.apiKeyFile) : ''
    const entry = { ...post }
    if (!keyFile || !existsSync(keyFile)) {
      entry.identity = { ok: false, reason: keyFile ? 'key file missing' : 'no apiKeyFile in roster' }
      entry.status = 'pending'
    } else {
      const key = readFileSync(keyFile, 'utf8').trim()
      entry.identity = await whoami(base, key)
      entry.status = entry.identity.ok ? 'ready' : 'failed'
      if (entry.identity.ok && post.kaneoUserId && post.kaneoUserId !== entry.identity.id) {
        entry.identityWarning = `roster userId ${post.kaneoUserId} differs from the key owner ${entry.identity.id}`
      }
    }
    profiles.push(entry)
    checklist.push({
      postId: post.postId,
      role: post.role,
      projectId: post.projectId,
      status: entry.status,
      kaneoUserId: entry.identity?.id ?? '',
      settings: {
        kaneo: {
          baseUrl: base,
          apiKey: keyFile ? `(from ${post.apiKeyFile})` : '(missing)',
          projectId: post.projectId,
          watchColumns: post.watchColumns ?? '(per project)',
          claimColumn: post.claimColumn ?? '',
        },
        gitea: { user: post.giteaUser ?? '', password: '(secret, set in the panel)' },
        ntfy: { baseUrl: post.ntfyBaseUrl ?? 'https://msn.feg.cn', topic: post.ntfyTopic ?? '', sender: post.ntfySender ?? '' },
      },
    })
  }

  const output = { workspaceId: roster.workspaceId, generatedAt: new Date().toISOString(), posts: profiles }
  if (options.out) { writeFileSync(options.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8'); console.log(`post profiles written to ${options.out}`) }
  console.log('\n=== wiring checklist (paste into each superagent instance) ===')
  for (const item of checklist) {
    console.log(`\n[${item.status}] ${item.postId} (${item.role}) project=${item.projectId} kaneoUser=${item.kaneoUserId || '(none)'}`)
    console.log(`    kaneo: ${item.settings.kaneo.baseUrl} | key ${item.settings.kaneo.apiKey} | project ${item.settings.kaneo.projectId} | watch ${item.settings.kaneo.watchColumns} | claim ${item.settings.kaneo.claimColumn}`)
    console.log(`    gitea: user ${item.settings.gitea.user} | ntfy: ${item.settings.ntfy.baseUrl} topic ${item.settings.ntfy.topic} sender ${item.settings.ntfy.sender}`)
  }
  const notReady = profiles.filter(profile => profile.status !== 'ready').map(profile => profile.postId)
  console.log(`\nready ${profiles.length - notReady.length}/${profiles.length}${notReady.length ? `; pending: ${notReady.join(', ')}` : ''}`)
}

main().catch(error => { console.error(`post accounts failed: ${error.message}`); process.exit(1) })
