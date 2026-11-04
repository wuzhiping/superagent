/**
 * Publishes the charter of the FDEP project in the panel's archive: the text a PM would write, with the flow it
 * declares (the board's columns and what each one means now).
 */
const base = process.env.PANEL ?? 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }

const text = `# FDEP 岗位工作宪章

version: 2
publishedBy: pm-fdep

## 当期流程（看板列）
- 当期流程：to-do 待辦池 → ready 待開工 → in-progress 進行中 → blocked 受阻 → in-review 待評審 → qa 驗收中 → staging 待發布 → done 完成

## 角色与职责
- PM 岗位：管理流程、颁布宪章、处理异常、裁决；不直接产出交付物。
- Worker 岗位：只领指派给自己的卡，开出岗位职责执行，回写工作日志与产出引用，推进卡片状态。

## 交付标准
- 产出类型由卡片自带的 kind 标签声明（doc / plan / quote / contract / complaint / code …），类型是开放的。
- 每项产出只有一个权威载体：代码 → Gitea PR；文档/方案 → MinIO 对象；报价、合同、客诉、物流回执 → 任务评论正文。
- 卡片要动哪些仓库，由卡片自己说明（repo:owner/name 标签或描述里写 owner/name），不写在本宪章里。

## 并发
- 每个岗位在飞职责上限 3；超出上限先停派工。

## 回写规则
- 只追加，不改写：进展、结论、阻塞分别成条。
- 交付时把工作日志与产出引用写进任务评论，并把卡片推进到交付列。
- 每次回写带上岗位身份与开工时的宪章版本。
`

const current = await fetch(`${base}/project-archive`, { headers }).then(response => response.json())
const archive = current.archive
for (const project of archive.projects) {
  if (project.charter?.version) {
    project.charter.history = [...project.charter.history, {
      version: project.charter.version, publishedAt: project.charter.publishedAt,
      publishedBy: project.charter.publishedBy, text: project.charter.text,
    }]
  }
  project.charter = {
    version: (project.charter?.version ?? 0) + 1,
    publishedAt: new Date().toISOString(),
    publishedBy: 'pm-fdep',
    text,
    draft: '',
    history: project.charter?.history ?? [],
  }
  console.log(`project ${project.id}: charter v${project.charter.version} published`)
}
const answer = await fetch(`${base}/project-archive`, {
  method: 'PUT', headers, body: JSON.stringify({ archive, revision: current.revision }),
}).then(response => response.json())
console.log('archive written:', JSON.stringify(answer))
