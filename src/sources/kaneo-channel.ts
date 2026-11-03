/** Kaneo outbound Channel: replies become task comments, with an HTML marker so a retried send does not comment twice. */
import type { OutboundMessage } from '../core/index.ts'
import type { SourceContext } from './host.ts'
import { KaneoClient, KaneoError } from './kaneo-api.ts'
import { KaneoCommentSchema } from './kaneo-trigger.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'

/** Kaneo's comment length limit with headroom for the marker; longer replies are cut rather than refused. */
const COMMENT_CHARS = 9000
/** A task that a reply can no longer reach: deleted or inaccessible. */
const gone = (error: unknown): boolean => error instanceof KaneoError && (error.status === 403 || error.status === 404)

/** Posts a reply as a task comment, checking for an earlier attempt with the same marker first so Outbox retries stay idempotent. */
export async function sendKaneo(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
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
    await client.comment(taskId, text)
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
