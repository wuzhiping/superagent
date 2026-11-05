/**
 * Applies the two design corrections to the live deployment:
 *  - the charter repository becomes its own field (`shawoo/rsi_superagent`), the event repository returns to `shawoo/PDP`;
 *  - ntfy intake is filtered by tag `dsh`.
 * Then verifies the charter is still read and what the health entries say.
 */
const base = 'http://127.0.0.1:3080/orchestrator/api'
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const panel = async (path, init = {}) => {
  const response = await fetch(`${base}/${path}`, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 240)}`)
  return text ? JSON.parse(text) : {}
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitReady = async (ids = ['kaneo', 'gitea', 'ntfy']) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const state = await panel('state')
      const health = state.health ?? {}
      if (health.runtime?.state === 'ready' && ids.every(id => ['ready', 'paused'].includes(health[id]?.state))) return
    } catch {}
    await sleep(2000)
  }
}

const changes = [
  ['gitea', { repository: 'shawoo/PDP', charterRepository: 'shawoo/rsi_superagent', charterPath: 'README.md' }],
  ['ntfy', { ingestTags: 'dsh' }],
]
for (const [id, config] of changes) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const settings = await panel('settings')
      const source = settings.sources.find(item => item.id === id)
      await panel(`settings/source:${id}`, { method: 'PUT', body: {
        value: { ...source.value, enabled: true, config: { ...source.value.config, ...config } }, revision: source.revision } })
      console.log(`saved ${id}`, JSON.stringify(config))
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
const gitea = settings.sources.find(item => item.id === 'gitea').value.config
const ntfy = settings.sources.find(item => item.id === 'ntfy').value.config
console.log('gitea:', JSON.stringify({ repository: gitea.repository, charterRepository: gitea.charterRepository, charterPath: gitea.charterPath }))
console.log('ntfy:', JSON.stringify({ topic: ntfy.topic, ingestTags: ntfy.ingestTags }))
for (const id of ['kaneo', 'gitea', 'ntfy', 's3']) console.log(id, ':', state.health?.[id]?.state, '-', state.health?.[id]?.detail)
const narrative = await panel('narrative')
const view = narrative.projects[0]
console.log('charter:', `v${view.charter.version}`, view.charter.carrier, view.charter.carrierRef)
