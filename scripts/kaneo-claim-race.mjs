#!/usr/bin/env node
/**
 * Claim race: N posts claim the same KanEO task at the same time, using the protocol RD.md §11.2 prescribes
 * (write assignee → read back → append a lease comment → the earliest lease wins). The test asserts that exactly one
 * claimant wins, then restores the task to its baseline state.
 *
 * Usage: node scripts/kaneo-claim-race.mjs --key-file <path> --task <taskId> [--claimants 3] [--report <file>]
 */
import { writeFileSync } from 'node:fs'
import { createClient, sleep } from './lib/kaneo-client.mjs'

const argv = process.argv.slice(2)
const options = { keyFile: '', task: '', claimants: 3, report: '', allowPipeline: false }
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--key-file') options.keyFile = argv[++i]
  else if (arg === '--task') options.task = argv[++i]
  else if (arg === '--claimants') options.claimants = Number(argv[++i])
  else if (arg === '--report') options.report = argv[++i]
  else if (arg === '--allow-pipeline') options.allowPipeline = true
  else if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0) }
  else { console.error(`unknown argument: ${arg}`); process.exit(2) }
}
const HELP = `kaneo-claim-race — concurrent claim arbitration on one KanEO task

  --key-file <path>   file containing the KanEO API key (or set KANEO_API_KEY)
  --task <id>         task id every claimant races for (must live on the FDEP board)
  --claimants <n>     number of claimants (default 3)
  --report <file>     write the JSON report to this file
  --allow-pipeline    override the guard that refuses to write to the pipeline board
`

async function main () {
  const client = createClient({ keyFile: options.keyFile, allowPipeline: options.allowPipeline })
  const task = await client.getTask(options.task)
  client.assertWritable(task.projectId)
  const baseline = { status: task.status, assigneeId: task.assigneeId ?? null }

  // Distinct real workspace members act as distinct posts; the last assignee write wins, the lease comment decides.
  const pool = new Map()
  const harvest = async projectId => {
    for (const candidate of await client.boardTasks(projectId)) {
      if (candidate.assigneeId && candidate.assigneeId !== baseline.assigneeId && !pool.has(candidate.assigneeId)) {
        pool.set(candidate.assigneeId, candidate.assigneeName ?? candidate.assigneeId)
      }
    }
  }
  await harvest(task.projectId)
  if (pool.size < 2) {
    // The task's own board may have no assignees; take identities from the other projects of the workspace.
    const workspaces = await client.api('GET', '/workspace')
    const projects = await client.api('GET', `/project?workspaceId=${encodeURIComponent(workspaces[0]?.id ?? '')}`)
    for (const project of projects) { if (pool.size >= 4) break; await harvest(project.id) }
  }
  const identities = [...pool.keys()].slice(0, Math.max(2, options.claimants))
  if (identities.length < 2) throw new Error('need at least two distinct workspace member ids; none found on the boards')
  console.log(`claimants: ${identities.map(id => `${pool.get(id)}(${id.slice(0, 8)})`).join(', ')}`)

  const token = `race-${Date.now().toString(36)}`
  const leaseIds = []
  const started = Date.now()

  const claim = async (identity, index) => {
    const name = pool.get(identity)
    const tag = `${index}:${name}`
    const own = `${token}:${tag}`
    const result = { index, name, identity, tag, outcome: 'unknown', leaseId: undefined }
    try {
      await client.setAssignee(options.task, identity)
      const after = await client.getTask(options.task)
      result.assigneeSeen = after.assigneeId ?? null
      if (result.assigneeSeen !== identity) { result.outcome = 'lost-assignee'; return result }
      const lease = await client.comment(options.task, `lease:${own}`)
      result.leaseId = lease?.id
      leaseIds.push(lease?.id)
      await sleep(1200)
      const leases = (await client.getComments(options.task))
        .filter(item => String(item.content ?? '').startsWith(`lease:${token}:`))
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
      result.leaseCount = leases.length
      result.winnerLease = leases[0] ? String(leases[0].content).split(':').slice(2).join(':') : undefined
      result.outcome = result.winnerLease === tag ? 'won' : 'lost-lease'
      return result
    } catch (error) {
      result.outcome = 'error'
      result.error = error.message
      return result
    }
  }

  const results = await Promise.all(identities.map((identity, index) => claim(identity, index)))
  const winners = results.filter(result => result.outcome === 'won')
  const report = {
    taskId: options.task, token, durationMs: Date.now() - started, baseline, results,
    winners: winners.length, exactlyOneWinner: winners.length === 1,
  }
  console.log(JSON.stringify(report, null, 2))

  for (const id of leaseIds) { if (id) { try { await client.deleteComment(id) } catch { /* best effort */ } } }
  await client.setAssignee(options.task, baseline.assigneeId)
  await client.setStatus(options.task, baseline.status)
  const restored = await client.getTask(options.task)
  report.restored = { status: restored.status, assigneeId: restored.assigneeId ?? null }
  console.log(`restored: status=${restored.status} assignee=${restored.assigneeId ?? 'null'}`)

  if (options.report) { writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(`report written to ${options.report}`) }
  if (!report.exactlyOneWinner) process.exit(1)
}

main().catch(error => { console.error(`race failed: ${error.message}`); process.exit(1) })
