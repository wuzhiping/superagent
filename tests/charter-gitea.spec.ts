import { beforeEach, describe, expect, it, vi } from 'vitest'
import { giteaCharter, invalidateCharterCache, readCharter, readGiteaCharter, publishCharter, type CharterTarget } from '../src/app/charter.ts'
import type { ArchiveProject } from '../src/app/narrative.ts'

const README = [
  '# 宪章 v3',
  'version: 3',
  'publishedBy: pm-rsi',
  'publishedAt: 2026-11-01T00:00:00.000Z',
  '',
  '- 当期流程：ready 待開工 → done 完成',
].join('\n')

/** Gitea's contents API: a base64 README at `README.md`, and a 404 for anything else. */
function serveGitea (options: { text?: string, sha?: string, write?: boolean } = {}) {
  const calls: { url: string, method: string, body?: unknown }[] = []
  const text = options.text ?? README
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const address = String(url)
    calls.push({ url: address, method: init?.method ?? 'GET', ...init?.body ? { body: JSON.parse(String(init.body)) } : {} })
    if (address.includes('/api/v1/version')) return json({ version: '1.27.3' })
    if (init?.method === 'PUT') {
      if (options.write === false) return json({ message: 'user does not have permission' }, 403)
      return json({ content: { sha: 'new-sha' } }, 201)
    }
    if (address.includes('/contents/README.md')) {
      return json({ name: 'README.md', path: 'README.md', sha: options.sha ?? 'old-sha', type: 'file',
        encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') })
    }
    return json({ message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, restore: () => vi.unstubAllGlobals() }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const target = (overrides: Partial<{ repository: string, path: string }> = {}): CharterTarget => ({
  kaneo: { baseUrl: 'https://pl.feg.cn', apiKey: 'k' },
  gitea: { baseUrl: 'https://git.feg.cn', user: 'wu.zhiping@feg.cn', password: 'p', token: '',
    repository: overrides.repository ?? 'shawoo/superagent-charter', path: overrides.path ?? 'README.md' },
})

const project = (): ArchiveProject => ({ id: 'at8xrho45bisco2umjzgl1xp', name: 'Superagent', slug: 'RSI',
  topics: ['pub_at8xrho45bisco2umjzgl1xp'], posts: [],
  charter: { version: 2, publishedAt: '2026-10-01T00:00:00.000Z', publishedBy: 'pm-old', text: 'version: 2', draft: '', history: [] } })

describe('gitea charter: the repository README is the charter', () => {
  beforeEach(() => { invalidateCharterCache() })
  it('reads the version, author and date the README states', async () => {
    const { restore, calls } = serveGitea()
    const charter = await readGiteaCharter(target().gitea!)
    expect(charter).toMatchObject({ version: 3, publishedAt: '2026-11-01T00:00:00.000Z', carrier: 'gitea',
      carrierRef: 'shawoo/superagent-charter/README.md', sha: 'old-sha' })
    expect(calls[0]!.url).toContain('/api/v1/repos/shawoo/superagent-charter/contents/README.md')
    restore()
  })

  it('prefers the repository over the Kanban mirror', async () => {
    const { restore } = serveGitea()
    const info = await readCharter(project(), target())
    expect(info.version).toBe(3)
    expect(info.carrier).toBe('gitea')
    expect(info.carrierRef).toBe('shawoo/superagent-charter/README.md')
    restore()
  })

  it('falls back to the Kanban mirror when the README holds no charter', async () => {
    const { restore } = serveGitea({ text: '# just a readme\n' })
    // The mirror holds a charter in the project's description.
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url)
      if (address.includes('git.feg.cn')) return json({ message: 'not found' }, 404)
      return json({ id: 'p1', name: 'Superagent', slug: 'RSI', icon: '', isPublic: false,
        description: 'version: 2\npublishedBy: pm-old\npublishedAt: 2026-10-01T00:00:00.000Z\n' }, init?.method === 'GET' ? 200 : 200)
    }))
    const info = await readCharter(project(), target())
    expect(info.carrier).toBe('kanban')
    restore()
  })

  it('publishes by committing the stamped text onto the README blob', async () => {
    const { restore, calls } = serveGitea()
    const previous = await readGiteaCharter(target().gitea!)
    const published = await publishCharter(target(), project().id, '# 宪章\n\n- 当期流程：ready → done\n', 'pm-rsi', previous,
      new Date('2026-11-06T00:00:00.000Z'))
    expect(published).toMatchObject({ version: 4, carrier: 'gitea', carrierRef: 'shawoo/superagent-charter/README.md' })
    const put = calls.find(call => call.method === 'PUT')
    expect(put).toBeDefined()
    const body = put!.body as { content: string, message: string, sha?: string }
    expect(body.sha).toBe('old-sha')
    expect(body.message).toContain('charter v4')
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toContain('version: 4')
    restore()
  })

  it('publishes to the Kanban mirror when the repository refuses the write', async () => {
    const { restore } = serveGitea({ write: false })
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url)
      if (init?.method === 'PUT' && address.includes('git.feg.cn')) return json({ message: 'forbidden' }, 403)
      if (init?.method === 'PUT') return json({ ok: true })
      if (address.includes('/contents/README.md')) return json({ message: 'not found' }, 404)
      // The Kanban project: read it back, then accept the description.
      if (init?.method === 'GET' && /\/project\//.test(address)) return json({ id: 'p1', name: 'Superagent', slug: 'RSI', icon: '', isPublic: false, description: '' })
      return json({ id: 'p1', name: 'Superagent', slug: 'RSI', icon: '', isPublic: false, description: 'version: 5\npublishedBy: pm-rsi\n' })
    }))
    const published = await publishCharter(target(), project().id, '# 宪章\n', 'pm-rsi', undefined,
      new Date('2026-11-06T00:00:00.000Z'))
    expect(published.carrier).toBe('kanban')
    expect(published.version).toBe(1)
    restore()
  })
})

describe('the charter repository is separate from the event repository', () => {
  const registry = (config: Record<string, unknown>) => ({
    instances: () => [{ id: 'gitea', kind: 'gitea', enabled: true, config }],
  }) as unknown as Parameters<typeof giteaCharter>[0]
  it('reads the charter from charterRepository and never from the event repository', () => {
    const target = giteaCharter(registry({ baseUrl: 'https://git.feg.cn', user: 'u', password: 'p', token: '',
      repository: 'shawoo/PDP', charterRepository: 'shawoo/rsi_superagent', charterPath: 'README.md' }))
    expect(target).toMatchObject({ repository: 'shawoo/rsi_superagent', path: 'README.md' })
  })
  it('has no Gitea charter when charterRepository is empty, even with an event repository', () => {
    expect(giteaCharter(registry({ repository: 'shawoo/PDP', charterRepository: '' }))).toBeUndefined()
  })
  it('keeps its own path, so the charter file is not tied to the event repository', () => {
    const target = giteaCharter(registry({ repository: 'shawoo/PDP', charterRepository: 'shawoo/rsi_superagent', charterPath: 'docs/charter.md' }))
    expect(target?.path).toBe('docs/charter.md')
  })
})
