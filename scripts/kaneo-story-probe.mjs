#!/usr/bin/env node
/**
 * Story probe: builds the artefacts the collaboration narrative in RD.md needs on a KanEO board and reads them back.
 *
 * It creates (and keeps, by design) a verification card, the role labels that carry "which post works on this card",
 * a charter carrier task (the place a PM publishes a versioned charter), and a subtask relation. Every artefact is
 * verified by reading it back through the same endpoints a worker would use.
 *
 * Usage: node scripts/kaneo-story-probe.mjs --key-file <path> [--project <id>] [--report <file>]
 */
import { writeFileSync } from 'node:fs'
import { createClient } from './lib/kaneo-client.mjs'

const argv = process.argv.slice(2)
const options = { keyFile: '', project: 'dgctny8ibgpn72ei2j8qj2hc', report: '', allowPipeline: false, verify: '' }
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--key-file') options.keyFile = argv[++i]
  else if (arg === '--project') options.project = argv[++i]
  else if (arg === '--report') options.report = argv[++i]
  else if (arg === '--verify') options.verify = argv[++i]
  else if (arg === '--allow-pipeline') options.allowPipeline = true
  else if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0) }
  else { console.error(`unknown argument: ${arg}`); process.exit(2) }
}
const HELP = `kaneo-story-probe — build and verify the narrative artefacts on a KanEO board

  --key-file <path>   file containing the KanEO API key (or set KANEO_API_KEY)
  --project <id>      project to build in (default: the FDEP board; test data must stay there)
  --verify <cardId>   verify an existing probe card instead of creating new artefacts
  --report <file>     write the JSON report to this file
  --allow-pipeline    override the guard that refuses to write to the pipeline board
`

async function ensureLabel (client, workspaceId, name, color, taskId) {
  const existing = await client.api('GET', `/label/workspace/${encodeURIComponent(workspaceId)}`)
  const found = (Array.isArray(existing) ? existing : []).find(label => label.name === name)
  const label = found ?? await client.api('POST', '/label', { name, color, workspaceId })
  const id = label?.id ?? label?.label?.id
  if (id && taskId) await client.api('PUT', `/label/${encodeURIComponent(id)}/task`, { taskId })
  return { id, name, created: !found }
}

async function main () {
  const client = createClient({ keyFile: options.keyFile, allowPipeline: options.allowPipeline })
  client.assertWritable(options.project)
  const workspaces = await client.api('GET', '/workspace')
  const workspaceId = workspaces[0]?.id
  const stamp = new Date().toISOString()

  if (options.verify) {
    // Verify an existing probe card without creating anything new.
    const cardRead = await client.getTask(options.verify)
    const cardLabels = await client.getLabels(options.verify)
    // The board endpoint truncates each column unless a status filter is given, so ask for the card's own column.
    const filtered = await client.api('GET', `/task/tasks/${encodeURIComponent(cardRead.projectId)}?status=${encodeURIComponent(cardRead.status)}&limit=100`)
    const boardTasks = (filtered?.data?.columns ?? []).flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
    const onBoard = boardTasks.find(task => task.id === options.verify)
    const relations = await client.api('GET', `/task-relation/${encodeURIComponent(options.verify)}`)
    const report = {
      stamp, verify: options.verify, project: cardRead.projectId,
      card: { id: cardRead.id, number: cardRead.number, status: cardRead.status, labels: cardLabels,
        boardLabels: (onBoard?.labels ?? []).map(label => label.name ?? label) },
      relations: relations,
      checks: {
        'card.labels-readable-via-label-endpoint': cardLabels.includes('role:pm'),
        'card.visible-in-status-filtered-board': !!onBoard,
        'card.labels-visible-on-board': (onBoard?.labels ?? []).some(label => (label.name ?? label) === 'role:pm'),
      },
    }
    const failed = Object.entries(report.checks).filter(([, ok]) => !ok).map(([name]) => name)
    console.log(JSON.stringify(report, null, 2))
    if (options.report) { writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(`report written to ${options.report}`) }
    if (failed.length) { console.error(`failed checks: ${failed.join(', ')}`); process.exit(1) }
    return
  }

  // 1. The verification card every post sees on the board.
  const card = await client.api('POST', `/task/${encodeURIComponent(options.project)}`, {
    title: '[probe] 岗位模型验证卡',
    description: 'RD.md §11.5 真实数据验证用卡：验证岗位归属、角色标签、宪章载体与任务关系。',
    priority: 'no-priority',
    status: 'to-do',
  })
  const cardId = card?.id ?? card?.task?.id
  console.log(`probe card: ${cardId} (#${card?.number ?? card?.task?.number})`)

  // 2. Role labels carry "which post works on this card" (RD.md §12.9).
  const roles = []
  for (const [name, color] of [['role:pm', '#DB2828'], ['role:ux', '#0e8a16'], ['role:worker', '#0969da']]) {
    roles.push(await ensureLabel(client, workspaceId, name, color, cardId))
  }
  console.log(`role labels: ${roles.map(role => role.name).join(', ')}`)

  // 3. The charter carrier: a task whose description holds a versioned charter a worker reads when it claims.
  const charter = await client.api('POST', `/task/${encodeURIComponent(options.project)}`, {
    title: '[probe] 宪章载体 v1',
    description: [
      '# 岗位工作宪章（probe）',
      `version: 1`,
      `publishedAt: ${stamp}`,
      'publishedBy: agent:pm',
      '',
      '## 交付要求',
      '- 代码变更 → Gitea PR，并在任务评论给出链接',
      '- 文档/方案/memo → MinIO 对象，并在任务评论给出对象键',
      '- 工作日志 → 任务评论（追加式）',
      '',
      '## 边界',
      '- 不跨工作目录交付',
      '- 不代领、不自领',
    ].join('\n'),
    priority: 'no-priority',
    status: 'to-do',
  })
  const charterId = charter?.id ?? charter?.task?.id
  await ensureLabel(client, workspaceId, 'charter', '#8250df', charterId)
  console.log(`charter carrier: ${charterId}`)

  // 4. A subtask relation, so a worker can own part of a card.
  const child = await client.api('POST', `/task/${encodeURIComponent(options.project)}`, {
    title: '[probe] 子任务 A',
    description: 'RD.md §11.5 任务关系验证用子卡。',
    priority: 'no-priority',
    status: 'to-do',
  })
  const childId = child?.id ?? child?.task?.id
  const relation = await client.api('POST', '/task-relation', { sourceTaskId: childId, targetTaskId: cardId, relationType: 'subtask' })
  console.log(`subtask relation: ${relation?.id ?? 'created'}`)

  // 5. Read everything back the way a worker would.
  const cardRead = await client.getTask(cardId)
  const cardLabels = await client.getLabels(cardId)
  const charterRead = await client.getTask(charterId)
  const charterVersion = /version:\s*(\d+)/.exec(String(charterRead.description ?? ''))?.[1]
  const relations = await client.api('GET', `/task-relation/${encodeURIComponent(cardId)}`)
  // The board endpoint truncates each column unless a status filter is given, so ask for the card's own column.
  const filtered = await client.api('GET', `/task/tasks/${encodeURIComponent(options.project)}?status=${encodeURIComponent(cardRead.status)}&limit=100`)
  const boardTasks = (filtered?.data?.columns ?? []).flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
  const onBoard = boardTasks.find(task => task.id === cardId)

  const report = {
    stamp, project: options.project, workspaceId,
    card: { id: cardId, number: card?.number ?? card?.task?.number, status: cardRead.status, labels: cardLabels, boardLabels: onBoard?.labels?.map(label => label.name ?? label) ?? [] },
    charter: { id: charterId, version: charterVersion, title: charterRead.title },
    relation: { childId, readBack: relations },
    checks: {
      'card.created': !!cardId,
      'card.labels-readable-via-label-endpoint': cardLabels.includes('role:pm') && cardLabels.includes('role:ux'),
      'card.visible-in-status-filtered-board': !!onBoard,
      'card.labels-visible-on-board': (onBoard?.labels ?? []).some(label => (label.name ?? label) === 'role:pm'),
      'charter.readable-and-version-pinned': charterVersion === '1',
      'subtask-relation-visible': JSON.stringify(relations ?? '').includes(String(childId)),
    },
  }
  const failed = Object.entries(report.checks).filter(([, ok]) => !ok).map(([name]) => name)
  console.log(JSON.stringify(report, null, 2))
  if (options.report) { writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(`report written to ${options.report}`) }
  if (failed.length) { console.error(`failed checks: ${failed.join(', ')}`); process.exit(1) }
}

main().catch(error => { console.error(`story probe failed: ${error.message}`); process.exit(1) })
