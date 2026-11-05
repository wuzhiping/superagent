/**
 * The pipeline-growth validation on the RSI project (slug RSI), whose board starts from Kanban's default flow:
 * a project's value stream grows in the retrospective, and the charter confirms it afterwards.
 *
 *   1. read the board (the flow the project was created with)
 *   2. publish a charter declaring that flow — the project description becomes the charter every post reads
 *   3. the retrospective finds a missing stage: the PM adds the column in Kanban
 *   4. the panel now sees drift — the board has a column the charter does not declare
 *   5. publishing again inside the week is refused; the PM overrides it deliberately
 *   6. the charter declares the grown flow, and the panel sees the board and the charter aligned
 *
 *   node scripts/lib/rsi-pipeline-growth.mjs --reset   # start from the default flow again
 */
import { sourceApiKey } from './store-read.mjs'
import { createClient } from './kaneo-client.mjs'

const PANEL = process.env.PANEL ?? 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }
const stateDir = process.env.STATE_DIR ?? 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PROJECT = process.argv.find(item => /^at[a-z0-9]+$/.test(item)) ?? 'at8xrho45bisco2umjzgl1xp'
const GROWN_NAME = 'QA 驗收'
const reset = process.argv.includes('--reset')

process.env.KANEO_API_KEY = sourceApiKey(stateDir, 'kaneo')
const kaneo = createClient({ base: 'https://pl.feg.cn' })
const panel = async (path, init = {}) => {
  const response = await fetch(`${PANEL}/${path}`, { ...init, headers })
  const text = await response.text()
  if (!response.ok) throw new Error(text.slice(0, 300))
  return text ? JSON.parse(text) : {}
}
const columns = async () => {
  const response = await kaneo.api('GET', `/column/${encodeURIComponent(PROJECT)}`)
  return Array.isArray(response) ? response : (response?.data ?? [])
}
const narrative = async () => (await panel('narrative')).projects.find(item => item.id === PROJECT)

/** The archive entry for the RSI project, added the way a PM adds a project in the panel. */
async function ensureProject () {
  const current = await panel('project-archive')
  if (current.archive.projects.some(item => item.id === PROJECT)) return
  const account = (await panel('capabilities')).account
  current.archive.projects.push({
    id: PROJECT, name: 'Superagent', slug: 'RSI', topics: [],
    charter: { version: 0, publishedAt: '', publishedBy: '', text: '', draft: '', history: [] },
    posts: [{
      postId: 'pm-rsi', role: 'pm', name: 'SuperAgent PM (RSI)', kaneoUserId: account?.id ?? '',
      giteaUser: '', ntfySender: '', wipLimit: 3, instance: 'web', watchColumns: 'ready',
    }],
  })
  await panel('project-archive', { method: 'PUT', body: JSON.stringify({ archive: current.archive, revision: current.revision }) })
  console.log('archive: the RSI project is registered')
}

const charterText = (steps, note) => [
  '# 宪章 · RSI 项目',
  'publishedBy: pm-rsi',
  '',
  '## 当期流程（看板列）',
  `- 当期流程：${steps.map(step => `${step.slug} ${step.meaning}`).join(' → ')}`,
  '',
  '## 角色与职责',
  '- PM 岗位：管流程、发宪章、派工、处理异常；不直接产出交付物。',
  '- Worker 岗位：领指派给自己的卡，按宪章与该卡的说明产出，回写工作日志与产出引用。',
  '',
  '## 交付标准',
  '- 产出由卡片自己声明（`kind:` 标签），载体是权威：代码 → Gitea PR；文档/方案 → MinIO 对象；其余 → 任务评论正文。',
  '- 卡要动哪些仓库，由卡自己说（`repo:owner/name`），不写在本宪章里。',
  '',
  '## 回写规则',
  '- 只追加、不改写；卡片推进到交付列时把工作日志与产出引用一起回写。',
  '',
  note,
  '',
].join('\n')

const publish = async (text, force) => panel('narrative/charter', { method: 'POST', body: JSON.stringify({
  projectId: PROJECT, publishedBy: 'pm-rsi', text, ...(force ? { force: true } : {}),
}) })

try {
  await ensureProject()

  // A clean start: the board back to the flow the project was created with.
  if (reset) {
    for (const column of await columns()) {
      if (column.name !== GROWN_NAME) continue
      try {
        await kaneo.api('DELETE', `/column/${encodeURIComponent(column.id)}`)
        console.log(`reset: removed "${column.name}" (${column.slug}) from the board`)
      } catch (error) {
        console.log(`reset: could not remove "${column.name}": ${String(error.message)} (its cards must move first)`)
      }
    }
  }

  // 1. the flow the project works with now
  const before = await columns()
  console.log(`1. board: ${before.map(column => `${column.slug} "${column.name}"`).join(', ')}`)

  // 2. the charter declares it, on the project itself
  const declared = await publish(charterText(before.map(column => ({ slug: column.slug, meaning: column.name })),
    '_v1：项目当前的流程。_'), true)
  const project = await kaneo.api('GET', `/project/${encodeURIComponent(PROJECT)}`)
  console.log(`2. charter v${declared.charter.version} published onto the project (${String((project?.data ?? project)?.description ?? '').length} chars)`)

  // 3. the flow grows: the retrospective adds the stage, and the PM adds the column in Kanban
  const grown = (await columns()).find(column => column.name === GROWN_NAME || column.slug.startsWith('qa'))
  if (!grown) {
    const created = await kaneo.api('POST', `/column/${encodeURIComponent(PROJECT)}`, { name: GROWN_NAME, color: '#f59e0b' })
    console.log(`3. the board grew: ${created.slug} "${created.name}"`)
  } else {
    console.log(`3. the board already has ${grown.slug} "${grown.name}"`)
  }

  // 4. the panel sees the drift the charter has not confirmed yet
  const drifted = await narrative()
  console.log(`4. drift before the charter confirms it: added=[${drifted.flow.drift.added.join(',')}] aligned=${drifted.flow.aligned}`)

  // 5. the weekly limit refuses a second publication; the PM overrides it on purpose
  const after = await columns()
  const text2 = charterText(after.map(column => ({ slug: column.slug, meaning: column.name })),
    '_v2：复盘发现验收这一段缺环，确认新增 QA 驗收。_')
  let refused = ''
  try { await publish(text2, false) } catch (error) { refused = error.message }
  console.log(`5. second publication inside the week: ${refused ? `refused (${refused.slice(0, 80)}…)` : 'ACCEPTED (unexpected)'}`)
  const confirmed = await publish(text2, true)
  console.log(`   charter v${confirmed.charter.version} published with the PM's override`)

  // 6. the board and the charter agree again
  const aligned = await narrative()
  console.log(`6. board now: ${aligned.flow.board.map(column => column.slug).join(', ')}`)
  console.log(`   declared  : ${aligned.flow.declared.map(step => step.column).join(', ')}`)
  console.log(`   drift added=[${aligned.flow.drift.added.join(',')}] removed=[${aligned.flow.drift.removed.join(',')}] aligned=${aligned.flow.aligned}`)
  console.log(`   charter: v${aligned.charter.version} shared=${aligned.charter.shared} nextPublishAt=${aligned.charter.nextPublishAt ?? '(due now)'}`)
  if (!aligned.flow.aligned) process.exitCode = 1
} catch (error) {
  console.error('FAILED:', error.message)
  process.exitCode = 1
}
