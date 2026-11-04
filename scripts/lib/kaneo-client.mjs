/**
 * Shared KanEO REST client for the validation scripts: API key from a file, rate-limit aware, no secrets in output.
 */
import { readFileSync } from 'node:fs'

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Projects the validation scripts must not write to without an explicit override. The pipeline board is the team's
 * live working board; test artefacts belong to the FDEP board.
 */
export const GUARDED_PROJECTS = new Map([
  ['wwo9d2mmqddjq8otbj8jh2hs', 'pipeline'],
  ['dgctny8ibgpn72ei2j8qj2hc', 'FDEP'],
])

/** Throws when a write targets a guarded project and the caller did not pass the override flag. */
export function assertWritableProject (projectId, { allowPipeline = false } = {}) {
  const name = GUARDED_PROJECTS.get(projectId)
  if (!name) return
  if (name === 'FDEP') return
  if (allowPipeline) { console.warn(`[guard] writing to ${name} (${projectId}) because --allow-pipeline was given`); return }
  throw new Error(`refusing to write to the ${name} board (${projectId}); test data belongs to FDEP — pass --allow-pipeline to override`)
}

export function createClient ({ base = 'https://pl.feg.cn', keyFile = '', allowPipeline = false } = {}) {
  const key = process.env.KANEO_API_KEY?.trim() || (keyFile ? readFileSync(keyFile, 'utf8').trim() : '')
  if (!key) throw new Error('no API key: pass keyFile or set KANEO_API_KEY')
  const rate = { limit: undefined, remaining: undefined, reset: undefined, hits: 0, waitedMs: 0 }

  async function api (method, path, body, attempt = 0) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'x-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const limit = response.headers.get('x-ratelimit-limit')
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')
    if (limit) rate.limit = Number(limit)
    if (remaining) rate.remaining = Number(remaining)
    if (reset) rate.reset = Number(reset)
    if (response.status === 429 && attempt < 8) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 0)
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.max(2000, rate.reset ? rate.reset * 1000 - Date.now() : 5000)
      rate.hits += 1
      rate.waitedMs += waitMs
      console.log(`[429] ${method} ${path} — waiting ${Math.round(waitMs / 1000)}s (limit ${rate.limit ?? '?'} remaining ${rate.remaining ?? '?'})`)
      await sleep(waitMs)
      return api(method, path, body, attempt + 1)
    }
    const text = await response.text()
    let parsed
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    if (!response.ok) {
      const error = new Error(`${method} ${path} -> ${response.status}`)
      error.detail = parsed
      throw error
    }
    return parsed
  }

  const getTask = async id => api('GET', `/task/${encodeURIComponent(id)}`)
  const getComments = async id => (await api('GET', `/comment/${encodeURIComponent(id)}`)) ?? []
  const getLabels = async id => {
    const payload = await api('GET', `/label/task/${encodeURIComponent(id)}`)
    const list = Array.isArray(payload) ? payload : payload ? [payload] : []
    return list.map(label => label.name ?? label).sort()
  }
  const board = async projectId => api('GET', `/task/tasks/${encodeURIComponent(projectId)}`)
  const boardTasks = async projectId => {
    const payload = await board(projectId)
    const columns = payload?.data?.columns ?? payload?.columns ?? []
    return columns.flatMap(column => (column.tasks ?? []).map(task => ({ ...task, column: column.slug })))
  }
  const setStatus = (id, status) => api('PUT', `/task/status/${encodeURIComponent(id)}`, { status })
  const setAssignee = (id, userId) => api('PUT', `/task/assignee/${encodeURIComponent(id)}`, { userId })
  const comment = (id, content) => api('POST', `/comment/${encodeURIComponent(id)}`, { content })
  const deleteComment = id => api('DELETE', `/comment/${encodeURIComponent(id)}`)

  return { api, rate, getTask, getComments, getLabels, board, boardTasks, setStatus, setAssignee, comment, deleteComment,
    assertWritable: projectId => assertWritableProject(projectId, { allowPipeline }) }
}
