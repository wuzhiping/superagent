/**
 * Restores the deployment's source settings to the ones the deployment should run with: the KanEO board on its own
 * (no label filter, a minute between polls), Gitea and ntfy on with the project's own topic.
 */
const base = process.env.PANEL ?? 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'Content-Type': 'application/json' }

const settings = await fetch(`${base}/settings`, { headers }).then(response => response.json())
for (const [id, value] of [
  ['kaneo', { requiredLabels: '', pollSeconds: 60, claimColumn: 'in-progress', doneColumn: 'done', ingestEvents: true }],
  ['gitea', { enabled: true }],
  ['ntfy', { enabled: true, topic: 'pub_dgctny8ibgpn72ei2j8qj2hc' }],
]) {
  const source = settings.sources.find(item => item.id === id)
  if (!source) continue
  const config = id === 'ntfy' ? { ...source.value.config, topic: value.topic } : { ...source.value.config, ...value }
  const body = { value: { ...source.value, enabled: value.enabled ?? source.value.enabled, config }, revision: source.revision }
  try {
    const answer = await fetch(`${base}/settings/source:${id}`, { method: 'PUT', headers, body: JSON.stringify(body) })
    console.log(`${id}:`, answer.status, await answer.text())
  } catch (error) {
    console.log(`${id}: ERR`, error.message)
  }
  await new Promise(resolve => setTimeout(resolve, 4000))
}
const evalBlock = settings.blocks.eval
if (evalBlock) {
  const answer = await fetch(`${base}/settings/eval`, {
    method: 'PUT', headers,
    body: JSON.stringify({ value: { ...evalBlock.value, mode: 'observe' }, revision: evalBlock.revision }),
  })
  console.log('eval:', answer.status, await answer.text())
}
