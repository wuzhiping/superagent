/** Kaneo Source configuration: the account fields deployment setup reads and the full kind schema. No Node-only imports (deployment imports this). */
import { z } from 'zod'

/** Default project id: the FDEP pipeline board on pl.feg.cn (slug FDE). */
export const DEFAULT_PROJECT = 'dgctny8ibgpn72ei2j8qj2hc'
export const DEFAULT_BASE_URL = 'https://pl.feg.cn'
export const DEFAULT_WATCH_COLUMNS = 'ready'
export const DEFAULT_CLAIM_COLUMN = 'in-progress'

/**
 * The account fields deployment setup resolves and restarts for. `apiKey` empty means the Kaneo Source is not configured;
 * `projectId` defaults to the FDEP board so a first save only needs the key; `workspaceId` names the workspace the
 * labels of the inbox live in (empty: the first workspace the API key can read).
 */
export const KaneoAccountSchema = z.object({
  baseUrl: z.string().trim().default(DEFAULT_BASE_URL),
  apiKey: z.string().trim().default(''),
  projectId: z.string().trim().default(DEFAULT_PROJECT),
  workspaceId: z.string().trim().default(''),
})
export type KaneoAccount = z.infer<typeof KaneoAccountSchema>

/**
 * One Kaneo board as a Source. A task in `watchColumns` becomes a request; a reply goes back as a task comment and, when
 * `claimColumn` is set, the task is moved there once the request is recorded. `bootstrap` decides what the first poll does
 * with tasks already in the watched columns: `skip` records them without a request, `trigger` treats them as requests.
 */
export const KaneoConfigSchema = z.object({
  baseUrl: z.string().trim().default(DEFAULT_BASE_URL).describe('Kaneo server, e.g. https://pl.feg.cn'),
  apiKey: z.string().trim().default('').describe('Kaneo API key; kept out of prompts and Session text'),
  projectId: z.string().trim().default(DEFAULT_PROJECT).describe('Kaneo project id whose board this Source watches'),
  workspaceId: z.string().trim().default('').describe('Optional workspace id; used only for display and links'),
  watchColumns: z.string().trim().default(DEFAULT_WATCH_COLUMNS).describe('Column slugs whose tasks become requests, comma separated'),
  ingestEvents: z.boolean().default(true).describe('Other Sources file their events as cards in this project instead of producing requests'),
  claimColumn: z.string().trim().default(DEFAULT_CLAIM_COLUMN).describe('Column a task moves to when the post starts working on it; empty to never move'),
  doneColumn: z.string().trim().default('').describe('Column a task moves to when the post delivers its result; empty to never move'),
  bootstrap: z.enum(['skip', 'trigger']).default('skip').describe('First poll: record tasks already in the watched columns, or treat them as requests'),
  requiredLabels: z.string().trim().default('').describe('Only tasks with one of these labels (comma separated); empty accepts every task'),
  pollSeconds: z.number().int().min(15).max(3600).default(60).describe('Poll interval in seconds'),
  failuresBeforeError: z.number().int().min(1).max(20).default(3).describe('Consecutive failed polls before the health entry reports an error'),
  maxTasksPerColumn: z.number().int().min(1).max(200).default(50).describe('Tasks read per watched column each poll'),
  actorFallback: z.string().trim().default('kaneo').describe('Actor id used when a task names neither an assignee nor a creator'),
}).strict()
export type KaneoConfig = z.infer<typeof KaneoConfigSchema>

const split = (value: string): string[] => value.split(',').map(item => item.trim()).filter(Boolean)
/** Watched column slugs from the comma-separated config field. */
export const watchColumnsOf = (config: Pick<KaneoConfig, 'watchColumns'>): string[] => split(config.watchColumns)
/** Required task labels from the comma-separated config field. */
export const requiredLabelsOf = (config: Pick<KaneoConfig, 'requiredLabels'>): string[] => split(config.requiredLabels)
/** The claim column a task moves to when the post starts working on it; empty means the task never moves. */
export const claimColumnOf = (config: Pick<KaneoConfig, 'claimColumn'> | undefined): string => config?.claimColumn.trim() ?? ''
/** The column a task moves to when the post delivers its result; empty means the task never moves. */
export const doneColumnOf = (config: Pick<KaneoConfig, 'doneColumn'> | undefined): string => config?.doneColumn.trim() ?? ''

/** The account fields of a stored Kaneo Source config, or undefined when no API key is configured. */
export function kaneoAccountOf(stored: Record<string, unknown> | undefined): KaneoAccount | undefined {
  if (!stored) return undefined
  const parsed = KaneoAccountSchema.safeParse(stored)
  const account = parsed.success ? parsed.data : undefined
  return account?.apiKey ? account : undefined
}

/** The API base URL of a configured Kaneo server (accepts a base without `/api`). */
export const apiBase = (baseUrl: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

/** The web page of a Kaneo task; the Site is a single-page app, so the board page is the stable fallback until a task route is confirmed. */
export const kaneoTaskUrl = (config: Pick<KaneoConfig, 'baseUrl' | 'projectId' | 'workspaceId'>, task: { id: string; number?: number | undefined }): string => {
  const base = config.baseUrl.replace(/\/+$/, '')
  const workspace = config.workspaceId ? `workspace/${encodeURIComponent(config.workspaceId)}/` : ''
  return `${base}/dashboard/${workspace}project/${encodeURIComponent(config.projectId)}?task=${encodeURIComponent(task.id)}`
}
