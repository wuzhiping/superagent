/**
 * Reads the deployment's own store (read-only) so a validation script can act as the deployment does — for
 * example with the same KanEO API key. Secrets are never printed or written to a report.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

/** Opens the deployment's store read-only. */
function open (stateDir) {
  return new DatabaseSync(`${stateDir.replace(/\\/g, '/')}/orchestrator.sqlite`, { readOnly: true })
}

/** The settings the deployment currently runs, taken from its newest settings version in the key-value store. */
export function currentSettings (stateDir) {
  const db = open(stateDir)
  try {
    const rows = db.prepare("select key, value from kv where key like 'settings-version:%'").all()
    const newest = rows.map(row => ({ row, version: Number(String(row.key).split(':').at(-1)) }))
      .filter(item => Number.isFinite(item.version)).sort((left, right) => right.version - left.version)[0]
    if (!newest) throw new Error('the store holds no settings version')
    return JSON.parse(newest.row.value).settings ?? {}
  } finally {
    db.close()
  }
}

/** The stored config of one source kind. */
export function storedSourceConfig (stateDir, kind = 'kaneo') {
  const settings = currentSettings(stateDir)
  const source = settings?.sources?.[kind]
  if (!source?.config) throw new Error(`the store holds no ${kind} source config`)
  return source.config
}

/** The API key of a source kind, read from the deployment's own store; never logged. */
export function sourceApiKey (stateDir, kind = 'kaneo') {
  const key = storedSourceConfig(stateDir, kind).apiKey
  if (!key) throw new Error(`the ${kind} source has no API key in the store`)
  return key
}

/** Reads a file-based key, for scripts that run against a board the deployment does not watch. */
export function fileKey (path) {
  return readFileSync(path, 'utf8').trim()
}
