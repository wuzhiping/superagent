/**
 * Gitea Source kind: issues, pull requests and comments of a self-hosted Gitea repository (default https://git.feg.cn).
 * Addressed events are filed as cards in the KanEO board (the only direct source); the board schedules them from
 * there. It polls the agent's notifications (token) or repository-wide increments (works anonymously for public
 * repositories).
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { key, type OutboundMessage, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import type { Commands } from '../infra/commands.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { Localized, SourceKind, ThreadContext, ContextPart, ContextPartName } from './kind.ts'
import { pause } from './poll.ts'
import { GiteaClient, GiteaError, type GiteaComment, type GiteaIssue, type GiteaNotification } from './gitea-api.ts'
import { KaneoClient } from './kaneo-api.ts'
import { fileEventOnce, inboxAccount, ingestEvents, type InboxEvent } from './kaneo-inbox.ts'
import { DEFAULT_GITEA_URL, giteaBot, giteaHasAuth, GiteaConfigSchema, repositoryOf, type GiteaConfig } from './gitea-config.ts'

export const SOURCE = 'gitea'
const now = (): string => new Date().toISOString()
const clamp = (text: string, limit = 4000): string => text.length <= limit ? text : `${text.slice(0, limit)}…`

export interface GiteaRef { owner: string; repo: string; index: number }
export const giteaThreadId = (ref: GiteaRef): string => `${ref.owner}/${ref.repo}#${ref.index}`
export const giteaThreadKey = (ref: GiteaRef): string => `${SOURCE}:${giteaThreadId(ref)}`
/** Parse `gitea:owner/repo#123` back into a reference. */
export function giteaRefOfThread(keyValue: string): GiteaRef | undefined {
  const match = /^gitea:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(keyValue)
  return match ? { owner: match[1]!, repo: match[2]!, index: Number(match[3]) } : undefined
}
/** The agent's mention in free text, e.g. `@dsh-superagent`. */
const mentioned = (text: string | null | undefined, agent: string): boolean =>
  !!agent && typeof text === 'string' && text.toLowerCase().includes(`@${agent.toLowerCase()}`)

/** A Trigger's Gitea reference, from its meta (written by every trigger builder). */
export function giteaRef(trigger: Trigger): GiteaRef | undefined {
  if (trigger.source !== SOURCE) return undefined
  const meta = trigger.meta as { owner?: unknown; repo?: unknown; index?: unknown }
  if (typeof meta.owner !== 'string' || typeof meta.repo !== 'string' || typeof meta.index !== 'number') return undefined
  return { owner: meta.owner, repo: meta.repo, index: meta.index }
}

const channelOf = (ref: GiteaRef, url: string | undefined) => ({
  source: SOURCE, thread: giteaThreadId(ref), address: { owner: ref.owner, repo: ref.repo, index: String(ref.index), ...url ? { url } : {} },
})
const metaOf = (ref: GiteaRef, kind: 'issue' | 'comment' | 'notification', extra: Record<string, unknown> = {}) =>
  ({ owner: ref.owner, repo: ref.repo, index: ref.index, kind, ...extra })

/** An issue (or pull request) that was created or updated since the cursor. */
export function issueTrigger(issue: GiteaIssue, ref: GiteaRef, config: GiteaConfig, at = now()): Trigger {
  const login = issue.user?.login ?? 'gitea'
  const addressed = mentioned(issue.body, config.agent) ? 'mention' as const : undefined
  return { id: key('gitea', giteaThreadId(ref), `i:${issue.updated_at}`), source: SOURCE, threads: [{ source: SOURCE, id: giteaThreadId(ref) }],
    actor: { source: SOURCE, id: login }, human: !giteaBot(login, config), ...addressed ? { addressed } : {},
    at: issue.updated_at || issue.created_at || at, text: clamp(`#${ref.index} ${issue.title}\n\n${issue.body ?? ''}`),
    channel: channelOf(ref, issue.html_url), ...issue.html_url ? { url: issue.html_url } : {},
    meta: metaOf(ref, 'issue', { title: issue.title, isPr: !!issue.pull_request }) }
}

/** A comment on an issue or pull request. A mention of the agent addresses it explicitly. */
export function commentTrigger(comment: GiteaComment, ref: GiteaRef, config: GiteaConfig, at = now(), title = ''): Trigger {
  const login = comment.user?.login ?? 'gitea'
  const addressed = mentioned(comment.body, config.agent) ? 'mention' as const : undefined
  return { id: key('gitea', giteaThreadId(ref), `c:${comment.id}`), source: SOURCE, threads: [{ source: SOURCE, id: giteaThreadId(ref) }],
    actor: { source: SOURCE, id: login }, human: !giteaBot(login, config), ...addressed ? { addressed } : {},
    at: comment.created_at || comment.updated_at || at, text: clamp(`${title ? `#${ref.index} ${title} — ` : `#${ref.index} `}${login}: ${comment.body}`),
    channel: channelOf(ref, comment.html_url), ...comment.html_url ? { url: comment.html_url } : {},
    meta: metaOf(ref, 'comment', { commentId: comment.id }) }
}

/** A notification of the agent account; Gitea only notifies about things directed at the account. */
export function notificationTrigger(notification: GiteaNotification, ref: GiteaRef, config: GiteaConfig, issue?: GiteaIssue, at = now()): Trigger {
  const type = notification.subject.type ?? ''
  const login = issue?.user?.login ?? 'gitea'
  return { id: key('gitea', giteaThreadId(ref), `n:${notification.id}`), source: SOURCE, threads: [{ source: SOURCE, id: giteaThreadId(ref) }],
    actor: { source: SOURCE, id: login }, human: !giteaBot(login, config), addressed: 'mention',
    at: notification.updated_at || at, text: clamp(`#${ref.index} ${notification.subject.title}${issue?.body ? `\n\n${issue.body}` : ''}\n\n(${type})`),
    channel: channelOf(ref, issue?.html_url),
    meta: metaOf(ref, 'notification', { title: notification.subject.title, isPr: type === 'Pull', notificationId: notification.id }) }
}

/** `owner/repo/issues/5` (or `/pulls/5`) from a Gitea URL. */
export function refFromUrl(value: string | null | undefined): GiteaRef | undefined {
  if (!value) return undefined
  const match = /\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pulls)\/(\d+)/.exec(value)
  return match ? { owner: match[1]!, repo: match[2]!, index: Number(match[3]) } : undefined
}

/** The card an issue or a pull request becomes: its title, its body and its link. */
export function issueEvent(issue: GiteaIssue): InboxEvent {
  return { source: SOURCE, title: issue.title, body: issue.body ?? '', url: issue.html_url, by: issue.user?.login }
}

/** The card a comment becomes: the issue it belongs to, the comment itself and its link. */
export function commentEvent(comment: GiteaComment, ref: GiteaRef, title?: string): InboxEvent {
  return { source: SOURCE, title: `#${ref.index} ${title ?? `${ref.owner}/${ref.repo} 的评论`}`, body: comment.body,
    url: comment.html_url, by: comment.user?.login }
}

/** The card a notification becomes: the title of the issue or pull request it points at. */
export function notificationEvent(notification: GiteaNotification, issue?: GiteaIssue): InboxEvent {
  return { source: SOURCE, title: notification.subject.title || 'Gitea 通知', body: issue?.body ?? '',
    url: issue?.html_url, by: issue?.user?.login }
}

/** The key of one event, so the same event is filed as a card once. */
const eventKey = (ref: GiteaRef, kind: string, id: string): string => `${giteaThreadId(ref)}:${kind}:${id}`

export const giteaKind: SourceKind<GiteaConfig> = {
  kind: SOURCE,
  title: { zh: 'Gitea 仓库', en: 'Gitea repository' },
  description: {
    zh: '私有部署的 Gitea 仓库（默认 https://git.feg.cn）。用邮箱+密码（或 API token）登录，读取 agent 通知或仓库里的 Issue/PR/评论增量；事件先在 KanEO 看板建一张卡（to-do 列），由看板统一调度，结果回写那张卡。',
    en: 'A self-hosted Gitea repository (default https://git.feg.cn). It signs in with the account e-mail and password (or an API token), reads the agent notifications or repository issue/PR/comment increments; every event is filed as a card in the KanEO board (to-do column) first, the board schedules it from there, and the result is written back to that card.',
  },
  schema: GiteaConfigSchema,
  /** Settings-panel probe: log in with the entered account and read the entered repository, without saving. */
  async test(config: GiteaConfig): Promise<void> {
    const repo = repositoryOf(config.repository)
    if (!repo) throw new Error('The repository must be owner/name')
    if (config.listen === 'notifications' && !giteaHasAuth(config)) throw new Error('The notification mode needs an account password or an API token')
    const client = new GiteaClient(config)
    if (giteaHasAuth(config)) await client.user()
    await client.repository(repo.owner, repo.name)
  },
  fields: [
    { key: 'baseUrl', type: 'text', label: { zh: 'Gitea 服务器', en: 'Gitea server' }, hint: { zh: '例如 https://git.feg.cn。', en: 'For example https://git.feg.cn.' } },
    { key: 'user', type: 'text', label: { zh: '邮箱', en: 'E-mail' }, hint: { zh: 'agent 的 Gitea 登录邮箱（或登录名）；只用于宿主进程，不进入提示词。', en: 'The agent Gitea e-mail (or login); host process only, never prompts.' } },
    { key: 'password', type: 'password', label: { zh: '密码', en: 'Password' }, hint: { zh: '与邮箱配套的 Gitea 密码（HTTP Basic）；留空表示不修改已保存的密码。', en: 'The Gitea password for that e-mail (HTTP Basic); leave it empty to keep the saved password.' } },
    { key: 'token', type: 'password', advanced: true, label: { zh: 'API token（可选）', en: 'API token (optional)' }, hint: { zh: '用于 2FA 账号或 CI bot；设置后优先于邮箱密码，留空表示不修改。', en: 'For a 2FA account or a CI bot; when set it takes precedence over the password. Leave empty to keep it.' } },
    { key: 'repository', type: 'text', label: { zh: '仓库', en: 'Repository' }, hint: { zh: 'owner/name；留空则来源暂停。', en: 'owner/name; empty keeps the Source paused.' } },
    { key: 'listen', type: 'select', label: { zh: '读取方式', en: 'Read mode' }, options: [
      { value: 'repo', label: { zh: '仓库增量（Issue/评论/PR）', en: 'Repository increments (issues/comments/PRs)' } },
      { value: 'notifications', label: { zh: 'agent 通知（需 token）', en: 'Agent notifications (needs a token)' } },
    ] },
    { key: 'agent', type: 'text', label: { zh: 'agent 的 Gitea 登录名', en: 'Agent Gitea login' }, hint: { zh: '评论或描述里 @ 这个名字即视为明确请求（入库模式下由 PM 在看板上决定是否派工）。', en: 'Mentioning this name in a comment or description is an explicit request (with the inbox on, the PM decides on the board whether to assign it).' } },
    { key: 'bots', type: 'text', advanced: true, label: { zh: '机器人账号（逗号分隔）', en: 'Bot accounts (comma separated)' } },
    { key: 'observeIssues', type: 'switch', label: { zh: '读 Issue 变化', en: 'Read issue changes' } },
    { key: 'observeComments', type: 'switch', label: { zh: '读评论', en: 'Read comments' } },
    { key: 'observePulls', type: 'switch', advanced: true, label: { zh: '读 PR 变化', en: 'Read pull request changes' } },
    { key: 'bootstrap', type: 'select', advanced: true, label: { zh: '首次轮询', en: 'First poll' },
      hint: { zh: 'skip：跳过已有事件；trigger：把已有事件也入库成卡（会一次建很多张卡）。', en: 'skip ignores the existing events; trigger files them as cards too (that creates many cards at once).' },
      options: [
      { value: 'skip', label: { zh: '跳过已有事件', en: 'Skip existing events' } },
      { value: 'trigger', label: { zh: '已有事件也入库', en: 'File existing events too' } },
    ] },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 15, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' } },
    { key: 'maxItems', type: 'number', advanced: true, min: 1, max: 200, label: { zh: '每次最多读取', en: 'Items read per poll' } },
  ],
  scope: () => ({ listened: true, observed: false }),
  health: ['gitea'],
  channel: {
    async send(host, message: OutboundMessage): Promise<'sent' | 'gone'> {
      const account = host.commands.deployment.gitea
      if (!account) throw new Error('The Gitea Source has no resolved account')
      const address = message.channel.address
      const ref = { owner: address.owner ?? '', repo: address.repo ?? '', index: Number(address.index ?? 0) }
      if (!ref.owner || !ref.repo || !ref.index) throw new Error('Missing Gitea reply target')
      const client = new GiteaClient(account)
      const marker = `<!-- dsh-superagent:${message.id} -->`
      try {
        const comments = await client.issueCommentsOf(ref.owner, ref.repo, ref.index, { limit: 50 })
        if (comments.some(comment => comment.body.includes(marker))) return 'sent'
        await client.createIssueComment(ref.owner, ref.repo, ref.index, `${message.text.slice(0, 60000)}\n\n${marker}`)
        return 'sent'
      } catch (error) {
        if (error instanceof GiteaError && (error.status === 403 || error.status === 404)) return 'gone'
        throw error
      }
    },
    link(address) {
      const index = address.index ?? ''
      return { url: address.url ?? '', label: { zh: `Gitea #${index}`, en: `Gitea #${index}` } }
    },
  },
  threadContext: {
    messageId: trigger => trigger.id,
    async read(_commands: Commands, trigger: Trigger, part: ContextPartName, _cursor: string | undefined, config: GiteaConfig): Promise<ContextPart> {
      const ref = giteaRef(trigger)
      if (!ref) throw new Error('This Trigger is not a Gitea issue or pull request')
      const client = new GiteaClient(config)
      const issue = await client.issue(ref.owner, ref.repo, ref.index)
      const root = { id: `${giteaThreadId(ref)}:body`, from: issue.user?.login ?? 'gitea', at: issue.created_at,
        text: issue.body || '(the issue has no description)' }
      const body = { title: issue.title, state: issue.state, ...issue.html_url ? { url: issue.html_url } : {}, isPr: !!issue.pull_request }
      if (part === 'root' || part === 'parent') return { messages: [root], body, status: issue.state }
      const comments = await client.issueCommentsOf(ref.owner, ref.repo, ref.index, { limit: config.maxItems })
      return { messages: [root, ...comments.map(comment => ({ id: String(comment.id), from: comment.user?.login ?? 'gitea',
        at: comment.created_at, text: comment.body, ...comment.html_url ? { url: comment.html_url } : {} }))], body, status: issue.state }
    },
  },
  find: query => {
    const match = /^gitea:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)$/.exec(query.trim())
    return { threads: match ? [query.trim()] : [], terms: [] }
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict()).default([]),
    }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起任务的 Gitea 用户', en: 'Gitea users that may originate work' },
      hint: { zh: '这些用户在 Issue/PR 评论或描述里 @ 智能体，即构成明确请求。', en: 'When one of these users mentions the agent in an issue or pull request, it is an explicit request.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '登录名', en: 'Login' } }, { key: 'name', type: 'text', label: { zh: '名称（可选）', en: 'Name (optional)' }, optional: true }] }],
    explicit: { zh: '名单里的 Gitea 用户在 Issue/PR 的评论或描述里 @ 了智能体。', en: 'A listed Gitea user mentions the agent in an issue or pull request.' },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_GITEA_REPOSITORY', description: { zh: '工单来源的 Gitea 仓库（owner/name）', en: 'Gitea repository of the ticket (owner/name)' } },
      { key: 'DSH_SUPERAGENT_GITEA_ACCOUNT', description: { zh: 'agent 的 Gitea 登录名', en: 'The agent Gitea login' } },
      { key: 'DSH_SUPERAGENT_GITEA_THREAD', description: { zh: '工单对应的 Issue/PR（owner/repo#index）', en: 'Issue/PR behind the ticket (owner/repo#index)' } },
      { key: 'DSH_SUPERAGENT_GITEA_URL', description: { zh: 'Issue/PR 的页面地址', en: 'The issue or pull request page' } },
    ],
    values: ({ deployment, config, trigger }) => {
      const meta = trigger?.source === SOURCE ? trigger.meta as { owner?: string; repo?: string; index?: number } : {}
      return {
        DSH_SUPERAGENT_GITEA_REPOSITORY: deployment.gitea?.repository ?? '',
        DSH_SUPERAGENT_GITEA_ACCOUNT: config.agent,
        DSH_SUPERAGENT_GITEA_THREAD: typeof meta.owner === 'string' && typeof meta.repo === 'string' && typeof meta.index === 'number' ? `${meta.owner}/${meta.repo}#${meta.index}` : '',
        DSH_SUPERAGENT_GITEA_URL: trigger?.url ?? '',
      }
    },
  },
  facts: (deployment): Record<string, Localized | string> => deployment?.gitea
    ? { repository: deployment.gitea.repository, server: deployment.gitea.baseUrl }
    : {},
}

/**
 * One polling round: baseline on first poll, then issue/comment/notification increments are filed as cards in the
 * KanEO board. KanEO is the only direct source, so the events do not become requests here (unless the KanEO Source
 * switched its inbox off); they become cards in the `to-do` pool, and the board schedules them from there.
 */
export async function pollRound(ctx: SourceContext, config: GiteaConfig, client: GiteaClient, signal?: AbortSignal): Promise<number> {
  const cursorKey = config.listen === 'notifications' ? KV.gitea.notifications : KV.gitea.repo
  const cursor = ctx.state.get(cursorKey)
  if (!cursor) {
    ctx.state.set(cursorKey, now())
    ctx.report('gitea', { state: 'ready', detail: 'baseline recorded; the next poll reports new activity', at: now() })
    return config.pollSeconds
  }
  let received = 0
  let filed = 0
  const ingest = ingestEvents(ctx)
  const account = ingest ? inboxAccount(ctx) : undefined
  // Without a KanEO account the events cannot be filed; the round fails instead of dropping them.
  if (ingest && !account) throw new Error('The KanEO Source has no API key: Gitea events are filed as KanEO cards')
  const kaneo = account ? new KaneoClient(account) : undefined
  /** Files one event as a card, or (with the KanEO inbox switched off) hands it to the Engine as a request. */
  const deliver = async (event: InboxEvent, id: string, trigger: () => Trigger): Promise<void> => {
    if (account && kaneo) {
      if (await fileEventOnce(ctx, account, event, id, { client: kaneo, signal })) filed += 1
      return
    }
    if (await ctx.receive(trigger()) !== 'filtered') received += 1
  }
  const repo = repositoryOf(config.repository)
  const problems: string[] = []
  if (config.listen === 'notifications') {
    const items = await client.notifications({ since: cursor, all: false, limit: config.maxItems }, signal)
    for (const item of items) {
      const target = refFromUrl(item.subject.url) ?? refFromUrl(item.repository?.full_name ? `/repos/${item.repository.full_name}` : undefined)
      if (!target) continue
      const issue = await client.issue(target.owner, target.repo, target.index).catch(() => undefined)
      await deliver(notificationEvent(item, issue), eventKey(target, 'notification', item.id),
        () => notificationTrigger(item, target, config, issue))
    }
  } else if (repo) {
    // Each stream is independent: one broken stream (for example orphaned comments after an issue was deleted) must not
    // stall the whole Source. A poll fails only when every attempted stream failed.
    let succeeded = 0
    const attempt = async (label: string, work: () => Promise<void>): Promise<void> => {
      try { await work(); succeeded += 1 }
      catch (error) { problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (config.observeIssues) await attempt('issues', async () => {
      const issues = await client.issues(repo.owner, repo.name, { state: 'all', since: cursor, limit: config.maxItems }, signal)
      for (const issue of issues) {
        const ref = { owner: repo.owner, repo: repo.name, index: issue.number }
        await deliver(issueEvent(issue), eventKey(ref, 'issue', issue.updated_at), () => issueTrigger(issue, ref, config))
      }
    })
    if (config.observeComments) await attempt('comments', async () => {
      const comments = await client.issueComments(repo.owner, repo.name, { since: cursor, limit: config.maxItems }, signal)
      for (const comment of comments) {
        const ref = refFromUrl(comment.issue_url)
        if (!ref) continue
        await deliver(commentEvent(comment, ref), eventKey(ref, 'comment', String(comment.id)), () => commentTrigger(comment, ref, config))
      }
    })
    // Follow-ups on threads a ticket follows: new comments reach the subscribed tickets as context.
    for (const thread of ctx.threads.subscribed(SOURCE)) {
      const ref = giteaRefOfThread(thread.key)
      if (!ref) continue
      await attempt(`thread ${thread.key}`, async () => {
        const start = ctx.state.get(KV.gitea.thread(thread.key)) ?? thread.createdAt
        const comments = await client.issueCommentsOf(ref.owner, ref.repo, ref.index, { since: start, limit: config.maxItems }, signal)
        for (const comment of comments) {
          await deliver(commentEvent(comment, ref), eventKey(ref, 'comment', String(comment.id)), () => commentTrigger(comment, ref, config))
        }
        ctx.state.set(KV.gitea.thread(thread.key), now())
      })
    }
    if (succeeded === 0 && problems.length) throw new Error(problems.join('; '))
  } else throw new Error('The Gitea Source names no repository')
  ctx.state.set(cursorKey, now())
  const detail = ingest
    ? `${filed} card(s) filed in KanEO from ${config.repository || 'notifications'}`
    : `${received} new event(s) from ${config.repository || 'notifications'}`
  ctx.report('gitea', { state: 'ready', detail: `${detail}${problems.length ? ` (partial: ${problems.join('; ')})` : ''}`, at: now() })
  return config.pollSeconds
}

/** Polls until aborted; setup pending, a missing token/repository and the Source being off pause quietly. */
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('gitea', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<GiteaConfig>(SOURCE)
    try {
      if (!config) ctx.report('gitea', health('paused', 'sourceOff'))
      else if (config.listen === 'notifications' && !giteaHasAuth(config)) ctx.report('gitea', { state: 'paused', detail: 'The notification mode needs an account and password (or an API token)' })
      else if (config.listen === 'repo' && !repositoryOf(config.repository)) ctx.report('gitea', { state: 'paused', detail: 'The Gitea Source names no repository' })
      // The events are filed as KanEO cards, so without a KanEO account they cannot be filed at all.
      else if (ingestEvents(ctx) && !inboxAccount(ctx)) ctx.report('gitea', { state: 'error', detail: 'Configure the KanEO Source first: Gitea events are filed as KanEO cards' })
      else if (config.bootstrap === 'trigger' && !ctx.state.get(config.listen === 'notifications' ? KV.gitea.notifications : KV.gitea.repo)) {
        // Trigger mode starts the cursor in the distant past so the first poll reports what is already there.
        ctx.state.set(config.listen === 'notifications' ? KV.gitea.notifications : KV.gitea.repo, '1970-01-01T00:00:00.000Z')
        failures = 0
        await pollRound(ctx, config, new GiteaClient(config), signal)
      } else { failures = 0; await pollRound(ctx, config, new GiteaClient(config), signal) }
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) {
        ctx.report('gitea', health('error', 'pollFailures', { count: String(failures), error: String(error) }))
      }
    }
    await pause((config?.pollSeconds ?? 60) * 1000, signal)
  }
}

export const name = 'dsh-superagent-gitea'
export const inject = ['orchestrator']
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(giteaKind), 'gitea: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, giteaKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch((error: unknown) => { source.report('gitea', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

export { DEFAULT_GITEA_URL }
