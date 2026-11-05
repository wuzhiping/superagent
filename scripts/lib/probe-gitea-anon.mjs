/**
 * Real Gitea probe: read issues and pull requests anonymously (no account) and show what a refused request looks
 * like. Raw fetch is enough for that; when Node runs with `--experimental-transform-types` the probe also exercises
 * `src/sources/gitea-api.ts` and `src/sources/gitea.ts`, so the committed implementation is checked against the
 * server instead of a copy of its logic.
 *
 * Usage:
 *   node scripts/lib/probe-gitea-anon.mjs [owner/name] [stateDir]
 *   node --experimental-transform-types scripts/lib/probe-gitea-anon.mjs [owner/name] [stateDir] --auth
 *
 * `--auth` also probes the account stored by the deployment itself (the login is printed, the password/token never
 * is). Without `--auth` every request is anonymous. No secret is ever printed.
 */
import { storedSourceConfig } from './store-read.mjs'

const DEFAULT_BASE = 'https://git.feg.cn'
const DEFAULT_REPO = 'shawoo/PDP'
const DEFAULT_STATE = 'D:/Refine/Books/ntop/AI/dsh/state/superagent'

const args = process.argv.slice(2)
const withAuth = args.includes('--auth')
const positional = args.filter(value => !value.startsWith('--'))
const baseUrl = (process.env.DSH_SUPERAGENT_GITEA_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, '')
const repository = positional[0]?.trim() || process.env.DSH_SUPERAGENT_GITEA_REPOSITORY?.trim() || DEFAULT_REPO
const stateDir = positional[1]?.trim() || DEFAULT_STATE
const [owner, name] = repository.split('/')
if (!owner || !name) throw new Error(`the repository must be owner/name, got ${JSON.stringify(repository)}`)

/** The TypeScript implementation, when Node can transform it; plain Node falls back to raw fetch. */
let implementation
try {
  const [api, kind] = await Promise.all([import('../../src/sources/gitea-api.ts'), import('../../src/sources/gitea.ts')])
  implementation = { GiteaClient: api.GiteaClient, GiteaError: api.GiteaError, giteaKind: kind.giteaKind }
} catch {
  implementation = undefined
}

const configuration = () => ({
  baseUrl, user: '', password: '', token: '', repository, listen: 'repo', agent: 'dsh-superagent', bots: '',
  observeIssues: true, observePulls: true, observeComments: true, bootstrap: 'skip', pollSeconds: 60,
  failuresBeforeError: 3, maxItems: 50,
})

console.log(`Gitea probe — ${withAuth ? 'anonymous + stored account' : 'anonymous only'}`)
console.log(`  server: ${baseUrl}`)
console.log(`  repository: ${repository}`)
console.log(`  client: ${implementation ? 'src/sources (TypeScript implementation)' : 'raw fetch (add --experimental-transform-types to exercise src/sources)'}`)
console.log('  secrets: never printed')

/** One raw anonymous API call; returns the status, the parsed JSON when there is any, and the text. */
const call = async (path, headers = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${path}`, { headers: { accept: 'application/json', ...headers } })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: response.status, json, text }
}
const countSuffix = result => Array.isArray(result.json) ? ` count=${result.json.length}` : ''
const messageOf = result => result.json && typeof result.json.message === 'string'
  ? result.json.message : result.text.slice(0, 180).replace(/\s+/g, ' ')
const repoPath = suffix => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`

console.log('\n[anonymous, raw fetch]')
const version = await call('/version')
console.log(`  version: status=${version.status} version=${version.json?.version ?? '-'}`)
const repo = await call(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`)
console.log(`  repository: status=${repo.status}` +
  (repo.json ? ` private=${repo.json.private} has_issues=${repo.json.has_issues} has_pull_requests=${repo.json.has_pull_requests}` : ''))
const issues = await call(`${repoPath('/issues')}?state=all&limit=1`)
console.log(`  issues: status=${issues.status}${countSuffix(issues)}`)
const pulls = await call(`${repoPath('/pulls')}?state=all&limit=1`)
console.log(`  pulls: status=${pulls.status}${countSuffix(pulls)}`)
const comments = await call(`${repoPath('/issues/comments')}?limit=1`)
console.log(`  comments: status=${comments.status}${countSuffix(comments)}`)

console.log('\n[refused without an account]')
const notifications = await call('/notifications?limit=1')
console.log(`  notifications: status=${notifications.status} message=${messageOf(notifications)}`)
const missing = await call(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}-missing/issues?limit=1`)
console.log(`  missing repository: status=${missing.status} message=${messageOf(missing)}`)

if (implementation) {
  const { GiteaClient, GiteaError, giteaKind } = implementation
  console.log('\n[implementation, anonymous]')
  const client = new GiteaClient({ baseUrl })
  for (const [label, read] of [
    ['issues', () => client.issues(owner, name, { limit: 1 })],
    ['pulls', () => client.pulls(owner, name, { limit: 1 })],
    ['comments', () => client.issueComments(owner, name, { limit: 1 })],
  ]) {
    try {
      const items = await read()
      console.log(`  ${label}: status=200 count=${items.length}`)
    } catch (error) {
      console.log(`  ${label}: status=${error instanceof GiteaError ? error.status ?? '-' : '-'} error=${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    await giteaKind.test(configuration())
    console.log('  giteaKind.test(): PASS (read one issue and one pull request)')
  } catch (error) {
    console.log(`  giteaKind.test(): FAIL ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await client.notifications({ limit: 1 })
    console.log('  notifications: unexpectedly readable without an account')
  } catch (error) {
    console.log(`  notifications refusal: status=${error instanceof GiteaError ? error.status ?? '-' : '-'} message=${error instanceof Error ? error.message : String(error)}`)
  }
}

if (withAuth) {
  console.log('\n[stored account]')
  try {
    const stored = storedSourceConfig(stateDir, 'gitea')
    const hasAuth = !!stored.token || (!!stored.user && !!stored.password)
    if (!hasAuth) {
      console.log('  no account stored: the deployment reads anonymously')
    } else {
      const account = {
        baseUrl: stored.baseUrl || baseUrl, user: stored.user ?? '', password: stored.password ?? '', token: stored.token ?? '',
      }
      console.log(`  account: ${stored.token ? 'API token' : `login ${stored.user}`} (password/token not printed)`)
      if (implementation) {
        const { GiteaClient, GiteaError, giteaKind } = implementation
        const client = new GiteaClient(account)
        try {
          const user = await client.user()
          console.log(`  authenticated as ${user.login}`)
        } catch (error) {
          console.log(`  authenticated read: status=${error instanceof GiteaError ? error.status ?? '-' : '-'} error=${error instanceof Error ? error.message : String(error)}`)
        }
        for (const [label, read] of [
          ['issues', () => client.issues(owner, name, { limit: 1 })],
          ['pulls', () => client.pulls(owner, name, { limit: 1 })],
        ]) {
          try {
            const items = await read()
            console.log(`  ${label}: status=200 count=${items.length}`)
          } catch (error) {
            console.log(`  ${label}: status=${error instanceof GiteaError ? error.status ?? '-' : '-'} error=${error instanceof Error ? error.message : String(error)}`)
          }
        }
        try {
          await giteaKind.test({ ...configuration(), ...account })
          console.log('  giteaKind.test(): PASS (logged in and read one issue and one pull request)')
        } catch (error) {
          console.log(`  giteaKind.test(): FAIL ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        const headers = stored.token
          ? { authorization: `token ${stored.token}` }
          : { authorization: `Basic ${Buffer.from(`${stored.user}:${stored.password}`, 'utf8').toString('base64')}` }
        const authedIssues = await call(`${repoPath('/issues')}?state=all&limit=1`, headers)
        const authedPulls = await call(`${repoPath('/pulls')}?state=all&limit=1`, headers)
        console.log(`  issues: status=${authedIssues.status}${countSuffix(authedIssues)}`)
        console.log(`  pulls: status=${authedPulls.status}${countSuffix(authedPulls)}`)
      }
    }
  } catch (error) {
    console.log(`  skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}
