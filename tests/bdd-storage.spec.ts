import { describe, expect, it } from 'vitest'
import {
  connectionFields, credentialsFilePath, fetchStoredConnection, maskKey, readCredentialRef, StoredConnections, storedKaneoAccount,
} from '../src/sources/bdd-storage.ts'

const file = (lines: string[]) => lines.join('\n')

describe('bdd storage: the masked-key lookup', () => {
  it('reads one ref out of the credentials file', () => {
    const text = file(['version: 1', 'refs:', '  AIFE_API_KEY: abc123', '  FEG_API_KEY: zzz', 'other: 1'])
    expect(readCredentialRef(text, 'AIFE_API_KEY')).toBe('abc123')
    expect(readCredentialRef(text, 'FEG_API_KEY')).toBe('zzz')
    expect(readCredentialRef(text, 'MISSING')).toBeNull()
  })

  it('strips quotes and stops at the end of the refs block', () => {
    const text = file(['refs:', '  AIFE_API_KEY: "quoted"', 'block:', '  AIFE_API_KEY: not-this-one'])
    expect(readCredentialRef(text, 'AIFE_API_KEY')).toBe('quoted')
  })

  it('masks a key as sk- plus the base64 of key@ISO', () => {
    const masked = maskKey('secret', new Date('2026-11-05T00:00:00.000Z'))
    expect(masked).toBe(`sk-${Buffer.from('secret@2026-11-05T00:00:00.000Z').toString('base64')}`)
    expect(masked.startsWith('sk-')).toBe(true)
  })

  it('accepts the credentials path override', () => {
    expect(credentialsFilePath({ DSH_CREDENTIALS_PATH: 'D:/x/c.yaml' })).toBe('D:/x/c.yaml')
    expect(credentialsFilePath({ DSH_HOME: 'D:/home' })).toContain('.credentials.yaml')
  })
})

describe('bdd storage: reading one service', () => {
  const response = (payload: unknown, status = 200) => async () => new Response(JSON.stringify(payload), { status })

  it('picks the kaneo key out of the record, regardless of the field casing', () => {
    expect(connectionFields('kaneo', { mode: 'iframe', API_KEY: 'k-123' })).toEqual({ apiKey: 'k-123' })
  })

  it('picks the gitea server, email and password', () => {
    expect(connectionFields('gitea', { GIT_URL: 'https://git.feg.cn', EMAIL: 'a@b.c', PASSWD: 'p' }))
      .toEqual({ baseUrl: 'https://git.feg.cn', email: 'a@b.c', password: 'p' })
  })

  it('picks the ntfy user, password and server', () => {
    expect(connectionFields('ntfy', { uid: 'jinbe', pwd: 'p', NTFY_URL: 'https://msn.feg.cn' }))
      .toEqual({ user: 'jinbe', password: 'p', server: 'https://msn.feg.cn' })
  })

  it('sends the masked key to the storage host and returns the fields', async () => {
    const calls: { url: string, body: string }[] = []
    const result = await fetchStoredConnection('kaneo', {
      readFile: () => file(['refs:', '  AIFE_API_KEY: abc']),
      now: new Date('2026-11-05T00:00:00.000Z'),
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body) })
        return new Response(JSON.stringify({ API_KEY: 'k-123' }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fields).toEqual({ apiKey: 'k-123' })
    expect(calls[0]!.url).toBe('https://abc.feg.com.tw/BDD/API/AI/dsh/storage/kaneo')
    expect(calls[0]!.body).toContain('sk-')
  })

  it('reports a missing credential reference instead of throwing', async () => {
    const result = await fetchStoredConnection('gitea', { readFile: () => 'refs:\n' })
    expect(result).toMatchObject({ ok: false, stage: 'credential' })
  })

  it('reports an empty record as a response failure', async () => {
    const result = await fetchStoredConnection('ntfy', {
      readFile: () => file(['refs:', '  AIFE_API_KEY: abc']),
      fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, stage: 'response' })
  })
})

describe('bdd storage: the process store', () => {
  it('caches a resolved connection and drops it on invalidate', async () => {
    let lookups = 0
    const store = new StoredConnections(() => ({
      readFile: () => file(['refs:', '  AIFE_API_KEY: abc']),
      fetchImpl: (async () => {
        lookups += 1
        return new Response(JSON.stringify({ API_KEY: `k-${lookups}` }), { status: 200 })
      }) as unknown as typeof fetch,
    }))
    expect(store.peek('kaneo')).toBeUndefined()
    await store.get('kaneo')
    expect(store.peek('kaneo')).toEqual({ apiKey: 'k-1' })
    await store.get('kaneo')
    expect(lookups).toBe(1)
    store.invalidate('kaneo')
    expect(store.peek('kaneo')).toBeUndefined()
    await store.get('kaneo', { force: true })
    expect(lookups).toBe(2)
  })

  it('exposes the kaneo account only once the record is read', async () => {
    expect(storedKaneoAccount('https://pl.feg.cn')).toBeUndefined()
  })
})
