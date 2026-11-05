/** Normalizes Kanban tasks into domain Triggers, Thread keys and Channel addresses; the task is the Thread. */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import { kaneoTaskUrl, type KaneoConfig } from './kaneo-config.ts'

export const SOURCE = 'kaneo'
/** Bound of the task text carried by a Trigger; the full description is read through the Thread context. */
const TEXT_CHARS = 4000

/** One task as Kanban returns it in a board listing or by id; unknown fields are kept for forward compatibility. */
export const KaneoTaskSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().default(''),
  number: z.number().int().optional(),
  description: z.string().nullish(),
  descriptionDeferred: z.boolean().optional(),
  status: z.string().default(''),
  columnId: z.string().optional(),
  priority: z.string().nullish(),
  startDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  position: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  userId: z.string().nullish(),
  assigneeId: z.string().nullish(),
  assigneeName: z.string().nullish(),
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
  labels: z.array(z.looseObject({ id: z.string().optional(), name: z.string(), color: z.string().optional() })).default([]),
})
export type KaneoTask = z.infer<typeof KaneoTaskSchema>

/** A task and its comments as the Thread context reader returns them. */
export const KaneoCommentSchema = z.looseObject({
  id: z.string().min(1),
  taskId: z.string().optional(),
  userId: z.string().nullish(),
  content: z.string().default(''),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  user: z.looseObject({ name: z.string().nullish(), image: z.string().nullish() }).nullish(),
})
export type KaneoComment = z.infer<typeof KaneoCommentSchema>

export const kaneoThreadKey = (taskId: string): string => `${SOURCE}:${taskId}`
/** Deterministic Trigger id: one task is one request, so repeated polls and restarts produce the same id. */
export const kaneoTriggerId = (taskId: string): string => key('kaneo', taskId)
/** The actor of a task: its assignee when set, else its creator, else the configured fallback id. */
export const kaneoActorId = (task: Pick<KaneoTask, 'assigneeId' | 'userId'>): string | undefined => task.assigneeId ?? task.userId ?? undefined

/** The Channel of a task: its comments, with the web address kept in the address for links. */
export const kaneoChannel = (config: Pick<KaneoConfig, 'baseUrl' | 'projectId' | 'workspaceId'>, task: Pick<KaneoTask, 'id' | 'number'>): ChannelRef => ({
  source: SOURCE, thread: task.id, address: { taskId: task.id, url: kaneoTaskUrl(config, task) },
})

const clamp = (value: string): string => value.length <= TEXT_CHARS ? value : `${value.slice(0, TEXT_CHARS)}…`

/** The text a Trigger carries: the task number and title, then the beginning of its description. */
export function kaneoText(task: KaneoTask): string {
  const heading = task.number ? `#${task.number} ${task.title}` : task.title
  const description = clamp((task.description ?? '').trim())
  return description ? `${heading}\n\n${description}` : heading
}

/**
 * Converts a task that entered a watched column into a Trigger. A person placing the task on the board is an explicit
 * request (`addressed: 'direct'`); the actor is the assignee, its creator or the fallback id, and the whole task is one Thread.
 */
export function kaneoTrigger(task: KaneoTask, config: KaneoConfig, at: string): Trigger {
  const actor = kaneoActorId(task) ?? config.actorFallback ?? 'kaneo'
  return {
    id: kaneoTriggerId(task.id),
    source: SOURCE,
    threads: [{ source: SOURCE, id: task.id }],
    actor: { source: SOURCE, id: actor },
    human: true,
    addressed: 'direct',
    at: task.updatedAt ?? task.createdAt ?? at,
    text: kaneoText(task),
    channel: kaneoChannel(config, task),
    url: kaneoTaskUrl(config, task),
    meta: {
      taskId: task.id,
      projectId: task.projectId ?? config.projectId,
      ...task.number === undefined ? {} : { number: task.number },
      status: task.status,
      columnId: task.columnId,
      priority: task.priority ?? undefined,
      labels: task.labels.map(label => label.name),
      ...task.assigneeName ? { assigneeName: task.assigneeName } : {},
    },
  }
}

/** The task id of a Kanban Trigger, or undefined for another Source. */
export function kaneoRef(trigger: Trigger): { taskId: string; url?: string } | undefined {
  if (trigger.source !== SOURCE) return undefined
  const meta = trigger.meta as { taskId?: unknown }
  const taskId = typeof meta.taskId === 'string' ? meta.taskId : trigger.threads[0]?.id
  if (!taskId) return undefined
  return { taskId, ...trigger.url ? { url: trigger.url } : {} }
}

/** Whether a task carries one of the required labels (any of them); an empty list accepts every task. */
export const labelled = (task: KaneoTask, required: readonly string[]): boolean =>
  required.length === 0 || task.labels.some(label => required.includes(label.name))
