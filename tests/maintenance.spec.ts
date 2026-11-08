/**
 * The cleanup audit and its safe plan: only ended duties are listed, open duties block their directory, a huge workspace
 * scan stops at its cap, and a removal path outside the executor root or at the state directory is refused.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { projectionCacheFile, registerHttp, type HttpHost } from '../src/app/http.ts'
import { audit, checkRemovable, clean, scanWorkspace, type CleanHost, type MaintenanceTicket,
  type SessionRemovalFailureReason } from '../src/app/maintenance.ts'
import { SettingsSchema } from '../src/policy.ts'

const roots: string[] = []
const temp = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-maintenance-'))
  roots.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
const ended = (at = '2026-09-20T00:00:00Z', outcome: 'completed' | 'merged' = 'completed') => ({ at, by: 'executor' as const, outcome })
const ticket = (id: string, directory: string, fields: Partial<MaintenanceTicket> = {}): MaintenanceTicket => ({
  id, title: id, execution: { name: id, directory, assignment: '' }, ...fields,
})
function host(input: { tickets: MaintenanceTicket[]; root: string; stateDir: string; workspaces?: { id: string; path: string }[]
  sessions?: { id: string; cwd?: string; bytes?: number }[]; deleted?: string[]; deletedSessions?: string[]
  failedSessions?: string[]; idleSessions?: string[]; sessionFailureReason?: SessionRemovalFailureReason }): CleanHost {
  return {
    tickets: () => input.tickets,
    workspaces: async () => input.workspaces ?? [],
    sessions: async () => input.sessions ?? [],
    executionRoot: () => input.root,
    stateDir: () => input.stateDir,
    deleteWorkspace: async id => { input.deleted?.push(id); return true },
    deleteSessions: async (ids, options) => {
      const hard = new Set(input.failedSessions ?? [])
      const idle = new Set(input.idleSessions ?? [])
      const deleted = ids.filter(id => !hard.has(id) && (!idle.has(id) || options?.includeIdle === true))
      input.deletedSessions?.push(...deleted)
      const failed = ids.filter(id => !deleted.includes(id)).map(id => ({
        id, reason: hard.has(id) ? (input.sessionFailureReason ?? 'removeFailed' as const) : 'idle' as const }))
      return { deleted, failed }
    },
  }
}

it('lists only ended duties, counts their sessions, and keeps an open duty in the skipped plan', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir); await mkdir(join(root, 'w1')); await mkdir(join(root, 'w2'))
  await writeFile(join(root, 'w1', 'result.md'), 'x'.repeat(64))
  const endedTicket = ticket('t1', join(root, 'w1'), { title: '修好的职责', ended: ended(), deliverableType: 'doc' })
  const openTicket = ticket('t2', join(root, 'w2'), { title: '还在做的职责' })
  const auditResult = await audit(host({ tickets: [endedTicket, openTicket], root, stateDir,
    workspaces: [{ id: 'ws1', path: await realpath(join(root, 'w1')) }],
    sessions: [{ id: 'worker-t1', cwd: join(root, 'w1') }, { id: 'other', cwd: join(root, 'w2') }] }))
  expect(auditResult.workspaces.map(row => row.ticketId)).toEqual(['t1'])
  expect(auditResult.workspaces[0]).toMatchObject({ ticketId: 't1', state: 'ended', outcome: 'completed', directory: join(root, 'w1'),
    workspaceId: 'ws1', workspaceExists: true, sessions: 1, sessionBytes: 0, deliverable: true, deliverableType: 'doc', removable: true })
  expect(auditResult.workspaces[0]!.sizeBytes).toBe(64)
  expect(auditResult.workspaces[0]!.files).toEqual(['result.md'])
  expect(auditResult.totals).toEqual({ count: 1, bytes: 64 })
  // The open duty is not a workspace row, but it is named in the plan's skipped list.
  expect(auditResult.plan.removable.map(item => item.ticketId)).toEqual(['t1'])
  expect(auditResult.plan.skipped).toEqual([{ ticketId: 't2', title: '还在做的职责', directory: join(root, 'w2'), reasons: ['open'] }])
})

it('refuses a directory an open duty still points at, and one another ended duty shares', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir); await mkdir(join(root, 'w1'))
  const shared = join(root, 'w1')
  const auditResult = await audit(host({ tickets: [ticket('t1', shared, { ended: ended() }), ticket('t2', shared)], root, stateDir }))
  expect(auditResult.workspaces[0]).toMatchObject({ removable: false, reasons: ['referenced'] })
  expect(auditResult.plan.removable).toEqual([])
  expect(auditResult.plan.skipped.map(item => [item.ticketId, item.reasons])).toEqual([['t1', ['referenced']], ['t2', ['open']]])
  // Two ended duties recording one directory is never planned: the files are one directory, not two.
  const doubles = await audit(host({ tickets: [ticket('t1', shared, { ended: ended() }), ticket('t3', shared, { ended: ended() })],
    root, stateDir }))
  expect(doubles.workspaces.every(row => !row.removable && row.reasons.includes('shared'))).toBe(true)
  expect(doubles.plan.removable).toEqual([])
})

it('caps a workspace scan at the byte or file limit instead of walking the whole tree', async () => {
  const base = await temp(), directory = join(base, 'big')
  await mkdir(directory)
  await writeFile(join(directory, 'a.bin'), Buffer.alloc(2048))
  const byBytes = await scanWorkspace(directory, { maxBytes: 100, maxFiles: 100 })
  expect(byBytes).toMatchObject({ exists: true, sizeCapped: true })
  expect(byBytes.sizeBytes).toBe(2048)
  expect(byBytes.lastModified).toBeTruthy()
  for (let index = 0; index < 5; index++) await writeFile(join(directory, `f${index}.txt`), 'x')
  const byFiles = await scanWorkspace(directory, { maxBytes: 1024 * 1024, maxFiles: 2 })
  expect(byFiles.sizeCapped).toBe(true)
  // A missing directory reads as absent instead of throwing.
  expect(await scanWorkspace(join(base, 'nope'))).toMatchObject({ exists: false, sizeBytes: 0, sizeCapped: false })
})

it('hides a duty with no residue at all, and skips one that has no directory', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir)
  // t1 has no directory, no registration and no Session: nothing left, so it is not listed (a cleaned duty disappears).
  // t2 records no directory at all.
  const auditResult = await audit(host({ tickets: [ticket('t1', join(root, 'gone'), { ended: ended() }), ticket('t2', '', { ended: ended() })],
    root, stateDir }))
  expect(auditResult.workspaces).toEqual([])
  expect(auditResult.plan.removable).toEqual([])
  expect(auditResult.plan.skipped.map(item => [item.ticketId, item.reasons])).toEqual([['t1', ['noDirectory']], ['t2', ['noDirectory']]])
})

it('lists a duty whose only residue is Sessions, and cleans those Sessions when asked', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir)
  const directory = join(root, 'gone')
  const deletedSessions: string[] = []
  const cleaner = host({ tickets: [ticket('t1', directory, { ended: ended() })], root, stateDir,
    sessions: [{ id: 'worker-t1', cwd: directory, bytes: 512 }, { id: 'worker-t1b', cwd: directory, bytes: 256 }],
    deletedSessions })
  const auditResult = await audit(cleaner)
  expect(auditResult.workspaces).toEqual([expect.objectContaining({ ticketId: 't1', workspaceExists: false, sessions: 2,
    sessionBytes: 768, removable: true, reasons: ['ended', 'missingDirectory', 'unreferenced', 'unregistered', 'sessionsPresent'] })])
  const result = await clean(cleaner, { ticketIds: ['t1'], removeSessions: true })
  expect(result.cleaned).toEqual([{ ticketId: 't1', title: 't1', sizeBytes: 0, workspaceDeleted: false, filesDeleted: false,
    sessionsDeleted: 2 }])
  expect(deletedSessions.sort()).toEqual(['worker-t1', 'worker-t1b'])
})

it('names why every Session was refused instead of a generic failure', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir)
  const directory = join(root, 'gone')
  const cleaner = host({ tickets: [ticket('t1', directory, { ended: ended() })], root, stateDir,
    sessions: [{ id: 'worker-t1', cwd: directory }], failedSessions: ['worker-t1'] })
  const result = await clean(cleaner, { ticketIds: ['t1'], removeSessions: true })
  expect(result.skipped).toEqual([{ ticketId: 't1', reasons: ['sessionRemoveFailed'] }])
})

it('refuses an idle loaded Session unless forced, and always refuses a running one', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir)
  const directory = join(root, 'gone')
  const sessions = [{ id: 'worker-t1', cwd: directory }]
  const idle = host({ tickets: [ticket('t1', directory, { ended: ended() })], root, stateDir, sessions, idleSessions: ['worker-t1'] })
  expect((await clean(idle, { ticketIds: ['t1'], removeSessions: true })).skipped)
    .toEqual([{ ticketId: 't1', reasons: ['sessionIdle'] }])
  const forced = host({ tickets: [ticket('t1', directory, { ended: ended() })], root, stateDir, sessions, idleSessions: ['worker-t1'] })
  expect((await clean(forced, { ticketIds: ['t1'], removeSessions: true, forceSessions: true })).cleaned)
    .toEqual([expect.objectContaining({ ticketId: 't1', sessionsDeleted: 1 })])
  const running = host({ tickets: [ticket('t1', directory, { ended: ended() })], root, stateDir, sessions,
    failedSessions: ['worker-t1'], sessionFailureReason: 'running' })
  expect((await clean(running, { ticketIds: ['t1'], removeSessions: true, forceSessions: true })).skipped)
    .toEqual([{ ticketId: 't1', reasons: ['sessionRunning'] }])
})

it('refuses when no requested action can clean anything', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir); await mkdir(join(root, 'w1'))
  const cleaner = host({ tickets: [ticket('t1', join(root, 'w1'), { ended: ended() })], root, stateDir,
    sessions: [{ id: 'worker-t1', cwd: join(root, 'w1') }] })
  const result = await clean(cleaner, { ticketIds: ['t1'] })
  expect(result.cleaned).toEqual([])
  expect(result.skipped).toEqual([{ ticketId: 't1', reasons: ['nothingToDo'] }])
})

it('refuses a removal path outside the executor root, at the state directory, or at the root itself', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state'), outside = join(base, 'elsewhere')
  await mkdir(root); await mkdir(stateDir); await mkdir(outside); await mkdir(join(root, 'w1'))
  const guard = { executionRoot: root, stateDir }
  expect(await checkRemovable(join(root, 'w1'), guard)).toEqual({ ok: true, path: await realpath(join(root, 'w1')) })
  expect(await checkRemovable(join(outside, 'x'), guard)).toEqual({ ok: false, reason: 'missing' })
  expect(await checkRemovable(outside, guard)).toEqual({ ok: false, reason: 'outsideRoot' })
  expect(await checkRemovable(stateDir, guard)).toEqual({ ok: false, reason: 'stateDir' })
  expect(await checkRemovable(root, guard)).toEqual({ ok: false, reason: 'root' })
  // A file is never a workspace directory to remove.
  await writeFile(join(root, 'w1', 'file.txt'), 'x')
  expect(await checkRemovable(join(root, 'w1', 'file.txt'), guard)).toEqual({ ok: false, reason: 'notDirectory' })
})

it('cleans only the safe plan: unregisters the workspace, removes the directory when asked, and skips everything else', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir); await mkdir(join(root, 'w1')); await mkdir(join(root, 'w2')); await mkdir(join(root, 'w3'))
  await writeFile(join(root, 'w1', 'work.txt'), 'done')
  const deleted: string[] = []
  const cleaner = host({ tickets: [ticket('t1', join(root, 'w1'), { ended: ended() }), ticket('t2', join(root, 'w2'), { ended: ended() }),
    ticket('t3', join(root, 'w3'))], root, stateDir, workspaces: [{ id: 'ws1', path: await realpath(join(root, 'w1')) }], deleted })
  const result = await clean(cleaner, { ticketIds: ['t1', 't3', 'nope'], removeFiles: true })
  expect(result.cleaned).toEqual([{ ticketId: 't1', title: 't1', sizeBytes: 4, workspaceDeleted: true, filesDeleted: true, sessionsDeleted: 0 }])
  expect(result.skipped).toEqual([{ ticketId: 't3', reasons: ['open'] }, { ticketId: 'nope', reasons: ['unknown'] }])
  expect(deleted).toEqual(['ws1'])
  await expect(realpath(join(root, 'w1'))).rejects.toThrow()
  // An unfinished duty's directory and a duty that was not selected stay.
  expect(await realpath(join(root, 'w3'))).toBeTruthy()
  expect(await realpath(join(root, 'w2'))).toBeTruthy()
})

it('keeps the directory unless the person asks for the folder removal', async () => {
  const base = await temp(), root = join(base, 'work'), stateDir = join(base, 'state')
  await mkdir(root); await mkdir(stateDir); await mkdir(join(root, 'w1'))
  await writeFile(join(root, 'w1', 'work.txt'), 'done')
  const deleted: string[] = []
  const result = await clean(host({ tickets: [ticket('t1', join(root, 'w1'), { ended: ended() })], root, stateDir,
    workspaces: [{ id: 'ws1', path: await realpath(join(root, 'w1')) }], deleted }), { ticketIds: ['t1'] })
  expect(result.cleaned).toEqual([{ ticketId: 't1', title: 't1', sizeBytes: 4, workspaceDeleted: true, filesDeleted: false, sessionsDeleted: 0 }])
  expect(deleted).toEqual(['ws1'])
  expect(await realpath(join(root, 'w1'))).toBeTruthy()
})

it('forwards forceSessions through the route so an idle Session can be cleaned', async () => {
  const base = await temp(), stateDir = join(base, 'state'), root = join(stateDir, 'work'), workspace = join(root, 'w2')
  await mkdir(workspace, { recursive: true })
  const sessionDir = join(workspace, 'worker-t2')
  await mkdir(sessionDir)
  const artifact = join(sessionDir, 'session.v4.jsonl.zstd')
  await writeFile(artifact, 'x')
  type Handler = (req: unknown, res: unknown) => Promise<void>
  let handler: Handler = async () => {}
  const ctx = {
    webServer: { host: '127.0.0.1', port: 3082, register: (route: { handler: Handler }) => { handler = route.handler; return () => {} } },
    workspaceRegistry: { list: () => [], delete: async () => false },
    sessionPersistence: { list: async () => [{ header: { id: 'worker-t2', cwd: workspace },
      location: { kind: 'jsonl', path: artifact } }] },
    agents: { get: () => ({ status: 'idle' }) },
  }
  const runtime = {
    ready: Promise.resolve(),
    store: { tickets: { list: () => [ticket('t2', workspace, { ended: ended() })] }, settings: () => SettingsSchema.parse({}) },
    machine: { stateDir },
  } as unknown as HttpHost
  registerHttp(ctx as never, runtime)
  const send = async (body: unknown) => {
    let status = 0, text = ''
    const req = { method: 'POST', url: '/orchestrator/api/maintenance/clean',
      headers: { host: '127.0.0.1:3082', 'x-orchestrator-request': '1' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }
    await handler(req, { writeHead: (code: number) => { status = code }, end: (data: string) => { text = data } })
    return { status, body: JSON.parse(text) as Record<string, unknown> }
  }
  const idle = await send({ ticketIds: ['t2'], removeSessions: true })
  expect(idle.status).toBe(200)
  expect(idle.body.skipped).toEqual([{ ticketId: 't2', reasons: ['sessionIdle'] }])
  const forced = await send({ ticketIds: ['t2'], removeSessions: true, forceSessions: true })
  expect(forced.body.cleaned).toEqual([expect.objectContaining({ ticketId: 't2', sessionsDeleted: 1 })])
  await expect(realpath(sessionDir)).rejects.toThrow()
})


it('serves the audit and the cleanup through the management routes with the workspace registry and session persistence', async () => {
  const base = await temp(), stateDir = join(base, 'state'), root = join(stateDir, 'work'), workspace = join(root, 'w1')
  await mkdir(root, { recursive: true }); await mkdir(workspace)
  await writeFile(join(workspace, 'result.md'), 'x'.repeat(32))
  const workspacePath = await realpath(workspace)
  const deleted: string[] = []
  type Handler = (req: unknown, res: unknown) => Promise<void>
  let handler: Handler = async () => {}
  const ctx = {
    webServer: { host: '127.0.0.1', port: 3082, register: (route: { handler: Handler }) => { handler = route.handler; return () => {} } },
    workspaceRegistry: { list: () => [{ id: 'ws1', path: workspacePath }], delete: async (id: string) => { deleted.push(id); return true } },
    sessionPersistence: { list: async () => [{ header: { id: 'worker-t1', cwd: workspace } }] },
  }
  const runtime = {
    ready: Promise.resolve(),
    store: { tickets: { list: () => [ticket('t1', workspace, { ended: ended() })] }, settings: () => SettingsSchema.parse({}) },
    machine: { stateDir },
  } as unknown as HttpHost
  registerHttp(ctx as never, runtime)
  const send = async (method: string, path: string, body?: unknown) => {
    let status = 0, text = ''
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = { method, url: `/orchestrator/api/${path}`, headers: { host: '127.0.0.1:3082', 'x-orchestrator-request': '1' },
      async *[Symbol.asyncIterator]() { yield* chunks } }
    await handler(req, { writeHead: (code: number) => { status = code }, end: (data: string) => { text = data } })
    return { status, body: JSON.parse(text) as Record<string, unknown> }
  }
  const listed = await send('GET', 'maintenance')
  expect(listed.status).toBe(200)
  expect(listed.body.workspaces).toEqual([expect.objectContaining({ ticketId: 't1', workspaceId: 'ws1', sessions: 1, sizeBytes: 32,
    removable: true })])
  expect(listed.body.totals).toEqual({ count: 1, bytes: 32 })
  const cleaned = await send('POST', 'maintenance/clean', { ticketIds: ['t1'], removeFiles: true })
  expect(cleaned.status).toBe(200)
  expect(cleaned.body.cleaned).toEqual([{ ticketId: 't1', title: 't1', sizeBytes: 32, workspaceDeleted: true, filesDeleted: true, sessionsDeleted: 0 }])
  expect(deleted).toEqual(['ws1'])
  await expect(realpath(workspace)).rejects.toThrow()
  // A request outside the safe plan is refused without deleting anything.
  const refused = await send('POST', 'maintenance/clean', { ticketIds: ['nope'] })
  expect(refused.body.skipped).toEqual([{ ticketId: 'nope', reasons: ['unknown'] }])
})

it('points a Session artifact at the DSH projection cache entry it must clear', () => {
  const sessionsRoot = join('D:', 'data', 'sessions')
  const location = join(sessionsRoot, '--hash--', 'worker-t1', 'session.v4.jsonl.zstd')
  expect(projectionCacheFile(location, 'worker-t1'))
    .toBe(join('D:', 'data', 'storages', 'session_projcache', 'sessions', 'worker-t1.json'))
  expect(projectionCacheFile(join('D:', 'data', 'store', '--hash--', 'worker-t1', 'session.v4.jsonl.zstd'), 'worker-t1'))
    .toBeUndefined()
})
