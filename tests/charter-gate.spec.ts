/**
 * Tests for "没有宪章不可开工": the charter gate refuses work for an archived project without a published charter, and
 * `gateOutcome` turns such an accept into an ignore carrying the reason.
 */
import { expect, it } from 'vitest'
import { charterAllows, type CharterTarget } from '../src/app/charter.ts'
import { gateOutcome } from '../src/app/assessment.ts'
import type { Trigger } from '../src/core/index.ts'

const trigger = (meta: Record<string, unknown> = {}): Trigger => ({
  id: 't1', source: 'kaneo', threads: [{ source: 'kaneo', id: 'p1' }], actor: { source: 'kaneo', id: 'u1' },
  human: true, at: '2026-11-06T00:00:00.000Z', text: 'do it', meta,
})

const archive = (charterVersion: number) => ({
  version: 1,
  projects: [{ id: 'p1', name: 'Project', slug: 'P', topics: [], posts: [],
    charter: { version: charterVersion, publishedAt: '', publishedBy: '', text: charterVersion ? 'version: 1\n' : '',
      draft: '', history: [] } }],
}) as unknown as Parameters<typeof charterAllows>[0]

const target: CharterTarget = {}
const accept = { kind: 'accept', title: 'Do it', scope: 'Do it', reason: { code: 'explicitRouted' } } as const

it('lets a project with a published charter start work', async () => {
  expect(await charterAllows(archive(12), target, trigger({ projectId: 'p1' }))).toBe(true)
})

it('refuses a project whose charter is not published', async () => {
  expect(await charterAllows(archive(0), target, trigger({ projectId: 'p1' }))).toBe(false)
})

it('does not gate a trigger that names no project, or one the archive does not know', async () => {
  expect(await charterAllows(archive(0), target, trigger({}))).toBe(true)
  expect(await charterAllows(archive(0), target, trigger({ projectId: 'other' }))).toBe(true)
})

it('keeps an accept when the gate allows it', async () => {
  const outcome = await gateOutcome(accept, trigger({ projectId: 'p1' }), async () => true)
  expect(outcome.kind).toBe('accept')
})

it('turns an accept into an ignore with the no-charter reason when the gate refuses', async () => {
  const outcome = await gateOutcome(accept, trigger({ projectId: 'p1' }), async () => false)
  expect(outcome.kind).toBe('ignore')
  expect(JSON.stringify(outcome.reason)).toContain('noCharter')
})

it('leaves an accept alone without a gate, a trigger, or an accept outcome', async () => {
  expect((await gateOutcome(accept, trigger({ projectId: 'p1' }), undefined)).kind).toBe('accept')
  expect((await gateOutcome(accept, undefined, async () => false)).kind).toBe('accept')
  const ignore = { kind: 'ignore', reason: { code: 'noAdmissible' } } as const
  expect((await gateOutcome(ignore, trigger({ projectId: 'p1' }), async () => false)).kind).toBe('ignore')
})
