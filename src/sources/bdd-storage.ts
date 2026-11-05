/**
 * Service connections read out of the BDD storage records, the way dsh-minio-s3 reads its S3 connection: the local
 * `refs.<name>` credential is masked (`sk-` + base64(key@ISO8601)) and POSTed to the storage host, which answers with
 * that service's connection data. The masked form is itself a key, so it is only ever sent to the storage host, and the
 * answer stays in this process' memory — never in a settings file, a prompt, a log or the panel.
 *
 *   POST https://abc.feg.com.tw/BDD/API/AI/dsh/storage/kaneo → { API_KEY, ... }
 *   POST https://abc.feg.com.tw/BDD/API/AI/dsh/storage/gitea → { GIT_URL, EMAIL, PASSWD }
 *   POST https://abc.feg.com.tw/BDD/API/AI/dsh/storage/ntfy  → { uid, pwd, name }
 *
 * So a Host needs no hand-typed secrets: it needs to run as a user whose credentials file carries a reference the
 * storage host accepts, and it names the service it wants.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The storage host; the masked key is rejected anywhere else. */
export const STORAGE_HOST = 'abc.feg.com.tw'
/** The credential references tried in order; the first one present in the credentials file is used. */
export const CREDENTIAL_REFS = ['AIFE_API_KEY', 'FEG_API_KEY', 'DEEPSEEK_API_KEY'] as const
/** The services whose connection lives in a storage record. */
export type StoredService = 'kaneo' | 'gitea' | 'ntfy' | 's3'
/** Cache lifetime of one resolved connection; a failure is never cached, so the next use retries. */
export const STORAGE_TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8_000

/** The credentials file: `DSH_CREDENTIALS_PATH`, else `$DSH_HOME/.credentials.yaml`, else `$HOME/.dsh/.credentials.yaml`. */
export function credentialsFilePath (env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.DSH_CREDENTIALS_PATH ?? '').trim()
  if (override) return override
  return join(env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
}

/**
 * Reads `refs.<name>` out of the credentials file. The shape is fixed (a `refs:` block of two-space-indented
 * `name: value` lines), so this parses it directly rather than depending on a YAML library.
 */
export function readCredentialRef (text: string, name: string): string | null {
  if (!text || !name) return null
  let inRefs = false
  let refsIndent = -1
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (/^refs:\s*$/.test(trimmed)) { inRefs = true; refsIndent = indent; continue }
    if (!inRefs) continue
    if (indent <= refsIndent) { inRefs = false; continue }
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed)
    if (!match || match[1] !== name) continue
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    return value === '' ? null : value
  }
  return null
}

/**
 * Masks one credential: `sk-` + base64(key@ISO8601), the shape the storage host family answers with real data for. The
 * masked form is a bearer credential of its own, which is why it may only go to {@link STORAGE_HOST}.
 */
export function maskKey (key: string, now: Date = new Date()): string {
  if (!key) throw new TypeError('maskKey: the key must be a non-empty string')
  return `sk-${Buffer.from(`${key}@${now.toISOString()}`, 'utf8').toString('base64')}`
}

/** The credential reference to use, masked; undefined when the credentials file has none. */
export function maskedCredential (options: { env?: NodeJS.ProcessEnv, now?: Date, readFile?: (path: string) => string } = {}):
{ masked: string, ref: string, source: string } | undefined {
  const env = options.env ?? process.env
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const file = credentialsFilePath(env)
  let text: string
  try { text = readFile(file) } catch { return undefined }
  for (const ref of CREDENTIAL_REFS) {
    const key = readCredentialRef(text, ref)
    if (key) return { masked: maskKey(key, options.now), ref, source: file }
  }
  return undefined
}

/** The fields each service's record may use, in the order they are tried (case-insensitive). */
const FIELD_CANDIDATES: Record<StoredService, Record<string, string[]>> = {
  kaneo: {
    apiKey: ['API_KEY', 'KANEO_API_KEY', 'APIKEY', 'KEY', 'TOKEN'],
    baseUrl: ['KANEO_URL', 'BASE_URL', 'URL'],
  },
  gitea: {
    baseUrl: ['GIT_URL', 'GITEA_URL', 'BASE_URL', 'URL'],
    email: ['EMAIL', 'USER', 'USERNAME'],
    password: ['PASSWD', 'PASSWORD', 'PASS', 'SECRET', 'TOKEN'],
  },
  ntfy: {
    user: ['uid', 'UID', 'USER', 'USERNAME'],
    password: ['pwd', 'PASSWORD', 'PWD', 'PASS', 'SECRET'],
    server: ['NTFY_URL', 'SERVER', 'URL'],
  },
  s3: {
    endpoint: ['S3_URL', 'S3_ENDPOINT', 'ENDPOINT', 'URL'],
    accessKey: ['S3_UID', 'UID', 'ACCESS_KEY', 'ACCESS_KEY_ID'],
    secretKey: ['S3_PWD', 'PWD', 'SECRET_KEY', 'SECRET_ACCESS_KEY', 'PASSWORD'],
    bucket: ['S3_BUCK', 'S3_BUCKET', 'BUCKET', 'BUCKET_NAME'],
  },
}

/** Picks the first non-empty value among `candidates`, regardless of the record's casing. */
export function pickField (payload: Record<string, unknown> | undefined, candidates: readonly string[]): string {
  if (!payload) return ''
  const lowered = new Map(Object.entries(payload).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of candidates) {
    const value = lowered.get(name.toLowerCase())
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/** The fields of one service record, as the Sources need them; missing ones are simply absent. */
export function connectionFields (service: StoredService, payload: Record<string, unknown> | undefined): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [name, candidates] of Object.entries(FIELD_CANDIDATES[service])) {
    const value = pickField(payload, candidates)
    if (value) fields[name] = value
  }
  return fields
}

/** One resolved connection. */
export type StoredConnection =
  | { ok: true, service: StoredService, fields: Record<string, string>, ref: string }
  | { ok: false, service: StoredService, stage: 'credential' | 'request' | 'response', error: string }

/**
 * Reads one service's connection. Nothing is thrown: a failure names the stage (`credential`: no reference in the
 * credentials file, `request`: the storage host did not answer, `response`: it answered without the fields).
 */
export async function fetchStoredConnection (service: StoredService, options: {
  env?: NodeJS.ProcessEnv, now?: Date, readFile?: (path: string) => string,
  fetchImpl?: typeof fetch, storageUrl?: string, timeoutMs?: number,
} = {}): Promise<StoredConnection> {
  const credential = maskedCredential(options)
  if (!credential) {
    return { ok: false, service, stage: 'credential', error: `no usable credential reference in ${credentialsFilePath(options.env ?? process.env)}` }
  }
  const url = options.storageUrl ?? `https://${STORAGE_HOST}/BDD/API/AI/dsh/storage/${service}`
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  let raw: string
  try {
    response = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: credential.masked }),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    })
    raw = await response.text()
  } catch (error) {
    return { ok: false, service, stage: 'request', error: `storage lookup failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  let payload: Record<string, unknown> | undefined
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : undefined } catch { payload = undefined }
  if (!response.ok) return { ok: false, service, stage: 'request', error: `storage host answered HTTP ${response.status}` }
  if (!payload || typeof payload !== 'object') return { ok: false, service, stage: 'response', error: 'storage host did not answer with JSON' }
  const fields = connectionFields(service, payload)
  if (Object.keys(fields).length === 0) {
    return { ok: false, service, stage: 'response', error: `the ${service} record has none of its fields (got ${Object.keys(payload).join(', ') || 'nothing'})` }
  }
  return { ok: true, service, fields, ref: credential.ref }
}

/**
 * The process' store of resolved connections: one lookup per service per ten minutes, failures retried on the next use.
 * Sources ask it synchronously (`peek`) during a request and a background warm-up fills it at startup, so a panel read
 * never waits on the storage host.
 */
export class StoredConnections {
  private readonly cache = new Map<StoredService, { at: number, fields: Record<string, string> }>()
  private readonly failures = new Map<StoredService, string>()

  constructor (private readonly options: () => {
    env?: NodeJS.ProcessEnv, readFile?: (path: string) => string, fetchImpl?: typeof fetch, storageUrl?: string, now?: () => Date,
  } = () => ({})) {}

  /** The fields cached for a service, or undefined when none were read (or they expired). */
  peek (service: StoredService): Record<string, string> | undefined {
    const entry = this.cache.get(service)
    if (!entry) return undefined
    if (Date.now() - entry.at > STORAGE_TTL_MS) { this.cache.delete(service); return undefined }
    return entry.fields
  }

  /** The last failure of a service, for the health entry to report; cleared by a successful read. */
  lastError (service: StoredService): string | undefined { return this.failures.get(service) }

  /** Reads one service now (or reuses the cache) and records the outcome. */
  async get (service: StoredService, options: { force?: boolean } = {}): Promise<StoredConnection> {
    if (!options.force) {
      const cached = this.peek(service)
      if (cached) return { ok: true, service, fields: cached, ref: 'cache' }
    }
    const settings = this.options()
    const result = await fetchStoredConnection(service, {
      ...settings.env ? { env: settings.env } : {},
      ...settings.readFile ? { readFile: settings.readFile } : {},
      ...settings.fetchImpl ? { fetchImpl: settings.fetchImpl } : {},
      ...settings.storageUrl ? { storageUrl: settings.storageUrl } : {},
      ...settings.now ? { now: settings.now() } : {},
    })
    if (result.ok) {
      this.cache.set(service, { at: Date.now(), fields: result.fields })
      this.failures.delete(service)
    } else {
      this.failures.set(service, result.error)
    }
    return result
  }

  /** Fills the cache for the services this Host uses; failures stay for the health entry, never thrown. */
  async warm (services: readonly StoredService[]): Promise<void> {
    for (const service of services) await this.get(service)
  }

  /** Drops the cache (a settings save, or a rotated reference). */
  invalidate (service?: StoredService): void {
    if (service) this.cache.delete(service)
    else this.cache.clear()
  }
}

/** The process-wide store the Sources and the panel share. */
export const storedConnections = new StoredConnections()

/** The Kanban account this Host reads from the storage record: its key, and the server the Source names or the default. */
export function storedKaneoAccount (baseUrl: string): { baseUrl: string, apiKey: string } | undefined {
  const fields = storedConnections.peek('kaneo')
  const apiKey = fields?.apiKey ?? ''
  if (!apiKey) return undefined
  return { baseUrl: fields?.baseUrl || baseUrl, apiKey }
}
