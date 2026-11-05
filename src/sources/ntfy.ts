/**
 * ntfy Source kind: a topic is the Thread; every message is an event. The messages are filed as cards in the Kanban board
 * (the only direct source), which schedules them from there; the answer goes back to that card. `pub_` topics are public,
 * so their sender identity is low-trust; a private topic can be protected with an account and password (HTTP Basic) or a
 * bearer token, and only credential holders can read or publish.
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { key, type OutboundMessage, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import type { Commands } from '../infra/commands.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { Localized, SourceKind, ContextPart, ContextPartName, ThreadContext } from './kind.ts'
import { pause } from './poll.ts'
import { NtfyClient, NtfyError, type NtfyMessage } from './ntfy-api.ts'
import { KaneoClient } from './kaneo-api.ts'
import { fileEventOnce, inboxAccount, ingestEvents, type InboxEvent } from './kaneo-inbox.ts'
import { DEFAULT_NTFY_URL, NtfyConfigSchema, ntfyAccountOf, ntfyTopicUrl, type NtfyConfig } from './ntfy-config.ts'

export const SOURCE = 'ntfy'
/** How far a topic switch rewinds the read cursor, so a message published at the switch is not lost. */
const TOPIC_SWITCH_REWIND_SEC = 600
const nowSec = (): number => Math.floor(Date.now() / 1000)
const clamp = (text: string, limit = 4000): string => text.length <= limit ? text : `${text.slice(0, limit)}…`
/** The title convention for a sender: `#name` or `@name`. */
export const ntfySenderOf = (title: string): string | undefined => /^[#@]\s*([A-Za-z0-9_.-]{1,80})/.exec(title.trim())?.[1]
const mentioned = (text: string, agent: string): boolean => !!agent && text.toLowerCase().includes(`@${agent.toLowerCase()}`)

export function ntfyTrigger(message: NtfyMessage, config: NtfyConfig, at = new Date().toISOString()): Trigger {
  const sender = ntfySenderOf(message.title) ?? 'ntfy'
  const body = `${message.title ? `[${message.title}] ` : ''}${message.message}`
  const addressed = mentioned(`${message.title} ${message.message}`, config.agent) ? 'mention' as const : undefined
  const url = ntfyTopicUrl(config.baseUrl, config.topic)
  return { id: key('ntfy', message.id), source: SOURCE, threads: [{ source: SOURCE, id: config.topic }],
    actor: { source: SOURCE, id: sender }, human: true, ...addressed ? { addressed } : {},
    at: new Date(message.time * 1000).toISOString() || at, text: clamp(body),
    channel: { source: SOURCE, thread: config.topic, address: { topic: config.topic, messageId: message.id, url } }, url,
    meta: { topic: config.topic, messageId: message.id, title: message.title, sender, priority: message.priority, tags: message.tags,
      contentType: message.content_type } }
}

/** The card a message becomes: its title, or the first line of its text when it has no title. */
export function messageEvent(message: NtfyMessage, config: NtfyConfig): InboxEvent {
  const title = message.title.trim() || (message.message.split('\n')[0] ?? '').trim() || '(no title)'
  return { source: SOURCE, title, body: message.message, url: ntfyTopicUrl(config.baseUrl, config.topic),
    by: ntfySenderOf(message.title) }
}

export const ntfyKind: SourceKind<NtfyConfig> = {
  kind: SOURCE,
  title: { zh: 'ntfy 主题', en: 'ntfy topic' },
  description: {
    zh: '订阅一个 ntfy 主题（默认 https://msn.feg.cn）。消息先在 Kanban 看板建一张卡（to-do 列），由看板统一调度，结果回写那张卡。私有 topic 可用账号+密码（HTTP Basic）或访问令牌保护；公开的 pub_ 主题无需认证，其发送者身份只能靠 title 约定，属低信任。',
    en: 'Subscribes to an ntfy topic (default https://msn.feg.cn). Every message is filed as a card in the Kanban board (to-do column) first, the board schedules it from there, and the result is written back to that card. A private topic can be protected with an account and password (HTTP Basic) or a bearer token; public pub_ topics need no authentication, so their sender identity comes from the title convention only and is low-trust.',
  },
  schema: NtfyConfigSchema,
  /** Settings-panel probe: read the entered topic with the entered authentication, without saving. */
  async test(config: NtfyConfig): Promise<void> {
    const account = ntfyAccountOf(config)
    if (!account) throw new Error('The topic is required')
    await new NtfyClient(account).history('1s', { limit: 1 })
  },
  fields: [
    { key: 'baseUrl', type: 'text', label: { zh: 'ntfy 服务器', en: 'ntfy server' }, hint: { zh: '例如 https://msn.feg.cn。', en: 'For example https://msn.feg.cn.' } },
    { key: 'topic', type: 'text', label: { zh: '主题（topic）', en: 'Topic' }, hint: { zh: '例如 pub_dgctny8ibgpn72ei2j8qj2hc；留空则来源暂停。', en: 'For example pub_dgctny8ibgpn72ei2j8qj2hc; empty keeps the Source paused.' } },
    { key: 'authMode', type: 'select', label: { zh: '认证方式', en: 'Authentication' }, options: [
      { value: 'none', label: { zh: '无（pub_ 公开 topic）', en: 'None (public pub_ topic)' } },
      { value: 'basic', label: { zh: '账号 + 密码（私有 topic）', en: 'Account + password (private topic)' } },
      { value: 'bearer', label: { zh: '访问令牌（私有 topic）', en: 'Access token (private topic)' } },
    ] },
    { key: 'authUser', type: 'text', advanced: true, label: { zh: '账号（私有 topic）', en: 'Account (private topic)' }, hint: { zh: '私有 topic 的 HTTP Basic 账号。', en: 'The HTTP Basic account for a private topic.' } },
    { key: 'authPassword', type: 'password', advanced: true, label: { zh: '密码', en: 'Password' }, hint: { zh: '留空表示不修改已保存的密码。', en: 'Leave empty to keep the saved password.' } },
    { key: 'authToken', type: 'password', advanced: true, label: { zh: '访问令牌', en: 'Token' }, hint: { zh: '留空表示不修改已保存的令牌。', en: 'Leave empty to keep the saved token.' } },
    { key: 'agent', type: 'text', label: { zh: '智能体提及名', en: 'Agent mention name' }, hint: { zh: '消息中出现 @这个名字 即视为明确请求。', en: 'A message containing @this-name is an explicit request.' } },
    { key: 'sender', type: 'text', advanced: true, label: { zh: 'agent 消息的 title 约定', en: 'Title convention for the agent' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 15, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' } },
    { key: 'maxMessages', type: 'number', advanced: true, min: 1, max: 500, label: { zh: '每次最多读取消息数', en: 'Messages read per poll' } },
    { key: 'bootstrap', type: 'select', advanced: true, label: { zh: '首次读取', en: 'First read' },
      hint: { zh: '从当前时间开始 / 把保留的历史也入库成卡（会一次建很多张卡）。', en: 'Start from now / file the retained history as cards too (that creates many cards at once).' },
      options: [
      { value: 'skip', label: { zh: '从当前时间开始', en: 'Start from now' } },
      { value: 'history', label: { zh: '保留的历史也入库', en: 'File the retained history too' } },
    ] },
  ],
  scope: () => ({ listened: true, observed: false }),
  health: ['ntfy'],
  channel: {
    async send(host, message: OutboundMessage): Promise<'sent' | 'gone'> {
      const account = host.commands.deployment.ntfy
      if (!account) throw new Error('The ntfy Source has no resolved account')
      const client = new NtfyClient(account)
      const marker = `<!-- dsh-superagent:${message.id} -->`
      try {
        // Retries are idempotent: a recent message carrying the marker means it already went out.
        const recent = await client.history('10m', { limit: 100 })
        if (recent.some(item => item.message.includes(marker))) return 'sent'
        await client.publish(`${message.text.slice(0, 8000)}\n\n${marker}`, { title: account.sender, priority: 3, tags: ['dsh-superagent'] })
        return 'sent'
      } catch (error) {
        if (error instanceof NtfyError && (error.status === 403 || error.status === 404)) return 'gone'
        throw error
      }
    },
    link(address) {
      return { url: address.url ?? '', label: { zh: 'ntfy 主题', en: 'ntfy topic' } }
    },
  },
  threadContext: {
    messageId: trigger => trigger.id,
    async read(_commands: Commands, trigger: Trigger, part: ContextPartName, _cursor: string | undefined, config: NtfyConfig): Promise<ContextPart> {
      const client = new NtfyClient(ntfyAccountOf(config) ?? { baseUrl: config.baseUrl, topic: config.topic, sender: config.sender,
        auth: { mode: 'none', user: '', password: '', token: '' } })
      const messages = await client.history('24h', { limit: config.maxMessages })
      const mapped = messages.map(message => ({ id: message.id, from: ntfySenderOf(message.title) ?? 'ntfy',
        at: new Date(message.time * 1000).toISOString(), text: `${message.title ? `[${message.title}] ` : ''}${message.message}` }))
      return { messages: part === 'thread' || part === 'root' ? mapped : mapped.slice(-1), body: { topic: config.topic }, status: undefined }
    },
  },
  find: query => {
    const topic = /^ntfy:([A-Za-z0-9_.-]{1,80})$/.exec(query.trim())?.[1]
    return { threads: topic ? [topic] : [], terms: [] }
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict()).default([]),
    }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起任务的 ntfy 发送者', en: 'ntfy senders that may originate work' },
      hint: { zh: '发送者身份来自消息 title 的 #name 约定。私有 topic 用账号+密码保护后，只有持凭据者能发布；公开 pub_ 主题任何人都能发布，名单只能作为低信任约束。', en: 'Sender identity comes from the #name title convention. A private topic protected by account and password only admits credential holders; anyone can publish to a public pub_ topic, so the list is only a low-trust constraint.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '发送者名', en: 'Sender' } }, { key: 'name', type: 'text', label: { zh: '名称（可选）', en: 'Name (optional)' }, optional: true }] }],
    explicit: { zh: '名单里的发送者在 ntfy 消息中 @ 了智能体（身份来自 title 约定；私有 topic 另有账号密码保护，公开 pub_ 主题则属低信任）。', en: 'A listed sender mentions the agent in an ntfy message (identity from the title convention; private topics also require the account password, while public pub_ topics are low-trust).' },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_NTFY_TOPIC', description: { zh: '工单来源的 ntfy 主题', en: 'ntfy topic the ticket came from' } },
      { key: 'DSH_SUPERAGENT_NTFY_MESSAGE', description: { zh: '工单对应的 ntfy 消息 id', en: 'ntfy message id behind the ticket' } },
      { key: 'DSH_SUPERAGENT_NTFY_URL', description: { zh: 'ntfy 主题页面地址', en: 'The topic page' } },
    ],
    values: ({ deployment, trigger }) => {
      const meta = trigger?.source === SOURCE ? trigger.meta as { messageId?: string } : {}
      return {
        DSH_SUPERAGENT_NTFY_TOPIC: deployment.ntfy?.topic ?? '',
        DSH_SUPERAGENT_NTFY_MESSAGE: typeof meta.messageId === 'string' ? meta.messageId : '',
        DSH_SUPERAGENT_NTFY_URL: trigger?.source === SOURCE ? trigger.url ?? '' : '',
      }
    },
  },
  facts: (deployment): Record<string, Localized | string> => deployment?.ntfy
    ? { topic: deployment.ntfy.topic, server: deployment.ntfy.baseUrl }
    : {},
}

/**
 * One polling round: baseline on first read, then every newer message is filed as a card in the Kanban board. Kanban is
 * the only direct source, so a message does not become a request here (unless the Kanban Source switched its inbox off);
 * it becomes a card in the `to-do` pool, and the board schedules it from there.
 */
export async function pollRound(ctx: SourceContext, config: NtfyConfig, client: NtfyClient, signal?: AbortSignal): Promise<number> {
  let stored = ctx.state.get(KV.ntfy.since)
  if (typeof stored === 'number') {
    // The cursor is kept across a topic switch. Rewinding it a little keeps a message published around the switch from
    // being skipped by the poll that already moved the cursor past it.
    const previousTopic = ctx.state.get(KV.ntfy.topic)
    if (previousTopic !== undefined && previousTopic !== config.topic) {
      stored = Math.max(0, stored - TOPIC_SWITCH_REWIND_SEC)
      ctx.state.set(KV.ntfy.since, stored)
    }
  }
  if (stored === undefined) {
    const baseline = config.bootstrap === 'history' ? 0 : nowSec()
    ctx.state.set(KV.ntfy.since, nowSec())
    if (config.bootstrap !== 'history') {
      ctx.report('ntfy', { state: 'ready', detail: `baseline at ${new Date(baseline * 1000).toISOString()}`, at: new Date().toISOString() })
      return config.pollSeconds
    }
  }
  const cursor = stored ?? 0
  const elapsed = Math.max(1, nowSec() - cursor)
  const messages = await client.history(`${elapsed}s`, { limit: config.maxMessages, signal })
  let received = 0
  let filed = 0
  const ingest = ingestEvents(ctx)
  const account = ingest ? inboxAccount(ctx) : undefined
  // Without a Kanban account the messages cannot be filed; the round fails instead of dropping them.
  if (ingest && !account) throw new Error('The Kanban Source has no API key: ntfy messages are filed as Kanban cards')
  const kaneo = account ? new KaneoClient(account) : undefined
  for (const message of messages) {
    if (message.time <= cursor) continue
    if (account && kaneo) {
      if (await fileEventOnce(ctx, account, messageEvent(message, config), message.id, { client: kaneo, signal })) filed += 1
      continue
    }
    if (await ctx.receive(ntfyTrigger(message, config)) !== 'filtered') received += 1
  }
  ctx.state.set(KV.ntfy.since, nowSec())
  ctx.state.set(KV.ntfy.topic, config.topic)
  const latest = messages.at(-1)
  const detail = ingest
    ? `${filed} card(s) filed in Kanban from ${config.topic}`
    : `${received} new message(s) in ${config.topic}`
  ctx.report('ntfy', { state: 'ready', detail: `${detail}${latest?.title ? `; latest: ${latest.title}` : ''}`, at: new Date().toISOString() })
  return config.pollSeconds
}

/** Polls until aborted; setup pending, a missing topic and the Source being off pause quietly. */
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('ntfy', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<NtfyConfig>(SOURCE)
    try {
      if (!config) ctx.report('ntfy', health('paused', 'sourceOff'))
      else if (!config.topic) ctx.report('ntfy', { state: 'paused', detail: 'The ntfy Source names no topic' })
      // The messages are filed as Kanban cards, so without a Kanban account they cannot be filed at all.
      else if (ingestEvents(ctx) && !inboxAccount(ctx)) ctx.report('ntfy', { state: 'error', detail: 'Configure the Kanban Source first: ntfy messages are filed as Kanban cards' })
      else { failures = 0; await pollRound(ctx, config, new NtfyClient(ntfyAccountOf(config) ?? { baseUrl: config.baseUrl, topic: config.topic,
        sender: config.sender, auth: { mode: 'none', user: '', password: '', token: '' } }), signal) }
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) {
        ctx.report('ntfy', health('error', 'pollFailures', { count: String(failures), error: String(error) }))
      }
    }
    await pause((config?.pollSeconds ?? 60) * 1000, signal)
  }
}

export const name = 'dsh-superagent-ntfy'
export const inject = ['orchestrator']
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(ntfyKind), 'ntfy: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, ntfyKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch((error: unknown) => { source.report('ntfy', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

export { DEFAULT_NTFY_URL }
