/**
 * A short verification card for the improved process: the worker must read the charter with `orchestrator_read charter`
 * and report its version and declared flow in the card's comment. It proves the gap the rehearsal found is closed.
 */
import { writeFileSync } from 'node:fs'
import { createClient, sleep } from './kaneo-client.mjs'
import { sourceApiKey } from './store-read.mjs'

const STATE_DIR = 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PANEL = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${PANEL}/${path}`, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}
const waitFor = async (read, accept, timeoutMs, stepMs, label) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const value = await read(); if (value && accept(value)) return value } catch {}
    await sleep(stepMs)
  }
  throw new Error(`timed out waiting for ${label}`)
}
const settings = await panel('settings')
const kaneoConfig = settings.sources.find(source => source.id === 'kaneo').value.config
const PROJECT = kaneoConfig.projectId
const watched = String(kaneoConfig.watchColumns).split(',')[0].trim()
const doneColumn = kaneoConfig.doneColumn || 'done'
const archive = (await panel('project-archive')).archive
const project = archive.projects.find(item => item.id === PROJECT)
const pm = project.posts.find(item => item.role === 'pm' && item.kaneoUserId)
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

process.env.KANEO_API_KEY = sourceApiKey(STATE_DIR, 'kaneo')
const kaneo = createClient({ base: kaneoConfig.baseUrl || 'https://pl.feg.cn' })
const label = async (name, color = '#0969da') => {
  const workspaces = await kaneo.api('GET', '/workspace')
  const workspaceId = workspaces[0]?.id
  const existing = await kaneo.api('GET', `/label/workspace/${encodeURIComponent(workspaceId)}`)
  const found = (Array.isArray(existing) ? existing : []).find(item => item.name === name)
  return (found ?? await kaneo.api('POST', '/label', { name, color, workspaceId }))?.id
}
const attach = async (name, taskId, color) => { const id = await label(name, color); if (id) await kaneo.api('PUT', `/label/${encodeURIComponent(id)}/task`, { taskId }) }

const title = `[rehearsal ${stamp}] 岗位自读宪章：报出版本与当期流程`
const description = [
  '这张卡验证改进后的流程：岗位**自己读宪章**。',
  '',
  '1. 用 `orchestrator_read charter` 读项目宪章（不要猜、不要从别处找）。',
  '2. 在卡片评论回写一段简短工作日志（≤120 字），必须包含：',
  '   - 宪章的 `version` 与 `carrier`；',
  '   - 宪章声明的「当期流程」的列（按顺序列出）；',
  '   - 一句话：你据此认为本卡应遵循的交付标准。',
  '3. 只做这些：不要上传对象、不要改代码、不要启动子代理。',
].join('\n')
const staging = watched === 'to-do' ? 'in-review' : 'to-do'
const task = await kaneo.api('POST', `/task/${encodeURIComponent(PROJECT)}`, { title, description, priority: 'no-priority', status: staging })
const taskId = task?.id ?? task?.task?.id
if (!taskId) throw new Error('card not created')
await attach('rehearsal', taskId)
if (pm?.kaneoUserId) await kaneo.api('PUT', `/task/assignee/${encodeURIComponent(taskId)}`, { userId: pm.kaneoUserId })
await kaneo.api('PUT', `/task/status/${encodeURIComponent(taskId)}`, { status: watched })
console.log('card', taskId, 'dispatched to', watched)

const thread = await waitFor(() => panel(`threads/${encodeURIComponent(`kaneo:${taskId}`)}`),
  value => Array.isArray(value.tickets) && value.tickets.length > 0, 240_000, 5_000, 'the card thread')
const ticketId = thread.tickets[0].id
console.log('ticket', ticketId)
const ended = await waitFor(async () => {
  const current = await panel(`tickets/${encodeURIComponent(ticketId)}`)
  return current?.ended ? current : undefined
}, Boolean, 2_400_000, 10_000, 'the ticket to end')
const card = await waitFor(async () => kaneo.getTask(taskId), value => value?.status === doneColumn, 300_000, 8_000, 'the card to be done')
const comments = await kaneo.getComments(taskId)
const record = { stamp, taskId, ticketId, outcome: ended.ended.outcome, summary: ended.summary, status: card.status,
  comments: comments.map(item => String(item.content ?? '').replace(/\s+/g, ' ').slice(0, 500)) }
writeFileSync(`TDD/artifacts/rehearsal-charter-read-${stamp}.json`, JSON.stringify(record, null, 2), 'utf8')
console.log(JSON.stringify(record, null, 2))
