/**
 * Kanban Source kind: a Kanban project board whose watched column is the stream of requests. A task in a watched column is
 * one explicit request and one Thread (`kaneo:<taskId>`); replies go back as task comments, and the task moves to the
 * claim column when the post first writes to it. The plugin entry polls each watched column on an interval.
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import { storedKaneoAccount } from './bdd-storage.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import { KaneoClient } from './kaneo-api.ts'
import { DEFAULT_BASE_URL, DEFAULT_CLAIM_COLUMN, DEFAULT_PROJECT, DEFAULT_WATCH_COLUMNS, KaneoConfigSchema, kaneoTaskUrl,
  requiredLabelsOf, watchColumnsOf, cancelColumnsOf, type KaneoConfig } from './kaneo-config.ts'
import { kaneoLink, sendKaneo } from './kaneo-channel.ts'
import { kaneoThreadContext } from './kaneo-read.ts'
import { kaneoActorId, kaneoChannel, labelled, kaneoThreadKey, kaneoTrigger, KaneoCommentSchema,
  KaneoTaskSchema, type KaneoComment, type KaneoTask } from './kaneo-trigger.ts'
import type { Localized, SourceKind } from './kind.ts'
import { pause } from './poll.ts'

export const SOURCE = 'kaneo'

const columns = (config: KaneoConfig): string => watchColumnsOf(config).join(', ') || 'no column'

/**
 * The workspace whose members the Policy roster reads: the configured workspace, else the watched project's workspace, else
 * the first workspace the account can see. Members' ids are the assignee/creator ids the board reports as actors.
 */
export async function policyWorkspace (client: KaneoClient, config: KaneoConfig, signal?: AbortSignal): Promise<string | undefined> {
  const configured = config.workspaceId.trim()
  if (configured) return configured
  const projectId = config.projectId.trim()
  if (projectId) {
    const project = await client.project(projectId, { signal }).catch(() => undefined)
    if (project?.workspaceId) return project.workspaceId
  }
  return (await client.workspaces({ signal }).catch(() => []))[0]?.id
}

/**
 * Refreshes the Kanban member roster (`id -> name`) the Policy's "who may originate work" column chooses from, and stores
 * it for the panel. A missing account or workspace answers an empty roster instead of failing the panel.
 */
export async function refreshKaneoMembers (ctx: SourceContext, signal?: AbortSignal): Promise<Record<string, string>> {
  const config = ctx.config<KaneoConfig>(SOURCE)
  if (!config) return {}
  const deployed = ctx.deployment.kaneo
  const account = deployed?.apiKey ? deployed : storedKaneoAccount(deployed?.baseUrl ?? config.baseUrl ?? DEFAULT_BASE_URL)
  if (!account?.apiKey) return {}
  const client = new KaneoClient(account)
  const workspaceId = await policyWorkspace(client, config, signal)
  if (!workspaceId) return {}
  const members = await client.workspaceMembers(workspaceId, { signal })
  const names = Object.fromEntries(members.map(member => [member.id, member.name.trim() || member.email.trim() || member.id]))
  ctx.state.set(KV.sources.labels(SOURCE), names)
  return names
}

/** The Source kind declaration: configuration form, policy part, Channel, Thread context, environment and health. */
export const kaneoKind: SourceKind<KaneoConfig> = {
  kind: SOURCE,
  title: { zh: 'Kanban 看板', en: 'Kanban board' },
  description: {
    zh: 'Kanban 项目看板的一个或多个列。任务进入监听列即成为一次明确的请求；抓取为工单，回复以任务评论写回，并可把任务移到认领列。',
    en: 'One or more columns of a Kanban project board. A task entering a watched column is an explicit request; it becomes a ticket, replies are posted as task comments, and the task may move to a claim column.',
  },
  schema: KaneoConfigSchema,
  /** Settings-panel probe: read the entered project board with the entered API key, without saving. */
  async test(config: KaneoConfig): Promise<void> {
    if (!config.apiKey) throw new Error('The API key is required')
    await new KaneoClient(config).board(config.projectId)
  },
  fields: [
    { key: 'baseUrl', type: 'text', label: { zh: 'Kanban 服务器', en: 'Kanban server' },
      hint: { zh: '例如 https://pl.feg.cn。保存时检查接口与密钥，然后重启 dsh-superagent。', en: 'For example https://pl.feg.cn. Saving checks the API and key, then restarts dsh-superagent.' } },
    { key: 'apiKey', type: 'password', label: { zh: 'Kanban API key', en: 'Kanban API key' },
      hint: { zh: 'Kanban 后台 → Settings → API keys 创建，留空到期日即永不过期。密钥只用于宿主进程，不进入提示词或 Session 文本；留空表示不修改。', en: 'Create one in Kanban Settings → API keys with no expiry. The key is used by the host process only; it never enters prompts or Session text. Leave empty to keep it.' } },
    { key: 'projectId', type: 'pick', from: 'projects', label: { zh: '项目', en: 'Project' },
      hint: { zh: '从这台 Host 的 Kanban 账号能看到的项目里选一个；选中会把项目 id、名称、slug 一起填好，工作区也随之确定。',
        en: 'Pick one of the projects this Host\'s Kanban account can see; the choice fills in the project id, name and slug, and the workspace follows.' } },
    { key: 'watchColumns', type: 'text', label: { zh: '监听的列（slug，逗号分隔）', en: 'Watched columns (slugs, comma separated)' },
      hint: { zh: '默认 ready（待開工）。任务进入这些列才成为请求。', en: 'Defaults to ready. Only tasks entering these columns become requests.' } },
    { key: 'ingestEvents', type: 'switch', label: { zh: '其它来源先入库成卡', en: 'File other sources as cards' },
      hint: { zh: '打开（默认）：Gitea/ntfy 等其它来源的事件先在本项目的 to-do 列建卡，由看板统一调度；关闭：其它来源的事件直接成为请求（旧行为）。',
        en: 'On (default): events of other Sources such as Gitea and ntfy become cards in the to-do column of this project first, and the board schedules them; off: those events become requests directly (the old behavior).' } },
    { key: 'claimColumn', type: 'text', label: { zh: '认领列（slug）', en: 'Claim column (slug)' },
      hint: { zh: '岗位第一次就这张卡回写时把任务移到这里，默认 in-progress（進行中）；留空表示不移动。', en: 'The task moves here when the post first writes to it; defaults to in-progress. Empty never moves a task.' } },
    { key: 'doneColumn', type: 'text', label: { zh: '交付列（slug）', en: 'Delivery column (slug)' },
      hint: { zh: '岗位交付结果（回写工作日志）后把任务移到这里，按看板流程填 done 或 in-review；留空表示不移动。', en: 'The task moves here when the post delivers its result; fill in done or in-review to match the board flow. Empty never moves a task.' } },
    { key: 'blockedColumn', type: 'text', label: { zh: '待裁决列（slug）', en: 'Waiting-for-decision column (slug)' },
      hint: { zh: '工单报告 blocked/failed、等 PM 裁决时把卡移到这里；裁决到达、工单恢复后移回认领列。留空表示不移动（裁决仍可通过评论/描述送达）。', en: 'While a ticket reports blocked/failed and waits for a decision the card moves here; it moves back to the claim column once the ticket runs again. Empty never moves the card (a decision can still arrive through comments/description).' } },
    { key: 'holdLabel', type: 'text', label: { zh: '等待标签（hold label）', en: 'Hold label' },
      hint: { zh: '工单等 PM 裁决时给卡自动打上这个标签（默认 blocked）；PM 在卡上写裁决、然后移除该标签，工单会用同一个 Session 恢复。留空表示不使用标签。', en: 'While a ticket waits for a decision the card gets this label (default blocked); the person writes the decision on the card and removes the label, which resumes the ticket in the same Session. Empty disables the label.' } },
    { key: 'cancelColumns', type: 'text', label: { zh: '取消列（slug，逗号分隔）', en: 'Cancel columns (slugs, comma separated)' },
      hint: { zh: '卡进入这些列即视为看板侧取消，对应工单会被停止（默认 canceled,cancelled）；卡被删除时同样停止。留空表示不监听取消。', en: 'A card in one of these columns counts as canceled on the board and its ticket is stopped (default canceled,cancelled); a deleted card stops it too. Empty disables cancellation.' } },
    { key: 'observeUpdates', type: 'switch', label: { zh: '观察执行中的卡片变化', en: 'Watch cards while they run' },
      hint: { zh: '打开（默认）：已有运行中工单的卡片若新增评论、改了标题或描述，会作为输入投递给运行中的 Session，不丢失最新反馈；关闭：只在卡片进入监听列时触发。', en: 'On (default): a comment, title or description change on a card whose ticket is running is delivered as an input to the running Session; off: only a card entering a watched column triggers.' } },
    { key: 'bootstrap', type: 'select', label: { zh: '首次轮询', en: 'First poll' },
      hint: { zh: 'skip：把监听列里已有的任务记为已见、不产生请求（推荐，避免一次抓爆整列）；trigger：把已有任务也当作请求。', en: 'skip records tasks already in the watched columns without requesting them (recommended); trigger treats them as requests too.' },
      options: [{ value: 'skip', label: { zh: '跳过已有任务', en: 'Skip existing tasks' } }, { value: 'trigger', label: { zh: '已有任务也触发', en: 'Trigger existing tasks' } }] },
    { key: 'requiredLabels', type: 'text', label: { zh: '只要这些标签的任务（逗号分隔）', en: 'Only tasks with these labels (comma separated)' },
      hint: { zh: '留空表示不限。例如 sprint-2026-W56 或 ai:。', en: 'Empty accepts every task; for example sprint-2026-W56 or ai:.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 15, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' },
      hint: { zh: 'API key 每分钟 100 次，默认 60 秒。', en: 'An API key is limited to 100 requests a minute; the default is 60 seconds.' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' },
      hint: { zh: '单次网络中断会在下一次轮询时自动重试。', en: 'A single network interruption is retried on the next poll.' } },
    { key: 'maxTasksPerColumn', type: 'number', advanced: true, min: 1, max: 200, label: { zh: '每列每次最多读取', en: 'Tasks read per column each poll' } },
    { key: 'workspaceId', type: 'pick', from: 'workspaces', advanced: true, label: { zh: '工作区', en: 'Workspace' },
      hint: { zh: '项目所在的工作区：选项目时会自动填好，一般不用手改。', en: 'The workspace the project lives in: filled in when a project is picked.' } },
    { key: 'actorFallback', type: 'text', advanced: true, label: { zh: '无负责人/创建者时的 actor', en: 'Actor when a task has no assignee or creator' } },
  ],
  // A task is already the whole request, so the Source listens to every Trigger it produces and observes nothing.
  scope: () => ({ listened: true, observed: false }),
  health: ['kaneo'],
  channel: { send: sendKaneo, link: kaneoLink },
  threadContext: kaneoThreadContext,
  /** The Policy roster offers board members instead of asking for raw ids. */
  refreshLabels: (host, signal) => refreshKaneoMembers(sourceContext(host, kaneoKind), signal),
  find: query => {
    const id = /^kaneo[:/]([A-Za-z0-9_-]{8,})$/.exec(query.trim())?.[1]
    return { threads: id ? [kaneoThreadKey(id)] : [], terms: [] }
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict()).default([]),
    }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起任务的 Kanban 用户', en: 'Kanban users that may originate work' },
      hint: { zh: '任务进入监听列时，由任务的负责人或创建者作为发起人；不在名单里的任务会被过滤，可在来源页看到。点「刷新成员」读取看板成员后即可直接选择，不需要手填 id。', en: 'A task is requested by its assignee or creator when it enters a watched column; a task whose actor is not listed is filtered and shown on the Sources page. Refresh the members to choose from the board roster instead of typing ids.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '用户 id', en: 'User id' },
        choose: { zh: '选择看板成员', en: 'Choose a board member' }, refresh: { zh: '刷新成员', en: 'Refresh members' } },
        { key: 'name', type: 'text', label: { zh: '名称（可选）', en: 'Name (optional)' }, optional: true }] }],
    explicit: { zh: '名单里的用户在 Kanban 看板上把任务放进监听列。', en: 'A user on the list puts a task into a watched Kanban column.' },
    rows(stored) {
      const config = KaneoConfigSchema.partial().parse(stored)
      const slugs = watchColumnsOf({ watchColumns: config.watchColumns ?? DEFAULT_WATCH_COLUMNS })
      return slugs.map(slug => ({ id: slug, label: { zh: `列 ${slug}`, en: `Column ${slug}` }, note: { zh: '任务放入即请求', en: 'A placed task is a request' },
        cells: { listedUnaddressed: true, unlistedAddressed: false, unlistedUnaddressed: false } }))
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_KANEO_PROJECT', description: { zh: '这个工单来自的 Kanban 项目 id', en: 'Kanban project id the ticket came from' } },
      { key: 'DSH_SUPERAGENT_KANEO_TASK', description: { zh: '工单对应的 Kanban 任务 id', en: 'Kanban task id behind the ticket' } },
      { key: 'DSH_SUPERAGENT_KANEO_NUMBER', description: { zh: '任务的票号（没有时为空）', en: 'The task number (empty when it has none)' } },
      { key: 'DSH_SUPERAGENT_KANEO_STATUS', description: { zh: '任务当前所在列的 slug', en: 'Slug of the column the task is in' } },
      { key: 'DSH_SUPERAGENT_KANEO_URL', description: { zh: '任务在看板上的页面地址', en: 'The task page on the board' } },
    ],
    values: ({ deployment, trigger }) => {
      const meta = trigger?.source === SOURCE ? trigger.meta : {}
      return {
        DSH_SUPERAGENT_KANEO_PROJECT: deployment.kaneo?.projectId ?? '',
        DSH_SUPERAGENT_KANEO_TASK: typeof meta.taskId === 'string' ? meta.taskId : '',
        DSH_SUPERAGENT_KANEO_NUMBER: typeof meta.number === 'number' ? String(meta.number) : '',
        DSH_SUPERAGENT_KANEO_STATUS: typeof meta.status === 'string' ? meta.status : '',
        DSH_SUPERAGENT_KANEO_URL: trigger?.source === SOURCE ? trigger.url ?? '' : '',
      }
    },
  },
  facts: (deployment): Record<string, Localized | string> => deployment?.kaneo
    ? { project: { zh: `项目 ${deployment.kaneo.projectId}`, en: `Project ${deployment.kaneo.projectId}` }, server: { zh: deployment.kaneo.baseUrl, en: deployment.kaneo.baseUrl } }
    : {},
}

/** The health entry of consecutive poll failures. */
const failing = (count: number, error: unknown): Health => health('error', 'pollFailures', { count: String(count), error: String(error) })

/** One card's observed state: title, description, column, labels, and a content hash per comment so a poll can diff it. */
interface ObservedCard { title: string; description: string; status: string; labels: string[]; comments: { id: string; hash: string }[] }

const commentHash = (comment: Pick<KaneoComment, 'id' | 'updatedAt' | 'content'>): string =>
  key('kaneo-comment', comment.id, comment.updatedAt ?? '', comment.content)

const observedCard = (task: KaneoTask, comments: readonly KaneoComment[]): ObservedCard => ({
  title: task.title,
  description: task.description ?? '',
  status: task.status,
  labels: task.labels.map(label => label.name),
  comments: comments.map(comment => ({ id: comment.id, hash: commentHash(comment) })),
})

const serializeCard = (card: ObservedCard): string => JSON.stringify(card)

/** A stored card snapshot; a malformed or older value is ignored so the next poll simply re-baselines. */
const parseObservedCard = (value: string | undefined): ObservedCard | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<ObservedCard>
    if (typeof parsed?.title !== 'string' || typeof parsed?.description !== 'string' || !Array.isArray(parsed.comments)) return undefined
    const comments = parsed.comments.flatMap(item => typeof item?.id === 'string' && typeof item?.hash === 'string'
      ? [{ id: item.id, hash: item.hash }] : [])
    return { title: parsed.title, description: parsed.description, status: typeof parsed.status === 'string' ? parsed.status : '',
      labels: Array.isArray(parsed.labels) ? parsed.labels.filter((label): label is string => typeof label === 'string') : [], comments }
  } catch { return undefined }
}

/** Reads the comments of a task; a failed comment read means "no comments" so a card edit still gets through. */
const taskComments = async (client: KaneoClient, taskId: string, signal?: AbortSignal): Promise<KaneoComment[]> => {
  const raw = await client.comments(taskId, { signal })
  return raw.flatMap(value => { const parsed = KaneoCommentSchema.safeParse(value); return parsed.success ? [parsed.data] : [] })
}

/** What changed on a card since the previous observation, ignoring comments the Host itself wrote. */
function cardChanges (previous: ObservedCard, current: ObservedCard, comments: readonly KaneoComment[], hostId: string): string | undefined {
  const known = new Map(previous.comments.map(comment => [comment.id, comment.hash]))
  const fresh = comments.filter(comment => comment.userId !== hostId
    && known.get(comment.id) !== commentHash(comment))
  const titleChanged = previous.title !== current.title
  const descriptionChanged = previous.description !== current.description
  const statusChanged = !!previous.status && previous.status !== current.status
  if (!titleChanged && !descriptionChanged && !statusChanged && !fresh.length) return undefined
  const parts: string[] = []
  if (statusChanged) parts.push(`卡片列更新：${previous.status} → ${current.status}`)
  if (titleChanged) parts.push(`标题更新：${current.title}`)
  if (descriptionChanged) parts.push(`描述更新：\n${current.description.trim() || '(空)'}`)
  if (fresh.length) parts.push(fresh.map(comment => `${comment.user?.name ?? comment.userId ?? 'Kanban'}：${comment.content}`).join('\n\n'))
  return parts.join('\n\n')
}

/** A Trigger for an update on a card whose ticket is already running: it reaches the ticket as an Input, not as a new request. */
const UPDATE_CHARS = 4000
function kaneoUpdateTrigger (task: KaneoTask, config: KaneoConfig, text: string, fingerprint: string, at: string, holdLifted = false): Trigger {
  const actor = kaneoActorId(task) ?? config.actorFallback ?? 'kaneo'
  const limited = text.length <= UPDATE_CHARS ? text : `${text.slice(0, UPDATE_CHARS)}…`
  return {
    id: key('kaneo-update', task.id, fingerprint),
    source: SOURCE,
    threads: [{ source: SOURCE, id: task.id }],
    actor: { source: SOURCE, id: actor },
    human: true,
    addressed: 'direct',
    at,
    text: `#${task.number ?? ''} ${task.title}\n\n${limited}`.trim(),
    channel: kaneoChannel(config, task),
    url: kaneoTaskUrl(config, task),
    meta: {
      taskId: task.id,
      update: true,
      ...holdLifted ? { holdLifted: true } : {},
      projectId: task.projectId ?? config.projectId,
      ...task.number === undefined ? {} : { number: task.number },
      status: task.status,
      labels: task.labels.map(label => label.name),
      ...task.assigneeName ? { assigneeName: task.assigneeName } : {},
    },
  }
}

/**
 * Cancels a ticket whose request disappeared on the board: the card lands in a cancel column, or the card itself is gone
 * (404). The ticket ends as a person-stopped duty with the reason, so the SuperAgent side matches the board.
 */
export async function syncCancellations (ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<void> {
  const columns = cancelColumnsOf(config)
  if (!columns.length) return
  for (const ticket of ctx.tickets.open()) {
    if (signal?.aborted || !ctx.config(SOURCE)) return
    const origin = ctx.triggers.get(ticket.origin.triggerId)
    const thread = origin?.threads.find(ref => ref.source === SOURCE)
    if (!thread) continue
    try {
      const parsed = KaneoTaskSchema.safeParse(await client.task(thread.id, { signal }))
      if (parsed.success && columns.includes(parsed.data.status)) ctx.cancel(ticket.id, 'card_canceled')
    } catch (error) {
      // A deleted card means the request is gone; a transient read failure does not.
      if ((error as { status?: number }).status === 404) ctx.cancel(ticket.id, 'card_deleted')
    }
  }
}

/**
 * Marks a card whose ticket waits for a person with the hold label, so the board shows the hold and the release is a board
 * action: the person writes the decision on the card and removes the label. The host never removes it itself.
 */
export async function syncHoldLabels (ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<void> {
  const hold = config.holdLabel
  if (!hold) return
  for (const ticket of ctx.tickets.open()) {
    if (signal?.aborted || !ctx.config(SOURCE)) return
    const origin = ctx.triggers.get(ticket.origin.triggerId)
    const thread = origin?.threads.find(ref => ref.source === SOURCE)
    if (!thread) continue
    const latest = ticket.assignments.at(-1)
    const waiting = !!ticket.attention || latest?.report?.state === 'blocked' || latest?.report?.state === 'failed'
    if (!waiting) continue
    try {
      const parsed = KaneoTaskSchema.safeParse(await client.task(thread.id, { signal }))
      if (!parsed.success) continue
      const task = parsed.data
      if (task.labels.some(label => label.name === hold)) continue
      const workspaceId = task.workspaceId ?? config.workspaceId
      if (!workspaceId) continue
      let labelId = ctx.state.get(KV.kaneo.holdLabel(workspaceId))
      if (!labelId) {
        const label = await client.createLabel(hold, 'd73a4a', workspaceId, { signal })
        labelId = label.id
        ctx.state.set(KV.kaneo.holdLabel(workspaceId), labelId)
      }
      await client.attachLabel(labelId, thread.id, { signal })
    } catch { /* a card that cannot be marked stays as it is */ }
  }
}

/**
 * Keeps the card's column in step with a hold: a ticket that waits for a person moves its card to `blockedColumn`, and one
 * that runs again moves it back to the claim column. The move is cosmetic — the decision itself reaches the Session as an
 * Input through observation. Empty `blockedColumn` disables the move entirely.
 */
export async function syncBlockedColumns (ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<void> {
  if (!config.blockedColumn) return
  for (const ticket of ctx.tickets.open()) {
    if (signal?.aborted || !ctx.config(SOURCE)) return
    const origin = ctx.triggers.get(ticket.origin.triggerId)
    const thread = origin?.threads.find(ref => ref.source === SOURCE)
    if (!thread) continue
    const latest = ticket.assignments.at(-1)
    const waiting = !!ticket.attention || latest?.report?.state === 'blocked' || latest?.report?.state === 'failed'
    const running = latest?.state === 'running' || latest?.state === 'pending'
    const target = waiting ? config.blockedColumn : running && config.claimColumn ? config.claimColumn : ''
    if (!target) continue
    try {
      const task = KaneoTaskSchema.safeParse(await client.task(thread.id, { signal }))
      if (!task.success || task.data.status === target) continue
      await client.move(thread.id, target)
    } catch { /* a card that cannot be moved stays where it is */ }
  }
}

/**
 * Polls the cards of live tickets and turns a comment, title or description change into an Input for the running
 * assignment. Kanban itself only requests a task when it enters a watched column, so this is what keeps feedback written
 * on the card from being lost while a post is already working on it. The first look only records a baseline.
 */
export async function observeCards (ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<number> {
  if (!config.observeUpdates) return 0
  const open = ctx.tickets.open()
  if (!open.length) return 0
  const me = await client.me({ signal }).catch(() => undefined)
  if (!me) return 0
  let delivered = 0
  for (const ticket of open) {
    if (signal?.aborted || !ctx.config(SOURCE)) break
    const origin = ctx.triggers.get(ticket.origin.triggerId)
    const thread = origin?.threads.find(ref => ref.source === SOURCE)
    if (!thread) continue
    const taskId = thread.id
    let task: KaneoTask | undefined
    try {
      const parsed = KaneoTaskSchema.safeParse(await client.task(taskId, { signal }))
      if (parsed.success) task = parsed.data
    } catch { task = undefined }
    if (!task) continue
    // A failed comment read means the card is not fully observed this round: skip it instead of treating old comments as new.
    const comments = await taskComments(client, taskId, signal).catch(() => undefined)
    if (!comments) continue
    const current = observedCard(task, comments)
    const serialized = serializeCard(current)
    const hold = config.holdLabel
    // While the hold keeps the card waiting, keep the pre-hold baseline: the decision written on the card must reach the
    // worker when the label is removed, not before.
    if (hold && current.labels.includes(hold)) { ctx.state.set(KV.kaneo.holdSeen(taskId), '1'); continue }
    const previous = parseObservedCard(ctx.state.get(KV.kaneo.observe(taskId)))
    if (!previous) { ctx.state.set(KV.kaneo.observe(taskId), serialized); continue }
    const heldSeen = ctx.state.get(KV.kaneo.holdSeen(taskId)) === '1'
    const lifted = !!hold && (heldSeen || previous.labels.includes(hold))
    if (heldSeen) ctx.state.set(KV.kaneo.holdSeen(taskId), undefined)
    const changes = cardChanges(previous, current, comments, me.id)
    const text = lifted ? [changes, `看板已解除「${hold}」标记，工单可以继续。`].filter(Boolean).join('\n\n') : changes
    if (!text) { ctx.state.set(KV.kaneo.observe(taskId), serialized); continue }
    await ctx.receive(kaneoUpdateTrigger(task, config, text, serialized, new Date().toISOString(), lifted))
    ctx.state.set(KV.kaneo.observe(taskId), serialized)
    delivered += 1
  }
  return delivered
}


/**
 * One polling round: read each watched column, record a Trigger for a task not seen before, describe its Thread, and move
 * it to the claim column. The first round under `bootstrap: 'skip'` only records what is already there. A failed column is
 * reported but does not stop the others; once every column has been tried, a failure makes the round fail so health sees it.
 */
export async function pollRound(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<number> {
  const watched = watchColumnsOf(config)
  const labels = requiredLabelsOf(config)
  const bootstrapped = ctx.state.get(KV.kaneo.bootstrap) === true
  const started = new Date().toISOString()
  const failures: string[] = []
  let received = 0
  let observed = 0
  if (config.observeUpdates) {
    try { observed = await observeCards(ctx, config, client, signal) }
    catch (error) { if (!signal?.aborted) failures.push(`observe: ${String(error)}`) }
  }
  if (config.blockedColumn) {
    try { await syncBlockedColumns(ctx, config, client, signal) }
    catch (error) { if (!signal?.aborted) failures.push(`columns: ${String(error)}`) }
  }
  if (config.holdLabel) {
    try { await syncHoldLabels(ctx, config, client, signal) }
    catch (error) { if (!signal?.aborted) failures.push(`hold: ${String(error)}`) }
  }
  try { await syncCancellations(ctx, config, client, signal) }
  catch (error) { if (!signal?.aborted) failures.push(`cancel: ${String(error)}`) }
  for (const slug of watched) {
    try {
      const raw = await client.columnTasks(config.projectId, slug, config.maxTasksPerColumn, { signal })
      for (const item of raw) {
        if (signal?.aborted || !ctx.config(SOURCE)) return config.pollSeconds
        const parsed = KaneoTaskSchema.safeParse(item)
        if (!parsed.success) continue
        const task = parsed.data
        if (!labelled(task, labels)) continue
        if (ctx.state.get(KV.kaneo.seen(task.id))) continue
        if (!bootstrapped && config.bootstrap === 'skip') {
          ctx.state.set(KV.kaneo.seen(task.id), { status: task.status, at: started })
          continue
        }
        const trigger = kaneoTrigger(task, config, started)
        const result = await ctx.receive(trigger)
        ctx.state.set(KV.kaneo.seen(task.id), { status: task.status, at: started })
        ctx.threads.describe(kaneoThreadKey(task.id), {
          label: task.number === undefined ? task.title : `#${task.number} ${task.title}`,
          ...trigger.url ? { url: trigger.url } : {},
          facts: { status: { value: task.status }, ...task.priority ? { priority: { value: task.priority } } : {} },
        })
        if (result === 'filtered') continue
        if (config.observeUpdates) {
          // Start the observation baseline at the request itself, so feedback written right after acceptance still counts.
          const comments = await taskComments(client, task.id, signal).catch(() => undefined)
          if (comments) ctx.state.set(KV.kaneo.observe(task.id), serializeCard(observedCard(task, comments)))
        }
        received += 1
        // The card is not claimed here: a request that is read is not yet a duty. The post claims it when it first
        // writes to the card (the Channel moves it to the claim column), so a request nobody admitted stays untouched.
      }
      ctx.state.set(KV.kaneo.cursor(slug), new Date().toISOString())
    } catch (error) {
      if (signal?.aborted) return config.pollSeconds
      failures.push(`${slug}: ${String(error)}`)
    }
  }
  if (!bootstrapped) ctx.state.set(KV.kaneo.bootstrap, true)
  if (failures.length) throw new Error(`${failures.length} Kanban reads failed: ${failures.slice(0, 3).join('; ')}`)
  ctx.report('kaneo', { state: 'ready', detail: `${received} new tasks from ${columns(config)}${config.observeUpdates ? `, ${observed} card updates` : ''}; next poll ≥ ${config.pollSeconds}s`, at: started })
  return config.pollSeconds
}

/** Polls until aborted; setup pending and a disabled Source pause quietly, and consecutive failures surface as source health. */
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('kaneo', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<KaneoConfig>(SOURCE)
    try {
      // The key comes from the Source card, or from this Host's storage record (BDD storage): a Host needs no typed secret.
      const account = config?.apiKey ? config : config ? storedKaneoAccount(config.baseUrl) ?? config : undefined
      if (!account?.apiKey) ctx.report('kaneo', health('paused', 'sourceOff'))
      else { failures = 0; await pollRound(ctx, { ...config, ...account } as KaneoConfig, new KaneoClient(account), signal) }
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) ctx.report('kaneo', failing(failures, error))
    }
    await pause((config?.pollSeconds ?? 60) * 1000, signal)
  }
}

export const name = 'dsh-superagent-kaneo'
export const inject = ['orchestrator']
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(kaneoKind), 'kaneo: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, kaneoKind)
    const controller = new AbortController()
    // Unhandled rejections terminate the DSH process, so a failure escaping the loop is reported as source health instead.
    const running = watch(source, controller.signal).catch((error: unknown) => { source.report('kaneo', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

export { DEFAULT_BASE_URL, DEFAULT_CLAIM_COLUMN, DEFAULT_PROJECT }
