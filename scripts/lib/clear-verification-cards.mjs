/**
 * Clears the verification cards this round left in the RSI to-do column (story leftovers, the rehearsal notice and the
 * filter test) so the board is not cluttered. Completed cards and the charter stay.
 */
import { createClient } from './kaneo-client.mjs'
import { sourceApiKey } from './store-read.mjs'

const STATE_DIR = 'D:/Refine/Books/ntop/AI/dsh/state/superagent'
const PROJECT = 'at8xrho45bisco2umjzgl1xp'
process.env.KANEO_API_KEY = sourceApiKey(STATE_DIR, 'kaneo')
const kaneo = createClient({ base: 'https://pl.feg.cn' })
const board = await kaneo.api('GET', `/task/tasks/${PROJECT}?status=to-do&limit=100`)
const tasks = (board?.data?.columns ?? board?.columns ?? []).flatMap(column => column.tasks ?? [])
const removable = tasks.filter(task => /story|filter-test|rehearsal/.test(String(task.title ?? '')))
for (const task of removable) {
  try {
    await kaneo.api('DELETE', `/task/${encodeURIComponent(task.id)}`)
    console.log('deleted', task.id, '|', String(task.title).slice(0, 70))
  } catch (error) {
    console.log('could not delete', task.id, String(error).slice(0, 120))
  }
}
console.log('deleted', removable.length, 'of', tasks.length, 'to-do cards')
