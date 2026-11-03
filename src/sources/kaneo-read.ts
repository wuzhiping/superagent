/** Thread context reader for Kaneo: a task's description and its comments, as the assessments read them. */
import type { ContextMessage, ContextPart, ContextPartName, ThreadContext } from './kind.ts'
import { KaneoClient } from './kaneo-api.ts'
import type { KaneoConfig } from './kaneo-config.ts'
import { kaneoRef, KaneoCommentSchema, KaneoTaskSchema } from './kaneo-trigger.ts'
import type { Trigger } from '../core/index.ts'

const taskOf = async (client: KaneoClient, taskId: string): Promise<{ id: string; title: string; status: string; description: string; createdAt?: string; assigneeName?: string | null; labels: { name: string }[]; priority?: string | null }> => {
  const parsed = KaneoTaskSchema.safeParse(await client.task(taskId))
  if (!parsed.success) throw new Error(`Kaneo returned an unreadable task ${taskId}`)
  const task = parsed.data
  return { id: task.id, title: task.title, status: task.status, description: task.description ?? '', createdAt: task.createdAt,
    assigneeName: task.assigneeName, labels: task.labels, priority: task.priority }
}
const commentOf = (value: unknown): ContextMessage | undefined => {
  const parsed = KaneoCommentSchema.safeParse(value)
  if (!parsed.success) return undefined
  const comment = parsed.data
  return { id: comment.id, from: comment.user?.name ?? comment.userId ?? 'Kaneo', at: comment.createdAt ?? '', text: comment.content }
}

/**
 * Reads a task: `root` is its description, `thread` its description followed by its comments, `parent` falls back to the
 * description because a Kaneo task has no replied-to conversation. One page is returned; cursors are ignored.
 */
export const kaneoThreadContext: ThreadContext<KaneoConfig> = {
  messageId: (trigger: Trigger) => trigger.id,
  async read(_commands, trigger: Trigger, part: ContextPartName, _cursor: string | undefined, config: KaneoConfig): Promise<ContextPart> {
    const ref = kaneoRef(trigger)
    if (!ref) throw new Error('This Trigger is not a Kaneo task')
    const client = new KaneoClient(config)
    if (part === 'parent') return onlyDescription(client, ref.taskId)
    const task = await taskOf(client, ref.taskId)
    const description: ContextMessage = { id: `${task.id}:description`, from: task.assigneeName ?? task.title ?? 'Kaneo',
      at: task.createdAt ?? '', text: task.description || '(the task has no description)' }
    if (part === 'root') return { messages: [description], body: bodyOf(task), status: task.status }
    const comments = (await client.comments(ref.taskId)).flatMap(value => { const message = commentOf(value); return message ? [message] : [] })
    return { messages: [description, ...comments], body: bodyOf(task), status: task.status }
  },
}

const bodyOf = (task: { title: string; status: string; labels: { name: string }[]; priority?: string | null }): Record<string, unknown> =>
  ({ title: task.title, status: task.status, labels: task.labels.map(label => label.name), ...task.priority ? { priority: task.priority } : {} })

async function onlyDescription(client: KaneoClient, taskId: string): Promise<ContextPart> {
  const task = await taskOf(client, taskId)
  return { messages: [{ id: `${task.id}:description`, from: task.assigneeName ?? task.title ?? 'Kaneo', at: task.createdAt ?? '',
    text: task.description || '(the task has no description)' }], body: bodyOf(task), status: task.status }
}
