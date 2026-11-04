/**
 * Puts the flow the PM confirmed into the project archive: the board's columns and what each one means now.
 * The archive is the host's own record; the panel API guards it with a revision.
 */
const base = process.env.PANEL ?? 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }

const flow = [
  { column: 'to-do', meaning: '待辦池：還沒排進這條價值流' },
  { column: 'ready', meaning: '待開工：已經指派好，等人接' },
  { column: 'in-progress', meaning: '進行中：崗位正在做' },
  { column: 'blocked', meaning: '受阻：等人給條件' },
  { column: 'in-review', meaning: '待評審：做完了，等人看' },
  { column: 'qa', meaning: '驗收中：按驗收口徑檢查' },
  { column: 'staging', meaning: '待發布：等發布窗口' },
  { column: 'done', meaning: '完成：這一輪價值流走完' },
]

const current = await fetch(`${base}/project-archive`, { headers }).then(response => response.json())
const archive = current.archive
for (const project of archive.projects) {
  if (project.id !== 'dgctny8ibgpn72ei2j8qj2hc') continue
  project.kind = 'software'
  project.flow = flow
  project.workfaces = project.workfaces?.length ? project.workfaces : [
    { kind: 'repo', name: 'shawoo/PDP', detail: '程式碼倉庫' },
    { kind: 'board', name: 'FDEP 看板', detail: '價值流看板' },
  ]
}
const answer = await fetch(`${base}/project-archive`, {
  method: 'PUT', headers, body: JSON.stringify({ archive, revision: current.revision }),
}).then(response => response.json())
console.log('archive written:', JSON.stringify(answer))
