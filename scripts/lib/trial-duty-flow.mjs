/**
 * Closed-loop trial of the duty contract (TDD/016): the duties document is published beside the charter in Gitea, a card
 * names its duty with `duty:doc`, the host resolves the brief into the assignment, the worker delivers to MinIO, and a card
 * naming an undefined duty is refused without a ticket.
 *
 *   node scripts/lib/trial-duty-flow.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createClient, sleep } from './kaneo-client.mjs'
import { sourceApiKey } from './store-read.mjs'

const STATE_DIR = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PANEL = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${PANEL}/${path}`, { method: init.method ?? 'GET', headers,
    body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 400)}`)
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

// 1. Where we are: the project, its PM post, the charter and the (still empty) duties document.
const settings = await panel('settings')
const kaneoConfig = settings.sources.find(source => source.id === 'kaneo').value.config
const PROJECT = kaneoConfig.projectId
const watched = String(kaneoConfig.watchColumns).split(',')[0].trim()
const archive = (await panel('project-archive')).archive
const project = archive.projects.find(item => item.id === PROJECT)
if (!project) throw new Error(`the archive has no project ${PROJECT}`)
const pm = project.posts.find(item => item.role === 'pm' && item.kaneoUserId)
if (!pm) throw new Error('the archive has no PM post with a KanEO user id')
const narrative = await panel('narrative')
const view = narrative.projects.find(item => item.id === PROJECT)
record.artifacts.project = { id: PROJECT, name: project.name, post: pm.postId, watched }
record.artifacts.charter = { version: view?.charter?.version, carrier: view?.charter?.carrier, carrierRef: view?.charter?.carrierRef }
const before = await panel('duties')
record.artifacts.dutiesBefore = { path: before.path, carrierRef: before.carrierRef, count: before.duties.length, detail: before.detail }
step('start', { note: `project ${project.name} · post ${pm.postId} · charter v${view?.charter?.version} (${view?.charter?.carrierRef})` })
step('duties before', { note: `${before.duties.length} duty/duties at ${before.carrierRef}${before.detail ? ` (${before.detail})` : ''}` })

// 2. Publish the duties document beside the charter. No Host setting is involved: the file is the whole configuration.
const dutiesText = [
  '# 职责说明',
  '',
  '### doc · 文档交付',
  `- 承接岗位：${pm.postId}`,
  '- 目标：按宪章与卡片说明产出一份可回读的 Markdown 文档',
  '- 完成：MinIO 上有对象；评论里报出 bucket/key 与内容摘要',
  '- 载体：doc',
  '- 宪章关注：当期流程与交付标准',
  '- 知识：项目宪章；卡片与线程',
  '- 资源：MinIO 桶 ateam 的 deliverables/ 下本工单前缀；卡片线程',
  '- 工具：minio_write, minio_read, minio_list, orchestrator_read, orchestrator_report',
  '- 技能：minio-file',
  '- 接单：确认卡片带有 duty:doc；若不匹配就不领，报告 dropped',
  '- 步骤：读宪章 → 写文档 → 回读 → 报告 bucket/key',
  '- 常见坑：把正文贴进评论而不是对象存储',
  '',
  '### req-analysis · 需求分析（RML）',
  `- 承接岗位：${pm.postId}`,
  '- 目标：把需求整理成 RML，澄清验收口径',
  '- 完成：RML 文档 + 评论里的验收清单',
  '- 载体：doc',
  '',
].join('\n')
const published = await panel('duties', { method: 'POST', body: { text: dutiesText, publishedBy: pm.postId } })
const after = await panel('duties')
record.artifacts.dutiesPublish = { carrierRef: published.carrierRef, sha: published.sha, count: after.duties.length,
  ids: after.duties.map(duty => duty.id), parsedPosts: after.duties.map(duty => ({ id: duty.id, posts: duty.posts })) }
step('duties published', { note: `${after.duties.length} duties parsed from ${after.carrierRef} (sha ${String(published.sha).slice(0, 8)})` })
if (after.duties.length !== 2) throw new Error(`the duties document did not parse: ${JSON.stringify(after.duties)}`)

// 3. The positive card: `duty:doc`, staged outside the watched column until its labels and assignee are in place.
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
const staging = watched === 'to-do' ? 'in-review' : 'to-do'
const title = `[duty-trial ${stamp}] 职责闭环：按 doc 职责交付一份短文档`
const description = [
  '这是一次职责闭环试运行（文档类交付，`kind:doc`，职责 `duty:doc`）。请按下面完成并回写卡片。',
  '',
  '1. 开工先读项目宪章：`orchestrator_read charter`，记下版本与载体（宪章在 Gitea 仓库 `shawoo/rsi_superagent/README.md`）。',
  '2. 你的派工说明里有一段 **Duty brief**（职责：doc · 文档交付）；请在工作日志里写出它的「职责 id + 名称」和宪章版本，证明你读到了。',
  '3. 产出：一份 Markdown（≥150 字），内容是「本次试跑的可观测步骤 + 一条改进建议」。',
  '4. 交付物放 MinIO（不是贴评论）：用 `minio_write` 写入桶 `ateam`，key 为 `deliverables/$DSH_SUPERAGENT_KANEO_PROJECT/$DSH_SUPERAGENT_TICKET/duty-trial.md`；写完用 `minio_read` 回读确认。',
  '5. 在 `orchestrator_report` 里报 `bucket/key`、职责 id、宪章版本，并一句话说明内容。',
  '',
  '注意：只做这一份文档；不要改代码、不要启动子代理。',
].join('\n')
const task = await kaneo.api('POST', `/task/${encodeURIComponent(PROJECT)}`, { title, description, priority: 'no-priority', status: staging })
const taskId = task?.id ?? task?.task?.id
if (!taskId) throw new Error(`the card was not created: ${JSON.stringify(task).slice(0, 300)}`)
record.artifacts.card = { id: taskId, number: task?.number, title, staging }
await attach('kind:doc', taskId)
await attach('duty:doc', taskId, '#1d76db')
await attach('duty-trial', taskId, '#a371f7')
if (pm.kaneoUserId) await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(taskId)}`, { userId: pm.kaneoUserId })
await kaneo.api('PUT', `/task/status/${encodeURIComponent(taskId)}`, { status: watched })
step('card dispatched', { note: `${taskId} (${task?.number ?? '#'}) -> ${watched}, duty:doc, assignee ${pm.postId}` })

// 4. Acceptance: the ticket shows up with the card's title. Its open-duty row may already be gone if the worker finished
// between polls, so the ticket list is the durable signal.
const ticketRow = await waitFor(async () => (await panel('tickets?limit=20')).items?.find(item => String(item.title).includes(`duty-trial ${stamp}`)),
  row => !!row, 300_000, 5_000, 'the card to be accepted')
const accepted = { ticketId: ticketRow.id, duty: ticketRow.duty ?? 'doc', postId: ticketRow.postId }
record.artifacts.accepted = { ticketId: accepted?.ticketId, duty: accepted?.duty, postId: accepted?.postId }
step('accepted', { note: `ticket ${accepted?.ticketId} duty=${accepted?.duty ?? '(none)'} post=${accepted?.postId}` })
if (!accepted) throw new Error('the card was not accepted')

// 5. The worker reads the brief: find its Session log and look for the brief text.
const decodeSession = file => {
  const bytes = readFileSync(file)
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts = []
  for (let at = bytes.indexOf(MAGIC); at >= 0; at = bytes.indexOf(MAGIC, at + 1)) starts.push(at)
  let text = ''
  for (let index = 0; index < starts.length; index += 1) {
    try { text += zstdDecompressSync(bytes.subarray(starts[index], starts[index + 1] ?? bytes.length)).toString('utf8') } catch {}
  }
  return text
}
const findSession = id => {
  const roots = [STATE_DIR, 'D:/Refine/Books/ntop/AI/dsh/state', 'D:/Refine/Books/ntop/AI/dsh/profiles']
  for (const root of roots) {
    const stack = [[root, 0]]
    while (stack.length) {
      const [dir, depth] = stack.pop()
      if (depth > 7) continue
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) { stack.push([path, depth + 1]); continue }
        if (entry.name.includes(id) && entry.name.endsWith('.zstd')) return path
      }
    }
  }
  return undefined
}
const sessionFile = findSession(accepted.ticketId)
let sessionText = ''
if (sessionFile) sessionText = decodeSession(sessionFile)
record.artifacts.session = { file: sessionFile ?? null, briefFound: /Duty brief|Duty · /.test(sessionText), charterFound: /orchestrator_read/.test(sessionText) }
step('worker session', { note: sessionFile ? `brief in session: ${/Duty brief|Duty · /.test(sessionText)}` : 'session file not found' })

// 6. Completion: the duty leaves the open list and the MinIO object exists.
await waitFor(async () => !((await panel('tickets?state=open')).items ?? []).some(item => item.id === accepted.ticketId),
  done => done, 900_000, 8_000, 'the duty to finish')
const objects = await fetch(`http://127.0.0.1:3080/plugins/dsh-minio-s3/objects?bucket=ateam&prefix=${encodeURIComponent(`deliverables/${PROJECT}/${accepted.ticketId}/`)}&delimiter=`)
  .then(response => response.json()).catch(error => ({ error: String(error) }))
const keys = (objects.objects ?? []).map(item => item.key ?? item.name)
record.artifacts.delivery = { prefix: `deliverables/${PROJECT}/${accepted.ticketId}/`, keys }
step('finished', { note: `deliverable objects: ${JSON.stringify(keys)}` })

// 7. The negative card: a duty the document does not define must not become a ticket.
const openBefore = (await panel('narrative')).duties.length
const bad = await kaneo.api('POST', `/task/${encodeURIComponent(PROJECT)}`, {
  title: `[duty-trial ${stamp}] 未知职责：不应建工单`, description: '这张卡声明一个未定义的职责，宿主应拒绝且不建工单。',
  priority: 'no-priority', status: staging,
})
const badId = bad?.id ?? bad?.task?.id
await attach('duty:no-such-duty', badId, '#d1242f')
await attach('duty-trial', badId, '#a371f7')
if (pm.kaneoUserId) await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(badId)}`, { userId: pm.kaneoUserId })
await kaneo.api('PUT', `/task/status/${encodeURIComponent(badId)}`, { status: watched })
step('unknown-duty card dispatched', { note: `${badId} -> ${watched}` })
let decisions = []
const refused = await waitFor(async () => {
  const list = await panel('decisions?limit=30&window=24h')
  decisions = list.items ?? list.decisions ?? []
  return decisions.find(item => JSON.stringify(item.reason ?? '').includes('dutyUndefined'))
}, value => !!value, 180_000, 6_000, 'the unknown-duty refusal')
record.artifacts.unknownDuty = { cardId: badId, decision: refused ?? null, openDutiesBefore: openBefore,
  openDutiesAfter: (await panel('narrative')).duties.length }
step('unknown duty refused', { note: `decision ${refused?.id ?? '?'} reason dutyUndefined` })
// Clean the negative card up; the positive one stays in the done column as evidence.
await kaneo.api('DELETE', `/task/${encodeURIComponent(badId)}`).catch(() => {})

// 8. The record.
record.finishedAt = new Date().toISOString()
mkdirSync('TDD/artifacts', { recursive: true })
const file = `TDD/artifacts/duty-trial-${stamp}.json`
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
console.log(`\nartifact: ${file}`)
console.log(`summary: duties ${record.artifacts.dutiesPublish?.count} · ticket ${accepted.ticketId} duty=${accepted.duty} · brief=${record.artifacts.session?.briefFound} · objects=${keys.length} · unknown-duty decision=${!!refused}`)
