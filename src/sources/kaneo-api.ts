/**
 * Minimal Kanban REST client: fetch with the `x-api-key` header, JSON responses validated by zod, a timeout, and bounded
 * retries for rate limits and transient server errors. Node's global fetch is used, so no dependency is added.
 *
 * Kanban limits an API key to 100 requests a minute, and every consumer sharing that key — this Source, the Kanban web
 * panel, a person's browser, a script — spends the same allowance. A spent allowance answers 429 to *any* request, so the
 * client keeps the allowance the server reports (`x-ratelimit-remaining`, `x-ratelimit-reset`) and waits before the
 * request that would spend the last of it, instead of walking into the refusal.
 */
import { z } from 'zod'
import { apiBase } from './kaneo-config.ts'

const TIMEOUT_MS = 30_000
/** Attempts for a transient server or network failure. */
const RETRIES = 3
/** Attempts for a 429: a spent allowance resets on a timer, so waiting is what makes progress. */
const RATE_RETRIES = 6
/** Requests kept in reserve: the last few of an allowance are left to the other consumers of the same key. */
const RESERVE = 3
/** Longest single wait, so a hostile `Retry-After` cannot park the Source forever. */
const MAX_WAIT_MS = 90_000
export type KaneoFetch = (input: string, init?: RequestInit) => Promise<Response>

/** A Kanban HTTP failure; `status` is the response status when the server answered. 404/403 mean the target is gone for a reply. */
export class KaneoError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'KaneoError' }
}

interface RequestOptions { signal?: AbortSignal | undefined; retry?: boolean | undefined }

/** The shape every Kanban list/board answer uses: `data` for the payload and `pagination` for its bounds. */
export const KaneoBoardSchema = z.looseObject({
  data: z.looseObject({
    columns: z.array(z.looseObject({ id: z.string().optional(), slug: z.string(), name: z.string().default(''), tasks: z.array(z.unknown()).default([]) })).default([]),
  }),
  pagination: z.looseObject({ total: z.number().default(0), page: z.number().default(1), totalPages: z.number().default(1) }).default({ total: 0, page: 1, totalPages: 1 }),
})

/** A task as Kanban answers a card creation: the id and number identify it, the column slug says where it landed. */
const CreatedTaskSchema = z.looseObject({ id: z.string().min(1), number: z.number().int().optional(), title: z.string().default(''), status: z.string().default('') })
/** A label as Kanban answers a label creation; the same name answers with the label that already exists. */
const LabelSchema = z.looseObject({ id: z.string().min(1), name: z.string().default('') })
/** A workspace as Kanban answers the workspace list; labels live in a workspace. */
const WorkspaceSchema = z.looseObject({ id: z.string().min(1), name: z.string().default('') })
/** The account behind the API key: its id identifies the post on the board, its role says what it may manage. */
const KaneoUserSchema = z.looseObject({
  id: z.string().min(1), name: z.string().default(''), email: z.string().default(''), role: z.string().default('member'),
})
/** One project: the board's title, the description the charter is published into, and the columns' slugs. */
const KaneoProjectSchema = z.looseObject({
  id: z.string().min(1), name: z.string().default(''), slug: z.string().default(''), description: z.string().default(''),
  icon: z.string().default(''), isPublic: z.boolean().default(false),
  /** The workspace the project lives in; the policy roster reads its members. */
  workspaceId: z.string().default(''),
  columns: z.array(z.looseObject({ slug: z.string().optional(), name: z.string().optional() })).default([]),
})
/** One project as the list answers it: what a picker needs to show a name and store an id. */
const KaneoProjectRefSchema = z.looseObject({
  id: z.string().min(1), name: z.string().default(''), slug: z.string().default(''), workspaceId: z.string().default(''),
})
/** One board column as the workflow endpoints answer it: the cuid identifies it, the slug is what tasks are stored by. */
const KaneoColumnSchema = z.looseObject({
  id: z.string().min(1), name: z.string().default(''), slug: z.string().default(''), isFinal: z.boolean().default(false),
  position: z.number().optional(),
})

const errorText = (text: string, status: number): string => {
  try {
    const value = JSON.parse(text) as { message?: unknown; error?: unknown }
    if (typeof value.message === 'string' && value.message) return `${value.message} (${status})`
    if (typeof value.error === 'string' && value.error) return `${value.error} (${status})`
  } catch { /* Not JSON; keep the status and body below. */ }
  const trimmed = text.trim()
  return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `Kanban answered ${status}`
}
const retryAfter = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}
/** The allowance Kanban reports with every answer: what is left, and when it is restored. */
interface Allowance { remaining?: number; resetAt?: number }
/**
 * Reads the allowance from a response's headers. `x-ratelimit-reset` is an epoch in milliseconds, but a server may report
 * seconds, so a value too small to be milliseconds is read as seconds.
 */
function allowanceOf(headers: Headers, now: number): Allowance {
  const remaining = Number(headers.get('x-ratelimit-remaining'))
  const reset = Number(headers.get('x-ratelimit-reset'))
  return {
    ...Number.isFinite(remaining) ? { remaining } : {},
    ...Number.isFinite(reset) && reset > 0 ? { resetAt: reset < 1e12 ? reset * 1000 : reset } : {},
  }
}
/** How long to wait for a 429, from the headers that say so, falling back to a growing wait. */
function waitFor(headers: Headers, allowance: Allowance, attempt: number, now: number): number {
  const named = retryAfter(headers)
    ?? (allowance.resetAt === undefined ? undefined : Math.max(0, allowance.resetAt - now))
  const wait = named ?? 1000 * 2 ** (attempt - 1)
  return Math.min(MAX_WAIT_MS, Math.max(50, wait))
}

/** One Kanban server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
export class KaneoClient {
  private readonly base: string
  /** What Kanban last said about the key's allowance, so the next request can wait instead of being refused. */
  private allowance: Allowance = {}
  /** The account behind the key, read once: it identifies the post and does not change while the process runs. */
  private account?: z.infer<typeof KaneoUserSchema>
  constructor(private readonly config: { baseUrl: string; apiKey: string }, private readonly fetchImpl: KaneoFetch = (input, init) => fetch(input, init),
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.base = apiBase(config.baseUrl)
  }

  /**
   * Waits while the key's allowance is nearly spent, so the request that would empty it is not sent at all. `RESERVE`
   * requests are left for the other consumers of the same key; a reset that has already passed needs no wait.
   */
  private async throttle(): Promise<void> {
    const { remaining, resetAt } = this.allowance
    if (remaining === undefined || remaining > RESERVE || resetAt === undefined) return
    const waitForReset = resetAt - Date.now()
    if (waitForReset <= 0) return
    await this.wait(Math.min(MAX_WAIT_MS, waitForReset))
    this.allowance = {}
  }

  /** Sends one request and parses its JSON body; 429 and 5xx are retried with backoff, and a 404/403 surfaces as `KaneoError` with its status. */
  async request<T>(schema: z.ZodType<T>, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    let lastError: unknown
    let rateAttempt = 0
    for (let attempt = 1; attempt <= Math.max(RETRIES, RATE_RETRIES); attempt += 1) {
      await this.throttle()
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
        // Every answer, a success or a refusal, reports the allowance; keeping it is what makes the next request cheap.
        this.allowance = allowanceOf(response.headers, Date.now())
        if (response.ok) {
          const parsed: unknown = text ? JSON.parse(text) : undefined
          return schema.parse(parsed)
        }
        const error = new KaneoError(errorText(text, response.status), response.status)
        if (response.status === 429) {
          rateAttempt += 1
          if (rateAttempt >= RATE_RETRIES) throw error
          lastError = error
          await this.wait(waitFor(response.headers, this.allowance, rateAttempt, Date.now()))
          continue
        }
        if (response.status < 500 || attempt >= RETRIES) throw error
        lastError = error
        await this.wait(retryAfter(response.headers) ?? 500 * attempt)
      } catch (caught) {
        // A caller's abort ends the request; only network failures with retries left are retried.
        if (options.signal?.aborted) throw caught
        if (caught instanceof KaneoError) {
          if (attempt >= Math.max(RETRIES, RATE_RETRIES)) throw caught
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

  /** Tasks of one board column, newest position first as Kanban returns them. */
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

  /**
   * One project: its name, its columns and — the project-level charter's home — its description. Every post of the
   * project reads the same record, whichever Host it runs on (RD.md §4.1, §8).
   */
  async project(id: string, options: RequestOptions = {}): Promise<z.infer<typeof KaneoProjectSchema>> {
    return this.request(KaneoProjectSchema, 'GET', `/project/${encodeURIComponent(id)}`, undefined, options)
  }

  /**
   * The projects of one workspace. The panel lists them so a person picks the project instead of typing its id; the
   * list needs the workspace id because the server scopes projects to a workspace.
   */
  async projects(workspaceId: string, options: RequestOptions = {}): Promise<z.infer<typeof KaneoProjectRefSchema>[]> {
    return this.request(z.array(KaneoProjectRefSchema), 'GET',
      `/project?workspaceId=${encodeURIComponent(workspaceId)}`, undefined, options)
  }

  /**
   * Replaces one project. The server validates the whole project, so every field the request carries must be sent —
   * the caller reads the project first and sends it back with the field it changes (the charter publishes into
   * `description`).
   */
  async updateProject(id: string, body: { name: string, slug: string, icon: string, isPublic: boolean, description: string },
    options: RequestOptions = {}): Promise<void> {
    await this.request(z.unknown(), 'PUT', `/project/${encodeURIComponent(id)}`, body, options)
  }

  /** The columns of one project's board, in board order; the value stream the team works in. */
  async columns(projectId: string, options: RequestOptions = {}): Promise<z.infer<typeof KaneoColumnSchema>[]> {
    return this.request(z.array(KaneoColumnSchema), 'GET', `/column/${encodeURIComponent(projectId)}`, undefined, options)
  }

  /** Adds a column to the end of a project's board: the flow grows by the PM confirming what the retrospective found. */
  async createColumn(projectId: string, body: { name: string, icon?: string, color?: string, isFinal?: boolean },
    options: RequestOptions = {}): Promise<z.infer<typeof KaneoColumnSchema>> {
    return this.request(KaneoColumnSchema, 'POST', `/column/${encodeURIComponent(projectId)}`, body, options)
  }

  /** The comments of one task, oldest first as Kanban returns them. */
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
   * waits in the pool until a person assigns it. Kanban requires `priority`, so the caller always names one.
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

  /** The account behind the API key; its role (`admin` or `member`) says whether it may manage the board's flow. Read once and reused: it does not change while the process runs. */
  async me(options: RequestOptions = {}): Promise<z.infer<typeof KaneoUserSchema>> {
    this.account ??= await this.request(KaneoUserSchema, 'GET', '/user/me', undefined, options)
    return this.account
  }

  /** The members of a workspace: their ids are the board's assignees, their e-mails the friendly account a post names. */
  async workspaceMembers(workspaceId: string, options: RequestOptions = {}): Promise<z.infer<typeof KaneoUserSchema>[]> {
    return this.request(z.array(KaneoUserSchema), 'GET', `/workspace/${encodeURIComponent(workspaceId)}/members`, undefined, options)
  }
}
