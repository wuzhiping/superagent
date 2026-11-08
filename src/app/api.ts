/** Type-only management API contract between the web panel and host routes, imported by the panel without bundling host code. */
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { PromptConfig, Prompts } from './prompts.ts'
import type { PromptsView, StateView, TicketPageView } from './http.ts'
import type { HistoryView } from './settings-history.ts'
import type { OverviewView } from './views/overview.ts'
import type { SettingsView } from './views/settings.ts'
import type { SourceStatusView } from './views/sources.ts'
import type { DecisionListView, SearchView, ThreadDetailView, ThreadListView } from './views/threads.ts'
import type { TicketListView } from './views/tickets.ts'
import type { MaintenanceCleanResult, MaintenanceView } from './maintenance.ts'
import type { NarrativeView } from './views/narrative.ts'
import type { ProjectArchive } from './narrative.ts'
import type { CharterInfo } from './narrative.ts'
import type { DutySpec } from './duties.ts'
import type { Capabilities } from './capabilities.ts'
import type { ProjectChoices } from './projects.ts'

export const TICKET_FILTERS = ['open', 'person', 'working', 'idle', 'ended'] as const
export const THREAD_FILTERS = ['subscribed', 'evaluating', 'recent', 'all'] as const
export type TicketFilter = typeof TICKET_FILTERS[number]
export type ThreadFilter = typeof THREAD_FILTERS[number]
interface Paged { offset?: number; limit?: number }
/** Whether a context update was already injected into the main Session or is still pending delivery. */
type Delivery = 'injected' | 'pending'

export interface Api {
  'GET state': { response: StateView }
  'GET capabilities': { response: Capabilities }
  /** The workspaces and projects this Host's Kanban account can see, so a person picks a project instead of typing its id. */
  'GET projects': { response: ProjectChoices }
  'GET overview': { response: OverviewView }
  'GET narrative': { response: NarrativeView }
  'GET project-archive': { response: { archive: ProjectArchive; revision: number } }
  'PUT project-archive': { body: { archive: unknown; revision: number };
    response: { revision: number; mapped?: { postId: string; email: string; userId: string }[] } }
  /** The members of the project's Kanban workspace (their e-mails are what a post names). */
  'GET kaneo-users': { query: { projectId?: string };
    response: { workspaceId?: string; users: import('./kaneo-users.ts').KaneoMember[]; detail?: string } }
  /** Publishes a project's charter into the project itself: one document per project, at most once a week. */
  'POST narrative/charter': { body: { projectId: string; text: string; publishedBy: string; force?: boolean };
    response: { charter: CharterInfo; carrier?: 'gitea' | 'kanban'; carrierRef?: string } }
  /** The project's duty descriptions, read from the Gitea repository that holds the charter (beside its file). */
  'GET duties': { response: { path: string; carrierRef: string; sha?: string; text: string; duties: DutySpec[]; mode: 'folder' | 'file' | 'none'; files?: Record<string, string>; detail?: string } }
  /** Publishes the duties document into that Gitea repository, as a commit; the Host configures nothing about duties. */
  'POST duties': { body: { text: string; publishedBy?: string }; response: { sha?: string; carrierRef: string; path?: string; files?: string[] } }
  'GET search': { query: { q: string }; response: SearchView }
  'GET sources': { response: SourceStatusView[] }
  'GET settings': { response: SettingsView }
  'POST sources/:id/labels': { response: { added: string[] } }
  'POST sources/:id/test': { body: { config: Record<string, unknown> }; response: { ok: true } | { ok: false; error: string } }
  'GET threads': { query?: Paged & { filter?: ThreadFilter }; response: ThreadListView }
  'GET threads/:key': { query?: { limit?: number; before?: string; around?: string }; response: ThreadDetailView }
  'POST threads/:key/unsubscribe': { response: { removed: boolean; thread: string; context_delivery: Delivery } }
  'POST triggers/:id/requeue': { response: { queued: boolean } }
  'GET decisions': { query?: Paged & { kind?: string; window?: '24h' }; response: DecisionListView }
  'POST decisions/:id/dismiss': { response: { dismissed: true } }
  'GET tickets': { query?: Paged & { state?: TicketFilter }; response: TicketListView }
  'GET tickets/:id': { response: TicketPageView }
  'POST tickets/:id/retry': { response: { retried: true } }
  'POST tickets/:id/stop': { response: { stopped: true } }
  // The cleanup page: the workspaces ended duties left behind, and the safe cleanup a person confirmed.
  'GET maintenance': { response: MaintenanceView }
  'POST maintenance/clean': { body: { ticketIds: string[]; removeFiles?: boolean; removeSessions?: boolean; forceSessions?: boolean }; response: MaintenanceCleanResult }
  'POST executor/pause': { body: { paused: boolean }; response: { paused: boolean } }
  'PUT settings/:block': { body: { value: unknown; revision: number }; response: { revision: number; restarting: boolean } }
  'GET policy/history': { response: HistoryView }
  'POST policy-sync/:id': { response: { policy: unknown } }
  'POST setup/check': { response: { restarting: true } }
  'GET models': { response: ModelCatalog }
  'GET prompts': { query?: { revision?: number; offset?: number }; response: PromptsView }
  'PUT prompts': { body: { config: PromptConfig; baseRevision: number }; response: { revision: number; context_delivery: Delivery } }
  'POST prompts/preview': { body: PromptConfig; response: ReturnType<Prompts['preview']> }
}
type Path<K> = K extends `${string} ${infer P}` ? P : never
type Params<P> = P extends `${string}:${infer Name}/${infer Rest}` ? Record<Name, string> & Params<Rest>
  : P extends `${string}:${infer Name}` ? Record<Name, string> : unknown
export type RouteParams<K extends keyof Api> = Params<Path<K>>
export type ApiRequest<K extends keyof Api> = RouteParams<K> & Omit<Api[K], 'response'>
export type ApiResponse<K extends keyof Api> = Api[K]['response']
