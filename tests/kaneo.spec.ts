import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { key, type Trigger } from '../src/core/index.ts'
import { KV, type Family, type Key } from '../src/kv.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { Deployment } from '../src/deployment.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { KaneoClient, KaneoError, type KaneoFetch } from '../src/sources/kaneo-api.ts'
import { kaneoKind, pollRound, SOURCE } from '../src/sources/kaneo.ts'
import { DEFAULT_PROJECT, KaneoConfigSchema, watchColumnsOf, type KaneoConfig } from '../src/sources/kaneo-config.ts'
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
function context(cfg: KaneoConfig): { ctx: SourceContext; recorded: Recorded; state: Map<string, unknown> } {
  const state = new Map<string, unknown>()
  const recorded: Recorded = { triggers: [], described: new Map(), reports: [] }
  const ctx: SourceContext = {
    deployment: {} as Deployment,
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
    threads: { get: () => undefined, subscribed: () => [], describe: (name, description) => { recorded.described.set(name, description) }, patch: () => {} },
    tickets: { get: () => undefined, open: () => [], bindThread: () => {}, threadClosed: () => {} },
    triggers: { get: () => undefined, latest: () => undefined },
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
  it('skips the tasks already in the watched column on the first poll, then requests only new ones and claims them', async () => {
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

    // A third task appears: one request and one claim.
    listed = [task('t1'), task('t2'), task('t3')]
    writes.length = 0
    await pollRound(ctx, cfg, client)
    expect(recorded.triggers.map(trigger => trigger.id)).toEqual([kaneoTriggerId('t3')])
    const moves = writes.filter(write => write.method === 'PUT')
    expect(moves).toHaveLength(1)
    expect(moves[0]?.body).toEqual({ status: 'in-progress' })
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
    await expect(pollRound(ctx, cfg, client)).rejects.toThrow(/Kaneo reads failed/)
    expect(recorded.reports).toHaveLength(0)
  })
})

describe('kaneo channel', () => {
  const commands = { deployment: { kaneo: { baseUrl: 'https://pl.feg.cn', apiKey: 'k', projectId: 'p' } } } as unknown as Commands
  const message = (id: string): Parameters<typeof sendKaneo>[1] => ({ id, text: 'hello there', kind: 'reply',
    channel: { source: 'kaneo', thread: 't1', address: { taskId: 't1', url: 'https://pl.feg.cn/dashboard' } } })

  it('posts a marker-carrying comment and does not repeat one already posted', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if ((init?.method ?? 'GET') === 'GET') return response([{ id: 'c1', content: 'old' }])
      return response({})
    }))
    await expect(sendKaneo({ commands }, message('dsh-1'))).resolves.toBe('sent')
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
    await expect(sendKaneo({ commands }, message('dsh-1'))).resolves.toBe('sent')
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(0)
  })

  it('reports a gone task when the comment target no longer exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'Task not found' }, 404)))
    await expect(sendKaneo({ commands }, message('dsh-2'))).resolves.toBe('gone')
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
  it('surfaces the final HTTP status instead of retrying a refusal', async () => {
    const client = new KaneoClient({ baseUrl: 'https://pl.feg.cn', apiKey: 'k' }, stubFetch(async () => response({ error: 'nope' }, 401)))
    const failure = await client.request(z.unknown(), 'GET', '/task/x').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(KaneoError)
    expect((failure as KaneoError).status).toBe(401)
  })
})
