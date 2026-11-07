/** The narrative layer: the project archive, the charter it points at, and the duties and exceptions a post carries. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  archivePath, archiveRevision, charterOfText, charterVersionOf, dutyRows, enrichTicket, exceptionRows, flowOfCharter,
  postOfActor, readArchive, rememberCharterVersion, writeArchive, type ProjectArchive,
} from '../src/app/narrative.ts'
import { Store } from '../src/app/store.ts'
import type { Ticket, Trigger } from '../src/core/model.ts'

let directory: string
let store: Store
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'narrative-'))
  store = new Store(join(directory, 'db.sqlite'))
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

const archive = (): ProjectArchive => ({ version: 1, projects: [{
  id: 'p1', name: 'FDEP', slug: 'FDE',
  charter: { version: 4, publishedAt: '2026-09-22T00:00:00Z', publishedBy: 'agent:pm', text: 'version: 4', draft: '', history: [] },
  topics: ['pub_fdep_pm'],
  posts: [{ postId: 'pm-fdep', role: 'pm', name: 'PM', kaneoUser: '', kaneoUserId: 'u-pm', giteaUser: 'sa-pm', ntfySender: '#sa-pm',
    wipLimit: 2, instance: 'web', watchColumns: 'ready', duties: [] },
    { postId: 'w1-fdep', role: 'worker', name: 'W1', kaneoUser: '', kaneoUserId: 'u-w1', giteaUser: '', ntfySender: '', wipLimit: 1, instance: '',
      watchColumns: 'ready', duties: [] }],
}] })

it('writes the archive, reads it back, and changes the revision when it changes', () => {
  expect(readArchive(directory)).toEqual({ version: 1, projects: [] })
  const first = writeArchive(directory, archive(), 0)
  expect(readArchive(directory).projects[0]?.posts).toHaveLength(2)
  expect(archiveRevision(directory)).toBe(first.revision)
  const second = writeArchive(directory, { ...archive(), projects: [] }, first.revision)
  expect(second.revision).not.toBe(first.revision)
  expect(readArchive(directory).projects).toHaveLength(0)
})

it('refuses to overwrite an archive that changed since it was read, and rejects an invalid one', () => {
  const first = writeArchive(directory, archive(), 0)
  writeArchive(directory, { version: 1, projects: [] }, first.revision)
  expect(() => writeArchive(directory, archive(), first.revision)).toThrow(/changed since it was loaded/)
  expect(() => writeArchive(directory, { projects: [{ id: '' }] }, 0)).toThrow()
})

it('finds the post a KanEO actor belongs to', () => {
  expect(postOfActor(archive(), 'u-w1')?.postId).toBe('w1-fdep')
  expect(postOfActor(archive(), 'unknown')).toBeUndefined()
})

it('reads the charter version from its text and marks an old charter stale', () => {
  const fresh = charterOfText('# 宪章\nversion: 4\n', '2026-09-22T00:00:00Z', 'agent:pm', Date.parse('2026-09-23T00:00:00Z'))
  expect(fresh.version).toBe(4)
  expect(fresh.stale).toBe(false)
  expect(fresh.ageDays).toBe(1)
  const old = charterOfText('version: 4', '2026-09-01T00:00:00Z', 'agent:pm', Date.parse('2026-09-23T00:00:00Z'))
  expect(old.stale).toBe(true)
  expect(charterOfText('no version here').stale).toBe(true)
})

it('reads the flow the charter declares, so the panel can compare it with the board', () => {
  const flow = flowOfCharter('version: 4\n- 当期流程：ready 待開工 → in-progress 進行中 → done 完成\n- 其他')
  expect(flow.map(step => step.column)).toEqual(['ready', 'in-progress', 'done'])
  expect(flow[0]?.meaning).toBe('待開工')
})

it('stamps a new duty with the post that owns it, its project, its deliverable kind and the charter version', () => {
  rememberCharterVersion('p1', 7)
  const trigger = { id: 't1', source: 'kaneo', threads: [{ source: 'kaneo', id: 'task-1' }], actor: { source: 'kaneo', id: 'u-w1' },
    human: true, addressed: 'direct',
    at: '2026-09-23T00:00:00Z', text: 'fix it', channel: { source: 'kaneo', thread: 'task-1', address: {} }, url: '',
    meta: { projectId: 'p1', labels: ['kind:doc'] } } as unknown as Trigger
  store.triggers.save(trigger)
  const ticket = { id: 'ticket-1', title: '写方案', decisionId: 'd1', mandate: { basis: 'received', strength: 'explicit' },
    channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z',
    origin: { triggerId: 't1', triggerIds: ['t1'] } } as unknown as Ticket
  const stamped = enrichTicket(store, archive(), ticket)
  expect(stamped.postId).toBe('w1-fdep')
  expect(stamped.projectId).toBe('p1')
  expect(stamped.deliverableType).toBe('doc')
  expect(stamped.charterVersion).toBe(7)
  expect(charterVersionOf('p1')).toBe(7)
})

it('lists the duties a post runs and the exceptions a PM has to handle', () => {
  const open = (id: string, postId: string, extra: Partial<Ticket> = {}) => ({ id, title: id, decisionId: 'd', mandate: {},
    channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z',
    origin: { triggerId: 't', triggerIds: ['t'] }, postId, ...extra }) as unknown as Ticket
  store.tickets.save(open('duty-1', 'w1-fdep'))
  store.tickets.save(open('duty-2', 'w1-fdep', { attention: { id: 'a', question: '需要确认口径' } }))
  const duties = dutyRows(store, archive())
  expect(duties.map(duty => duty.ticketId)).toEqual(['duty-1', 'duty-2'])
  expect(duties.every(duty => duty.postId === 'w1-fdep')).toBe(true)
  const exceptions = exceptionRows(store, archive())
  expect(exceptions.map(row => row.kind)).toContain('waiting')
  expect(exceptions[0]?.detail).toBe('需要确认口径')
})

it('keeps the archive inside the runtime state directory', () => {
  expect(archivePath(directory)).toBe(join(directory, 'projects.json'))
})
