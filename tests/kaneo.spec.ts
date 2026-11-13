import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { key, type Thread, type Ticket, type Trigger } from '../src/core/index.ts'
import { KV, type Family, type Key } from '../src/kv.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { Deployment } from '../src/deployment.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { KaneoClient, KaneoError, type KaneoFetch } from '../src/sources/kaneo-api.ts'
import { kaneoKind, observeCards, pollRound, refreshKaneoMembers, refreshThreadPages, SOURCE } from '../src/sources/kaneo.ts'
import { DEFAULT_PROJECT, KaneoConfigSchema, KaneoStoredConfigSchema, kaneoTaskUrl, watchColumnsOf, type KaneoConfig } from '../src/sources/kaneo-config.ts'
import { kaneoThreadKey, kaneoTrigger, kaneoTriggerId, KaneoTaskSchema } from '../src/sources/kaneo-trigger.ts'
import { sendKaneo } from '../src/sources/kaneo-channel.ts'
import { kaneoThreadContext } from '../src/sources/kaneo-read.ts'

const config = (overrides: Partial<KaneoConfig> = {}): KaneoConfig => KaneoConfigSchema.parse({ apiKey: 'test-key', projectId: 'project-1', ...overrides })
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const board = (status: string, tasks: unknown[]): Response => response({ data: { columns: [{ slug: status, name: status, tasks }] },
  pagination: { total: tasks.length, page: 1, totalPages: 1 } })
const stubFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): KaneoFetch => {
  const fn = vi.fn(handler)
  return ((input: string, init?: RequestInit) => fn(input, init)) as KaneoFetch
}
const task = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ id, title: `Task ${id}`, number: Number(id.replace(/\D/g, '')) || 1,
  description: 'Do the work', status: 'ready', assigneeId: 'user-1', updatedAt: '2026-11-03T00:00:00.000Z', labels: [], ...overrides })

interface Recorded { triggers: Trigger[]; described: Map<string, unknown>; reports: { entry: string; health: unknown }[] }
/** A SourceContext whose Store lives in a Map and whose only observations are recorded. */
function context(cfg: KaneoConfig, options: { tickets?: Ticket[]; triggers?: Trigger[]; threads?: Thread[]; deployment?: Deployment } = {}): { ctx: SourceContext; recorded: Recorded; state: Map<string, unknown> } {
  const state = new Map<string, unknown>()
  const recorded: Recorded = { triggers: [], described: new Map(), reports: [] }
  const ctx: SourceContext = {
    deployment: options.deployment ?? {} as Deployment,
    commands: {} as Commands,
    ready: Promise.resolve(),
    configured: () => true,
    config: <C extends Record<string, unknown>>(id: string) => (id === SOURCE ? cfg as unknown as C : undefined),
    receive: async trigger => { recorded.triggers.push(trigger); return 'stored' as const },
    atomic: work => work(),
    state: {
      get: <V,>(name: Key<V>) => state.get(name) as V | undefined,
      set: <V,>(name: Key<V>, value: V | undefined) => { if (value === undefined) state.delete(name); else state.set(name, value) },
      keys: <V,>(family: Family<V, never>) => [...state.keys()].filter(name => name.startsWith(family.prefix)) as Key<V>[],
    },
    threads: { get: key => options.threads?.find(thread => thread.key === key), subscribed: () => options.threads ?? [], describe: (name, description) => { recorded.described.set(name, description) }, patch: () => {} },
    tickets: { get: () => undefined, open: () => options.tickets ?? [], bindThread: () => {}, threadClosed: () => {} },
    triggers: { get: id => options.triggers?.find(trigger => trigger.id === id), latest: () => undefined },
    notify: () => {},
    report: (entry, health) => { recorded.reports.push({ entry, health }) },
  }
  return { ctx, recorded, state }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('kaneo kind', () => {
  it('declares the FDEP board defaults and the Kaneo policy form', () => {
    const parsed = KaneoConfigSchema.parse({ apiKey: 'k' })
    expect(parsed.projectId).toBe(DEFAULT_PROJECT)
    expect(parsed.watchColumns).toBe('ready')
    expect(parsed.claimColumn).toBe('in-progress')
    expect(watchColumnsOf(parsed)).toEqual(['ready'])
    expect(kaneoKind.kind).toBe('kaneo')
    expect(kaneoKind.channel).toBeDefined()
    expect(kaneoKind.threadContext).toBeDefined()
    expect(kaneoKind.policy?.fields[0]?.key).toBe('allowed')
  })

  it('still reads a config saved before the board-hold design was removed, dropping only its fields', () => {
    // A config saved while hold labels and cancel columns existed carries them; a Source whose config this version
    // refuses is not run, so they are dropped instead of refused.
    const stored = { apiKey: 'k', projectId: 'project-1', watchColumns: 'to-do', claimColumn: 'in-progress', doneColumn: 'done',
      holdLabel: 'blocked', blockedColumn: 'blocked-column', cancelColumns: 'canceled,cancelled' }
    const parsed = KaneoStoredConfigSchema.parse(stored)
    expect(parsed).toMatchObject({ projectId: 'project-1', watchColumns: 'to-do', claimColumn: 'in-progress', doneColumn: 'done' })
    expect(parsed).not.toHaveProperty('holdLabel')
    expect(parsed).not.toHaveProperty('blockedColumn')
    expect(parsed).not.toHaveProperty('cancelColumns')
    // Any other unknown field is still refused, so a typo does not pass silently.
    expect(KaneoStoredConfigSchema.safeParse({ apiKey: 'k', holdLable: 'blocked' }).success).toBe(false)
  })

  it('links a task to the board opened on its card, the way the app itself links to it', () => {
    const url = kaneoTaskUrl({ baseUrl: 'https://pl.feg.cn', projectId: 'project-1', workspaceId: 'ws-1' }, { id: 'task-1' })
    expect(url).toBe('https://pl.feg.cn/dashboard/workspace/ws-1/project/project-1/board?taskId=task-1')
    // Without a workspace the project path stands alone, a trailing slash on the base does not double, and the ids are escaped.
    expect(kaneoTaskUrl({ baseUrl: 'https://pl.feg.cn/', projectId: 'p', workspaceId: '' }, { id: 'a b' })).toBe(`https://pl.feg.cn/dashboard/project/p/board?taskId=${encodeURIComponent('a b')}`)
  })
})

describe('kaneo trigger', () => {
  it('turns a task into one explicit request on a task Thread', () => {
    const parsed = KaneoTaskSchema.parse(task('t1', { title: 'Fix the widget', number: 7, description: 'Repair the widget', assigneeId: 'user-1' }))
    const trigger = kaneoTrigger(parsed, config(), '2026-11-03T00:00:00.000Z')
    expect(trigger).toMatchObject({
      id: key('kaneo', 't1'), source: 'kaneo', human: true, addressed: 'direct',
      actor: { source: 'kaneo', id: 'user-1' }, threads: [{ source: 'kaneo', id: 't1' }],
    })
    expect(trigger.text).toContain('#7 Fix the widget')
    expect(trigger.text).toContain('Repair the widget')
    expect(trigger.channel?.address.taskId).toBe('t1')
    expect(trigger.url).toContain('pl.feg.cn')
    expect(kaneoThreadKey('t1')).toBe('kaneo:t1')
    expect(trigger.id).toBe(kaneoTriggerId('t1'))
    expect(trigger.meta).toMatchObject({ taskId: 't1', number: 7, status: 'ready', labels: [] })
  })
  it('falls back to the creator and then the configured actor, and cuts a very long description', () => {
    const created = KaneoTaskSchema.parse(task('t2', { assigneeId: null, userId: 'creator-9' }))
    expect(kaneoTrigger(created, config(), '2026-11-03T00:00:00.000Z').actor.id).toBe('creator-9')
    const anonymous = KaneoTaskSchema.parse(task('t3', { assigneeId: null, userId: null, description: 'x'.repeat(5000) }))
    const trigger = kaneoTrigger(anonymous, config({ actorFallback: 'board' }), '2026-11-03T00:00:00.000Z')
    expect(trigger.actor.id).toBe('board')
    expect(trigger.text.length).toBeLessThan(4100)
  })
})

describe('kaneo polling', () => {
  it('skips the tasks already in the watched column on the first poll, then requests only new ones without claiming them', async () => {
    const cfg = config()
    const { ctx, recorded, state } = context(cfg)
    let listed = [task('t1'), task('t2')]
    const writes: { method: string; url: string; body?: unknown }[] = []
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async (url, init) => {
      const method = init?.method ?? 'GET'
      writes.push({ method, url, ...init?.body ? { body: JSON.parse(String(init.body)) } : {} })
      if (url.includes('/task/tasks/')) return board('ready', listed)
      if (url.includes('/task/status/')) return response({})
      return response({})
    }))

    // First poll: bootstrap records both tasks without a request and without moving anything.
    await pollRound(ctx, cfg, client)
    expect(recorded.triggers).toHaveLength(0)
    expect(state.get(KV.kaneo.bootstrap)).toBe(true)
    expect(state.get(KV.kaneo.seen('t1'))).toMatchObject({ status: 'ready' })
    expect(writes.some(write => write.method === 'PUT')).toBe(false)

    // A third task appears: one request. The card is not claimed yet — a request that was read is not yet a duty;
    // the post claims it when it first writes to the card.
    listed = [task('t1'), task('t2'), task('t3')]
    writes.length = 0
    await pollRound(ctx, cfg, client)
    expect(recorded.triggers.map(trigger => trigger.id)).toEqual([kaneoTriggerId('t3')])
    expect(writes.filter(write => write.method === 'PUT')).toHaveLength(0)
    expect(recorded.described.get(kaneoThreadKey('t3'))).toMatchObject({ label: '#3 Task t3' })

    // Polling again produces nothing new.
    writes.length = 0
    await pollRound(ctx, cfg, client)
    expect(recorded.triggers).toHaveLength(1)
    expect(writes.filter(write => write.method === 'PUT')).toHaveLength(0)
    expect(recorded.reports.at(-1)).toMatchObject({ entry: 'kaneo', health: { state: 'ready' } })
  })

  it('requests the tasks already present when bootstrap is trigger, and honors required labels', async () => {
    const cfg = config({ bootstrap: 'trigger', claimColumn: '', requiredLabels: 'ai:' })
    const { ctx, recorded } = context(cfg)
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async url =>
      url.includes('/task/tasks/') ? board('ready', [task('t1', { labels: [{ name: 'ai:' }] }), task('t2', { labels: [{ name: 'gov:' }] })]) : response({})))
    await pollRound(ctx, cfg, client)
    expect(recorded.triggers.map(trigger => trigger.id)).toEqual([kaneoTriggerId('t1')])
  })

  it('keeps a column failure from stopping the other columns and reports health after the round', async () => {
    const cfg = config({ watchColumns: 'ready,blocked' })
    const { ctx, recorded } = context(cfg)
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async url => {
      if (url.includes('status=blocked')) return response({ error: 'boom' }, 500)
      return board('ready', [])
    }), async () => {})
    await expect(pollRound(ctx, cfg, client)).rejects.toThrow(/Kanban reads failed/)
    expect(recorded.reports).toHaveLength(0)
  })
})

describe('kaneo channel', () => {
  const commands = { deployment: { kaneo: { baseUrl: 'https://pl.feg.cn', apiKey: 'k', projectId: 'p' } } } as unknown as Commands
  const message = (id: string, ticketId?: string): Parameters<typeof sendKaneo>[1] => ({ id, text: 'hello there', kind: 'reply',
    ...ticketId ? { ticketId } : {},
    channel: { source: 'kaneo', thread: 't1', address: { taskId: 't1', url: 'https://pl.feg.cn/dashboard' } } })

  it('posts a marker-carrying comment and does not repeat one already posted', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if ((init?.method ?? 'GET') === 'GET') return response([{ id: 'c1', content: 'old' }])
      return response({})
    }))
    await expect(sendKaneo({ commands, config: () => undefined }, message('dsh-1'))).resolves.toBe('sent')
    const post = calls.find(call => call.init?.method === 'POST')
    expect(post).toBeDefined()
    expect(String(post?.init?.body)).toContain('hello there')
    expect(String(post?.init?.body)).toContain('<!-- dsh-superagent:dsh-1 -->')

    // A retry finds the marker and sends nothing.
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return response([{ id: 'c2', content: 'hello there\n\n<!-- dsh-superagent:dsh-1 -->' }])
    }))
    await expect(sendKaneo({ commands, config: () => undefined }, message('dsh-1'))).resolves.toBe('sent')
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(0)
  })

  it('claims the card in the claim column when the post first writes to it', async () => {
    const calls: { url: string; method: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? String(init.body) : undefined })
      if (url.endsWith('/comment/t1')) return response([])
      if (url.endsWith('/task/t1')) return response({ id: 't1', status: 'ready' })
      return response({})
    }))
    await expect(sendKaneo({ commands, config: () => config() as never }, message('dsh-3', 'ticket-1'))).resolves.toBe('sent')
    const move = calls.find(call => call.method === 'PUT' && call.url.includes('/task/status/'))
    expect(move?.body).toContain('in-progress')
    // The comment follows the claim: the card shows that the post is on it.
    expect(calls.findIndex(call => call.method === 'PUT')).toBeLessThan(calls.findIndex(call => call.method === 'POST'))
  })

  it('leaves a card that nobody acted on alone: a notice without a duty does not claim it', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      if (String(input).endsWith('/comment/t1')) return response([])
      if (String(input).endsWith('/task/t1')) return response({ id: 't1', status: 'ready' })
      return response({})
    }))
    await expect(sendKaneo({ commands, config: () => config() as never }, message('dsh-5'))).resolves.toBe('sent')
    expect(calls.some(call => call.method === 'PUT')).toBe(false)
  })

  it('leaves a card that already sits in the claim column alone', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      if (String(input).endsWith('/comment/t1')) return response([])
      if (String(input).endsWith('/task/t1')) return response({ id: 't1', status: 'in-progress' })
      return response({})
    }))
    await expect(sendKaneo({ commands, config: () => config() as never }, message('dsh-4', 'ticket-2'))).resolves.toBe('sent')
    expect(calls.some(call => call.method === 'PUT')).toBe(false)
  })

  it('moves the card to the delivery column when the post delivers its result', async () => {
    const calls: { url: string; method: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? String(init.body) : undefined })
      if (url.endsWith('/comment/t1')) return response([])
      if (url.endsWith('/task/t1')) return response({ id: 't1', status: 'in-progress' })
      return response({})
    }))
    await expect(sendKaneo({ commands, config: () => config({ doneColumn: 'in-review' }) as never },
      { ...message('dsh-6', 'ticket-3'), kind: 'reply' })).resolves.toBe('sent')
    const move = calls.find(call => call.method === 'PUT' && call.url.includes('/task/status/'))
    expect(move?.body).toContain('in-review')
  })

  it('keeps the card where it is when no delivery column is set', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      if (String(input).endsWith('/comment/t1')) return response([])
      if (String(input).endsWith('/task/t1')) return response({ id: 't1', status: 'ready' })
      return response({})
    }))
    await expect(sendKaneo({ commands, config: () => config({ doneColumn: '', claimColumn: '' }) as never },
      { ...message('dsh-7', 'ticket-4'), kind: 'reply' })).resolves.toBe('sent')
    expect(calls.some(call => call.method === 'PUT')).toBe(false)
  })

  it('reports a gone task when the comment target no longer exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'Task not found' }, 404)))
    await expect(sendKaneo({ commands, config: () => undefined }, message('dsh-2'))).resolves.toBe('gone')
  })
})

describe('kaneo thread context', () => {
  it('reads the task description as the root and its comments as the thread', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      if (url.endsWith('/task/t1')) return response({ id: 't1', title: 'Task one', status: 'ready', description: 'The body', createdAt: '2026-11-01T00:00:00.000Z' })
      if (url.endsWith('/comment/t1')) return response([{ id: 'c1', content: 'a comment', createdAt: '2026-11-02T00:00:00.000Z', user: { name: 'Alice' } }])
      return response({})
    }))
    const trigger = kaneoTrigger(KaneoTaskSchema.parse(task('t1')), config(), '2026-11-03T00:00:00.000Z')
    const thread = await kaneoThreadContext.read({} as Commands, trigger, 'thread', undefined, config())
    expect(thread.status).toBe('ready')
    expect(thread.messages.map(item => item.text)).toEqual(['The body', 'a comment'])
    expect(thread.messages[1]).toMatchObject({ from: 'Alice', id: 'c1' })
  })
})

describe('kaneo api client', () => {
  it('retries a rate-limited request and returns the parsed body', async () => {
    const waits: number[] = []
    let attempts = 0
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async () => {
      attempts += 1
      return attempts < 2 ? response({ error: 'rate limited' }, 429) : response({ ok: true })
    }), async ms => { waits.push(ms) })
    await expect(client.request(z.object({ ok: z.boolean() }), 'GET', '/task/x')).resolves.toEqual({ ok: true })
    expect(attempts).toBe(2)
    expect(waits).toHaveLength(1)
  })
  it('reads the workspace members whose e-mails a post can name', async () => {
    const calls: string[] = []
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async url => {
      calls.push(url)
      return response([{ id: 'u-pm', name: 'PM', email: 'pm@example.com', role: 'admin' }])
    }))
    const members = await client.workspaceMembers('ws-1')
    expect(members).toEqual([{ id: 'u-pm', name: 'PM', email: 'pm@example.com', role: 'admin' }])
    expect(calls[0]).toBe('https://pl.feg.cn/api/workspace/ws-1/members')
  })
  it('surfaces the final HTTP status instead of retrying a refusal', async () => {
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async () => response({ error: 'nope' }, 401)))
    const failure = await client.request(z.unknown(), 'GET', '/task/x').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(KaneoError)
    expect((failure as KaneoError).status).toBe(401)
  })
})

describe('kaneo card observation', () => {
  const running = (cfg: KaneoConfig): { ticket: Ticket; trigger: Trigger } => {
    const trigger = kaneoTrigger(KaneoTaskSchema.parse(task('t1')), cfg, '2026-11-03T00:00:00.000Z')
    const ticket = { id: 'ticket-1', origin: { triggerId: trigger.id, triggerIds: [trigger.id] } } as unknown as Ticket
    return { ticket, trigger }
  }
  const comment = (id: string, userId: string, content: string) => ({ id, taskId: 't1', userId, content, createdAt: '2026-11-03T00:01:00.000Z', user: { name: userId } })
  const fetchFor = (comments: unknown[], taskValue = task('t1')): KaneoFetch => stubFetch(async url => {
    if (url.endsWith('/task/t1')) return response(taskValue)
    if (url.endsWith('/comment/t1')) return response(comments)
    if (url.endsWith('/user/me')) return response({ id: 'host-1', name: 'Host' })
    return response({})
  })

  it('delivers a new comment on a running ticket as one update trigger, then records the baseline', async () => {
    const cfg = config()
    const { ticket, trigger } = running(cfg)
    const { ctx, recorded, state } = context(cfg, { tickets: [ticket], triggers: [trigger] })
    state.set(KV.kaneo.observe('t1'), JSON.stringify({ title: 'Task t1', description: 'Do the work', comments: [] }))
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, fetchFor([comment('c1', 'user-2', 'Please also cover the edge case')]))
    expect(await observeCards(ctx, cfg, client)).toBe(1)
    expect(recorded.triggers).toHaveLength(1)
    expect(recorded.triggers[0]!).toMatchObject({ source: 'kaneo', human: true, addressed: 'direct', meta: { taskId: 't1', update: true } })
    expect(recorded.triggers[0]!.threads).toEqual([{ source: 'kaneo', id: 't1' }])
    expect(recorded.triggers[0]!.text).toContain('Please also cover the edge case')
    expect(recorded.triggers[0]!.id).toBeDefined()
    expect(await observeCards(ctx, cfg, client)).toBe(0)
  })

  it('keeps the card page on the board route that opens it', async () => {
    // A Thread described before the board route was known still pointed at the plain board; observation keeps it current
    // so the panel's "open original" lands on the card.
    const cfg = config({ workspaceId: 'ws-1' })
    const { ticket, trigger } = running(cfg)
    const { ctx, recorded } = context(cfg, { tickets: [ticket], triggers: [trigger] })
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, fetchFor([]))
    await observeCards(ctx, cfg, client)
    expect(recorded.described.get(kaneoThreadKey('t1'))).toMatchObject({
      url: 'https://pl.feg.cn/dashboard/workspace/ws-1/project/project-1/board?taskId=t1',
    })
  })

  it('ignores comments the Host itself wrote and a title or description change still gets through', async () => {
    const cfg = config()
    const { ticket, trigger } = running(cfg)
    const { ctx, recorded, state } = context(cfg, { tickets: [ticket], triggers: [trigger] })
    state.set(KV.kaneo.observe('t1'), JSON.stringify({ title: 'Task t1', description: 'Do the work', comments: [] }))
    const own = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, fetchFor([comment('c9', 'host-1', 'reply from the host')]))
    expect(await observeCards(ctx, cfg, own)).toBe(0)
    const edited = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, fetchFor([], task('t1', { description: 'Do the work, plus the edge case' })))
    expect(await observeCards(ctx, cfg, edited)).toBe(1)
    expect(recorded.triggers[0]!.text).toContain('Do the work, plus the edge case')
  })

  it('uses the first look as a baseline instead of replaying the old card text', async () => {
    const cfg = config()
    const { ticket, trigger } = running(cfg)
    const { ctx, recorded, state } = context(cfg, { tickets: [ticket], triggers: [trigger] })
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, fetchFor([]))
    expect(await observeCards(ctx, cfg, client)).toBe(0)
    expect(state.get(KV.kaneo.observe('t1'))).toBeDefined()
    expect(recorded.triggers).toHaveLength(0)
  })
})

describe('kaneo card column changes', () => {
  const waitTrigger = (cfg: KaneoConfig): Trigger => kaneoTrigger(KaneoTaskSchema.parse(task('t1')), cfg, '2026-11-03T00:00:00.000Z')
  const waitingTicket = (cfg: KaneoConfig): Ticket => {
    const origin = waitTrigger(cfg)
    return { id: 'ticket-1', origin: { triggerId: origin.id, triggerIds: [origin.id] },
      attention: { id: 'a1', question: 'Approve the extra budget?' },
      assignments: [{ id: 'a-1', state: 'ended', report: { state: 'blocked', summary: 'needs a decision', at: '2026-11-03T00:02:00.000Z' } }] } as unknown as Ticket
  }
  it('delivers a card column change to the running ticket', async () => {
    const cfg = config()
    const { ticket, trigger } = { ticket: waitingTicket(cfg), trigger: waitTrigger(cfg) }
    const { ctx, recorded, state } = context(cfg, { tickets: [ticket], triggers: [trigger] })
    state.set(KV.kaneo.observe('t1'), JSON.stringify({ title: 'Task t1', description: 'Do the work', status: 'blocked', comments: [] }))
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async url => {
      if (url.endsWith('/task/t1')) return response(task('t1', { status: 'in-progress' }))
      if (url.endsWith('/comment/t1')) return response([])
      if (url.endsWith('/user/me')) return response({ id: 'host-1', name: 'Host' })
      return response({})
    }))
    expect(await observeCards(ctx, cfg, client)).toBe(1)
    expect(recorded.triggers[0]!.text).toContain('卡片列更新：blocked → in-progress')
  })

})

describe('kaneo card pages', () => {
  const thread = (url: string): Thread => ({ key: 'kaneo:t1', ref: { source: 'kaneo', id: 't1' }, createdAt: '2026-11-03T00:00:00.000Z',
    subscriptions: ['ticket-1'], correlated: [], pending: [], meta: { url } }) as unknown as Thread
  it('repairs card pages stored before the board route was known, and writes nothing once they match', () => {
    const cfg = config({ workspaceId: 'ws-1' })
    const { ctx, recorded } = context(cfg, { threads: [thread('https://pl.feg.cn/dashboard/workspace/ws-1/project/project-1?task=t1')] })
    refreshThreadPages(ctx, cfg)
    expect(recorded.described.get('kaneo:t1')).toMatchObject({ url: 'https://pl.feg.cn/dashboard/workspace/ws-1/project/project-1/board?taskId=t1' })
    // One that already points at the card is left alone, so the repair writes nothing on later rounds.
    const current = context(cfg, { threads: [thread('https://pl.feg.cn/dashboard/workspace/ws-1/project/project-1/board?taskId=t1')] })
    refreshThreadPages(current.ctx, cfg)
    expect(current.recorded.described.size).toBe(0)
  })
})

describe('kaneo policy roster', () => {
  const account = { baseUrl: 'https://pl.feg.cn', apiKey: 'k', projectId: 'project-1', workspaceId: '' }
  it('reads board members into the policy label table, following the project workspace', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/project/project-1')) return response({ id: 'project-1', workspaceId: 'ws-1' })
      if (url.includes('/workspace/ws-1/members')) return response([{ id: 'user-1', name: '高洁' }, { id: 'user-2', name: '', email: 'x@y.example' }])
      return response({})
    }))
    const { ctx, state } = context(config(), { deployment: { kaneo: account } as unknown as Deployment })
    const names = await refreshKaneoMembers(ctx)
    expect(names).toEqual({ 'user-1': '高洁', 'user-2': 'x@y.example' })
    expect(state.get(KV.sources.labels('kaneo'))).toEqual(names)
    expect(calls.some(call => call.includes('/workspace/ws-1/members'))).toBe(true)
  })
  it('answers an empty roster when no Kanban account is configured', async () => {
    const { ctx, state } = context(config({ apiKey: '' }), { deployment: {} as Deployment })
    await expect(refreshKaneoMembers(ctx)).resolves.toEqual({})
    expect(state.get(KV.sources.labels('kaneo'))).toBeUndefined()
  })
})
