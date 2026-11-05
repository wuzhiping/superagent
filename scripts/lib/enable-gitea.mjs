/**
 * The story run leaves Gitea paused if its restore missed it; the rehearsal starts from the Gitea charter, so the Source
 * is re-enabled here and the charter carrier is checked before anything else happens.
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const state = await panel('state')
      const health = state.health ?? {}
      if (health.runtime?.state === 'ready' && health.gitea?.state === 'ready') return
    } catch {}
    await sleep(2000)
  }
}
for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    const settings = await panel('settings')
    const source = settings.sources.find(item => item.id === 'gitea')
    if (source.value.enabled === true) { console.log('gitea already enabled'); break }
    await panel('settings/source:gitea', { method: 'PUT', body: { value: { ...source.value, enabled: true }, revision: source.revision } })
    console.log('gitea enabled')
    await sleep(1500)
    await waitReady()
    break
  } catch (error) {
    if (attempt === 10) throw error
    await sleep(4000)
    await waitReady()
  }
}
await waitReady()
const state = await panel('state')
const narrative = await panel('narrative')
const view = narrative.projects[0]
console.log('gitea:', state.health?.gitea?.state, '-', state.health?.gitea?.detail)
console.log('charter:', `v${view?.charter?.version}`, 'carrier:', view?.charter?.carrier, view?.charter?.carrierRef)
