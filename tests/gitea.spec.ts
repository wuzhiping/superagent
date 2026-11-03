import { afterEach, describe, expect, it, vi } from 'vitest'
import { KV, type Family, type Key } from '../src/kv.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { Deployment } from '../src/deployment.ts'
import { key, type Trigger } from '../src/core/index.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { GiteaClient, type GiteaFetch } from '../src/sources/gitea-api.ts'
import { GiteaConfigSchema, giteaBot, repositoryOf, type GiteaConfig } from '../src/sources/gitea-config.ts'
import { commentTrigger, giteaKind, giteaThreadKey, issueTrigger, notificationTrigger, pollRound, refFromUrl, SOURCE } from '../src/sources/gitea.ts'

const config = (overrides: Partial<GiteaConfig> = {}): GiteaConfig => GiteaConfigSchema.parse({ repository: 'acme/widgets', ...overrides })
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const stubFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): GiteaFetch => {
  const fn = vi.fn(handler)
  return ((input: string, init?: RequestInit) => fn(input, init)) as GiteaFetch
}
const issue = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 1, number: 5, title: 'Fix it', body: 'Please @dsh-superagent', state: 'open',
  user: { login: 'alice' }, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', html_url: 'https://git.feg.cn/acme/widgets/issues/5', ...overrides })
const comment = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 9, body: 'looks good', user: { login: 'bob' },
  created_at: '2026-11-02T01:00:00Z', updated_at: '2026-11-02T01:00:00Z', html_url: 'https://git.feg.cn/acme/widgets/issues/5#issuecomment-9',
  issue_url: 'https://git.feg.cn/api/v1/repos/acme/widgets/issues/5', ...overrides })
function context(cfg: GiteaConfig) {
  const state = new Map<string, unknown>()
  const triggers: Trigger[] = []
  const reports: { entry: string; health: { state: string; detail: string } }[] = []
  const ctx: SourceContext = {
    deployment: {} as Deployment, commands: {} as Commands, ready: Promise.resolve(), configured: () => true,
    config: <C extends Record<string, unknown>>(id: string) => (id === SOURCE ? cfg as unknown as C : undefined),
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

describe('gitea config and refs', () => {
  it('defaults to git.feg.cn and parses repository and URLs', () => {
    const parsed = GiteaConfigSchema.parse({})
    expect(parsed.baseUrl).toBe('https://git.feg.cn')
    expect(parsed.listen).toBe('repo')
    expect(parsed.user).toBe('')
    expect(parsed.password).toBe('')
    expect(repositoryOf('acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' })
    expect(refFromUrl('https://git.feg.cn/api/v1/repos/acme/widgets/issues/7')).toEqual({ owner: 'acme', repo: 'widgets', index: 7 })
  })
  it('treats a [bot] login and an explicit list as bots', () => {
    expect(giteaBot('ci[bot]', { bots: '' })).toBe(true)
    expect(giteaBot('ci', { bots: 'ci, deploy' })).toBe(true)
    expect(giteaBot('alice', { bots: '' })).toBe(false)
  })
})

describe('gitea client authentication', () => {
  it('sends HTTP Basic for an e-mail and password account', async () => {
    let header: unknown
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', user: 'wu.zhiping@feg.cn', password: 'secret' }, stubFetch(async (_url, init) => {
      header = (init?.headers as Record<string, string>).authorization
      return response({ version: '1.27.3' })
    }))
    await expect(client.version()).resolves.toBe('1.27.3')
    expect(header).toBe(`Basic ${Buffer.from('wu.zhiping@feg.cn:secret').toString('base64')}`)
  })
  it('prefers an API token when one is set', async () => {
    let header: unknown
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', user: 'u', password: 'p', token: 'tk' }, stubFetch(async (_url, init) => {
      header = (init?.headers as Record<string, string>).authorization
      return response({ version: '1.27.3' })
    }))
    await client.version()
    expect(header).toBe('token tk')
  })
})

describe('gitea triggers', () => {
  it('turns an issue whose body mentions the agent into an explicit request', () => {
    const trigger = issueTrigger(issue() as never, { owner: 'acme', repo: 'widgets', index: 5 }, config())
    expect(trigger.source).toBe(SOURCE)
    expect(trigger.addressed).toBe('mention')
    expect(trigger.id).toBe(key('gitea', 'acme/widgets#5', 'i:2026-11-02T00:00:00Z'))
    expect(trigger.channel?.address).toMatchObject({ owner: 'acme', repo: 'widgets', index: '5' })
    expect(giteaThreadKey({ owner: 'acme', repo: 'widgets', index: 5 })).toBe('gitea:acme/widgets#5')
  })
  it('leaves an unmentioned comment unaddressed and names the sender', () => {
    const trigger = commentTrigger(comment() as never, { owner: 'acme', repo: 'widgets', index: 5 }, config(), 'now', 'Fix it')
    expect(trigger.addressed).toBeUndefined()
    expect(trigger.actor.id).toBe('bob')
    expect(trigger.text).toContain('Fix it')
  })
  it('treats a notification as addressed, with the agent account notified directly', () => {
    const trigger = notificationTrigger({ id: 'n1', unread: true, updated_at: '2026-11-02T02:00:00Z', subject: { title: 'mentioned', type: 'Issue' } },
      { owner: 'acme', repo: 'widgets', index: 5 }, config(), undefined)
    expect(trigger.addressed).toBe('mention')
    expect(trigger.id).toBe(key('gitea', 'acme/widgets#5', 'n:n1'))
  })
})

describe('gitea polling', () => {
  it('records a baseline first, then turns issues and comments into Triggers', async () => {
    const cfg = config()
    const { ctx, state, triggers } = context(cfg)
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', token: '' }, stubFetch(async url => {
      if (url.includes('/issues/comments')) return response([comment()])
      if (url.includes('/issues')) return response([issue()])
      return response([])
    }))
    await pollRound(ctx, cfg, client)
    expect(triggers).toHaveLength(0)
    expect(state.get(KV.gitea.repo)).toBeTruthy()

    await pollRound(ctx, cfg, client)
    expect(triggers.map(trigger => trigger.id)).toEqual([
      key('gitea', 'acme/widgets#5', 'i:2026-11-02T00:00:00Z'),
      key('gitea', 'acme/widgets#5', 'c:9'),
    ])
    expect(triggers[0]?.addressed).toBe('mention')
  })
  it('keeps polling when one stream fails, reporting the partial result', async () => {
    const cfg = config()
    const { ctx, state, reports } = context(cfg)
    state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', user: '', password: '' }, stubFetch(async url => {
      if (url.includes('/issues/comments')) return response({ message: 'issue does not exist' }, 500)
      return response([issue()])
    }))
    await expect(pollRound(ctx, cfg, client)).resolves.toBeGreaterThan(0)
    expect(reports.at(-1)?.health.state).toBe('ready')
    expect(reports.at(-1)?.health.detail).toContain('partial')
  })
})

describe('gitea channel', () => {
  it('posts a marker-carrying issue comment and does not repeat one already posted', async () => {
    const deployment = { gitea: { baseUrl: 'https://git.feg.cn', token: 't', repository: 'acme/widgets' } } as unknown as Deployment
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if ((init?.method ?? 'GET') === 'GET') return response([])
      return response(comment())
    }))
    const message = { id: 'reply-1', kind: 'reply' as const, text: 'done', channel: { source: SOURCE, thread: 'acme/widgets#5',
      address: { owner: 'acme', repo: 'widgets', index: '5', url: 'https://git.feg.cn/acme/widgets/issues/5' } } }
    const commands = { deployment } as unknown as Commands
    await expect(giteaKind.channel!.send({ commands }, message)).resolves.toBe('sent')
    const post = calls.find(call => call.init?.method === 'POST')
    expect(String(post?.init?.body)).toContain('<!-- dsh-superagent:reply-1 -->')

    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return response([comment({ body: 'done\n\n<!-- dsh-superagent:reply-1 -->' })])
    }))
    await expect(giteaKind.channel!.send({ commands }, message)).resolves.toBe('sent')
    expect(calls.some(call => call.init?.method === 'POST')).toBe(true)
  })
})

describe('gitea thread context', () => {
  it('returns the issue body and its comments', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      if (url.includes('/comments')) return response([comment()])
      return response(issue())
    }))
    const trigger = issueTrigger(issue() as never, { owner: 'acme', repo: 'widgets', index: 5 }, config())
    const thread = await giteaKind.threadContext!.read({} as Commands, trigger, 'thread', undefined, config())
    expect(thread.messages).toHaveLength(2)
    expect(thread.messages[1]).toMatchObject({ from: 'bob', text: 'looks good' })
  })
})

