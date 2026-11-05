/**
 * The non-code deliverable loop, end to end, on the FDEP board: the bytes go to MinIO and the progress and result go
 * back to the card. A card labelled `kind:doc` is dispatched to the deployment's post; the worker writes the document,
 * uploads it with `minio_write`, and its report reaches the card as a comment.
 *
 *   node scripts/lib/minio-delivery-e2e.mjs [--timeout 600]
 */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PANEL_BASE = process.env.PANEL_BASE ?? 'http://127.0.0.1:3080'
const PANEL = `${PANEL_BASE}/orchestrator/api`
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }
const PROJECT = 'dgctny8ibgpn72ei2j8qj2hc'
const ADMIN = 'bsFdwgQXqZpYKvD5E2emqQ5TQ81eJ3zG'
const timeout = Number(process.argv.find(item => /^\d+$/.test(item)) ?? 600) * 1000
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const kaneo = createClient({ base: 'https://pl.feg.cn' })
const panel = async (path) => (await fetch(`${PANEL}/${path}`, { headers })).json()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const title = `[delivery ${stamp}] MinIO 交付物闭环：写一份说明并回写卡片`
console.log(`0. the card: ${title}`)

// The board's own automation moves a card out of `ready` within half a minute, and the deployment polls every minute,
// so the run narrows the Source's interval the way the story harness does and restores it afterwards.
const saved = await panel('settings')
const kaneoSource = saved.sources.find(source => source.id === 'kaneo')
const restore = async () => {
  const fresh = await panel('settings')
  const source = fresh.sources.find(item => item.id === 'kaneo')
  if (!source || !kaneoSource) return
  await fetch(`${PANEL}/settings/source:kaneo`, { method: 'PUT', headers,
    body: JSON.stringify({ value: kaneoSource.value, revision: source.revision }) })
}
try {
  await fetch(`${PANEL}/settings/source:kaneo`, { method: 'PUT', headers, body: JSON.stringify({
    value: { ...kaneoSource.value, config: { ...kaneoSource.value.config, pollSeconds: 15 } }, revision: kaneoSource.revision,
  }) })
  await sleep(20_000)
} catch (error) {
  console.log(`could not narrow the polling interval: ${error.message}`)
}

// A label names the carrier; the same name answers with the label that already exists.
const label = await kaneo.api('POST', '/label', { name: 'kind:doc', color: '#0ea5e9', workspaceId: 'lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o' })
const task = await kaneo.api('POST', `/task/${PROJECT}`, {
  title, status: 'to-do', priority: 'no-priority',
  description: [
    '交付物类型：文档（`kind:doc`）。',
    '',
    '请写一份简短说明（Markdown，300 字以内），内容是「本项目的交付物如何存放」：',
    '- 交付物文件放在 MinIO 的哪个桶、哪个 key 前缀下；',
    '- 卡片上只保留什么（进度与结果），以及为什么不把文件本体贴在评论里。',
    '',
    '要求：',
    '1. 用 `minio_write` 把文件存到对象存储，key 用 `deliverables/' + PROJECT + '/<你的 ticket id>/<文件名>`；',
    '2. 用 `minio_read` 或 `minio_list` 读回来确认它真的在；',
    '3. 在完成报告里写 `bucket/key`，然后报告 ready —— 卡片由宿主按报告回写评论并推进，**不要自己动看板**。',
  ].join('\n'),
})
await kaneo.api('PUT', `/label/${encodeURIComponent(label.id)}/task`, { taskId: task.id })
await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(task.id)}`, { userId: ADMIN })
await kaneo.api('PUT', `/task/status/${encodeURIComponent(task.id)}`, { status: 'ready' })
console.log(`1. dispatched: task ${task.id} (kind:doc, assigned, in ready)`)

// Wait for the worker: its report arrives as a comment on the card, and the card reaches the delivery column.
const deadline = Date.now() + timeout
let comments = []
let card = task
while (Date.now() < deadline) {
  await sleep(15_000)
  comments = await kaneo.getComments(task.id)
  card = await kaneo.getTask(task.id)
  const done = card.status === 'done'
  console.log(`   … card in ${card.status}; ${comments.length} comment(s)${done ? ' — delivered' : ''}`)
  if (done && comments.length > 0) break
}

// The object the report names: every comment that mentions an object key is checked against the store.
const text = comments.map(comment => String(comment.content ?? '')).join('\n')
const reference = /([a-z0-9][a-z0-9-]{1,62})\/(deliverables\/[^\s`'"）)]+)/i.exec(text)
console.log(`2. card status: ${card.status}; comments: ${comments.length}`)
console.log(`   report names: ${reference ? `${reference[1]}/${reference[2]}` : '(no object key found)'}`)

if (!reference) {
  // The report is only part of the proof: a person can only use a deliverable that really is in the store, so the
  // store's own listing is checked as well.
  const listing = await store('ateam', 'deliverables/')
  console.log(`FAILED: the report does not name a MinIO object; the store has ${listing.length} deliverable(s)`)
  for (const key of listing.slice(0, 5)) console.log(`   ${key}`)
  process.exitCode = 1
} else {
  const [, bucket, key] = reference
  // The store's listing is polled briefly: a report can arrive a moment before the object is visible to a list call.
  const found = await until(async () => {
    const objects = await store(bucket, key)
    return objects.find(item => item === key)
  }, 60_000, 5_000)
  console.log(`3. store: ${bucket}/${key} → ${found ? 'present' : 'MISSING'}`)
  if (!found) process.exitCode = 1
}

const threads = await panel('threads?filter=all&limit=20')
const thread = (threads.items ?? []).find(item => item.key === `kaneo:${task.id}`)
console.log(`4. the card's thread: ${thread ? `${thread.key} (${thread.evaluating ? 'evaluating' : 'settled'})` : '(not in the latest twenty)'}`)
await restore()
console.log('settings restored')

/** Waits until `check` answers, so a list that lags behind the write is not read as a missing object. */
async function until (check, timeoutMs, everyMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check().catch(() => undefined)
    if (value) return value
    await sleep(everyMs)
  }
  return undefined
}

/** Lists the folder's objects; the route appends a slash to the prefix, so a file key is asked for by its folder. */
async function store (bucket, prefix) {
  const folder = prefix.endsWith('/') ? prefix : prefix.slice(0, prefix.lastIndexOf('/') + 1)
  const response = await fetch(`${PANEL_BASE}/plugins/dsh-minio-s3/objects?bucket=${encodeURIComponent(bucket)}` +
    `&prefix=${encodeURIComponent(folder)}&delimiter=`, { headers })
  const listing = await response.json()
  return (listing.objects ?? []).map(object => object.key ?? object.name)
}
