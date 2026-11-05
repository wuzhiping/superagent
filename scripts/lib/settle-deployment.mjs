/**
 * End of the rehearsal: leave the deployment usable for the user — the Kanban Source watches every card in the RSI
 * project's to-do column (no story label filter), ntfy listens on the project topic, and the state is checked.
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const state = await panel('state')
      const health = state.health ?? {}
      if (health.runtime?.state === 'ready' && health.kaneo?.state === 'ready' && health.gitea?.state === 'ready') return
    } catch {}
    await sleep(2000)
  }
}
for (const [id, config] of [
  ['kaneo', { projectId: RSI, watchColumns: 'to-do', claimColumn: 'in-progress', doneColumn: 'done', requiredLabels: '', pollSeconds: 60 }],
  ['ntfy', { topic: `pub_${RSI}`, pollSeconds: 60 }],
  ['gitea', { enabled: true }],
]) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const settings = await panel('settings')
      const source = settings.sources.find(item => item.id === id)
      const next = id === 'gitea' ? { ...source.value, enabled: true }
        : { ...source.value, enabled: true, config: { ...source.value.config, ...config } }
      await panel(`settings/source:${id}`, { method: 'PUT', body: { value: next, revision: source.revision } })
      console.log(`saved ${id}`)
      await sleep(1500)
      await waitReady()
      break
    } catch (error) {
      if (attempt === 8) throw error
      await sleep(4000)
      await waitReady()
    }
  }
}
await waitReady()
const state = await panel('state')
for (const id of ['runtime', 'kaneo', 'gitea', 'ntfy', 's3']) {
  console.log(id, ':', state.health?.[id]?.state, '-', state.health?.[id]?.detail)
}
const narrative = await panel('narrative')
const view = narrative.projects[0]
console.log('charter:', `v${view.charter.version}`, view.charter.carrier, view.charter.carrierRef)
console.log('flow aligned:', view.flow.aligned, 'declared:', view.flow.declared.map(item => item.column).join(' > '))
const settings = await panel('settings')
console.log('kaneo requiredLabels:', JSON.stringify(settings.sources.find(item => item.id === 'kaneo').value.config.requiredLabels))
