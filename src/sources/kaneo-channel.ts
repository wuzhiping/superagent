/** Kaneo outbound Channel: replies become task comments, with an HTML marker so a retried send does not comment twice. */
import type { OutboundMessage } from '../core/index.ts'
import type { SourceContext } from './host.ts'
import { KaneoClient, KaneoError } from './kaneo-api.ts'
import { KaneoCommentSchema } from './kaneo-trigger.ts'
import { claimColumnOf, doneColumnOf, type KaneoConfig } from './kaneo-config.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'

/** Kaneo's comment length limit with headroom for the marker; longer replies are cut rather than refused. */
const COMMENT_CHARS = 9000
/** A task that a reply can no longer reach: deleted or inaccessible. */
const gone = (error: unknown): boolean => error instanceof Error && error instanceof KaneoError && (error.status === 403 || error.status === 404)

/**
 * Moves the task to the claim column when the post first writes to it about a duty: the claim belongs to the duty
 * that started, not to the request that was merely read (RD.md §6.1–§6.2). A notice without a duty never claims.
 */
async function claim (client: KaneoClient, taskId: string, config: KaneoConfig | undefined): Promise<void> {
  await move(client, taskId, claimColumnOf(config))
}

/**
 * Moves the task to the delivery column when the post delivers its result: the post advances the card, so a duty
 * that waits for the card to close does not wait forever (RD.md §6.2).
 */
async function deliver (client: KaneoClient, taskId: string, config: KaneoConfig | undefined): Promise<void> {
  await move(client, taskId, doneColumnOf(config))
}

/** Moves the task to `column` when it is set and the task is not there already. */
async function move (client: KaneoClient, taskId: string, column: string): Promise<void> {
  if (!column) return
  try {
    const task = await client.task(taskId) as { status?: string }
    if (task?.status === column) return
    await client.move(taskId, column)
  } catch {
    // A card that cannot be moved stays where it is; the reply itself still goes through.
  }
}

/** Posts a reply as a task comment, checking for an earlier attempt with the same marker first so Outbox retries stay idempotent. */
export async function sendKaneo(host: Pick<SourceContext, 'commands' | 'config'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const account = host.commands.deployment.kaneo
  if (!account?.apiKey) throw new Error('The Kaneo Source has no API key configured')
  const taskId = message.channel.address.taskId
  if (!taskId) throw new Error('Missing Kaneo reply target')
  const client = new KaneoClient(account)
  const marker = `<!-- dsh-superagent:${message.id} -->`
  try {
    const comments = await client.comments(taskId)
    const mine = comments.some(item => {
      const parsed = KaneoCommentSchema.safeParse(item)
      return parsed.success && parsed.data.content.includes(marker)
    })
    if (mine) return 'sent'
    const text = `${message.text.slice(0, COMMENT_CHARS)}\n\n${marker}`
    const config = host.config('kaneo') as KaneoConfig | undefined
    // Only a message about a duty claims the card; a notice that nobody acted on leaves it where it is.
    if (message.ticketId) await claim(client, taskId, config)
    await client.comment(taskId, text)
    // The result of a duty advances the card: the post moves the work along its own flow.
    if (message.kind === 'reply' && message.ticketId) await deliver(client, taskId, config)
    return 'sent'
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
}

/** The task page of a Channel address; the address carries the URL because link() receives no Source configuration. */
export function kaneoLink(address: Record<string, string>, _links: ChannelLinks): ChannelLink {
  return { url: address.url ?? '', label: { zh: 'Kaneo 任务', en: 'Kaneo task' } }
}
