/** Loopback-only management HTTP routes with same-origin enforcement for the web panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { THREAD_FILTERS, TICKET_FILTERS, type Api, type ApiResponse, type RouteParams } from './api.ts'
import { sourceSkills } from './context.ts'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { PromptConflict, SKILL_NAME, SKILL_PREFIX, TEAM_SECTIONS, builtInBase, builtInParts, defaultPrompts, savePrompts, type Prompts }
  from './prompts.ts'
import { policyVersion } from '../policy.ts'
import { SettingsConflict, type Settings } from './settings.ts'
import { SetupError, type SetupProblem } from '../setup.ts'
import { UserError, type EngineForPeople, type Ticket } from '../core/index.ts'
import type { Deployment, Machine } from '../deployment.ts'
import type { DshExecutor } from '../executor/dsh.ts'
import type { Health } from '../sources/host.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'
import { writeArchive } from './narrative.ts'
import { charterOfText } from './narrative.ts'
import { charterTarget, kaneoAccount, publishCharter, publishWindow, readPrimaryCharter } from './charter.ts'
import { dutiesPathOf, publishDuties, readDuties } from './duties.ts'
import { readProjectChoices } from './projects.ts'
import { readCapabilities } from './capabilities.ts'
import { storedKaneoAccount } from '../sources/bdd-storage.ts'
import { DEFAULT_BASE_URL } from '../sources/kaneo-config.ts'
import { archiveView, narrativeView } from './views/narrative.ts'
import type { TextCache } from './cache.ts'
import type { LinkTarget, ViewHost } from './views/records.ts'
import { executionRoot, type Variable } from './execution-environment.ts'
import { audit, clean, type CleanHost } from './maintenance.ts'
import { policyHistory } from './settings-history.ts'
import { overview } from './views/overview.ts'
import { settingsView } from './views/settings.ts'
import { sourcesStatus, type SetupState } from './views/sources.ts'
import { decisionList, search, threadDetail, threadList } from './views/threads.ts'
import { executorLoad, ticketDetail, ticketList } from './views/tickets.ts'

export interface HttpHost {
  readonly store: Store
  /** Feishu message links resolved since startup, used by search to match AppLink URLs. */
  readonly sourceLinks: Pick<TextCache, 'entries'>
  readonly sources: SourceRegistry
  readonly prompts: Pick<Prompts, 'current' | 'version' | 'history' | 'preview' | 'save' | 'defaultChanged'>
  readonly sessions: Pick<Sessions, 'status' | 'notify' | 'delivery'>
  readonly settings: Pick<Settings, 'view' | 'save' | 'pause' | 'sync' | 'refreshLabels'>
  readonly engine: EngineForPeople
  readonly executor: Pick<DshExecutor, 'activeCount'>
  readonly health: Record<string, Health>
  readonly machine: Machine
  readonly masterId: string
  /** Resolves once startup finishes or setup determines what is still missing. */
  readonly ready: Promise<void>
  /** Resolved deployment; throws if read while waiting for setup (`!configured()`). */
  readonly deployment: Deployment
  readonly setupProblem?: SetupProblem | undefined
  readonly feishuProblem?: SetupProblem | undefined
  configured(): boolean
  links(): LinkTarget
  ticketEnvironment(ticket: Ticket): Variable[]
  checkSetup(): void
  requestPass(): void
  models(): Promise<ModelCatalog>
}
/**
 * Represents a client-facing 400 or 404 error raised during management route parsing or lookup.
 * Route handlers throw it when request bodies are malformed or target records are missing, and registerHttp serializes its status and message in the HTTP response.
 */
class RouteError extends Error { constructor(readonly status: 400 | 404, message: string) { super(message) } }
async function readBody(req: IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > maxBytes) throw new RouteError(400, `Request exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new RouteError(400, 'The request body is not JSON') }
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value))
}
export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  return req.headers['x-orchestrator-request'] === '1' && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)
}
/** Maps errors to HTTP status codes and structured payloads that the panel localizes in the interface language. */
function failure(error: unknown): [number, Record<string, unknown>] {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
    return [400, { error: `Invalid settings: ${issues.map(issue => issue.path).join(', ')}`, issues }]
  }
  if (error instanceof SetupError) return [400, { error: error.message, setup: error.problem }]
  if (error instanceof RouteError) return [error.status, { error: error.message }]
  if (error instanceof UserError) return [error.missing ? 404 : 400, { error: error.message, code: error.code, values: error.values }]
  if (error instanceof SettingsConflict || error instanceof PromptConflict) return [409, { error: error.message }]
  return [500, { error: error instanceof Error ? error.message : String(error) }]
}

function machineView({ stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs }: Machine) {
  return { stateDir, promptMaxChars: promptMaxChars.get(), admissionContextMaxPages: admissionContextMaxPages.get(),
    admissionContextTimeoutMs: admissionContextTimeoutMs.get() }
}
function setupView(runtime: HttpHost) {
  const resolved = runtime.configured() ? runtime.deployment : undefined
  return {
    machine: machineView(runtime.machine), problem: runtime.setupProblem ?? null, feishuProblem: runtime.feishuProblem ?? null,
    accounts: resolved ? { repository: resolved.repository, agent: resolved.github.login, feishu: resolved.feishu ? { appId: resolved.feishu.appId, brand: resolved.feishu.brand, botId: resolved.feishu.botId, name: resolved.feishu.name } : null } : null,
  }
}
/** Build the `/orchestrator/api/state` response consumed by the management panel and `scripts/dsh-superagent status` (`docs/006-deployment.md`). */
export function stateView(runtime: HttpHost) {
  const settings = runtime.store.settings()
  return { setup: setupView(runtime), load: { ...executorLoad(runtime.store, runtime.executor.activeCount()),
    maxWorkers: settings.executor.maxWorkers },
    masterId: runtime.masterId, paused: settings.paused, health: runtime.health }
}
const views = (runtime: HttpHost): ViewHost => ({ store: runtime.store, sources: runtime.sources, links: runtime.links() })
const setupState = (runtime: HttpHost): SetupState => ({ deployment: runtime.configured() ? runtime.deployment : undefined,
  problem: runtime.setupProblem, feishuProblem: runtime.feishuProblem })
export type StateView = ReturnType<typeof stateView>
/** Builds a ticket's detail view; `environment` is empty while waiting for setup because it requires the resolved deployment. */
function ticketPage(runtime: HttpHost, id: string) {
  const detail = ticketDetail(views(runtime), id), ticket = runtime.store.tickets.get(id)
  if (!detail || !ticket) throw new RouteError(404, 'Ticket not found')
  return { ...detail, environment: runtime.configured() ? runtime.ticketEnvironment(ticket) : [] }
}
export type TicketPageView = ReturnType<typeof ticketPage>
function promptsView(runtime: HttpHost, revision: number | undefined, offset: number) {
  const current = runtime.prompts.current()
  const shown = revision === undefined || revision === current.revision ? current : runtime.prompts.version(revision)
  // Each built-in part with the key of its text, which an override records as its base, and for the overrides shown whose
  // built-in text changed since, the text they were edited from when known.
  const parts = Object.entries(builtInParts()).map(([key, part]) => ({ key, ...part, base: builtInBase(part.text) }))
  return { masterId: runtime.masterId, current: shown, defaults: defaultPrompts(), sections: TEAM_SECTIONS, skillName: SKILL_NAME.source,
    builtin: Object.keys(sourceSkills), skillPrefix: SKILL_PREFIX, parts, defaultChanged: runtime.prompts.defaultChanged(shown.config),
    ...runtime.sessions.status(), ...runtime.prompts.history(offset) }
}
export type PromptsView = ReturnType<typeof promptsView>

interface Input<K extends keyof Api> {
  params: RouteParams<K>; query: Record<string, string>; body: (maxBytes?: number) => Promise<unknown>
}
type Routes = { [K in keyof Api]: (input: Input<K>) => ApiResponse<K> | Promise<ApiResponse<K>> }
const offset = z.coerce.number().int().nonnegative().catch(0)
const limit = (fallback: number, max: number) => z.coerce.number().int().positive().catch(fallback).transform(value => Math.min(max, value))
const TicketsQuery = z.object({ state: z.enum(TICKET_FILTERS).catch('open'), offset, limit: limit(20, 1000) })
const ThreadsQuery = z.object({ filter: z.enum(THREAD_FILTERS).catch('subscribed'), offset, limit: limit(20, 1000) })
const ThreadQuery = z.object({ limit: limit(50, 100), before: z.string().optional(), around: z.string().optional() })
const DecisionsQuery = z.object({ kind: z.string().default(''), window: z.literal('24h').optional().catch(undefined), offset,
  limit: limit(30, 200) })
const count = z.coerce.number().int().nonnegative()
const PromptsQuery = z.object({ revision: count.optional(), offset: count.default(0) })
const SourceBlock = z.templateLiteral(['source:', z.string().regex(/^[a-z][a-z0-9-]*$/)])
const SettingsBlockSchema = z.union([z.enum(['policy', 'eval', 'executor']), SourceBlock])
const SaveRequest = z.object({ value: z.unknown(), revision: z.number().int().nonnegative() })
const TestSourceRequest = z.object({ config: z.record(z.string(), z.unknown()) })
const CleanRequest = z.object({ ticketIds: z.array(z.string().min(1)).max(1000), removeFiles: z.boolean().optional() })

/** Merge a source card's hidden secret fields with the stored values: an empty field means "keep the saved secret". */
function mergedSourceConfig(runtime: HttpHost, id: string, submitted: Record<string, unknown>): Record<string, unknown> {
  const registry = runtime.sources as unknown as {
    kind?: (id: string) => { fields?: readonly { key: string; type: string }[] } | undefined
    instance?: (id: string) => { config?: Record<string, unknown> } | undefined
  }
  const secrets = (registry.kind?.(id)?.fields ?? []).filter(field => field.type === 'password')
  const stored = registry.instance?.(id)?.config
  const config = { ...submitted }
  for (const field of secrets) if (!config[field.key] && stored?.[field.key]) config[field.key] = stored[field.key]
  return config
}

function routes(runtime: HttpHost, maintenance: CleanHost): Routes {
  const { store } = runtime
  const ticket = (id: string) => { if (!store.tickets.get(id)) throw new RouteError(404, 'Ticket not found'); return id }
  const promptBody = (input: { body: (maxBytes?: number) => Promise<unknown> }) => input.body(4 * runtime.machine.promptMaxChars.get() + 4096)
  return {
    'GET state': () => stateView(runtime),
    // What this Host may do as a post: its Kanban account and the management rights that come with it (RD.md §4).
    'GET capabilities': async () => {
      const deployed = runtime.configured() ? runtime.deployment.kaneo : undefined
      const account = deployed?.apiKey ? deployed : storedKaneoAccount(deployed?.baseUrl ?? DEFAULT_BASE_URL)
      return readCapabilities(account)
    },
    // The projects this Host may work on: the panel lists them so a person picks one instead of typing its id. This
    // must answer while setup is still pending, because filling the project id in is part of fixing setup.
    'GET projects': ({ query }) => readProjectChoices(kaneoAccount(runtime.sources), { force: query.refresh === 'true' }),
    'GET overview': () => overview(views(runtime), runtime.health, policyVersion(store.settings()),
      executorLoad(store, runtime.executor.activeCount()), runtime.setupProblem ?? runtime.feishuProblem),
    // The narrative view: projects, posts, the charter each PM published, the duties in flight and the exceptions.
    'GET narrative': () => narrativeView(store, runtime.sources, runtime.machine.stateDir),
    'GET project-archive': () => archiveView(runtime.machine.stateDir),
    'PUT project-archive': async ({ body }) => {
      const input = await body(256 * 1024) as { archive?: unknown; revision?: unknown }
      const revision = z.number().int().nonnegative().catch(0).parse(input?.revision)
      try {
        return writeArchive(runtime.machine.stateDir, input?.archive, revision)
      } catch (error) {
        throw new RouteError(400, error instanceof Error ? error.message : String(error))
      }
    },
    'GET search': ({ query }) => search(views(runtime), query.q ?? '', runtime.sourceLinks),
    // Publishing a project's charter: it replaces the one the project holds (one document, every post reads it), at
    // most once a week; the panel keeps the draft and the history.
    'POST narrative/charter': async ({ body }) => {
      const input = await body(64 * 1024) as { projectId?: unknown, text?: unknown, publishedBy?: unknown, force?: unknown }
      const projectId = typeof input?.projectId === 'string' ? input.projectId.trim() : ''
      const text = typeof input?.text === 'string' ? input.text.trim() : ''
      const publishedBy = typeof input?.publishedBy === 'string' ? input.publishedBy.trim() : ''
      if (!projectId || !text) throw new RouteError(400, 'A charter needs a project and its text')
      const stateDir = runtime.machine.stateDir
      const current = archiveView(stateDir)
      const project = current.archive.projects.find(item => item.id === projectId)
      if (!project) throw new RouteError(404, 'Project not found in the archive')
      const target = charterTarget(runtime.sources)
      const previous = await readPrimaryCharter(target, projectId)
      const window = publishWindow(previous?.publishedAt ?? (project.charter.publishedAt || undefined))
      if (!window.ok && input?.force !== true) {
        throw new RouteError(400, `A project's charter changes at most once a week; it may be published again on ${new Date(window.dueAt).toISOString()}`)
      }
      let published
      try {
        published = await publishCharter(target, projectId, text, publishedBy, previous)
      } catch (error) {
        throw new RouteError(400, error instanceof Error ? error.message : String(error))
      }
      project.charter = {
        version: published.version,
        publishedAt: published.publishedAt,
        publishedBy: publishedBy || project.charter.publishedBy,
        text: published.text,
        draft: '',
        history: project.charter.version > 0
          ? [...project.charter.history, { version: project.charter.version, publishedAt: project.charter.publishedAt,
              publishedBy: project.charter.publishedBy, text: project.charter.text }]
          : project.charter.history,
      }
      writeArchive(stateDir, current.archive, current.revision)
      return { charter: charterOfText(published.text, published.publishedAt, project.charter.publishedBy),
        carrier: published.carrier, carrierRef: published.carrierRef }
    },
    // 职责说明：与宪章同仓的 duties.md。内容属于项目治理，所以 Host 不提供设置，面板只读 + 发布。
    'GET duties': async () => {
      const target = charterTarget(runtime.sources)
      const doc = await readDuties(target)
      return { path: dutiesPathOf(target.gitea?.path ?? 'README.md'), carrierRef: doc.carrierRef,
        ...doc.sha ? { sha: doc.sha } : {}, text: doc.text, duties: doc.duties, ...doc.detail ? { detail: doc.detail } : {} }
    },
    'POST duties': async ({ body }) => {
      const input = await body(64 * 1024) as { text?: unknown; publishedBy?: unknown }
      const text = typeof input?.text === 'string' ? input.text : ''
      if (!text.trim()) throw new RouteError(400, 'A duties document needs its text')
      const publishedBy = typeof input?.publishedBy === 'string' ? input.publishedBy.trim() : ''
      try {
        const published = await publishDuties(charterTarget(runtime.sources), text, publishedBy)
        return { ...published, path: dutiesPathOf(charterTarget(runtime.sources).gitea?.path ?? 'README.md') }
      } catch (error) {
        throw new RouteError(400, error instanceof Error ? error.message : String(error))
      }
    },
    'GET sources': () => sourcesStatus(views(runtime), runtime.health, setupState(runtime)),
    'GET settings': () => settingsView(store, runtime.sources, runtime.health, setupState(runtime), runtime.machine.stateDir),
    'POST sources/:id/labels': ({ params }) => runtime.settings.refreshLabels(params.id),
    // Validate the values currently in the settings card without saving them; the panel enables Save only after this passes.
    'POST sources/:id/test': async ({ params, body }) => {
      const kind = runtime.sources.kind(params.id)
      if (!kind?.test) throw new RouteError(404, 'This Source cannot be tested')
      const input = TestSourceRequest.parse(await body())
      const config = mergedSourceConfig(runtime, params.id, input.config)
      try {
        await kind.test(kind.schema.parse(config))
        return { ok: true as const }
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      }
    },
    'GET threads': ({ query }) => {
      const { filter, offset, limit } = ThreadsQuery.parse(query)
      return threadList(views(runtime), filter, offset, limit)
    },
    'GET threads/:key': ({ params, query }) => {
      const { limit, before, around } = ThreadQuery.parse(query)
      const detail = threadDetail(views(runtime), params.key, before, limit, around)
      if (!detail) throw new RouteError(404, 'Thread not found')
      return detail
    },
    'POST threads/:key/unsubscribe': async ({ params }) => {
      const removed = runtime.engine.unsubscribe(params.key)
      return { removed, thread: params.key, context_delivery: await runtime.sessions.delivery(`subscription:${params.key}`) }
    },
    'POST triggers/:id/requeue': ({ params }) => {
      const queued = runtime.engine.reevaluate(params.id)
      runtime.requestPass()
      return { queued }
    },
    'GET decisions': ({ query }) => {
      const { kind, window, offset, limit } = DecisionsQuery.parse(query)
      const since = window ? new Date(Date.now() - 86_400_000).toISOString() : ''
      return decisionList(views(runtime), kind.split(',').filter(Boolean), offset, limit, since)
    },
    'POST decisions/:id/dismiss': ({ params }) => { runtime.engine.dismiss(params.id); return { dismissed: true } },
    'GET tickets': ({ query }) => {
      const { state, offset, limit } = TicketsQuery.parse(query)
      return ticketList(views(runtime), state, offset, limit)
    },
    'GET tickets/:id': ({ params }) => ticketPage(runtime, params.id),
    'POST tickets/:id/retry': ({ params }) => { const id = ticket(params.id); runtime.engine.retryTicket(id); return { retried: true } },
    'POST tickets/:id/stop': ({ params }) => { const id = ticket(params.id); runtime.engine.stopTicket(id); return { stopped: true } },
    // The cleanup page: what the ended duties left behind, and the safe cleanup a person confirmed.
    'GET maintenance': async () => {
      const { workspaces, totals, notes } = await audit(maintenance)
      return { workspaces, totals, notes }
    },
    'POST maintenance/clean': async ({ body }) => clean(maintenance, CleanRequest.parse(await body())),
    'POST executor/pause': async ({ body }) => runtime.settings.pause(z.object({ paused: z.boolean() }).parse(await body()).paused, 'panel'),
    'PUT settings/:block': async ({ params, body }) => {
      const block = SettingsBlockSchema.parse(params.block)
      const known = !block.startsWith('source:') || runtime.sources.instances().some(instance => `source:${instance.id}` === block)
      if (!known) throw new RouteError(404, 'Source not found')
      const request = SaveRequest.parse(await body())
      // Secret fields are never sent to the browser; an empty submission keeps the stored value instead of clearing it.
      let value = request.value
      if (block.startsWith('source:')) {
        const id = block.slice('source:'.length)
        const submitted = value as { config?: Record<string, unknown> } | null
        if (submitted && typeof submitted === 'object' && submitted.config && typeof submitted.config === 'object') {
          value = { ...submitted, config: mergedSourceConfig(runtime, id, submitted.config) }
        }
      }
      return runtime.settings.save(block, value, request.revision, 'panel')
    },
    'GET policy/history': () => policyHistory(store, runtime.sources, policyVersion(store.settings())),
    'POST policy-sync/:id': async ({ params }) => ({ policy: await runtime.settings.sync(params.id) }),
    'POST setup/check': () => { runtime.checkSetup(); return { restarting: true } },
    'GET models': () => runtime.models(),
    'GET prompts': ({ query }) => { const { revision, offset } = PromptsQuery.parse(query); return promptsView(runtime, revision, offset) },
    'PUT prompts': async input => {
      const request = z.object({ config: z.unknown(), baseRevision: z.number().int().nonnegative() }).parse(await promptBody(input))
      return savePrompts(runtime, request.config, request.baseRevision, 'panel')
    },
    'POST prompts/preview': async input => runtime.prompts.preview(await promptBody(input)),
  }
}
function decoded(segment: string): string {
  try { return decodeURIComponent(segment) } catch { throw new RouteError(400, 'A path segment has a malformed escape') }
}
function match(table: Routes, method: string, segments: string[]) {
  for (const [route, run] of Object.entries(table)) {
    const [verb, path] = route.split(' ') as [string, string]
    const pattern = path.split('/')
    const fits = pattern.length === segments.length && pattern.every((part, index) => part.startsWith(':') || part === segments[index])
    if (verb !== method || !fits) continue
    const params: Record<string, string> = {}
    pattern.forEach((part, index) => { if (part.startsWith(':')) params[part.slice(1)] = decoded(segments[index]!) })
    return { run: run as (input: Input<keyof Api>) => unknown, params }
  }
  return undefined
}
export function registerHttp(ctx: Context, runtime: HttpHost): () => void {
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('Orchestrator management requires a loopback Web server')
  // Read the workspace registry and Session persistence lazily, when the cleanup routes ask: a Host without them still
  // serves every other route, and a test host need not provide them.
  const maintenance: CleanHost = {
    tickets: () => runtime.store.tickets.list(),
    workspaces: async () => ctx.workspaceRegistry.list().map(workspace => ({ id: String(workspace.id), path: workspace.path })),
    sessions: async () => (await ctx.sessionPersistence.list()).flatMap(snapshot => snapshot.header.cwd
      ? [{ id: String(snapshot.header.id), cwd: snapshot.header.cwd }] : []),
    executionRoot: () => executionRoot(runtime.store.settings(), runtime.machine.stateDir),
    stateDir: () => runtime.machine.stateDir,
    deleteWorkspace: id => ctx.workspaceRegistry.delete(id as WorkspaceId),
  }
  const table = routes(runtime, maintenance)
  const disposers = [
    ctx.webServer.register({ kind: 'prefix', path: '/orchestrator', handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith('/orchestrator/api/')) { res.writeHead(404); res.end(); return }
      if (!sameOrigin(req, ctx.webServer.port)) { json(res, 403, { error: 'Same-origin management request required' }); return }
      try {
        await runtime.ready
        const route = match(table, req.method ?? 'GET', url.pathname.slice('/orchestrator/api/'.length).split('/'))
        if (!route) throw new RouteError(404, 'Unknown operation')
        const query = Object.fromEntries(url.searchParams)
        json(res, 200, await route.run({ params: route.params as never, query, body: maxBytes => readBody(req, maxBytes) }))
      } catch (error) { json(res, ...failure(error)) }
    } })]
  return () => { for (const dispose of disposers) dispose() }
}
