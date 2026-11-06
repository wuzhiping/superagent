import { describe, expect, it } from 'vitest'
import { readResource, resourceGrammar, type ResourceHost } from '../src/app/resources.ts'

/** A ResourceHost with only what the charter route reads: the ticket it belongs to and the charter itself. */
function host (charter: Awaited<ReturnType<ResourceHost['charter']>>): ResourceHost {
  return {
    store: { tickets: { get: (id: string) => id === 't1' ? { id: 't1', projectId: 'p1' } : undefined } } as unknown as ResourceHost['store'],
    pages: { get: () => undefined, set: () => {} } as unknown as ResourceHost['pages'],
    prompts: {} as ResourceHost['prompts'],
    commands: {} as ResourceHost['commands'],
    masterId: 'master',
    context: {} as ResourceHost['context'],
    promptVersion: () => ({ revision: 0, config: {} } as never),
    mayRead: () => true,
    feishuPageSize: () => 20,
    sourceLink: async () => ({}),
    charter: async projectId => projectId === 'p1' ? charter : undefined,
    duty: async () => undefined,
  }
}

const charter = { version: 11, carrier: 'gitea', carrierRef: 'shawoo/rsi_superagent/README.md',
  publishedAt: '2026-11-05T20:53:27.801Z', text: '# 宪章 · RSI 项目\n\n- 当期流程：to-do → in-progress → done\n' }

describe('the charter resource a worker reads', () => {
  it('names its version, its carrier and its text', async () => {
    const page = await readResource(host(charter), 'charter', 0, 4000, 't1') as Record<string, unknown>
    expect(page).toMatchObject({ resource: 'charter', version: 11, carrier: 'gitea',
      carrier_ref: 'shawoo/rsi_superagent/README.md', published_at: '2026-11-05T20:53:27.801Z' })
    expect(String(page.text)).toContain('当期流程')
    expect(page.total_chars).toBe(charter.text.length)
    expect(page.next_offset).toBeNull()
  })

  it('pages the text, so a long charter stays out of the prompt until asked for', async () => {
    const first = await readResource(host(charter), 'charter', 0, 20, 't1') as Record<string, unknown>
    expect(first.next_offset).toBe(20)
    const second = await readResource(host(charter), 'charter', 20, 4000, 't1') as Record<string, unknown>
    expect(String(second.text)).toBe(charter.text.slice(20))
  })

  it('refuses a project without a charter, and a session without a ticket', async () => {
    await expect(readResource(host(undefined), 'charter', 0, 4000, 't1')).rejects.toThrow(/No charter/)
    await expect(readResource(host(charter), 'charter', 0, 4000)).rejects.toThrow(/from a ticket/)
  })

  it('is announced to worker Sessions in the resource list', () => {
    expect(resourceGrammar(true)).toContain('charter: the project charter')
    // The main Session reads the full grammar; the charter is additionally marked executor, so workers see it too.
    expect(resourceGrammar(false)).toContain('charter: the project charter')
  })
})
