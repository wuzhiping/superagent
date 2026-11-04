/**
 * Minimal Kaneo REST client: fetch with the `x-api-key` header, JSON responses validated by zod, a timeout, and bounded
 * retries for rate limits and transient server errors. Node's global fetch is used, so no dependency is added.
 */
import { z } from 'zod'
import { apiBase } from './kaneo-config.ts'

const TIMEOUT_MS = 30_000
const RETRIES = 3
export type KaneoFetch = (input: string, init?: RequestInit) => Promise<Response>

/** A Kaneo HTTP failure; `status` is the response status when the server answered. 404/403 mean the target is gone for a reply. */
export class KaneoError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'KaneoError' }
}

interface RequestOptions { signal?: AbortSignal | undefined; retry?: boolean | undefined }

/** The shape every Kaneo list/board answer uses: `data` for the payload and `pagination` for its bounds. */
export const KaneoBoardSchema = z.looseObject({
  data: z.looseObject({
    columns: z.array(z.looseObject({ id: z.string().optional(), slug: z.string(), name: z.string().default(''), tasks: z.array(z.unknown()).default([]) })).default([]),
  }),
  pagination: z.looseObject({ total: z.number().default(0), page: z.number().default(1), totalPages: z.number().default(1) }).default({ total: 0, page: 1, totalPages: 1 }),
})

/** A task as Kaneo answers a card creation: the id and number identify it, the column slug says where it landed. */
const CreatedTaskSchema = z.looseObject({ id: z.string().min(1), number: z.number().int().optional(), title: z.string().default(''), status: z.string().default('') })
/** A label as Kaneo answers a label creation; the same name answers with the label that already exists. */
const LabelSchema = z.looseObject({ id: z.string().min(1), name: z.string().default('') })
/** A workspace as Kaneo answers the workspace list; labels live in a workspace. */
const WorkspaceSchema = z.looseObject({ id: z.string().min(1), name: z.string().default('') })

const errorText = (text: string, status: number): string => {
  try {
    const value = JSON.parse(text) as { message?: unknown; error?: unknown }
    if (typeof value.message === 'string' && value.message) return `${value.message} (${status})`
    if (typeof value.error === 'string' && value.error) return `${value.error} (${status})`
  } catch { /* Not JSON; keep the status and body below. */ }
  const trimmed = text.trim()
  return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `Kaneo answered ${status}`
}
const retryAfter = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

/** One Kaneo server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
export class KaneoClient {
  private readonly base: string
  constructor(private readonly config: { baseUrl: string; apiKey: string }, private readonly fetchImpl: KaneoFetch = (input, init) => fetch(input, init),
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.base = apiBase(config.baseUrl)
  }

  /** Sends one request and parses its JSON body; 429 and 5xx are retried with backoff, and a 404/403 surfaces as `KaneoError` with its status. */
  async request<T>(schema: z.ZodType<T>, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
      try {
        const response = await this.fetchImpl(`${this.base}${path}`, {
          method, signal,
          headers: { accept: 'application/json', 'x-api-key': this.config.apiKey, ...body === undefined ? {} : { 'content-type': 'application/json' } },
          ...body === undefined ? {} : { body: JSON.stringify(body) },
        })
        const text = await response.text()
        if (response.ok) {
          const parsed: unknown = text ? JSON.parse(text) : undefined
          return schema.parse(parsed)
        }
        const error = new KaneoError(errorText(text, response.status), response.status)
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable || attempt === RETRIES) throw error
        lastError = error
        await this.wait(retryAfter(response.headers) ?? 500 * attempt)
      } catch (caught) {
        // A caller's abort ends the request; only network failures with retries left are retried.
        if (options.signal?.aborted) throw caught
        if (caught instanceof KaneoError) {
          if (attempt === RETRIES) throw caught
          lastError = caught
          continue
        }
        if (attempt === RETRIES) throw caught
        lastError = caught
        await this.wait(500 * attempt)
      } finally { clearTimeout(timeout) }
    }
    throw lastError instanceof Error ? lastError : new KaneoError(String(lastError))
  }

  /** Tasks of one board column, newest position first as Kaneo returns them. */
  async columnTasks(projectId: string, status: string, limit: number, options: RequestOptions = {}): Promise<unknown[]> {
    const board = await this.request(KaneoBoardSchema, 'GET',
      `/task/tasks/${encodeURIComponent(projectId)}?status=${encodeURIComponent(status)}&limit=${limit}`, undefined, options)
    return board.data.columns.flatMap(column => column.tasks)
  }

  /** Reads the project board once without a column filter; used by setup to check the key and project without touching a column. */
  async board(projectId: string, options: RequestOptions = {}): Promise<void> {
    await this.request(KaneoBoardSchema, 'GET', `/task/tasks/${encodeURIComponent(projectId)}?limit=1`, undefined, options)
  }

  /** One task by id. */
  async task(id: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request(z.unknown(), 'GET', `/task/${encodeURIComponent(id)}`, undefined, options)
  }

  /** The comments of one task, oldest first as Kaneo returns them. */
  async comments(taskId: string, options: RequestOptions = {}): Promise<unknown[]> {
    const value = await this.request(z.array(z.unknown()), 'GET', `/comment/${encodeURIComponent(taskId)}`, undefined, options)
    return value
  }

  /** Posts a comment on a task. */
  async comment(taskId: string, content: string, options: RequestOptions = {}): Promise<void> {
    await this.request(z.unknown(), 'POST', `/comment/${encodeURIComponent(taskId)}`, { content }, options)
  }

  /** Moves a task to another column of its project. */
  async move(id: string, status: string, options: RequestOptions = {}): Promise<void> {
    await this.request(z.unknown(), 'PUT', `/task/status/${encodeURIComponent(id)}`, { status }, options)
  }

  /**
   * Creates a card in a project. `status` is the slug of the column it lands in; no assignee is written, so the card
   * waits in the pool until a person assigns it. Kaneo requires `priority`, so the caller always names one.
   */
  async createTask(projectId: string, body: { title: string; description?: string; status?: string; priority?: string },
    options: RequestOptions = {}): Promise<z.infer<typeof CreatedTaskSchema>> {
    return this.request(CreatedTaskSchema, 'POST', `/task/${encodeURIComponent(projectId)}`, body, options)
  }

  /** Creates a label in a workspace; the same name answers with the label that already exists. */
  async createLabel(name: string, color: string, workspaceId: string, options: RequestOptions = {}): Promise<z.infer<typeof LabelSchema>> {
    return this.request(LabelSchema, 'POST', '/label', { name, color, workspaceId }, options)
  }

  /** Attaches a label to a card, so the board shows where the card came from. */
  async attachLabel(labelId: string, taskId: string, options: RequestOptions = {}): Promise<void> {
    await this.request(z.unknown(), 'PUT', `/label/${encodeURIComponent(labelId)}/task`, { taskId }, options)
  }

  /** The workspaces the API key can read; labels belong to one of them. */
  async workspaces(options: RequestOptions = {}): Promise<z.infer<typeof WorkspaceSchema>[]> {
    return this.request(z.array(WorkspaceSchema), 'GET', '/workspace', undefined, options)
  }
}
