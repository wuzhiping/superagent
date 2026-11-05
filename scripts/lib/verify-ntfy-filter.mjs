/**
 * Proves the ntfy tag filter live: a message without a wanted tag is not filed, one carrying `dsh` becomes a card. The
 * Kanban card of the tagged message is read back, and the Source's health detail shows the filter and the skip count.
 */
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
const settings = await panel('settings')
const kaneoConfig = settings.sources.find(source => source.id === 'kaneo').value.config
const ntfyConfig = settings.sources.find(source => source.id === 'ntfy').value.config
const PROJECT = kaneoConfig.projectId
const topic = ntfyConfig.topic
const server = ntfyConfig.baseUrl || 'https://msn.feg.cn'
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

process.env.KANEO_API_KEY = sourceApiKey(STATE_DIR, 'kaneo')
const kaneo = createClient({ base: kaneoConfig.baseUrl || 'https://pl.feg.cn' })
const todoTitles = async () => {
  const board = await kaneo.api('GET', `/task/tasks/${encodeURIComponent(PROJECT)}?status=to-do&limit=100`)
  const tasks = (board?.data?.columns ?? board?.columns ?? []).flatMap(column => column.tasks ?? [])
  return tasks.map(task => String(task.title ?? ''))
}
const before = await todoTitles()
console.log('to-do before:', before.length)

const publish = async (title, message, tags) => {
  const response = await fetch(server, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ topic, title, message, tags, priority: 3 }) })
  if (!response.ok) throw new Error(`ntfy ${response.status}`)
  return response.headers.get('x-ntfy-id') ?? ''
}
const plainId = await publish(`[filter-test ${stamp}] no tag`, '没有 dsh tag 的消息不应该入库。', [])
const taggedId = await publish(`[filter-test ${stamp}] tagged`, '带 dsh tag 的消息应该入库成卡。', ['dsh'])
console.log('published:', plainId, taggedId)

// Wait for at least one poll round after the messages.
const deadline = Date.now() + 180_000
let titles = before
while (Date.now() < deadline) {
  await sleep(10_000)
  titles = await todoTitles()
  if (titles.some(title => title.includes(`[filter-test ${stamp}] tagged`))) break
}
const state = await panel('state')
const filteredTitles = titles.filter(title => title.includes(`[filter-test ${stamp}]`))
console.log('to-do after:', titles.length, 'filter-test cards:', JSON.stringify(filteredTitles))
console.log('ntfy health:', state.health?.ntfy?.state, '-', state.health?.ntfy?.detail)
const result = {
  stamp, plainMessageId: plainId, taggedMessageId: taggedId,
  filed: filteredTitles.some(title => title.includes('tagged')),
  skipped: !filteredTitles.some(title => title.includes('no tag')),
  cards: filteredTitles,
  health: state.health?.ntfy?.detail,
}
console.log(JSON.stringify(result, null, 2))
