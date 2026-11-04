/**
 * User-story runner: drives the live test deployment through the narratives of RD.md and checks what the panel,
 * the host and KanEO actually show. Every story is a persona, a few steps and assertions; every run writes a
 * report so a later run can be compared with it.
 *
 *   node scripts/user-stories.mjs [--only <id>] [--timeout <seconds>] [--report <file>] [--keep-narrowing]
 *
 * Safety: the run narrows the deployment to the story card — the KanEO Source watches only tasks carrying the
 * `story-test` label, and the Gitea and ntfy Sources are paused — then restores every setting afterwards. Test
 * data stays on the FDEP board and is left in place.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createClient, sleep } from './lib/kaneo-client.mjs'
import { sourceApiKey } from './lib/store-read.mjs'

const options = { panel: 'http://127.0.0.1:3080', stateDir: 'D:/Refine/Books/ntop/AI/dsh/state/superagent',
  project: 'dgctny8ibgpn72ei2j8qj2hc', timeout: 420, only: '', keepNarrowing: false, report: '', label: 'story-test' }
for (let index = 2; index < process.argv.length; index += 1) {
  const flag = process.argv[index]
  const value = process.argv[index + 1]
  if (flag === '--only') { options.only = value; index += 1 }
  else if (flag === '--timeout') { options.timeout = Number(value); index += 1 }
  else if (flag === '--report') { options.report = value; index += 1 }
  else if (flag === '--panel') { options.panel = value; index += 1 }
  else if (flag === '--state-dir') { options.stateDir = value; index += 1 }
  else if (flag === '--project') { options.project = value; index += 1 }
  else if (flag === '--label') { options.label = value; index += 1 }
  else if (flag === '--keep-narrowing') options.keepNarrowing = true
}

/** Calls the panel's management API. */
async function panel (path, init = {}) {
  const response = await fetch(`${options.panel}/orchestrator/api/${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-orchestrator-request': '1', ...init.body ? { 'content-type': 'application/json' } : {} },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

/** Waits for the service to answer again after a restart, and for its Sources to be running again. */
async function waitForService (timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await panel('state')
      const sources = Object.entries(state.health ?? {}).filter(([name]) => ['kaneo', 'gitea', 'ntfy'].includes(name))
      // A Source that is off is paused on purpose; one that is still starting is not ready yet.
      if (sources.every(([, entry]) => entry.state === 'ready' || entry.state === 'paused')) return true
    } catch { /* the host is restarting */ }
    await sleep(2000)
  }
  return false
}

/** Waits until `check` returns a value, or the timeout passes. */
async function until (check, timeoutMs, everyMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value } catch { /* keep waiting */ }
    await sleep(everyMs)
  }
  return undefined
}

const stories = []
/** Registers one user story. */
function story (id, persona, title, run) { stories.push({ id, persona, title, run }) }

process.env.KANEO_API_KEY = sourceApiKey(options.stateDir, 'kaneo')
const kaneo = createClient({ base: 'https://pl.feg.cn' })
const marker = `us-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
let created = null
const saved = {}

/** The project archive the deployment uses. */
async function archive () {
  return (await panel('project-archive')).archive
}

/** Creates a label on the workspace and attaches it to a task. */
async function attachLabel (name, taskId, color = '#0969da') {
  const workspaces = await kaneo.api('GET', '/workspace')
  const workspaceId = workspaces[0]?.id
  const existing = await kaneo.api('GET', `/label/workspace/${encodeURIComponent(workspaceId)}`)
  const found = (Array.isArray(existing) ? existing : []).find(label => label.name === name)
  const label = found ?? await kaneo.api('POST', '/label', { name, color, workspaceId })
  const id = label?.id ?? label?.label?.id
  if (id && taskId) await kaneo.api('PUT', `/label/${encodeURIComponent(id)}/task`, { taskId })
  return id
}

story('US-01', 'PM', '编队页给出项目、岗位与宪章的现状', async () => {
  const narrative = await panel('narrative')
  const project = narrative.projects.find(item => item.id === options.project)
  const post = narrative.posts.find(item => item.role === 'pm')
  return {
    checks: {
      'narrative.configured': narrative.configured === true,
      'narrative.has-project': !!project,
      'narrative.charter-read': !!project?.charter?.version,
      'narrative.charter-fresh': project?.charter?.stale === false,
      'narrative.has-post': !!post,
      'narrative.post-has-kaneo-identity': !!post?.kaneoUserId,
      'narrative.exception-queue-present': Array.isArray(narrative.exceptions),
    },
    evidence: { project: project?.name, charter: project?.charter?.version, posts: narrative.posts.map(item => item.postId) },
  }
})

story('US-02', 'PM', '派工：建卡、指派给岗位账号、放进监听列', async () => {
  const { projects } = await archive()
  const project = projects.find(item => item.id === options.project)
  const post = project?.posts.find(item => item.role === 'pm')
  if (!post?.kaneoUserId) return { checks: { 'dispatch.has-kaneo-identity': false }, evidence: { note: 'no KanEO identity for the PM post' } }
  // A card is dispatched in the order a PM works: it starts outside the watched column, gets its labels and its
  // assignee, and only then enters the column the posts watch — a card that enters first is read once and never again.
  const task = await kaneo.api('POST', `/task/${encodeURIComponent(options.project)}`, {
    title: `[story ${marker}] 岗位职责冒烟：写一份方案并回写`,
    description: [
      '这是用户故事验证卡（RD.md §4–§8）。请在任务评论里回写一份简短的工作日志，不需要改代码。',
      '验收口径：评论里出现「工作日志」与结论；完成后把状态移到 done。',
      '请只输出一段不超过 100 字的中文工作日志（纯文本），不要启动子代理、不要上传对象、不要执行外部命令。',
    ].join('\n'),
    priority: 'no-priority',
    status: 'to-do',
  })
  created = task?.id ?? task?.task?.id
  await attachLabel(options.label, created, '#8250df')
  await attachLabel('kind:doc', created)
  // The dispatch itself: the card names the post that must take it.
  await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(created)}`, { userId: post.kaneoUserId })
  await kaneo.api('PUT', `/task/status/${encodeURIComponent(created)}`, { status: 'ready' })
  const readBack = await kaneo.getTask(created)
  const labels = await kaneo.getLabels(created)
  return {
    checks: {
      'dispatch.card-created': !!created,
      'dispatch.assignee-is-post': readBack.assigneeId === post.kaneoUserId,
      'dispatch.in-watched-column': readBack.status === 'ready',
      'dispatch.kind-label': labels.includes('kind:doc'),
      'dispatch.story-label': labels.includes(options.label),
    },
    evidence: { taskId: created, status: readBack.status, assigneeId: readBack.assigneeId, labels },
  }
})

/**
 * The duty of a KanEO card. The assessor rewrites the ticket title, so the stable link is the Thread the card made:
 * `kaneo:<taskId>` — its thread lists the tickets that work on it.
 */
async function dutyOf (taskId) {
  try {
    const thread = await panel(`threads/${encodeURIComponent(`kaneo:${taskId}`)}`)
    const id = thread.tickets?.[0]?.id
    if (!id) return undefined
    return await panel(`tickets/${encodeURIComponent(id)}`)
  } catch {
    return undefined
  }
}

/**
 * Waits for the duty of a card. The board's own automation may pull a card out of the watched column within seconds
 * (this board moves `ready` cards to `in-progress` after ~20s), so a card that was never read is dispatched again —
 * the PM pushing a card that nothing picked up. A card the deployment already answered is left alone: it has it.
 */
async function dutyWithRedispatch (taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  while (Date.now() < deadline) {
    const duty = await dutyOf(taskId)
    if (duty) return { duty, attempts }
    await sleep(5000)
    const again = await dutyOf(taskId)
    if (again) return { duty: again, attempts }
    const task = await kaneo.getTask(taskId)
    if (task.status !== 'ready') {
      const comments = await kaneo.getComments(taskId)
      const answered = comments.some(comment => String(comment.content ?? '').includes('<!-- dsh-superagent:'))
      if (answered) { await sleep(5000); const settled = await dutyOf(taskId); if (settled) return { duty: settled, attempts } }
      attempts += 1
      await kaneo.api('PUT', `/task/status/${encodeURIComponent(taskId)}`, { status: 'ready' })
      console.log(`  [re-dispatch #${attempts}] ${taskId} was in ${task.status}; put it back into ready`)
    }
  }
  return { duty: undefined, attempts }
}

story('US-03', '岗位', '接单：工单落到正确的岗位上', async () => {
  if (!created) return { checks: { 'claim.ticket-found': false }, evidence: { note: 'US-02 did not create a card' } }
  const { projects } = await archive()
  const post = projects.find(item => item.id === options.project)?.posts.find(item => item.role === 'pm')
  const { duty, attempts } = await dutyWithRedispatch(created, options.timeout * 1000)
  if (!duty) {
    const decisions = await panel('decisions?kind=accept,wouldAccept,ignore&limit=20')
    return { checks: { 'claim.ticket-found': false }, evidence: { note: 'no duty within the timeout', redispatches: attempts, decisions: decisions.items.slice(0, 3) } }
  }
  const kaneoTask = await until(async () => {
    const task = await kaneo.getTask(created)
    return task.status === 'in-progress' ? task : undefined
  }, 90_000) ?? await kaneo.getTask(created)
  return {
    checks: {
      'claim.ticket-found': true,
      'claim.ticket-owns-post': duty.postId === post?.postId,
      'claim.ticket-has-project': duty.projectId === options.project,
      'claim.ticket-has-deliverable': duty.deliverableType === 'doc',
      'claim.ticket-pins-charter': typeof duty.charterVersion === 'number',
      'claim.kaneo-claimed': kaneoTask.status !== 'ready',
    },
    evidence: {
      ticketId: duty.id, title: duty.title, postId: duty.postId, projectId: duty.projectId,
      deliverableType: duty.deliverableType, charterVersion: duty.charterVersion, kaneoStatus: kaneoTask.status,
      kaneoAssignee: kaneoTask.assigneeId,
    },
  }
})

story('US-04', '岗位', '交付：状态回写与工作日志回到看板', async () => {
  if (!created) return { checks: { 'deliver.ticket-found': false }, evidence: { note: 'US-02 did not create a card' } }
  // The duty ends when the worker reports, but the work log reaches the card a little later (it travels through the
  // outbox). So wait for the card to reach the delivery column — that is the moment the delivery happened — and only
  // then read the board once: the shared API key is rate limited and polling it wastes the budget.
  const settings = await panel('settings')
  const kaneoConfig = settings.sources.find(source => source.id === 'kaneo')?.value?.config ?? {}
  const deliveryColumn = kaneoConfig.doneColumn || 'done'
  const delivered = await until(async () => {
    const task = await kaneo.getTask(created)
    return task.status === deliveryColumn ? task : undefined
  }, options.timeout * 1000 * 3, 10_000)
  const ticket = await until(async () => {
    const duty = await dutyOf(created)
    if (!duty) return undefined
    const ended = await panel(`tickets/${encodeURIComponent(duty.id)}`)
    return ended.ended ? ended : undefined
  }, 90_000)
  const comments = await kaneo.getComments(created)
  const kaneoTask = delivered ?? await kaneo.getTask(created)
  const log = comments.find(comment => /工作日志|产出|work log|方案|plan/i.test(String(comment.content ?? ''))
    && !String(comment.content ?? '').startsWith('收到'))
  return {
    checks: {
      'deliver.ticket-ended': !!ticket,
      'deliver.kaneo-has-worklog': !!log,
      'deliver.kaneo-left-ready': kaneoTask.status !== 'ready',
    },
    evidence: {
      ticketId: ticket?.id, outcome: ticket?.ended?.outcome, kaneoStatus: kaneoTask.status, comments: comments.length,
      deliveryColumn, logExcerpt: String(log?.content ?? '').slice(0, 240),
    },
  }
})

story('US-05', 'PM', '宪章：面板的版本与它声明的流程一致', async () => {
  const { projects } = await archive()
  const project = projects.find(item => item.id === options.project)
  const charter = project?.charter
  if (!charter) return { checks: { 'charter.published': false }, evidence: {} }
  const narrative = await panel('narrative')
  const view = narrative.projects.find(item => item.id === options.project)
  const shown = view?.charter?.version ?? 0
  const board = view?.flow.board.map(column => column.slug) ?? []
  const declared = view?.flow.declared.map(step => step.column) ?? []
  return {
    checks: {
      'charter.published': (charter.version ?? 0) > 0,
      'charter.panel-shows-the-version': shown === charter.version,
      'charter.flow-covers-the-board': declared.length > 0 && declared.every(column => board.includes(column)),
      'charter.keeps-its-history': (charter.history?.length ?? 0) === (view?.charter?.versions.length ?? 0),
    },
    evidence: {
      version: charter.version, shown, publishedBy: charter.publishedBy,
      declared, board, history: charter.history?.map(item => `v${item.version}`).join('、'),
    },
  }
})

story('US-10', '系统', '入库：其它来源的事件先落成卡，再由岗位接手', async () => {
  const { projects } = await archive()
  const project = projects.find(item => item.id === options.project)
  if (!project) return { checks: { 'ingest.project-known': false }, evidence: {} }
  // The event goes to a topic of its own, so the team's real topic stays quiet; the run restores the source afterwards.
  const topic = `pub_superagent_story_${marker.replace(/[^a-z0-9]/gi, '').slice(-10)}`
  const settings = await panel('settings')
  const ntfySource = settings.sources.find(source => source.id === 'ntfy')
  if (!ntfySource) return { checks: { 'ingest.source-present': false }, evidence: {} }
  await panel('settings/source:ntfy', { method: 'PUT', body: {
    value: { ...ntfySource.value, enabled: true, config: { ...ntfySource.value.config, topic } },
    revision: ntfySource.revision } })
  await waitForService()
  // The event itself: one message on the topic. ntfy takes the topic in the payload and the server root as the URL.
  const title = `[story ${marker}] 入库验证`
  const server = ntfySource.value.config.server || 'https://msn.feg.cn'
  const published = await fetch(server, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ topic, title, message: '这条消息应当先变成看板上的一张卡，再由岗位接手。', markdown: false, priority: 3, tags: [] }),
  })
  if (!published.ok) return { checks: { 'ingest.event-published': false }, evidence: { status: published.status } }
  // The filed card: labelled from:ntfy, waiting in to-do, with nobody assigned.
  const filed = await until(async () => {
    const board = await kaneo.api('GET', `/task/tasks/${encodeURIComponent(options.project)}?status=to-do&limit=100`)
    const tasks = (board?.data?.columns ?? board?.columns ?? []).flatMap(column => column.tasks ?? [])
    return tasks.find(task => String(task.title ?? '').includes(marker)) ?? undefined
  }, 240_000, 10_000)
  if (!filed) return { checks: { 'ingest.card-filed': false }, evidence: { note: 'no card with the story marker was filed' } }
  const labels = await kaneo.getLabels(filed.id)
  const filedTask = await kaneo.getTask(filed.id)
  // The PM dispatches it: assign the post and move it into the watched column. The story label keeps the run's
  // narrowing (only labelled cards become requests) from swallowing the filed card.
  const post = project.posts.find(item => item.role === 'pm')
  await attachLabel(options.label, filed.id, '#8250df')
  await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(filed.id)}`, { userId: post.kaneoUserId })
  await kaneo.api('PUT', `/task/status/${encodeURIComponent(filed.id)}`, { status: 'ready' })
  const duty = await dutyWithRedispatch(filed.id, 240_000).then(result => result.duty)
  const delivery = await until(async () => {
    const task = await kaneo.getTask(filed.id)
    return task.status === 'done' ? task : undefined
  }, options.timeout * 1000 * 3, 10_000)
  const comments = await kaneo.getComments(filed.id)
  return {
    checks: {
      'ingest.card-filed': true,
      'ingest.card-waits-in-todo': filedTask.status === 'to-do',
      'ingest.card-has-source-label': labels.includes('from:ntfy'),
      'ingest.card-has-no-assignee': !filedTask.assigneeId,
      'ingest.card-became-a-duty': !!duty,
      'ingest.card-got-the-worklog': comments.length > 1,
      'ingest.card-reached-the-delivery-column': delivery?.status === 'done',
    },
    evidence: {
      cardId: filed.id, title: filed.title, column: filedTask.status, labels, comments: comments.length,
      dutyId: duty?.id, deliveredTo: delivery?.status,
      excerpt: String(comments.at(-1)?.content ?? '').slice(0, 200),
    },
  }
})

story('US-11', 'PM', '权限：这个 Host 的账号身份与管理权限可见', async () => {
  const { projects } = await archive()
  const project = projects.find(item => item.id === options.project)
  const capabilities = await panel('capabilities')
  const post = project?.posts.find(item => item.kaneoUserId)
  return {
    checks: {
      'permission.account-known': !!capabilities.account?.id,
      'permission.account-is-the-post': !!post && capabilities.account?.id === post.kaneoUserId,
      'permission.management-follows-the-role': capabilities.canManageFlow === ['admin', 'owner'].includes(capabilities.account?.role ?? ''),
      'permission.reason-explains-a-missing-right': capabilities.canManageFlow || !!capabilities.reason,
    },
    evidence: {
      account: capabilities.account, canManageFlow: capabilities.canManageFlow,
      canPublishCharter: capabilities.canPublishCharter, reason: capabilities.reason,
      workspaces: capabilities.workspaces.map(item => item.name),
    },
  }
})

story('US-06', '系统', '看板查询：带 status 过滤才不漏任务', async () => {
  const unfiltered = await kaneo.api('GET', `/task/tasks/${encodeURIComponent(options.project)}`)
  const columns = unfiltered?.data?.columns ?? unfiltered?.columns ?? []
  // The card's own column is the one that matters: a card that moved is not in the column it started in. The card may
  // move between the two reads, so the column is read again after the query and the query repeated when it changed.
  const limit = 100
  let status = 'ready'
  let filteredTasks = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const card = created ? await kaneo.getTask(created) : undefined
    status = card?.status ?? 'ready'
    const filtered = await kaneo.api('GET', `/task/tasks/${encodeURIComponent(options.project)}?status=${encodeURIComponent(status)}&limit=${limit}`)
    filteredTasks = (filtered?.data?.columns ?? filtered?.columns ?? []).flatMap(column => column.tasks ?? [])
    if (!created || filteredTasks.some(task => task.id === created)) break
    await sleep(3000)
  }
  const unfilteredTasks = columns.flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
  const seen = new Set(unfilteredTasks.map(task => task.id))
  const missing = filteredTasks.filter(task => !seen.has(task.id))
  // A column with more tasks than the limit is cut off: the card may sit beyond the cut, which is the same truncation
  // the unfiltered board shows on every column.
  const cut = filteredTasks.length >= limit
  return {
    checks: {
      'board.columns-listed': columns.length > 0,
      'board.filtered-query-sees-the-card': !created || cut || filteredTasks.some(task => task.id === created),
      'board.unfiltered-can-miss-tasks': missing.length > 0,
    },
    evidence: {
      columns: columns.map(column => `${column.slug}:${(column.tasks ?? []).length}`),
      cardColumn: status, unfilteredCount: unfilteredTasks.length, filteredCount: filteredTasks.length,
      missingFromUnfiltered: missing.length, columnCutAtLimit: cut,
    },
  }
})

story('US-07', '系统', '限流：连续读写不会把脚本打死', async () => {
  let failures = 0
  for (let index = 0; index < 15; index += 1) {
    try { await kaneo.api('GET', `/task/tasks/${encodeURIComponent(options.project)}?status=ready&limit=100`) }
    catch { failures += 1 }
  }
  return {
    checks: { 'limit.no-failure-after-backoff': failures === 0 },
    evidence: { requests: 15, failures, waitedMs: kaneo.rate.waitedMs, limit: kaneo.rate.limit, remaining: kaneo.rate.remaining },
  }
})

story('US-08', '系统', '一个后台：叙事视图与工单列表说的是同一件事', async () => {
  const narrative = await panel('narrative')
  const open = await panel('tickets?state=open&limit=200')
  const ended = await panel('tickets?state=ended&limit=200')
  const post = narrative.posts.find(item => item.role === 'pm')
  const owned = [...open.items, ...ended.items].filter(item => item.postId === post?.postId).length
  return {
    checks: {
      'unified.narrative-has-posts': Array.isArray(narrative.posts),
      'unified.duties-counted-once': narrative.duties.length <= owned + open.items.length,
      'unified.archive-shared': (await panel('project-archive')).archive.projects.length === narrative.projects.length,
    },
    evidence: { duties: narrative.duties.length, ticketsOwned: owned, open: open.items.length, projects: narrative.projects.length },
  }
})

story('US-09', '岗位', '不代领：没有指派的卡被忽略，而且不被认领', async () => {
  const task = await kaneo.api('POST', `/task/${encodeURIComponent(options.project)}`, {
    title: `[story ${marker}] 未指派卡：应当被忽略且留在原列`,
    description: '这张卡没有负责人。岗位不代领、不自领：它应当被忽略，并且留在原列（不被认领）。',
    priority: 'no-priority',
    status: 'to-do',
  })
  const id = task?.id ?? task?.task?.id
  await attachLabel(options.label, id, '#8250df')
  await kaneo.api('PUT', `/task/status/${encodeURIComponent(id)}`, { status: 'ready' })
  // Give the deployment time to read the card and decide on it.
  await sleep(options.timeout * 1000 / 4)
  const readBack = await kaneo.getTask(id)
  const decisions = await panel('decisions?kind=ignore&limit=20')
  const decision = decisions.items.find(item => item.thread === `kaneo:${id}`)
  const duty = await dutyOf(id)
  const comments = await kaneo.getComments(id)
  const ours = comments.filter(comment => String(comment.content ?? '').includes('<!-- dsh-superagent:'))
  return {
    checks: {
      'not-claimed.no-duty': !duty,
      'not-claimed.no-reply': ours.length === 0,
      'not-claimed.decision-ignore': decision?.outcome === 'ignore',
    },
    evidence: {
      taskId: id, kaneoStatus: readBack.status, decision: decision?.outcome,
      reason: decision?.reason?.map(item => item.code).join(','), dutyId: duty?.id, replies: ours.length,
    },
  }
})

/** Narrows the deployment to the story card: only labelled KanEO tasks, no other sources. */
async function narrow () {
  const settings = await panel('settings')
  saved.eval = { value: settings.blocks.eval.value, revision: settings.blocks.eval.revision }
  saved.sources = {}
  for (const source of settings.sources) saved.sources[source.id] = { value: source.value, revision: source.revision }
  // The assessor acts on its own, so an explicit request becomes a duty.
  await panel('settings/eval', { method: 'PUT', body: { value: { ...saved.eval.value, mode: 'auto' }, revision: saved.eval.revision } })
  // Only the story card is a request; the other Sources stay quiet during the run.
  const kaneoSource = settings.sources.find(source => source.id === 'kaneo')
  await panel('settings/source:kaneo', { method: 'PUT', body: {
    value: { ...kaneoSource.value, config: { ...kaneoSource.value.config, requiredLabels: options.label, pollSeconds: 15 } },
    revision: kaneoSource.revision } })
  for (const id of ['gitea', 'ntfy']) {
    const source = settings.sources.find(item => item.id === id)
    if (!source || source.value.enabled === false) continue
    await panel(`settings/source:${id}`, { method: 'PUT', body: {
      value: { ...source.value, enabled: false }, revision: source.revision } })
  }
  await waitForService()
}

/** Restores every setting the run changed. */
async function restore () {
  if (!saved.sources) return
  for (const id of ['ntfy', 'gitea', 'kaneo']) {
    const previous = saved.sources[id]
    if (!previous) continue
    const settings = await panel('settings')
    const current = settings.sources.find(item => item.id === id)
    if (!current) continue
    // A source save restarts the plugin; wait for it before the next one, and let a source that is not installed
    // (its kind is off) stay as it is rather than failing the whole restore.
    try {
      await panel(`settings/source:${id}`, { method: 'PUT', body: { value: previous.value, revision: current.revision } })
      await waitForService()
    } catch (error) {
      console.error(`could not restore the ${id} Source: ${error.message}`)
    }
  }
  if (saved.eval) {
    const settings = await panel('settings')
    await panel('settings/eval', { method: 'PUT', body: { value: saved.eval.value, revision: settings.blocks.eval.revision } })
  }
  await waitForService()
}

const results = []
const started = new Date().toISOString()
try {
  await narrow()
  for (const item of stories) {
    if (options.only && item.id !== options.only) continue
    const began = Date.now()
    let outcome
    try { outcome = await item.run() }
    catch (error) { outcome = { checks: { [item.id]: false }, evidence: { error: error.message } } }
    const failed = Object.entries(outcome.checks ?? {}).filter(([, ok]) => !ok).map(([name]) => name)
    results.push({ id: item.id, persona: item.persona, title: item.title, ok: failed.length === 0, failed, ms: Date.now() - began, ...outcome })
    console.log(`[${failed.length ? 'FAIL' : ' ok '}] ${item.id} ${item.title} ${failed.length ? `— failed: ${failed.join(', ')}` : ''}`)
  }
} finally {
  if (!options.keepNarrowing) {
    try { await restore(); console.log('settings restored') }
    catch (error) { console.error(`could not restore the settings: ${error.message}`) }
  }
}

const report = {
  started, finished: new Date().toISOString(), marker, project: options.project, created,
  stories: results, passed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length,
}
const target = options.report || join('TDD', 'artifacts', `user-stories-${marker}.json`)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\n${report.passed} passed, ${report.failed} failed — report: ${target}`)
process.exitCode = report.failed ? 1 : 0
