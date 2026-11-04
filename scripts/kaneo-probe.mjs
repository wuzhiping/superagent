#!/usr/bin/env node
/**
 * KanEO probe: read-only inspection of the live board, plus a self-restoring write suite used to validate the
 * target model in RD.md §11.5 against real data. The write suite touches exactly one task and restores its state.
 *
 * Usage:
 *   node scripts/kaneo-probe.mjs --key-file <path> [--project <id>] [--task <taskId>]
 *   node scripts/kaneo-probe.mjs --key-file <path> --task <taskId> --write-suite --confirm-write [--report <file>]
 *
 * The API key never appears in arguments or output: pass a file path (or set KANEO_API_KEY / KANEO_KEY_FILE).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const options = {
  base: 'https://pl.feg.cn', keyFile: '', task: '', write: false, confirmWrite: false,
  writeSuite: false, project: '', report: '', allowPipeline: false,
}
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--base') options.base = argv[++i]
  else if (arg === '--key-file') options.keyFile = argv[++i]
  else if (arg === '--task') options.task = argv[++i]
  else if (arg === '--project') options.project = argv[++i]
  else if (arg === '--report') options.report = argv[++i]
  else if (arg === '--write') options.write = true
  else if (arg === '--write-suite') options.writeSuite = true
  else if (arg === '--confirm-write') options.confirmWrite = true
  else if (arg === '--allow-pipeline') options.allowPipeline = true
  else if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0) }
  else { console.error(`unknown argument: ${arg}`); process.exit(2) }
}

const HELP = `kaneo-probe — KanEO inspection and write suite (RD.md §11.5)

  --key-file <path>   file containing the KanEO API key (or set KANEO_API_KEY / KANEO_KEY_FILE)
  --base <url>        KanEO base URL (default https://pl.feg.cn)
  --project <id>      project id to inspect (default: all projects of the workspace)
  --task <id>         task id for comment/label/custom-field inspection
  --write             allow a single-task write probe (comment + read-back); needs --confirm-write
  --write-suite       run the self-restoring write suite on --task; needs --confirm-write
  --confirm-write     acknowledge that the write touches one task and restores its state
  --allow-pipeline    override the guard that refuses to write to the pipeline board
  --report <file>     write the suite report as JSON to this file
`

function apiKey () {
  const fromEnv = process.env.KANEO_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const file = options.keyFile || process.env.KANEO_KEY_FILE
  if (!file) { console.error('no API key: pass --key-file or set KANEO_API_KEY'); process.exit(2) }
  return readFileSync(file, 'utf8').trim()
}

const KEY = apiKey()
/** The pipeline board is the team's live working board; test artefacts belong to FDEP. */
const PIPELINE_PROJECT = 'wwo9d2mmqddjq8otbj8jh2hs'
const assertWritableProject = projectId => {
  if (projectId === PIPELINE_PROJECT && !options.allowPipeline) {
    throw new Error('refusing to write to the pipeline board; test data belongs to FDEP — pass --allow-pipeline to override')
  }
}
const rateLimit = { limit: undefined, remaining: undefined, reset: undefined, hits: 0, waitedMs: 0 }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** KanEO answers 429 with `Retry-After` and `X-RateLimit-*` headers; wait it out and retry. */
async function api (method, path, body, attempt = 0) {
  const response = await fetch(`${options.base}/api${path}`, {
    method,
    headers: { 'x-api-key': KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const limit = response.headers.get('x-ratelimit-limit')
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  if (limit) rateLimit.limit = Number(limit)
  if (remaining) rateLimit.remaining = Number(remaining)
  if (reset) rateLimit.reset = Number(reset)
  if (response.status === 429 && attempt < 8) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 0)
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.max(2000, (rateLimit.reset ? rateLimit.reset * 1000 - Date.now() : 5000))
    rateLimit.hits += 1
    rateLimit.waitedMs += waitMs
    console.log(`[429] ${method} ${path} — waiting ${Math.round(waitMs / 1000)}s (limit ${rateLimit.limit ?? '?'}, remaining ${rateLimit.remaining ?? '?'})`)
    await sleep(waitMs)
    return api(method, path, body, attempt + 1)
  }
  const text = await response.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  if (!response.ok) {
    const error = new Error(`${method} ${path} -> ${response.status}`)
    error.detail = parsed
    throw error
  }
  return parsed
}

const show = (label, value) => console.log(`\n=== ${label} ===\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`)
/** `GET /task/tasks/{projectId}` answers with `{ data: <project object> }`; the project carries its columns and their tasks. */
const columnsOf = payload => payload?.data?.columns ?? payload?.columns ?? []
const tasksOf = payload => columnsOf(payload).flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
const labelNames = task => (task?.labels ?? []).map(label => label.name ?? label)
/** `GET /task/{id}` does not carry labels; `GET /label/task/{taskId}` does, and answers with one object or a list. */
async function labelsOfTask (taskId) {
  const payload = await api('GET', `/label/task/${encodeURIComponent(taskId)}`)
  const list = Array.isArray(payload) ? payload : payload ? [payload] : []
  return list.map(label => label.name ?? label).sort()
}

async function main () {
  const me = await api('GET', '/user/me')
  show('identity (/user/me)', { id: me.id, name: me.name, role: me.role })

  const workspaces = await api('GET', '/workspace')
  show('workspaces', workspaces.map(item => ({ id: item.id, name: item.name })))

  const workspaceId = workspaces[0]?.id
  const projects = await api('GET', `/project?workspaceId=${encodeURIComponent(workspaceId ?? '')}`)
  show('projects', projects.map(item => ({ id: item.id, name: item.name, slug: item.slug })))

  const targets = options.project ? projects.filter(item => item.id === options.project) : projects
  for (const project of targets) {
    const board = await api('GET', `/task/tasks/${encodeURIComponent(project.id)}`)
    const columns = columnsOf(board).map(column => ({ slug: column.slug, name: column.name, tasks: (column.tasks ?? []).length }))
    show(`columns of ${project.name} (${project.slug})`, columns)

    const mine = await api('GET', `/task/tasks/${encodeURIComponent(project.id)}?assigneeId=${encodeURIComponent(me.id)}&limit=50`)
    show(`tasks assigned to me in ${project.name} (assigneeId filter)`, tasksOf(mine).map(task => ({
      id: task.id, number: task.number, column: task.column, status: task.status, title: task.title, labels: labelNames(task),
    })))

    const all = tasksOf(board)
    show(`all tasks in ${project.name}`, all.map(task => ({
      id: task.id, number: task.number, column: task.column, status: task.status,
      assigneeId: task.assigneeId, assigneeName: task.assigneeName, title: task.title,
    })))
  }

  if (options.task) {
    const task = await api('GET', `/task/${encodeURIComponent(options.task)}`)
    show(`task ${options.task}`, { id: task.id, projectId: task.projectId, status: task.status, assigneeId: task.assigneeId, labels: labelNames(task), priority: task.priority, dueDate: task.dueDate })
    const comments = await api('GET', `/comment/${encodeURIComponent(options.task)}`)
    show('comments', (comments ?? []).map(comment => ({ id: comment.id, createdAt: comment.createdAt, content: String(comment.content ?? '').slice(0, 120) })))
    show('labels', await api('GET', `/label/task/${encodeURIComponent(options.task)}`))
    show('custom field values', await api('GET', `/custom-field/task/${encodeURIComponent(options.task)}`))
    show('custom field definitions', await api('GET', `/custom-field/project/${encodeURIComponent(task.projectId)}`))
  }

  if (options.writeSuite) {
    if (!options.task) { console.error('--write-suite needs --task <id>'); process.exit(2) }
    if (!options.confirmWrite) { console.error('--write-suite needs --confirm-write (it writes to one task and restores it)'); process.exit(2) }
    const report = await writeSuite(options.task, me)
    if (options.report) { writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(`\nreport written to ${options.report}`) }
    show('write suite report', report)
    if (report.failed.length) process.exit(1)
    return
  }

  if (options.write) {
    if (!options.task) { console.error('--write needs --task <id>'); process.exit(2) }
    if (!options.confirmWrite) { console.error('--write needs --confirm-write (this changes one task)'); process.exit(2) }
    const marker = `probe ${new Date().toISOString()}`
    const current = await api('GET', `/task/${encodeURIComponent(options.task)}`)
    assertWritableProject(current.projectId)
    const comment = await api('POST', `/comment/${encodeURIComponent(options.task)}`, { content: marker })
    show('write probe: comment created', { id: comment?.id, content: marker })
    const task = await api('GET', `/task/${encodeURIComponent(options.task)}`)
    show('write probe: read-back', { status: task.status, assigneeId: task.assigneeId })
  }
}

/**
 * Self-restoring write suite on one task. Each step records what was sent and what came back, so the report is
 * evidence rather than a claim. Every step restores what it changed.
 */
async function writeSuite (taskId, me) {
  const steps = []
  const failed = []
  const stamp = new Date().toISOString()
  const token = `probe-${Date.now().toString(36)}`
  const record = (name, ok, detail) => {
    steps.push({ name, ok, detail })
    if (!ok) failed.push(name)
    console.log(`[${ok ? 'ok  ' : 'FAIL'}] ${name} ${JSON.stringify(detail)}`)
  }
  const getTask = async () => api('GET', `/task/${encodeURIComponent(taskId)}`)
  const getComments = async () => (await api('GET', `/comment/${encodeURIComponent(taskId)}`)) ?? []
  const pace = async () => { await sleep(1200) }

  const baseline = await getTask()
  assertWritableProject(baseline.projectId)
  const baselineState = { status: baseline.status, assigneeId: baseline.assigneeId ?? null, labels: await labelsOfTask(taskId) }
  record('baseline', true, baselineState)

  // 1. Label round-trip: create → attach → read back → detach → delete.
  let labelId
  try {
    await pace()
    const created = await api('POST', '/label', { name: `${token}-label`, color: '#ededed', workspaceId: baseline.workspaceId, taskId })
    labelId = created?.id ?? created?.label?.id
    record('label.create', !!labelId, { id: labelId, name: created?.name ?? created?.label?.name })
    if (labelId) {
      await pace()
      await api('PUT', `/label/${encodeURIComponent(labelId)}/task`, { taskId })
      const attached = await labelsOfTask(taskId)
      record('label.attach', attached.includes(`${token}-label`), { labels: attached })
      await pace()
      await api('DELETE', `/label/${encodeURIComponent(labelId)}/task`, { taskId })
      const detached = await labelsOfTask(taskId)
      record('label.detach', !detached.includes(`${token}-label`), { labels: detached })
    }
  } catch (error) { record('label.roundtrip', false, { error: error.message, detail: error.detail }) }

  // 2. Comment round-trip: create → read back → delete.
  let commentId
  try {
    await pace()
    const comment = await api('POST', `/comment/${encodeURIComponent(taskId)}`, { content: `${token} comment` })
    commentId = comment?.id
    const comments = await getComments()
    const found = comments.find(item => item.id === commentId)
    record('comment.create', !!found, { id: commentId, createdAt: found?.createdAt, total: comments.length })
    await pace()
    await api('DELETE', `/comment/${encodeURIComponent(commentId)}`)
    const after = await getComments()
    record('comment.delete', !after.some(item => item.id === commentId), { total: after.length })
  } catch (error) { record('comment.roundtrip', false, { error: error.message, detail: error.detail }) }

  // 3. Lease protocol: two claimants leave lease comments; the earliest one wins (RD.md §11.2 fallback).
  const leaseIds = []
  try {
    for (const claim of ['A', 'B']) {
      const comment = await api('POST', `/comment/${encodeURIComponent(taskId)}`, { content: `lease:${token}:${claim}` })
      leaseIds.push({ id: comment?.id, claim })
      await new Promise(resolve => setTimeout(resolve, 1100)) // leases are 1s apart so createdAt ordering is unambiguous
    }
    const comments = await getComments()
    const leases = comments.filter(item => String(item.content ?? '').startsWith(`lease:${token}:`))
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    const winner = leases[0] ? String(leases[0].content).split(':').at(-1) : undefined
    record('lease.earliest-wins', winner === 'A' && leases.length === 2, { leases: leases.map(item => ({ id: item.id, claim: String(item.content).split(':').at(-1), createdAt: item.createdAt })), winner })
  } catch (error) { record('lease.protocol', false, { error: error.message, detail: error.detail }) }

  // 4. Status round-trip: move to in-progress, read back from both the task and the board, then restore.
  try {
    await pace()
    await api('PUT', `/task/status/${encodeURIComponent(taskId)}`, { status: 'in-progress' })
    const moved = await getTask()
    // The board endpoint truncates each column unless a status filter is given, so ask for the target column.
    const board = await api('GET', `/task/tasks/${encodeURIComponent(baseline.projectId)}?status=in-progress&limit=100`)
    const column = (board?.data?.columns ?? []).flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
      .find(item => item.id === taskId)?.column
    record('status.move', moved.status === 'in-progress' && column === 'in-progress', { status: moved.status, column })
    await pace()
    await api('PUT', `/task/status/${encodeURIComponent(taskId)}`, { status: baseline.status })
    const restored = await getTask()
    record('status.restore', restored.status === baseline.status, { status: restored.status })
  } catch (error) { record('status.roundtrip', false, { error: error.message, detail: error.detail }) }

  // 5. Assignee round-trip: claim for the probe identity, then release.
  try {
    await pace()
    await api('PUT', `/task/assignee/${encodeURIComponent(taskId)}`, { userId: me.id })
    const claimed = await getTask()
    record('assignee.claim', claimed.assigneeId === me.id, { assigneeId: claimed.assigneeId, assigneeName: claimed.assigneeName })
    await pace()
    await api('PUT', `/task/assignee/${encodeURIComponent(taskId)}`, { userId: baselineState.assigneeId })
    const released = await getTask()
    record('assignee.release', (released.assigneeId ?? null) === baselineState.assigneeId, { assigneeId: released.assigneeId })
  } catch (error) { record('assignee.roundtrip', false, { error: error.message, detail: error.detail }) }

  // 6. Cleanup of the lease comments.
  for (const lease of leaseIds) {
    try { await api('DELETE', `/comment/${encodeURIComponent(lease.id)}`) } catch { /* best effort */ }
  }
  if (labelId) { try { await api('DELETE', `/label/${encodeURIComponent(labelId)}`) } catch { /* best effort */ } }

  // 7. Final state must match the baseline.
  const final = await getTask()
  const finalState = { status: final.status, assigneeId: final.assigneeId ?? null, labels: await labelsOfTask(taskId) }
  const same = finalState.status === baselineState.status
    && finalState.assigneeId === baselineState.assigneeId
    && JSON.stringify(finalState.labels) === JSON.stringify(baselineState.labels)
  record('restore.matches-baseline', same, { baseline: baselineState, final: finalState })

  return { taskId, stamp, token, baseline: baselineState, final: finalState, rateLimit: { ...rateLimit }, steps, failed }
}

main().catch(error => {
  console.error(`probe failed: ${error.message}`)
  if (error.detail) console.error(JSON.stringify(error.detail))
  process.exit(1)
})
