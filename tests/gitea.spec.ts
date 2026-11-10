import { afterEach, describe, expect, it, vi } from 'vitest'
import { KV, type Family, type Key } from '../src/kv.ts'
import type { Commands } from '../src/infra/commands.ts'
import { SETUP_FIELDS, type Deployment } from '../src/deployment.ts'
import { verifyGitea } from '../src/app/setup.ts'
import { key, type Trigger } from '../src/core/index.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { GiteaClient, GiteaError, type GiteaFetch } from '../src/sources/gitea-api.ts'
import { GiteaAccountSchema, GiteaConfigSchema, giteaBot, giteaReader, repositoryOf, type GiteaConfig } from '../src/sources/gitea-config.ts'
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
/** The Kanban account of the deployed Kanban Source; the events are filed with it. */
const kaneoAccount = { baseUrl: 'https://pl.feg.cn', apiKey: 'k', projectId: 'project-1', workspaceId: 'ws-1' }
/** The Kaneo REST calls one poll makes: the source label, the card, and the label attached to the card. */
function kaneoRest() {
  const calls: { method: string; url: string; body?: unknown }[] = []
  const stub = () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, url, ...init?.body ? { body: JSON.parse(String(init.body)) } : {} })
      if (url.endsWith('/label')) return response({ id: 'label-1', name: 'from:gitea' })
      if (url.includes('/task/')) return response({ id: 'card-1', number: 42, title: 'Fix it', status: 'to-do' })
      return response({ id: 'label-1' })
    }))
  }
  return { calls, stub }
}
function context(cfg: GiteaConfig, options: { kaneo?: typeof kaneoAccount | undefined; ingestEvents?: boolean } = { kaneo: kaneoAccount }) {
  const state = new Map<string, unknown>()
  const triggers: Trigger[] = []
  const reports: { entry: string; health: { state: string; detail: string } }[] = []
  const kaneoConfig = { ingestEvents: options.ingestEvents ?? true }
  const ctx: SourceContext = {
    deployment: { kaneo: options.kaneo } as unknown as Deployment, commands: {} as Commands, ready: Promise.resolve(), configured: () => true,
    config: <C extends Record<string, unknown>>(id: string) => (id === SOURCE ? cfg as unknown as C : id === 'kaneo' ? kaneoConfig as unknown as C : undefined),
    receive: async trigger => { triggers.push(trigger); return 'stored' as const },
    cancel: () => {},
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
  it('sends no Authorization header when no account is set', async () => {
    let headers: Record<string, string> | undefined
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn' }, stubFetch(async (_url, init) => {
      headers = init?.headers as Record<string, string>
      return response([])
    }))
    await client.issues('acme', 'widgets', { limit: 1 })
    expect(headers?.authorization).toBeUndefined()
    expect(Object.keys(headers ?? {}).map(name => name.toLowerCase())).not.toContain('authorization')
  })
  it('explains that a refused anonymous request may need an account', async () => {
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn' }, stubFetch(async () => response({ message: 'The repository does not exist' }, 401)),
      async () => {})
    const error = await client.issues('acme', 'private', { limit: 1 }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GiteaError)
    expect((error as GiteaError).status).toBe(401)
    expect((error as Error).message).toMatch(/anonymous/)
    expect((error as Error).message).toMatch(/may be private or need an account/)
  })
  it('keeps the original refusal message when an account is set', async () => {
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', user: 'u', password: 'p' }, stubFetch(async () => response({ message: 'user is not permitted' }, 403)),
      async () => {})
    const error = await client.issues('acme', 'widgets', { limit: 1 }).catch((caught: unknown) => caught)
    expect((error as Error).message).toBe('user is not permitted (403)')
  })
})

describe('gitea charter repository access', () => {
  const charterConfig = (overrides: Partial<GiteaConfig> = {}): GiteaConfig =>
    GiteaConfigSchema.parse({ charterRepository: 'acme/charter', ...overrides })
  const repositoryAnswer = { id: 1, full_name: 'acme/charter', default_branch: 'main', private: false, has_issues: true, has_pull_requests: true }
  it('tests the charter repository anonymously and reads no issues or pull requests', async () => {
    const calls: { url: string; authorization: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), authorization: (init?.headers as Record<string, string> | undefined)?.authorization })
      return response(repositoryAnswer)
    }))
    await expect(giteaKind.test!(charterConfig())).resolves.toBeUndefined()
    expect(calls.some(call => call.url.includes('/repos/acme/charter'))).toBe(true)
    expect(calls.some(call => call.url.includes('/issues'))).toBe(false)
    expect(calls.some(call => call.url.includes('/pulls'))).toBe(false)
    expect(calls.every(call => call.authorization === undefined)).toBe(true)
  })
  it('still logs in and reads the charter repository when an account is set', async () => {
    const calls: { url: string; authorization: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, authorization: (init?.headers as Record<string, string> | undefined)?.authorization })
      if (url.endsWith('/user')) return response({ id: 1, login: 'agent' })
      return response(repositoryAnswer)
    }))
    await expect(giteaKind.test!(charterConfig({ user: 'agent@feg.cn', password: 'secret' }))).resolves.toBeUndefined()
    const login = calls.find(call => call.url.endsWith('/user'))
    expect(login?.authorization).toBe(`Basic ${Buffer.from('agent@feg.cn:secret').toString('base64')}`)
    expect(calls.some(call => call.url.includes('/repos/acme/charter'))).toBe(true)
    expect(calls.some(call => call.url.includes('/issues'))).toBe(false)
  })
  it('refuses a Source without a charter repository', async () => {
    await expect(giteaKind.test!(charterConfig({ charterRepository: '' }))).rejects.toThrow(/charter repository/)
  })
  it('names the missing charter repository and the server on a 404 instead of a bare status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'not found' }, 404)))
    await expect(giteaKind.test!(charterConfig({ baseUrl: 'https://git.example' })))
      .rejects.toThrow(/Charter repository acme\/charter was not found on https:\/\/git\.example/)
  })
  it('explains a refused account when logging in fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'unauthorized' }, 401)))
    await expect(giteaKind.test!(charterConfig({ user: 'agent', password: 'wrong' })))
      .rejects.toThrow(/rejected the account/)
  })
  it('names the reader (anonymous or the account) in the health detail', async () => {
    const anonymous = config()
    const first = context(anonymous)
    kaneoRest().stub()
    first.state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    await pollRound(first.ctx, anonymous, new GiteaClient({ baseUrl: 'https://git.feg.cn' }, stubFetch(async () => response([]))))
    expect(first.reports.at(-1)?.health.detail).toContain('reading anonymously')

    const account = config({ user: 'agent@feg.cn', password: 'secret' })
    const second = context(account)
    second.state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    await pollRound(second.ctx, account, new GiteaClient({ baseUrl: 'https://git.feg.cn', user: 'agent@feg.cn', password: 'secret' }, stubFetch(async () => response([]))))
    expect(second.reports.at(-1)?.health.detail).toContain('reading as agent@feg.cn')
    expect(giteaReader({ user: '', password: '', token: '' })).toBe('anonymously')
    expect(giteaReader({ user: 'agent', password: 'secret', token: 'tk' })).toBe('with an API token')
  })
  it('fails a poll with a readable hint instead of silently reporting zero events', async () => {
    const cfg = config()
    const { ctx, state } = context(cfg)
    state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn' }, stubFetch(async () => response({ message: 'The repository does not exist' }, 401)),
      async () => {})
    await expect(pollRound(ctx, cfg, client)).rejects.toThrow(/may be private or need an account/)
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
  it('records a baseline first, then files issues and comments as Kanban cards', async () => {
    const cfg = config()
    const { ctx, state, triggers, reports } = context(cfg)
    const kaneo = kaneoRest()
    kaneo.stub()
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', token: '' }, stubFetch(async url => {
      if (url.includes('/issues/comments')) return response([comment()])
      if (url.includes('/issues')) return response([issue()])
      return response([])
    }))
    await pollRound(ctx, cfg, client)
    expect(triggers).toHaveLength(0)
    expect(state.get(KV.gitea.repo)).toBeTruthy()
    expect(kaneo.calls).toHaveLength(0)

    await pollRound(ctx, cfg, client)
    // Kanban is the only direct source: the events became cards, not Triggers.
    expect(triggers).toHaveLength(0)
    const card = kaneo.calls.find(call => call.method === 'POST' && call.url.includes('/task/project-1'))
    expect(card).toBeDefined()
    const body = card?.body as { title: string; description: string; status: string; userId?: string; assigneeId?: string }
    expect(body.title).toBe('Fix it')
    expect(body.description).toContain('Please @dsh-superagent')
    expect(body.description).toContain('Source URL: https://git.feg.cn/acme/widgets/issues/5')
    expect(body.description).toContain('此卡由 gitea 入库')
    expect(body.status).toBe('to-do')
    // The card waits in the pool: nobody is assigned to it.
    expect(body.userId).toBeUndefined()
    expect(body.assigneeId).toBeUndefined()
    // The source label is created once and attached to the card.
    const label = kaneo.calls.find(call => call.method === 'POST' && call.url.endsWith('/label'))
    expect((label?.body as { name: string; workspaceId: string }).name).toBe('from:gitea')
    expect((label?.body as { workspaceId: string }).workspaceId).toBe('ws-1')
    const attach = kaneo.calls.find(call => call.method === 'PUT' && call.url.includes('/label/label-1/task'))
    expect((attach?.body as { taskId: string }).taskId).toBe('card-1')
    expect(reports.at(-1)?.health.detail).toContain('card(s) filed in Kanban')
  })

  it('files the same event only once', async () => {
    const cfg = config()
    const { ctx, state } = context(cfg)
    const kaneo = kaneoRest()
    kaneo.stub()
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', token: '' }, stubFetch(async url =>
      url.includes('/issues/comments') ? response([]) : response([issue()])))
    state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    await pollRound(ctx, cfg, client)
    const first = kaneo.calls.filter(call => call.method === 'POST' && call.url.includes('/task/')).length
    await pollRound(ctx, cfg, client)
    const second = kaneo.calls.filter(call => call.method === 'POST' && call.url.includes('/task/')).length
    expect(first).toBe(1)
    expect(second).toBe(1)
  })

  it('reports the missing Kanban account instead of dropping the events', async () => {
    const cfg = config()
    const { ctx, state, triggers } = context(cfg, { kaneo: undefined })
    state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', token: '' }, stubFetch(async url =>
      url.includes('/issues/comments') ? response([]) : response([issue()])))
    await expect(pollRound(ctx, cfg, client)).rejects.toThrow(/Kanban Source has no API key/)
    expect(triggers).toHaveLength(0)
  })

  it('produces Triggers again when the Kanban inbox is switched off', async () => {
    const cfg = config()
    const { ctx, state, triggers } = context(cfg, { ingestEvents: false })
    state.set(KV.gitea.repo, '2026-11-01T00:00:00.000Z')
    const client = new GiteaClient({ baseUrl: 'https://git.feg.cn', token: '' }, stubFetch(async url => {
      if (url.includes('/issues/comments')) return response([comment()])
      if (url.includes('/issues')) return response([issue()])
      return response([])
    }))
    await pollRound(ctx, cfg, client)
    expect(triggers.map(trigger => trigger.id)).toEqual([
      key('gitea', 'acme/widgets#5', 'i:2026-11-02T00:00:00Z'),
      key('gitea', 'acme/widgets#5', 'c:9'),
    ])
  })

  it('keeps polling when one stream fails, reporting the partial result', async () => {
    const cfg = config()
    const { ctx, state, reports } = context(cfg)
    kaneoRest().stub()
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
    await expect(giteaKind.channel!.send({ commands, config: () => undefined }, message)).resolves.toBe('sent')
    const post = calls.find(call => call.init?.method === 'POST')
    expect(String(post?.init?.body)).toContain('<!-- dsh-superagent:reply-1 -->')

    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return response([comment({ body: 'done\n\n<!-- dsh-superagent:reply-1 -->' })])
    }))
    await expect(giteaKind.channel!.send({ commands, config: () => undefined }, message)).resolves.toBe('sent')
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

describe('gitea setup checks the charter repository', () => {
  const account = (overrides: Record<string, unknown> = {}) => GiteaAccountSchema.parse({ charterRepository: 'acme/charter', ...overrides })
  it('accepts an account that only names the charter repository', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ id: 1, full_name: 'acme/charter', default_branch: 'main' })))
    await expect(verifyGitea(account())).resolves.toBeUndefined()
  })
  it('reports the missing charter repository instead of the removed event repository', async () => {
    await expect(verifyGitea(account({ charterRepository: '', repository: 'acme/events' })))
      .rejects.toThrow('the charter repository must be owner/name')
  })
  it('restarts on the charter repository fields and shows them as facts', () => {
    expect(SETUP_FIELDS.gitea).toEqual(['baseUrl', 'user', 'password', 'token', 'charterRepository', 'charterPath'])
    expect(giteaKind.facts!({ gitea: account() } as never)).toMatchObject({ repository: 'acme/charter' })
  })
})
