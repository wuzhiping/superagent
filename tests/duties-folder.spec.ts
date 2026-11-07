/**
 * The duties folder (user decision 2026-11-07): one markdown file per duty under `duties/`, beside the charter, and a
 * publish that splits one document into those files (removing what the document no longer names, retiring the legacy file).
 */
import { beforeEach, expect, it, vi } from 'vitest'
import { dutiesDirOf, invalidateDutiesCache, publishDuties, readDuties, splitDuties } from '../src/app/duties.ts'
import type { CharterTarget } from '../src/app/charter.ts'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const file = (path: string, text: string, sha: string): Response =>
  json({ name: path.split('/').at(-1), path, sha, type: 'file', encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') })
const entry = (name: string) => ({ name, path: `duties/${name}`, sha: `sha-${name}`, type: 'file' })

type Call = { url: string, method: string, body?: { content?: string, message?: string, sha?: string } }
function serveGitea (options: { dir?: string[], files?: Record<string, string>, legacy?: string } = {}) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const address = String(url)
    calls.push({ url: address, method: init?.method ?? 'GET', ...init?.body ? { body: JSON.parse(String(init.body)) } : {} })
    const path = address.split('/contents/')[1] ?? ''
    if ((init?.method ?? 'GET') === 'PUT' || (init?.method ?? 'GET') === 'DELETE') return json({ content: { sha: 'next' } })
    if (path === 'duties') {
      if (!options.dir) return json({ message: 'not found' }, 404)
      return json(options.dir.map(name => entry(name)))
    }
    if (options.files?.[path]) return file(path, options.files[path]!, `sha-${path}`)
    // A duty file that exists but is not preloaded (a stale one the publish should remove).
    if (path.startsWith('duties/')) return file(path, '# stale\n', `sha-${path}`)
    if (path === 'duties.md' && options.legacy) return file(path, options.legacy, 'legacy-sha')
    return json({ message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, restore: () => vi.unstubAllGlobals() }
}

const target = (): CharterTarget => ({
  kaneo: { baseUrl: 'https://pl.feg.cn', apiKey: 'k' },
  gitea: { baseUrl: 'https://git.feg.cn', user: 'u', password: 'p', token: '', repository: 'acme/charter', path: 'README.md' },
})

beforeEach(() => { invalidateDutiesCache() })

it('reads one duty per file from the duties folder, in file order', async () => {
  const { restore } = serveGitea({
    dir: ['api.md', 'doc.md', 'notes.txt'],
    files: {
      'duties/api.md': '# api · 后台接口实现\n- 目标：按卡片实现接口\n- 承接岗位：w-api\n',
      'duties/doc.md': '# doc · 文档交付\n- 目标：产出文档\n',
    },
  })
  const doc = await readDuties(target())
  expect(doc.mode).toBe('folder')
  expect(doc.duties.map(duty => duty.id)).toEqual(['api', 'doc'])
  expect(doc.duties[0]).toMatchObject({ name: '后台接口实现', goal: '按卡片实现接口', posts: ['w-api'] })
  expect(doc.carrierRef).toBe('acme/charter/duties')
  expect(doc.files).toEqual({ api: 'duties/api.md', doc: 'duties/doc.md' })
  // The combined text is what the editor shows, so the single textarea still works.
  expect(doc.text).toContain('# doc · 文档交付')
  expect(dutiesDirOf('docs/charter.md')).toBe('docs/duties')
  restore()
})

it('falls back to the legacy single file until the folder exists', async () => {
  const { restore } = serveGitea({ legacy: '### doc · 文档交付\n- 目标：产出文档\n' })
  const doc = await readDuties(target())
  expect(doc.mode).toBe('file')
  expect(doc.duties.map(duty => duty.id)).toEqual(['doc'])
  expect(doc.carrierRef).toBe('acme/charter/duties.md')
  restore()
})

it('publishes one file per duty, removes what the document drops, and retires the legacy file', async () => {
  const { calls, restore } = serveGitea({ dir: ['doc.md', 'stale.md'], legacy: '### doc · 旧文档\n' })
  const text = '# 职责说明\n\n### doc · 文档交付\n- 目标：产出文档\n\n### api · 后台接口\n- 目标：写接口\n'
  const published = await publishDuties(target(), text, 'pm-rsi')
  expect(published.files).toEqual(['duties/doc.md', 'duties/api.md'])
  const puts = calls.filter(call => call.method === 'PUT')
  expect(puts.map(call => call.url.split('/contents/')[1])).toEqual(['duties/doc.md', 'duties/api.md'])
  // The heading is normalized to the file's own title, and the underscore in a name is written as a bullet.
  expect(Buffer.from(puts[1]!.body!.content!, 'base64').toString('utf8')).toBe('# api · 后台接口\n\n- 目标：写接口\n')
  const deletes = calls.filter(call => call.method === 'DELETE').map(call => call.url.split('/contents/')[1])
  expect(deletes).toContain('duties/stale.md')
  expect(deletes).toContain('duties.md')
  restore()
})

it('splits a document into file-safe duty ids and refuses an id that cannot be a file name', () => {
  expect(splitDuties('### a_b-1 · A\n- 目标：x\n').map(item => item.id)).toEqual(['a_b-1'])
  expect(() => splitDuties('### 文档 · A\n- 目标：x\n')).toThrow()
})
