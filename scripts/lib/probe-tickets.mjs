import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('D:/Refine/Books/ntop/AI/dsh/state/superagent/orchestrator.sqlite', { readOnly: true })
for (const table of ['ticket', 'decision', 'trigger']) {
  console.log(`--- ${table} ---`)
  for (const row of db.prepare(`select * from ${table}`).all()) {
    let parsed; try { parsed = JSON.parse(row.value) } catch { parsed = {} }
    console.log(JSON.stringify({
      id: row.id ?? row.key ?? row.thread,
      title: parsed.title,
      postId: parsed.postId,
      deliverableType: parsed.deliverableType,
      charterVersion: parsed.charterVersion,
      ended: parsed.ended ? parsed.ended.outcome ?? 'ended' : undefined,
      kind: parsed.kind ?? parsed.outcome,
      actor: parsed.actor?.id ?? parsed.mandate?.actor?.id,
      at: parsed.createdAt ?? parsed.at,
    }))
  }
}
db.close()
