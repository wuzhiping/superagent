import { afterEach, expect, it, vi } from 'vitest'
import { invalidateProjectChoices, readProjectChoices } from '../src/app/projects.ts'

const account = { baseUrl: 'https://pl.feg.cn', apiKey: 'k-123' }

/** Answers the two list endpoints the way the server does, and remembers what was asked. */
function serve (projects: Record<string, unknown[]>, options: { failWorkspace?: boolean } = {}) {
  const asked: string[] = []
  const fetchMock = vi.fn(async (url: string | URL) => {
    const text = String(url)
    asked.push(text)
    if (text.includes('/api/workspace')) {
      if (options.failWorkspace) return new Response(JSON.stringify({ message: 'refused' }), { status: 401 })
      return new Response(JSON.stringify([{ id: 'w1', name: 'ATEAM' }, { id: 'w2', name: 'FEIT' }]), { status: 200 })
    }
    const workspaceId = /workspaceId=([^&]+)/.exec(text)?.[1] ?? ''
    return new Response(JSON.stringify(projects[workspaceId] ?? []), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { asked }
}

afterEach(() => { vi.unstubAllGlobals(); invalidateProjectChoices() })

it('lists the workspaces and their projects, with the workspace each project lives in', async () => {
  const { asked } = serve({
    w1: [{ id: 'p1', name: 'FDEP', slug: 'FDE', workspaceId: 'w1' }, { id: 'p2', name: 'Superagent', slug: 'RSI', workspaceId: 'w1' }],
    w2: [],
  })
  const choices = await readProjectChoices(account, { force: true })
  expect(choices.workspaces.map(workspace => workspace.name)).toEqual(['ATEAM', 'FEIT'])
  expect(choices.projects.map(project => project.id)).toEqual(['p1', 'p2'])
  expect(choices.projects[0]).toMatchObject({ workspaceId: 'w1' })
  expect(choices.problem).toBeUndefined()
  expect(asked.filter(url => url.includes('/api/project?workspaceId='))).toHaveLength(2)
})

it('sorts projects by name so the picker is predictable', async () => {
  serve({ w1: [{ id: 'p2', name: 'Superagent', slug: 'RSI' }, { id: 'p1', name: 'FDEP', slug: 'FDE' }] })
  const choices = await readProjectChoices(account, { force: true })
  expect(choices.projects.map(project => project.name)).toEqual(['FDEP', 'Superagent'])
})

it('caches the answer for a minute and reads it again when forced', async () => {
  const { asked } = serve({ w1: [{ id: 'p1', name: 'FDEP', slug: 'FDE' }] })
  const now = Date.now()
  await readProjectChoices(account, { force: true, now })
  await readProjectChoices(account, { now: now + 1000 })
  expect(asked.filter(url => url.includes('/api/workspace'))).toHaveLength(1)
  await readProjectChoices(account, { force: true, now: now + 2000 })
  expect(asked.filter(url => url.includes('/api/workspace'))).toHaveLength(2)
})

it('explains a missing account instead of asking the server', async () => {
  const { asked } = serve({})
  const choices = await readProjectChoices(undefined)
  expect(asked).toHaveLength(0)
  expect(choices.projects).toEqual([])
  expect(choices.problem).toContain('no Kanban account')
})

it('reports a refusal and keeps the picker readable', async () => {
  serve({}, { failWorkspace: true })
  const choices = await readProjectChoices(account, { force: true })
  expect(choices.projects).toEqual([])
  expect(choices.problem).toContain('401')
})
