/**
 * Ready for the rehearsal: the Kanban Source watches only cards labelled `rehearsal`, and ntfy listens on the project's
 * topic. Waits for the service to come back.
 */
const base = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${base}/${path}`, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const RSI = 'at8xrho45bisco2umjzgl1xp'

const waitReady = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const state = await panel('state')
      const health = state.health ?? {}
      if (health.runtime?.state === 'ready' && health.kaneo?.state === 'ready') return
    } catch {}
    await sleep(2000)
  }
}
for (const [id, config] of [
  ['kaneo', { projectId: RSI, watchColumns: 'to-do', claimColumn: 'in-progress', doneColumn: 'done', requiredLabels: 'rehearsal', pollSeconds: 15 }],
  ['ntfy', { topic: `pub_${RSI}`, pollSeconds: 15 }],
]) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const settings = await panel('settings')
      const source = settings.sources.find(item => item.id === id)
      await panel(`settings/source:${id}`, { method: 'PUT', body: {
        value: { ...source.value, enabled: true, config: { ...source.value.config, ...config } }, revision: source.revision } })
      console.log(`saved ${id}`)
      await sleep(1500)
      await waitReady()
      break
    } catch (error) {
      if (attempt === 10) throw error
      await sleep(4000)
      await waitReady()
    }
  }
}
await waitReady()
const state = await panel('state')
const settings = await panel('settings')
console.log('kaneo:', JSON.stringify(settings.sources.find(item => item.id === 'kaneo').value.config))
console.log('ntfy topic:', settings.sources.find(item => item.id === 'ntfy').value.config.topic)
console.log('gitea repo:', settings.sources.find(item => item.id === 'gitea').value.config.repository,
  'health:', state.health?.gitea?.state, '-', state.health?.gitea?.detail)
