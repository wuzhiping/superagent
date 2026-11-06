/** The PM execution rule: a PM post takes execution work only when the published charter explicitly allows it. */
import { expect, it } from 'vitest'
import { dutyIdOf, pmAllowance, pmExecutionGate } from '../src/app/pm-execution.ts'
import type { Trigger } from '../src/core/index.ts'

const trigger = (labels: string[] = [], actorId = 'u-pm', projectId = 'p1'): Trigger => ({
  id: 't1', source: 'kaneo', threads: [{ source: 'kaneo', id: 'p1' }], actor: { source: 'kaneo', id: actorId },
  human: true, at: '2026-11-06T00:00:00.000Z', text: 'do it', meta: { labels, projectId },
})

const archive = (role: 'pm' | 'worker', postId = role === 'pm' ? 'pm-rsi' : 'w-rsi') => ({
  version: 1,
  projects: [{ id: 'p1', name: 'Project', slug: 'P', topics: [],
    charter: { version: 12, publishedAt: '', publishedBy: '', text: '', draft: '', history: [] },
    posts: [{ postId, role, name: postId, kaneoUser: '', kaneoUserId: 'u-pm', giteaUser: '', ntfySender: '', wipLimit: 3,
      instance: '', watchColumns: '' }] }],
}) as unknown as Parameters<typeof pmExecutionGate>[0]

it('reads no allowance from a charter without the line', () => {
  expect(pmAllowance('version: 12\n# 宪章\n派工与验收')).toEqual({ all: false, duties: [] })
  expect(pmAllowance(undefined)).toEqual({ all: false, duties: [] })
})

it('reads the duties a charter allows the PM to execute', () => {
  expect(pmAllowance('PM 可执行职责：doc, req-analysis')).toEqual({ all: false, duties: ['doc', 'req-analysis'] })
  expect(pmAllowance('- pm-executes: PRD，UI')).toEqual({ all: false, duties: ['prd', 'ui'] })
})

it('reads a wildcard allowance', () => {
  expect(pmAllowance('- PM 可执行职责：*')).toEqual({ all: true, duties: [] })
  expect(pmAllowance('PM 可执行职责：全部')).toEqual({ all: true, duties: [] })
})

it('reads the duty a card names', () => {
  expect(dutyIdOf(trigger(['story-test', 'duty:doc']))).toBe('doc')
  expect(dutyIdOf(trigger(['story-test']))).toBeUndefined()
})

it('lets a worker post take execution work without any charter line', () => {
  expect(pmExecutionGate(archive('worker'), '', trigger())).toEqual({})
})

it('refuses execution work for a PM post when the charter says nothing', () => {
  const gate = pmExecutionGate(archive('pm'), 'version: 12\n派工与验收', trigger(['duty:doc']))
  expect(gate.refuse?.code).toBe('pmExecutionNotAllowed')
  expect(gate.refuse?.detail).toContain('doc')
})

it('allows the duty the charter names, and refuses the others', () => {
  const charter = 'PM 可执行职责：doc'
  expect(pmExecutionGate(archive('pm'), charter, trigger(['duty:doc']))).toEqual({})
  expect(pmExecutionGate(archive('pm'), charter, trigger(['duty:prd'])).refuse?.code).toBe('pmExecutionNotAllowed')
})

it('allows any duty with the wildcard, including a card without a duty label', () => {
  const charter = 'PM 可执行职责：*'
  expect(pmExecutionGate(archive('pm'), charter, trigger(['duty:prd']))).toEqual({})
  expect(pmExecutionGate(archive('pm'), charter, trigger())).toEqual({})
})

it('refuses a card without a duty label when the charter names only specific duties', () => {
  expect(pmExecutionGate(archive('pm'), 'PM 可执行职责：doc', trigger()).refuse?.code).toBe('pmExecutionNotAllowed')
})
