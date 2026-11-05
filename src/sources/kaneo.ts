/**
 * Kanban Source kind: a Kanban project board whose watched column is the stream of requests. A task in a watched column is
 * one explicit request and one Thread (`kaneo:<taskId>`); replies go back as task comments, and the task moves to the
 * claim column when the post first writes to it. The plugin entry polls each watched column on an interval.
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { KV } from '../kv.ts'
import { storedKaneoAccount } from './bdd-storage.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import { KaneoClient } from './kaneo-api.ts'
import { DEFAULT_BASE_URL, DEFAULT_CLAIM_COLUMN, DEFAULT_PROJECT, DEFAULT_WATCH_COLUMNS, KaneoConfigSchema, requiredLabelsOf,
  watchColumnsOf, type KaneoConfig } from './kaneo-config.ts'
import { kaneoLink, sendKaneo } from './kaneo-channel.ts'
import { kaneoThreadContext } from './kaneo-read.ts'
import { labelled, kaneoThreadKey, kaneoTrigger, KaneoTaskSchema } from './kaneo-trigger.ts'
import type { Localized, SourceKind } from './kind.ts'
import { pause } from './poll.ts'

export const SOURCE = 'kaneo'

const columns = (config: KaneoConfig): string => watchColumnsOf(config).join(', ') || 'no column'

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
  find: query => {
    const id = /^kaneo[:/]([A-Za-z0-9_-]{8,})$/.exec(query.trim())?.[1]
    return { threads: id ? [kaneoThreadKey(id)] : [], terms: [] }
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict()).default([]),
    }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起任务的 Kanban 用户', en: 'Kanban users that may originate work' },
      hint: { zh: '任务进入监听列时，由任务的负责人或创建者作为发起人；不在名单里的任务会被过滤，可在来源页看到。', en: 'A task is requested by its assignee or creator when it enters a watched column; a task whose actor is not listed is filtered and shown on the Sources page.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '用户 id', en: 'User id' } }, { key: 'name', type: 'text', label: { zh: '名称（可选）', en: 'Name (optional)' }, optional: true }] }],
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
  ctx.report('kaneo', { state: 'ready', detail: `${received} new tasks from ${columns(config)}; next poll ≥ ${config.pollSeconds}s`, at: started })
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
