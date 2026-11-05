/**
 * KanEO 入库助手：其它来源（Gitea、ntfy）的事件先在 KanEO 看板里落成一张卡，再由 KanEO 统一调度。
 * KanEO 是唯一的直接来源：入库的卡停在 `to-do` 待辦池，不指派任何人；PM 指派并移进监听列之后，卡片才成为请求。
 */
import { KV } from '../kv.ts'
import { storedKaneoAccount } from './bdd-storage.ts'
import { KaneoClient } from './kaneo-api.ts'
import { DEFAULT_BASE_URL, DEFAULT_PROJECT, kaneoTaskUrl, type KaneoConfig } from './kaneo-config.ts'
import type { SourceContext } from './host.ts'

/** 待辦池：入库的卡先落在这里，还没排进价值流（RD.md §10.2）。 */
export const INBOX_COLUMN = 'to-do'
/** 每个来源一个入库标签；颜色自定，同名标签由 KanEO 复用。 */
const LABEL_COLORS: Record<string, string> = { gitea: '#2563eb', ntfy: '#16a34a' }

/** The KanEO account an event is filed into: the account of the deployed KanEO Source. */
export interface InboxAccount { baseUrl: string; apiKey: string; projectId: string; workspaceId?: string | undefined }

/** One event of another Source, as it is filed. */
export interface InboxEvent {
  /** 来源名（gitea、ntfy…）：标签与说明都用它。 */
  source: string
  /** 卡片标题：原事件的标题（没有标题就用正文首行）。 */
  title: string
  /** 原事件的正文。 */
  body?: string | undefined
  /** 原链接：写进描述的 `Source URL:` 一行。 */
  url?: string | undefined
  /** 发起人。 */
  by?: string | undefined
}

/** The card an event became. */
export interface InboxCard { id: string; number?: number | undefined; title: string; url: string; label: string; column: string }

/** The label name of one source: `from:<source>`. */
export const inboxLabel = (source: string): string => `from:${source}`

/** The card description: the original text, the original link, and one line saying where the card came from. */
export function inboxDescription(event: InboxEvent): string {
  const parts: string[] = []
  const body = (event.body ?? '').trim()
  if (body) parts.push(body)
  if (event.url) parts.push(`Source URL: ${event.url}`)
  parts.push(`此卡由 ${event.source} 入库${event.by ? `（${event.by}）` : ''}，等 PM 指派并移入监听列后才成为职责。`)
  return parts.join('\n\n')
}

/**
 * The KanEO account of the deployment, or undefined when the KanEO Source is not configured. Without it an event
 * cannot be filed, so the Sources report the missing account instead of dropping the event.
 */
export function inboxAccount(ctx: SourceContext): InboxAccount | undefined {
  let account: { baseUrl: string; apiKey: string; projectId: string; workspaceId?: string | undefined } | undefined
  // The deployment throws while setup is still running; that is the same as "no account yet".
  try { account = ctx.deployment.kaneo } catch { return undefined }
  if (account?.apiKey) {
    return { baseUrl: account.baseUrl, apiKey: account.apiKey, projectId: account.projectId, workspaceId: account.workspaceId }
  }
  // A Host whose storage record carries the key needs nothing typed into the Source card.
  const stored = storedKaneoAccount(account?.baseUrl ?? DEFAULT_BASE_URL)
  if (!stored) return undefined
  return { baseUrl: stored.baseUrl, apiKey: stored.apiKey, projectId: account?.projectId ?? ctx.config<KaneoConfig>('kaneo')?.projectId ?? DEFAULT_PROJECT,
    workspaceId: account?.workspaceId ?? ctx.config<KaneoConfig>('kaneo')?.workspaceId }
}

/**
 * Whether the other Sources file their events as cards (the default) or produce requests themselves. The switch lives
 * on the KanEO Source, because KanEO is the only direct source and owns the board the events are filed into.
 */
export function ingestEvents(ctx: SourceContext): boolean {
  return ctx.config<KaneoConfig>('kaneo')?.ingestEvents !== false
}

/**
 * Files one event as a KanEO card: the source label, a card in the `to-do` pool without an assignee, and the label
 * attached to that card. The card is the inbox entry, not a request: only KanEO's own polling turns it into work.
 */
export async function fileEvent(account: InboxAccount, event: InboxEvent, options: { client?: KaneoClient; signal?: AbortSignal } = {}): Promise<InboxCard> {
  const client = options.client ?? new KaneoClient(account)
  const label = await ensureLabel(client, account, event.source, options.signal)
  const task = await client.createTask(account.projectId, {
    title: event.title, description: inboxDescription(event), status: INBOX_COLUMN, priority: 'no-priority',
  }, { signal: options.signal })
  await client.attachLabel(label.id, task.id, { signal: options.signal })
  return { id: task.id, number: task.number, title: task.title, label: label.name, column: task.status,
    url: kaneoTaskUrl({ baseUrl: account.baseUrl, projectId: account.projectId, workspaceId: account.workspaceId ?? '' }, task) }
}

/**
 * Files one event unless this Source filed it before; the marker keeps a half-finished round from filing the same
 * event twice. Returns the new card, or undefined when the event was filed already.
 */
export async function fileEventOnce(ctx: SourceContext, account: InboxAccount, event: InboxEvent, eventKey: string,
  options: { client?: KaneoClient; signal?: AbortSignal } = {}): Promise<InboxCard | undefined> {
  const marker = KV.inbox.filed(event.source, eventKey)
  if (ctx.state.get(marker)) return undefined
  const card = await fileEvent(account, event, options)
  ctx.state.set(marker, { cardId: card.id, at: new Date().toISOString() })
  return card
}

/** The source's label, created on first use; KanEO answers a known name with the label that already exists. */
async function ensureLabel(client: KaneoClient, account: InboxAccount, source: string, signal?: AbortSignal): Promise<{ id: string; name: string }> {
  const workspaceId = account.workspaceId || await firstWorkspace(client, signal)
  const label = await client.createLabel(inboxLabel(source), LABEL_COLORS[source] ?? '#64748b', workspaceId, { signal })
  return { id: label.id, name: label.name }
}

/** The workspace of the API key; labels live in a workspace. */
async function firstWorkspace(client: KaneoClient, signal?: AbortSignal): Promise<string> {
  const workspaces = await client.workspaces({ signal })
  const id = workspaces[0]?.id
  if (!id) throw new Error('Kaneo has no workspace for this API key')
  return id
}
