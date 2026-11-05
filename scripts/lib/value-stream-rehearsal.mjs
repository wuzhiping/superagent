/**
 * The value-stream rehearsal of the new design, driven from outside:
 *
 *   Gitea charter (README.md) -> Kanban card in the RSI project -> host dispatch -> worker delivers to MinIO ->
 *   the card keeps the progress and the result -> ntfy carries the realtime conversation.
 *
 * It only uses documented surfaces: the panel API for narrative/threads/tickets, KanEO REST for the card, the MinIO
 * plugin route for the object, and ntfy's JSON API for the topic. Nothing is asserted from local state alone.
 *
 *   node scripts/lib/value-stream-rehearsal.mjs [--keep]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient, sleep } from './kaneo-client.mjs'
import { sourceApiKey } from './store-read.mjs'

const STATE_DIR = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PANEL = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${PANEL}/${path}`, { method: init.method ?? 'GET', headers,
    body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}
const waitFor = async (read, accept, timeoutMs = 1_200_000, stepMs = 5_000, label = 'condition') => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const value = await read(); if (value && accept(value)) return value } catch {}
    await sleep(stepMs)
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const startedAt = new Date().toISOString()
const record = { stamp, startedAt, steps: [], artifacts: {} }
const step = (name, detail = {}) => {
  record.steps.push({ at: new Date().toISOString(), name, ...detail })
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${name} ${detail.note ?? ''}`)
}

const settings = await panel('settings')
const kaneoConfig = settings.sources.find(source => source.id === 'kaneo').value.config
const PROJECT = kaneoConfig.projectId
const watched = String(kaneoConfig.watchColumns).split(',')[0].trim()
const doneColumn = kaneoConfig.doneColumn || 'done'
const archive = (await panel('project-archive')).archive
const project = archive.projects.find(item => item.id === PROJECT)
if (!project) throw new Error(`the archive has no project ${PROJECT}`)
const pm = project.posts.find(item => item.role === 'pm' && item.kaneoUserId)
record.artifacts.project = { id: PROJECT, name: project.name, slug: project.slug, watched, doneColumn }

// 1. The charter: the document the rehearsal starts from.
const narrative = await panel('narrative')
const view = narrative.projects.find(item => item.id === PROJECT)
record.artifacts.charter = {
  version: view?.charter?.version, carrier: view?.charter?.carrier, carrierRef: view?.charter?.carrierRef,
  publishedAt: view?.charter?.publishedAt, flow: view?.flow?.declared?.map(item => item.column) ?? [],
}
step('charter read', { note: `v${view?.charter?.version} from ${view?.charter?.carrier} ${view?.charter?.carrierRef}` })
if (!view?.charter?.version) throw new Error('no charter is readable, the rehearsal starts from it')
if (view.charter.carrier !== 'gitea') console.warn(`warning: charter carrier is ${view.charter.carrier}, not gitea`)

// 2. The KanEO card: a labelled non-code deliverable, assigned to the PM post and moved into the watched column.
process.env.KANEO_API_KEY = sourceApiKey(STATE_DIR, 'kaneo')
const kaneo = createClient({ base: kaneoConfig.baseUrl || 'https://pl.feg.cn' })
const label = async (name, color = '#0969da') => {
  const workspaces = await kaneo.api('GET', '/workspace')
  const workspaceId = workspaces[0]?.id
  const existing = await kaneo.api('GET', `/label/workspace/${encodeURIComponent(workspaceId)}`)
  const found = (Array.isArray(existing) ? existing : []).find(item => item.name === name)
  return (found ?? await kaneo.api('POST', '/label', { name, color, workspaceId }))?.id
}
const attach = async (name, taskId, color) => {
  const id = await label(name, color)
  if (id) await kaneo.api('PUT', `/label/${encodeURIComponent(id)}/task`, { taskId })
  return id
}

const title = `[rehearsal ${stamp}] RSI 值流闭环：宪章 → 看板 → ntfy → MinIO 的交付与复盘`
const description = [
  '这是一次值流闭环演练（文档类交付，`kind:doc`）。请按以下要求完成并回写卡片：',
  '',
  '1. 先读项目宪章：它在 Gitea 仓库 `shawoo/rsi_superagent` 的 `README.md`（项目宪章正文，含当期流程与交付标准）。',
  '2. 产出：一份 Markdown 交付物（≤600 字），内容是本轮值流闭环的**执行摘要 + 改进建议**：',
  '   - 你从接到这张卡到交付，经过了哪些步骤；',
  '   - 依据宪章/交付标准，哪一步最费时间或最容易卡住，你建议流程怎么改（1–3 条，可操作）。',
  '3. 交付物放 MinIO（不是把正文贴进评论）：',
  '   - 用 `minio_write` 写入桶 `ateam`，key 为 `deliverables/$DSH_SUPERAGENT_KANEO_PROJECT/$DSH_SUPERAGENT_TICKET/retro.md`；',
  '   - 写完用 `minio_list` 或 `minio_read` 回读确认；',
  '   - 在 `orchestrator_report` 里用 `bucket/key` 报出载体，并一句话说明内容。',
  '4. 卡片上只留进度与结果：评论写清你做了什么、交付物在哪个对象；不要贴文件正文。',
  '',
  '注意：只做这一份文档；不要改代码、不要启动子代理。',
].join('\n')

// The card is staged outside the watched column, gets its labels and its assignee, and only then enters the column
// the Source watches — a card read before its labels are attached would be skipped for good.
const staging = watched === 'to-do' ? 'in-review' : 'to-do'
const task = await kaneo.api('POST', `/task/${encodeURIComponent(PROJECT)}`, {
  title, description, priority: 'no-priority', status: staging,
})
const taskId = task?.id ?? task?.task?.id
if (!taskId) throw new Error(`the card was not created: ${JSON.stringify(task).slice(0, 200)}`)
record.artifacts.card = { id: taskId, number: task?.number, title, staging }
await attach('kind:doc', taskId, '#0ea5e9')
await attach('rehearsal', taskId, '#a371f7')
if (pm?.kaneoUserId) await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(taskId)}`, { userId: pm.kaneoUserId })
await kaneo.api('PUT', `/task/status/${encodeURIComponent(taskId)}`, { status: watched })
step('card dispatched', { note: `${taskId} (${task?.number ?? '#'}) -> ${watched}, assignee ${pm?.kaneoUserId ? 'PM post' : 'none'}` })

// 3. The realtime channel: one message on the project's ntfy topic while the work is under way.
const topic = settings.sources.find(source => source.id === 'ntfy').value.config.topic
const ntfyServer = settings.sources.find(source => source.id === 'ntfy').value.config.baseUrl || 'https://msn.feg.cn'
const ntfyTitle = `[rehearsal ${stamp}] PM 通知：值流闭环演练进行中`
const ntfyMessage = [
  `任务 ${task?.number ?? taskId} 已进入 ${watched} 列：交付物是 MinIO 上的 retrofit 摘要（key 以 deliverables/${PROJECT}/ 开头），卡片只写进度与结果。`,
  '有阻塞请在卡片评论或本 topic 说明；完成后我会在卡片回写结论。',
].join('\n')
const published = await fetch(ntfyServer, {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ topic, title: ntfyTitle, message: ntfyMessage, markdown: false, priority: 3, tags: ['rehearsal'] }),
})
if (!published.ok) throw new Error(`ntfy publish -> ${published.status}: ${(await published.text()).slice(0, 200)}`)
record.artifacts.ntfy = { topic, title: ntfyTitle, messageId: published.headers.get('x-ntfy-id') ?? '' }
step('ntfy message sent', { note: `topic ${topic}` })

// The inbound message became a KanEO card of its own (labelled from:ntfy); it is not a duty because it carries no
// rehearsal label.
const filed = await waitFor(async () => {
  const board = await kaneo.api('GET', `/task/tasks/${encodeURIComponent(PROJECT)}?status=to-do&limit=100`)
  const tasks = (board?.data?.columns ?? board?.columns ?? []).flatMap(column => column.tasks ?? [])
  return tasks.find(item => String(item.title ?? '').includes(`[rehearsal ${stamp}] PM 通知`))
}, Boolean, 240_000, 8_000, 'the ntfy message to become a card')
record.artifacts.ntfyCard = { id: filed.id, title: filed.title, status: filed.status }
step('ntfy message filed on the board', { note: `${filed.id} in ${filed.status}` })

// 4. The host picks the card up: the Thread, then the ticket it makes.
const thread = await waitFor(() => panel(`threads/${encodeURIComponent(`kaneo:${taskId}`)}`),
  value => Array.isArray(value.tickets) && value.tickets.length > 0, 300_000, 5_000, 'the card thread')
const ticketId = thread.tickets[0].id
record.artifacts.ticket = { id: ticketId }
step('ticket created', { note: ticketId })

const ticket = await waitFor(() => panel(`tickets/${encodeURIComponent(ticketId)}`),
  value => value?.postId, 60_000, 2_000, 'the ticket view')
record.artifacts.post = { postId: ticket.postId, charterVersion: ticket.charterVersion, state: ticket.state }
step('ticket running', { note: `post ${ticket.postId}, charter v${ticket.charterVersion}` })

// 5. MinIO: the deliverable object appears while the card keeps only the progress.
const minio = {
  list: async prefix => (await fetch(`http://127.0.0.1:3080/plugins/dsh-minio-s3/objects?bucket=ateam&prefix=${encodeURIComponent(prefix)}&delimiter=`)).json(),
  read: async key => (await fetch(`http://127.0.0.1:3080/plugins/dsh-minio-s3/object?bucket=ateam&key=${encodeURIComponent(key)}`)).json(),
}
const objectKey = await waitFor(async () => {
  const listing = await minio.list(`deliverables/${PROJECT}`)
  const objects = listing.objects ?? []
  return objects.map(item => item.key ?? item.name).find(key => String(key).includes(ticketId))
}, Boolean, 1_800_000, 10_000, 'the deliverable object in MinIO')
const detail = await minio.list(`deliverables/${PROJECT}/${ticketId}`)
record.artifacts.minio = { bucket: 'ateam', key: objectKey, objects: (detail.objects ?? []).map(item => item.key ?? item.name) }
step('MinIO deliverable', { note: objectKey })

// 6. The card's own record: the work log, the delivery outcome and the column it reached.
const ended = await waitFor(async () => {
  const current = await panel(`tickets/${encodeURIComponent(ticketId)}`)
  return current?.ended ? current : undefined
}, Boolean, 2_400_000, 10_000, 'the ticket to end')
record.artifacts.outcome = { outcome: ended.ended.outcome, summary: ended.summary, endedAt: ended.ended.at }
const card = await waitFor(async () => kaneo.getTask(taskId),
  value => value?.status === doneColumn, 300_000, 8_000, `the card to reach ${doneColumn}`)
const comments = await kaneo.getComments(taskId)
record.artifacts.board = {
  status: card.status,
  comments: comments.map(item => ({ author: item.authorId ?? item.author, at: item.createdAt,
    excerpt: String(item.content ?? '').replace(/\s+/g, ' ').slice(0, 220) })),
}
step('card delivered', { note: `${card.status}, ${comments.length} comment(s)` })

// 7. The realtime conversation, read back from ntfy.
const history = await (await fetch(`${ntfyServer}/${encodeURIComponent(topic)}/json?poll=1&since=12h`)).text()
const messages = history.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return undefined } }).filter(Boolean)
record.artifacts.ntfyHistory = messages.filter(item => String(item.title ?? '').includes('rehearsal') || item.messageId === record.artifacts.ntfy.messageId)
  .map(item => ({ id: item.id, time: item.time, title: item.title, tags: item.tags, message: String(item.message ?? '').slice(0, 200) }))
step('ntfy conversation read back', { note: `${record.artifacts.ntfyHistory.length} message(s)` })

const file = `TDD/artifacts/rehearsal-${stamp}.json`
mkdirSync('TDD/artifacts', { recursive: true })
writeFileSync(file, JSON.stringify(record, null, 2), 'utf8')
console.log(`\nsummary: ${file}`)
console.log(JSON.stringify({
  charter: record.artifacts.charter,
  card: record.artifacts.card,
  ticket: record.artifacts.ticket,
  outcome: record.artifacts.outcome,
  minio: record.artifacts.minio,
  boardStatus: record.artifacts.board.status,
  comments: record.artifacts.board.comments.length,
  ntfyMessages: record.artifacts.ntfyHistory.length,
}, null, 2))
