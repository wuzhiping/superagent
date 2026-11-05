/**
 * Points the deployment at the RSI project (idempotent): every source save retries while the plugin reloads, because a
 * save restarts the service and the next kind may still be registering.
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

const RSI = 'at8xrho45bisco2umjzgl1xp'
const wanted = [
  ['kaneo', { projectId: RSI, watchColumns: 'to-do', claimColumn: 'in-progress', doneColumn: 'done', requiredLabels: 'story-test', pollSeconds: 15 }],
  ['ntfy', { topic: `pub_${RSI}`, pollSeconds: 15 }],
]
for (const [id, config] of wanted) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const settings = await panel('settings')
      const source = settings.sources.find(item => item.id === id)
      if (!source) throw new Error(`no ${id} source`)
      await panel(`settings/source:${id}`, { method: 'PUT', body: {
        value: { ...source.value, enabled: true, config: { ...source.value.config, ...config } }, revision: source.revision } })
      console.log(`saved ${id}`)
      await sleep(1500)
      await waitReady()
      break
    } catch (error) {
      if (attempt === 10) throw error
      console.log(`retry ${id}: ${error.message.slice(0, 120)}`)
      await sleep(4000)
      await waitReady()
    }
  }
}

await waitReady()
const state = await panel('state')
const current = await panel('settings')
for (const id of ['kaneo', 'ntfy', 'gitea', 's3']) {
  const source = current.sources.find(item => item.id === id)
  console.log(id, 'enabled:', source?.value?.enabled, 'health:', state.health?.[id]?.state, '-', state.health?.[id]?.detail)
}
console.log('kaneo config:', JSON.stringify(current.sources.find(item => item.id === 'kaneo')?.value?.config))
console.log('ntfy config topic:', current.sources.find(item => item.id === 'ntfy')?.value?.config?.topic)
