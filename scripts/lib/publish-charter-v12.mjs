/**
 * Publishes charter v12 into the Gitea README, carrying the improvements the two rehearsals and the story run produced:
 * a worker reads the charter through its own tool (`orchestrator_read charter`), the deliverable key is fixed, the
 * realtime channel names its topic, and the retrospective has a place in the loop.
 */
const base = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${base}/${path}`, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

const narrative = await panel('narrative')
const project = narrative.projects[0]
const before = project.charter
console.log(`before: v${before.version} carrier=${before.carrier} ref=${before.carrierRef}`)

const text = [
  '# 宪章 · RSI 项目（Superagent）',
  '',
  '## 当期流程（看板列）',
  '- 当期流程：to-do → in-progress → in-review → done → qa-驗收',
  '',
  '## 岗位职责',
  '- PM 岗位：管流程、发宪章、派工、处理异常；不直接产出交付物。',
  '- Worker 岗位：开工第一步用 `orchestrator_read charter` 读本期宪章（报出版本与载体），再读卡片；不代领、不自领没有指派给自己的卡。',
  '',
  '## 交付标准',
  '- 非代码交付物放 MinIO（桶 `ateam`）：key 固定为 `deliverables/<projectId>/<ticketId>/<file>`，同一 key 覆盖即修订；卡片评论只写进度与结果（`bucket/key`），不贴正文。',
  '- 代码交付走 Gitea PR，PR 描述写明 Before/After 证据；卡片要动哪些仓库由卡自己声明（`repo:owner/name`）。',
  '',
  '## 实时沟通',
  '- 项目主题：`pub_<projectId>`（本期 `pub_at8xrho45bisco2umjzgl1xp`）。ntfy 消息先入库成卡（`from:ntfy`），有阻塞在卡片评论或 topic 说明。',
  '',
  '## 复盘与改版',
  '- 每轮值流闭环后 PM 复盘：载体是卡片评论 + MinIO 复盘文档，可执行的流程改进写进 SOP。',
  '- 宪章至多每周一版；本期改进：岗位自读宪章（`orchestrator_read charter`）作为开工第一步，交付物 key 只此一种写法。',
].join('\n')

const published = await panel('narrative/charter', { method: 'POST', body: {
  projectId: project.id, text, publishedBy: 'pm-rsi', force: true } })
console.log('published:', JSON.stringify(published).slice(0, 400))

const after = await panel('narrative')
const view = after.projects[0]
console.log(`after: v${view.charter.version} carrier=${view.charter.carrier} ref=${view.charter.carrierRef} publishedBy=${view.charter.publishedBy}`)

const readme = await (await fetch('https://git.feg.cn/api/v1/repos/shawoo/rsi_superagent/contents/README.md')).json()
const committed = Buffer.from(readme.content ?? '', readme.encoding ?? 'base64').toString('utf8')
console.log('README bytes:', committed.length, 'FFFD:', (committed.match(/\uFFFD/g) || []).length)
console.log('README version line:', committed.split('\n').find(line => line.startsWith('version:')))
console.log(committed.split('\n').slice(0, 6).join(' | '))
