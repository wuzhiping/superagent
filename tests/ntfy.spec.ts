import { afterEach, describe, expect, it, vi } from 'vitest'
import { KV, type Family, type Key } from '../src/kv.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { Deployment } from '../src/deployment.ts'
import { key, type Trigger } from '../src/core/index.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { NtfyClient, NtfyError, ntfyAuthHeader, parseNtfyHistory, type NtfyFetch } from '../src/sources/ntfy-api.ts'
import { NtfyConfigSchema, ntfyAccountOf, type NtfyConfig } from '../src/sources/ntfy-config.ts'
import { ntfyKind, ntfySenderOf, ntfyTrigger, pollRound, SOURCE } from '../src/sources/ntfy.ts'

const config = (overrides: Partial<NtfyConfig> = {}): NtfyConfig => NtfyConfigSchema.parse({ topic: 'pub_test', ...overrides })
const message = (id: string, time: number, title = '', body = '') => JSON.stringify({ id, time, event: 'message', topic: 'pub_test', title, message: body })
const history = (lines: string[], status = 200): Response => new Response(lines.join('\n'), { status, headers: { 'content-type': 'application/x-ndjson' } })
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const stubFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): NtfyFetch => {
  const fn = vi.fn(handler)
  return ((input: string, init?: RequestInit) => fn(input, init)) as NtfyFetch
}
/** The Kanban account of the deployed Kanban Source; the messages are filed with it. */
const kaneoAccount = { baseUrl: 'https://pl.feg.cn', apiKey: 'k', projectId: 'project-1', workspaceId: 'ws-1' }
/** The Kaneo REST calls one poll makes: the source label, the card, and the label attached to the card. */
function kaneoRest() {
  const calls: { method: string; url: string; body?: unknown }[] = []
  const stub = () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, url, ...init?.body ? { body: JSON.parse(String(init.body)) } : {} })
      if (url.endsWith('/label')) return response({ id: 'label-1', name: 'from:ntfy' })
      if (url.includes('/task/')) return response({ id: 'card-1', number: 42, title: '#alice', status: 'to-do' })
      return response({ id: 'label-1' })
    }))
  }
  return { calls, stub }
}
function context(cfg: NtfyConfig, options: { kaneo?: typeof kaneoAccount | undefined; ingestEvents?: boolean } = { kaneo: kaneoAccount }) {
  const state = new Map<string, unknown>()
  const triggers: Trigger[] = []
  const reports: { entry: string; health: { state: string; detail: string } }[] = []
  const kaneoConfig = { ingestEvents: options.ingestEvents ?? true }
  const ctx: SourceContext = {
    deployment: { kaneo: options.kaneo } as unknown as Deployment, commands: {} as Commands, ready: Promise.resolve(), configured: () => true,
    config: <C extends Record<string, unknown>>(id: string) => (id === SOURCE ? cfg as unknown as C : id === 'kaneo' ? kaneoConfig as unknown as C : undefined),
    receive: async trigger => { triggers.push(trigger); return 'stored' as const },
    atomic: work => work(),
    state: {
      get: <V,>(name: Key<V>) => state.get(name) as V | undefined,
      set: <V,>(name: Key<V>, value: V | undefined) => { if (value === undefined) state.delete(name); else state.set(name, value) },
      keys: <V,>(family: Family<V, never>) => [...state.keys()].filter(name => name.startsWith(family.prefix)) as Key<V>[],
    },
    threads: { get: () => undefined, subscribed: () => [], describe: () => {}, patch: () => {} },
    tickets: { get: () => undefined, open: () => [], bindThread: () => {}, threadClosed: () => {} },
    triggers: { get: () => undefined, latest: () => undefined },
    notify: () => {},
    report: (entry, health) => { reports.push({ entry, health: health as { state: string; detail: string } }) },
  }
  return { ctx, state, triggers, reports }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('ntfy config and parsing', () => {
  it('defaults to msn.feg.cn and builds auth headers', () => {
    const parsed = NtfyConfigSchema.parse({})
    expect(parsed.baseUrl).toBe('https://msn.feg.cn')
    expect(ntfyAccountOf(parsed)).toBeUndefined()
    expect(ntfyAuthHeader({ mode: 'none', user: '', password: '', token: '' })).toEqual({})
    expect(ntfyAuthHeader({ mode: 'bearer', user: '', password: '', token: 'tk' }).authorization).toBe('Bearer tk')
  })
  it('keeps messages, drops tombstoned ones and malformed lines', () => {
    const text = [message('a', 100), JSON.stringify({ id: 'd', time: 101, event: 'message_delete', sequence_id: 'a' }), message('b', 102), 'nope'].join('\n')
    expect(parseNtfyHistory(text).map(item => item.id)).toEqual(['b'])
  })
})

describe('ntfy trigger', () => {
  it('names the sender from the title and marks a mention as explicit', () => {
    const trigger = ntfyTrigger({ id: 'm1', time: 1000, event: 'message', topic: 'pub_test', title: '#wu.zhiping', message: '@dsh-superagent do it', tags: [] }, config())
    expect(ntfySenderOf('#wu.zhiping')).toBe('wu.zhiping')
    expect(trigger.actor).toEqual({ source: SOURCE, id: 'wu.zhiping' })
    expect(trigger.addressed).toBe('mention')
    expect(trigger.id).toBe(key('ntfy', 'm1'))
    expect(trigger.threads).toEqual([{ source: SOURCE, id: 'pub_test' }])
  })
  it('leaves a message without a mention unaddressed', () => {
    const trigger = ntfyTrigger({ id: 'm2', time: 1000, event: 'message', topic: 'pub_test', title: '#alice', message: 'hello', tags: [] }, config())
    expect(trigger.addressed).toBeUndefined()
    expect(trigger.actor.id).toBe('alice')
  })
})

describe('ntfy polling', () => {
  it('records a baseline first, then files newer messages as Kanban cards', async () => {
    const cfg = config()
    const { ctx, state, triggers, reports } = context(cfg)
    const kaneo = kaneoRest()
    kaneo.stub()
    const client = new NtfyClient({ baseUrl: 'https://msn.feg.cn', topic: 'pub_test', sender: '#dsh-superagent', auth: { mode: 'none', user: '', password: '', token: '' } },
      stubFetch(async () => history([message('m1', Math.floor(Date.now() / 1000), '#alice', '@dsh-superagent hi')])))
    await pollRound(ctx, cfg, client)
    expect(triggers).toHaveLength(0)
    expect(state.get(KV.ntfy.since)).toBeTypeOf('number')
    expect(kaneo.calls).toHaveLength(0)

    state.set(KV.ntfy.since, Math.floor(Date.now() / 1000) - 60)
    await pollRound(ctx, cfg, client)
    // Kanban is the only direct source: the message became a card, not a Trigger.
    expect(triggers).toHaveLength(0)
    const card = kaneo.calls.find(call => call.method === 'POST' && call.url.includes('/task/project-1'))
    expect(card).toBeDefined()
    const body = card?.body as { title: string; description: string; status: string; userId?: string; assigneeId?: string }
    expect(body.title).toBe('#alice')
    expect(body.description).toContain('@dsh-superagent hi')
    expect(body.description).toContain('Source URL: https://msn.feg.cn/pub_test')
    expect(body.description).toContain('此卡由 ntfy 入库')
    expect(body.status).toBe('to-do')
    // The card waits in the pool: nobody is assigned to it.
    expect(body.userId).toBeUndefined()
    expect(body.assigneeId).toBeUndefined()
    const label = kaneo.calls.find(call => call.method === 'POST' && call.url.endsWith('/label'))
    expect((label?.body as { name: string }).name).toBe('from:ntfy')
    const attach = kaneo.calls.find(call => call.method === 'PUT' && call.url.includes('/label/label-1/task'))
    expect((attach?.body as { taskId: string }).taskId).toBe('card-1')
    expect(reports.at(-1)?.health.detail).toContain('card(s) filed in Kanban')
  })

  it('files the same message only once', async () => {
    const cfg = config()
    const { ctx, state } = context(cfg)
    const kaneo = kaneoRest()
    kaneo.stub()
    const client = new NtfyClient({ baseUrl: 'https://msn.feg.cn', topic: 'pub_test', sender: '#dsh-superagent', auth: { mode: 'none', user: '', password: '', token: '' } },
      stubFetch(async () => history([message('m1', Math.floor(Date.now() / 1000) - 30, '#alice', 'hi')])))
    state.set(KV.ntfy.since, Math.floor(Date.now() / 1000) - 60)
    await pollRound(ctx, cfg, client)
    await pollRound(ctx, cfg, client)
    expect(kaneo.calls.filter(call => call.method === 'POST' && call.url.includes('/task/'))).toHaveLength(1)
  })

  it('reports the missing Kanban account instead of dropping the messages', async () => {
    const cfg = config()
    const { ctx, state, triggers } = context(cfg, { kaneo: undefined })
    state.set(KV.ntfy.since, Math.floor(Date.now() / 1000) - 60)
    const client = new NtfyClient({ baseUrl: 'https://msn.feg.cn', topic: 'pub_test', sender: '#dsh-superagent', auth: { mode: 'none', user: '', password: '', token: '' } },
      stubFetch(async () => history([message('m1', Math.floor(Date.now() / 1000) - 30, '#alice', 'hi')])))
    await expect(pollRound(ctx, cfg, client)).rejects.toThrow(/Kanban Source has no API key/)
    expect(triggers).toHaveLength(0)
  })

  it('produces Triggers again when the Kanban inbox is switched off', async () => {
    const cfg = config()
    const { ctx, state, triggers } = context(cfg, { ingestEvents: false })
    state.set(KV.ntfy.since, Math.floor(Date.now() / 1000) - 60)
    const client = new NtfyClient({ baseUrl: 'https://msn.feg.cn', topic: 'pub_test', sender: '#dsh-superagent', auth: { mode: 'none', user: '', password: '', token: '' } },
      stubFetch(async () => history([message('m1', Math.floor(Date.now() / 1000) - 30, '#alice', 'hi')])))
    await pollRound(ctx, cfg, client)
    expect(triggers.map(trigger => trigger.id)).toEqual([key('ntfy', 'm1')])
  })
})

describe('ntfy channel', () => {
  it('publishes with the sender title and a marker, and does not repeat a message already published', async () => {
    const deployment = { ntfy: { baseUrl: 'https://msn.feg.cn', topic: 'pub_test', sender: '#dsh-superagent',
      auth: { mode: 'none', user: '', password: '', token: '' } } } as unknown as Deployment
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if ((init?.method ?? 'GET') === 'GET') return history([])
      return new Response(JSON.stringify({ id: 'out-1' }), { status: 200 })
    }))
    const outbound = { id: 'reply-1', kind: 'reply' as const, text: 'done', channel: { source: SOURCE, thread: 'pub_test',
      address: { topic: 'pub_test', messageId: 'm1', url: 'https://msn.feg.cn/pub_test' } } }
    const commands = { deployment } as unknown as Commands
    await expect(ntfyKind.channel!.send({ commands, config: () => undefined }, outbound)).resolves.toBe('sent')
    const post = calls.find(call => call.init?.method === 'POST')
    expect(String(post?.init?.body)).toContain('<!-- dsh-superagent:reply-1 -->')
    expect((post?.init?.headers as Record<string, string>).Title).toBe('#dsh-superagent')

    vi.stubGlobal('fetch', vi.fn(async () => history([message('existing', 2000, '#dsh-superagent', 'done\n\n<!-- dsh-superagent:reply-1 -->')])))
    await expect(ntfyKind.channel!.send({ commands, config: () => undefined }, outbound)).resolves.toBe('sent')
  })
})

describe('ntfy thread context and client', () => {
  it('reads recent topic messages and surfaces refusals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => history([message('a', 100, '#alice', 'one'), message('b', 200, '#bob', 'two')])))
    const trigger = ntfyTrigger({ id: 'b', time: 200, event: 'message', topic: 'pub_test', title: '#bob', message: 'two', tags: [] }, config())
    const thread = await ntfyKind.threadContext!.read({} as Commands, trigger, 'thread', undefined, config())
    expect(thread.messages.map(item => item.text)).toEqual(['[#alice] one', '[#bob] two'])
    expect(thread.messages[1]).toMatchObject({ from: 'bob' })

    const client = new NtfyClient({ baseUrl: 'https://msn.feg.cn', topic: 'private', sender: '#x', auth: { mode: 'none', user: '', password: '', token: '' } },
      stubFetch(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })))
    const failure = await client.history('1h').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(NtfyError)
    expect((failure as NtfyError).status).toBe(403)
  })
})

