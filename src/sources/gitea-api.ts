/**
 * Minimal Gitea REST client: token or user/password (HTTP Basic) authentication, JSON validated by zod, a timeout, and
 * bounded retries. Gitea mirrors GitHub's API shape; the endpoints here are confirmed against /swagger.v1.json.
 */
import { z } from 'zod'

const TIMEOUT_MS = 30_000
const RETRIES = 3
export type GiteaFetch = (input: string, init?: RequestInit) => Promise<Response>

/** A Gitea HTTP failure; `status` is the response status when the server answered. */
export class GiteaError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'GiteaError' }
}

/** Authentication for one Gitea server: a token, or the account's login and password. */
export interface GiteaAuth { baseUrl: string; user?: string | undefined; password?: string | undefined; token?: string | undefined }
/** `Authorization` headers for an account: token first, else HTTP Basic, else none (anonymous public reads). */
export function giteaAuthHeaders(account: Pick<GiteaAuth, 'user' | 'password' | 'token'>): Record<string, string> {
  if (account.token) return { authorization: `token ${account.token}` }
  if (account.user && account.password) {
    return { authorization: `Basic ${Buffer.from(`${account.user}:${account.password}`, 'utf8').toString('base64')}` }
  }
  return {}
}

export interface GiteaRepository { id: number; full_name: string; default_branch: string; private: boolean; has_issues: boolean; has_pull_requests: boolean; permissions?: { admin?: boolean; push?: boolean; pull?: boolean } }
export interface GiteaUser { id: number; login: string; full_name?: string; email?: string; is_admin?: boolean }

const RepositorySchema = z.looseObject({ id: z.number(), full_name: z.string(), default_branch: z.string().default(''),
  private: z.boolean().default(false), has_issues: z.boolean().default(true), has_pull_requests: z.boolean().default(true),
  permissions: z.looseObject({ admin: z.boolean().optional(), push: z.boolean().optional(), pull: z.boolean().optional() }).optional() })
const UserSchema = z.looseObject({ id: z.number(), login: z.string(), full_name: z.string().optional(), email: z.string().optional(), is_admin: z.boolean().optional() })
const NotificationSchema = z.looseObject({ id: z.string(), unread: z.boolean().default(false), updated_at: z.string(),
  subject: z.looseObject({ title: z.string().default(''), url: z.string().optional(), type: z.string().optional() }),
  repository: z.looseObject({ full_name: z.string().optional() }).optional() })
const IssueSchema = z.looseObject({ id: z.number(), number: z.number(), title: z.string(), body: z.string().nullish(), state: z.string().default('open'),
  user: z.looseObject({ login: z.string() }).nullish(), assignee: z.looseObject({ login: z.string() }).nullish(), created_at: z.string(), updated_at: z.string(),
  html_url: z.string().optional(), pull_request: z.unknown().optional() })
const CommentSchema = z.looseObject({ id: z.number(), body: z.string().default(''), user: z.looseObject({ login: z.string() }).nullish(),
  created_at: z.string(), updated_at: z.string(), html_url: z.string().optional(), issue_url: z.string().optional() })
const PullSchema = z.looseObject({ id: z.number(), number: z.number(), title: z.string(), state: z.string().default('open'),
  user: z.looseObject({ login: z.string() }).nullish(), created_at: z.string(), updated_at: z.string(), html_url: z.string().optional(),
  merged: z.boolean().optional(), merged_at: z.string().nullish(), head: z.looseObject({ sha: z.string().optional() }).optional() })

export type GiteaNotification = z.infer<typeof NotificationSchema>
export type GiteaIssue = z.infer<typeof IssueSchema>
export type GiteaComment = z.infer<typeof CommentSchema>
export type GiteaPull = z.infer<typeof PullSchema>

const errorText = (text: string, status: number): string => {
  try {
    const value = JSON.parse(text) as { message?: unknown; errors?: unknown }
    if (typeof value.message === 'string' && value.message) return `${value.message} (${status})`
  } catch { /* Not JSON; keep the status and body. */ }
  const trimmed = text.trim()
  return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `Gitea answered ${status}`
}
const retryAfter = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

/** One Gitea server; tests substitute `fetch` and the retry clock. */
export class GiteaClient {
  private readonly base: string
  constructor(private readonly account: GiteaAuth, private readonly fetchImpl: GiteaFetch = (input, init) => fetch(input, init),
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.base = `${account.baseUrl.replace(/\/+$/, '')}/api/v1`
  }

  /** Sends one request and parses its JSON body; 429 and 5xx retry with backoff, others surface `GiteaError`. */
  async request<T>(schema: z.ZodType<T>, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let lastError: unknown
    const auth = giteaAuthHeaders(this.account)
    const anonymous = Object.keys(auth).length === 0
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      try {
        const response = await this.fetchImpl(`${this.base}${path}`, {
          method, signal: requestSignal,
          headers: { accept: 'application/json', ...auth, ...body === undefined ? {} : { 'content-type': 'application/json' } },
          ...body === undefined ? {} : { body: JSON.stringify(body) },
        })
        const text = await response.text()
        if (response.ok) return schema.parse(text ? JSON.parse(text) : undefined)
        const error = new GiteaError(this.failureMessage(text, response.status, method, path, anonymous), response.status)
        if (!(response.status === 429 || response.status >= 500) || attempt === RETRIES) throw error
        lastError = error
        await this.wait(retryAfter(response.headers) ?? 500 * attempt)
      } catch (caught) {
        if (signal?.aborted) throw caught
        if (caught instanceof GiteaError) {
          if (attempt === RETRIES) throw caught
          lastError = caught
          continue
        }
        if (attempt === RETRIES) throw caught
        lastError = caught
        await this.wait(500 * attempt)
      } finally { clearTimeout(timeout) }
    }
    throw lastError instanceof Error ? lastError : new GiteaError(String(lastError))
  }

  /**
   * A readable failure: an anonymous read that was refused usually means the repository is private, so it names the
   * account fields that fix it instead of looking like an empty repository.
   */
  private failureMessage(text: string, status: number, method: string, path: string, anonymous: boolean): string {
    const detail = errorText(text, status)
    if (!anonymous || (status !== 401 && status !== 403)) return detail
    return `Gitea refused the anonymous request ${method} ${path} (${status}): the repository may be private or need an account; set the Gitea e-mail and password (or an API token). ${detail}`
  }

  /** `GET /version`; works without a token and tells which Gitea the instance runs. */
  async version(signal?: AbortSignal): Promise<string> {
    const value = await this.request(z.looseObject({ version: z.string() }), 'GET', '/version', undefined, signal)
    return value.version
  }
  /** `GET /user`; requires a token and is how deployment verifies the agent account. */
  async user(signal?: AbortSignal): Promise<GiteaUser> { return this.request(UserSchema, 'GET', '/user', undefined, signal) }
  /** `GET /repos/{owner}/{repo}`. */
  async repository(owner: string, name: string, signal?: AbortSignal): Promise<GiteaRepository> {
    return this.request(RepositorySchema, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, undefined, signal)
  }
  /** `GET /notifications`; `since` is an RFC 3339 timestamp. */
  async notifications(options: { since?: string; all?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<GiteaNotification[]> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 50) })
    if (options.since) query.set('since', options.since)
    if (options.all) query.set('all', 'true')
    return this.request(z.array(NotificationSchema), 'GET', `/notifications?${query}`, undefined, signal)
  }
  /** `GET /repos/{owner}/{repo}/issues`; `since` is an RFC 3339 timestamp. */
  async issues(owner: string, name: string, options: { state?: string; since?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GiteaIssue[]> {
    const query = new URLSearchParams({ state: options.state ?? 'all', limit: String(options.limit ?? 50) })
    if (options.since) query.set('since', options.since)
    return this.request(z.array(IssueSchema), 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?${query}`, undefined, signal)
  }
  /** `GET /repos/{owner}/{repo}/issues/comments`; repository-wide comments, `since` an RFC 3339 timestamp. */
  async issueComments(owner: string, name: string, options: { since?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GiteaComment[]> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 50) })
    if (options.since) query.set('since', options.since)
    return this.request(z.array(CommentSchema), 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/comments?${query}`, undefined, signal)
  }
  /** `GET /repos/{owner}/{repo}/pulls`; Gitea has no `since`, so callers filter by `updated_at`. */
  async pulls(owner: string, name: string, options: { state?: string; sort?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GiteaPull[]> {
    const query = new URLSearchParams({ state: options.state ?? 'all', sort: options.sort ?? 'recentupdate', limit: String(options.limit ?? 50) })
    return this.request(z.array(PullSchema), 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query}`, undefined, signal)
  }
  /** `GET /repos/{owner}/{repo}/issues/{index}`; a pull request is an issue too and carries `pull_request`. */
  async issue(owner: string, name: string, index: number, signal?: AbortSignal): Promise<GiteaIssue> {
    return this.request(IssueSchema, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${index}`, undefined, signal)
  }
  /** `GET /repos/{owner}/{repo}/issues/{index}/comments`; `since` an RFC 3339 timestamp. */
  async issueCommentsOf(owner: string, name: string, index: number, options: { since?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GiteaComment[]> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 50) })
    if (options.since) query.set('since', options.since)
    return this.request(z.array(CommentSchema), 'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${index}/comments?${query}`, undefined, signal)
  }
  /** `POST /repos/{owner}/{repo}/issues/{index}/comments`; returns the created comment. */
  async createIssueComment(owner: string, name: string, index: number, body: string, signal?: AbortSignal): Promise<GiteaComment> {
    return this.request(CommentSchema, 'POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${index}/comments`, { body }, signal)
  }

  /**
   * One file of a repository through the contents API: its blob sha (needed to replace it) and its text. The repository
   * may be public, so the read works anonymously; a private or missing path answers 404.
   */
  async fileContents(owner: string, name: string, path: string, options: { ref?: string } = {},
    signal?: AbortSignal): Promise<{ sha: string, text: string }> {
    const query = options.ref ? `?ref=${encodeURIComponent(options.ref)}` : ''
    const file = await this.request(ContentFileSchema, 'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodePath(path)}${query}`, undefined, signal)
    const text = file.content ? Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8') : ''
    return { sha: file.sha, text }
  }

  /**
   * Creates or replaces one file with a commit: `sha` is the blob being replaced, omitted when the file is new. The
   * commit message names what changed, so the repository's history is the document's history.
   */
  async putFile(owner: string, name: string, path: string,
    input: { content: string, message: string, sha?: string, branch?: string }, signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.request(ContentWriteSchema, 'PUT', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodePath(path)}`, {
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      message: input.message,
      ...input.sha ? { sha: input.sha } : {},
      ...input.branch ? { branch: input.branch } : {},
    }, signal)
    return result.content?.sha
  }
}

/** One file of the contents API: the blob sha identifies the version a replacement commits on top of. */
const ContentWriteSchema = z.looseObject({ content: z.looseObject({ sha: z.string().optional() }).optional() })

const ContentFileSchema = z.looseObject({
  sha: z.string().min(1), type: z.string().default('file'), encoding: z.string().default('base64'),
  content: z.string().optional(),
})

/** A repository path kept as path segments, each encoded, so a nested README works as well as the root one. */
const encodePath = (path: string): string => path.split('/').map(segment => encodeURIComponent(segment)).join('/')
