/**
 * Workspace maintenance for ended duties: audits the directory and Session each Ticket left behind, plans a safe
 * removal, and performs it when a person confirms.
 *
 * A Ticket's workspace is a directory under the executor's root plus the DSH workspace registration that points at it
 * (`workspaceRegistry`). The registration only lists the directory, so deleting it is always safe; removing the
 * directory is a separate, explicit choice. Session logs live outside both and have no supported delete API, so this
 * module only counts them: a cleanup unregisters the workspace and never touches a `.jsonl` log or the database.
 */
import { lstat, readdir, realpath, rm, stat } from 'node:fs/promises'
import { join, parse, resolve, sep } from 'node:path'
import type { Ticket, TicketOutcome } from '../core/index.ts'

/** Bytes after which a workspace scan stops accounting and marks the row capped (512 MiB). */
export const SIZE_CAP_BYTES = 512 * 1024 * 1024
/** File count after which a workspace scan stops accounting and marks the row capped. */
export const FILE_CAP = 20_000
/** Top-level entry names a row keeps, for the panel to show what a directory holds. */
export const LISTED_FILES = 20

/** Limits at which a workspace scan gives up instead of walking a huge tree forever. */
export interface ScanLimits { maxBytes: number; maxFiles: number }
export const SCAN_LIMITS: ScanLimits = { maxBytes: SIZE_CAP_BYTES, maxFiles: FILE_CAP }

/** What one workspace directory scan found; `sizeBytes` is a partial sum once `sizeCapped` is set. */
export interface WorkspaceScan {
  exists: boolean
  sizeBytes: number
  sizeCapped: boolean
  lastModified?: string
  /** Top-level entry names, at most `LISTED_FILES`. */
  files: string[]
}

/** A registered workspace as the audit reads it (`workspaceRegistry.list()`). */
export interface WorkspaceRecord { id: string; path: string }
/** A stored Session as the audit counts it (`sessionPersistence.list()`, flattened to its header). */
export interface SessionRecord { id: string; cwd?: string }

/** The Ticket fields the audit reads; a full `Ticket` satisfies it. */
export type MaintenanceTicket = Pick<Ticket, 'id' | 'title' | 'ended' | 'execution'>
  & Partial<Pick<Ticket, 'postId' | 'deliverableType' | 'repos' | 'follows'>>

/** Why a row can be removed, or why it is skipped. The panel words each code. */
export type MaintenanceReason = 'ended' | 'directoryExists' | 'unreferenced' | 'registered' | 'unregistered'
  | 'open' | 'noDirectory' | 'missingDirectory' | 'referenced' | 'shared'
  | 'unknown' | 'notPlanned' | 'nothingToDo'
  | 'missing' | 'notDirectory' | 'outsideRoot' | 'stateDir' | 'root'
  | 'removeFailed' | 'registryFailed'

/** A short note the audit returns; the panel words each code. */
export type MaintenanceNote = 'sessionsKept' | 'filesOptional' | 'endedOnly'

/** One ended duty with the workspace it left behind. */
export interface MaintenanceRow {
  ticketId: string
  title: string
  postId?: string
  state: 'ended'
  outcome?: TicketOutcome
  endedAt: string
  directory: string
  workspaceId?: string
  workspaceExists: boolean
  sizeBytes: number
  sizeCapped: boolean
  lastModified?: string
  sessions: number
  files: string[]
  /** Whether the duty has a deliverable to confirm by hand before its workspace is cleaned. */
  deliverable: boolean
  deliverableType?: string
  /** Whether the safe plan includes this row. */
  removable: boolean
  reasons: MaintenanceReason[]
}

/** One item of the safe removal plan. */
export interface MaintenancePlanItem {
  ticketId: string
  title: string
  directory: string
  workspaceId?: string
  sizeBytes: number
  reasons: MaintenanceReason[]
}
/** A duty the safe plan leaves alone. */
export interface MaintenanceSkip {
  ticketId: string
  title: string
  directory?: string
  reasons: MaintenanceReason[]
}
/** The safe removal plan: only ended duties whose directory exists and no open duty uses. */
export interface RemovalPlan { removable: MaintenancePlanItem[]; skipped: MaintenanceSkip[] }

/** The audit the management API returns. */
export interface MaintenanceView {
  workspaces: MaintenanceRow[]
  totals: { count: number; bytes: number }
  notes: MaintenanceNote[]
}
/** The audit plus the plan the clean action enforces. */
export interface MaintenanceAudit extends MaintenanceView { plan: RemovalPlan }

/** Host reads the audit needs; the route supplies them from `Store`, `workspaceRegistry` and `sessionPersistence`. */
export interface MaintenanceHost {
  /** Every Ticket, newest first (`store.tickets.list()`). */
  tickets(): MaintenanceTicket[]
  /** Registered workspaces (`workspaceRegistry.list()`). */
  workspaces(): Promise<WorkspaceRecord[]>
  /** Stored Sessions (`sessionPersistence.list()`). */
  sessions(): Promise<SessionRecord[]>
  /** The directory ticket workspaces are created under (`executionRoot`), which removal must stay below. */
  executionRoot(): string
  /** The runtime state directory, which removal must never touch. */
  stateDir(): string
}
/** A host that can also unregister a workspace and remove a directory. */
export interface CleanHost extends MaintenanceHost {
  /** Unregister one workspace (`workspaceRegistry.delete(id)`); resolves whether a record was deleted. */
  deleteWorkspace(id: string): Promise<boolean>
}
/** The clean action's request. */
export interface CleanRequest { ticketIds: string[]; removeFiles?: boolean }
/** What the clean action did, and what it refused. */
export interface MaintenanceCleanResult {
  cleaned: { ticketId: string; title: string; sizeBytes: number; workspaceDeleted: boolean; filesDeleted: boolean }[]
  skipped: { ticketId: string; reasons: MaintenanceReason[] }[]
}
/** The guard a directory removal must pass before anything is deleted. */
export interface DeleteGuard {
  executionRoot: string
  stateDir: string
  /** Resolve a path to its canonical form; defaults to `fs.realpath`. */
  canonical?(path: string): Promise<string>
}

/** Resolve `path`, falling back to the plain absolute path when it does not exist. */
const absolute = async (path: string): Promise<string> => realpath(path).catch(() => resolve(path))
/** Compare two paths the way the filesystem does: case-insensitively on Windows. */
const samePath = (left: string, right: string): boolean => {
  const a = resolve(left), b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
/** Windows path comparison form. */
const normalized = (path: string): string => {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}
/** Whether `child` is strictly below `parent`. */
const inside = (child: string, parent: string): boolean => {
  const a = normalized(child), b = normalized(parent)
  return a !== b && a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`)
}

/**
 * Scans one workspace directory: its byte size, its newest modification, and up to `LISTED_FILES` top-level names.
 * The walk stops and sets `sizeCapped` once the byte or file cap is exceeded, so a huge workspace never stalls the panel.
 */
export async function scanWorkspace(directory: string, limits: ScanLimits = SCAN_LIMITS): Promise<WorkspaceScan> {
  const root = await stat(directory).catch(() => undefined)
  if (!root || !root.isDirectory()) return { exists: false, sizeBytes: 0, sizeCapped: false, files: [] }
  const top = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = top.slice(0, LISTED_FILES).map(entry => entry.name)
  let sizeBytes = 0, count = 0, capped = false
  let last = root.mtimeMs
  const walk = async (current: string): Promise<void> => {
    if (capped) return
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (capped) return
      if (entry.isDirectory()) { await walk(join(current, entry.name)); continue }
      const stats = await lstat(join(current, entry.name)).catch(() => undefined)
      if (!stats) continue
      sizeBytes += stats.size; count++
      if (stats.mtimeMs > last) last = stats.mtimeMs
      if (sizeBytes > limits.maxBytes || count > limits.maxFiles) { capped = true; return }
    }
  }
  await walk(directory)
  return { exists: true, sizeBytes, sizeCapped: capped, lastModified: new Date(last).toISOString(), files }
}

/**
 * Checks that `target` may be removed under `guard`: it must exist, be a directory, sit strictly below the executor's
 * workspace root, and be neither that root nor a filesystem root nor the state directory (or anything containing it).
 * The check runs on `fs.realpath`, so a symlink pointing outside the root is refused as well.
 */
export async function checkRemovable(target: string,
  guard: DeleteGuard): Promise<{ ok: true; path: string } | { ok: false; reason: MaintenanceReason }> {
  if (!target.trim()) return { ok: false, reason: 'missing' }
  const canonical = guard.canonical ?? realpath
  const targetPath = await canonical(target).catch(() => undefined)
  if (!targetPath) return { ok: false, reason: 'missing' }
  const stats = await stat(targetPath).catch(() => undefined)
  if (!stats?.isDirectory()) return { ok: false, reason: 'notDirectory' }
  const rootPath = await absolute(guard.executionRoot)
  const statePath = await absolute(guard.stateDir)
  if (samePath(targetPath, rootPath)) return { ok: false, reason: 'root' }
  if (normalized(targetPath) === normalized(parse(targetPath).root)) return { ok: false, reason: 'root' }
  if (samePath(targetPath, statePath) || inside(statePath, targetPath)) return { ok: false, reason: 'stateDir' }
  if (!inside(targetPath, rootPath)) return { ok: false, reason: 'outsideRoot' }
  return { ok: true, path: targetPath }
}

/** Group Tickets by the canonical form of the workspace directory they record. */
async function groupByDirectory(tickets: readonly MaintenanceTicket[]): Promise<{ key: string; ticket: MaintenanceTicket }[]> {
  const rows: { key: string; ticket: MaintenanceTicket }[] = []
  for (const ticket of tickets) {
    const directory = ticket.execution?.directory
    if (!directory) continue
    rows.push({ key: await absolute(directory), ticket })
  }
  return rows
}

/**
 * Audits every ended Ticket's workspace: directory size, last modification, session count, deliverable signal, and why
 * the safe plan may or may not remove it. Open Tickets are never listed as workspaces; they only block a directory.
 */
export async function audit(host: MaintenanceHost, options: { limits?: ScanLimits } = {}): Promise<MaintenanceAudit> {
  const limits = options.limits ?? SCAN_LIMITS
  const tickets = host.tickets()
  const workspaces = await host.workspaces()
  const sessions = await host.sessions()
  const grouped = await groupByDirectory(tickets)
  const keys = new Map<string, string>()
  for (const { key, ticket } of grouped) keys.set(ticket.id, key)
  const refs = new Map<string, MaintenanceTicket[]>()
  for (const { key, ticket } of grouped) refs.set(key, [...refs.get(key) ?? [], ticket])
  const rows: MaintenanceRow[] = []
  for (const ticket of tickets) {
    const directory = ticket.execution?.directory ?? ''
    if (!directory || !ticket.ended) continue
    const key = keys.get(ticket.id) ?? resolve(directory)
    const others = (refs.get(key) ?? []).filter(item => item.id !== ticket.id)
    const scan = await scanWorkspace(directory, limits)
    const workspace = workspaces.find(item => samePath(item.path, key) || samePath(item.path, directory))
    const live = others.some(item => !item.ended)
    const reasons: MaintenanceReason[] = !scan.exists ? ['missingDirectory']
      : live ? ['referenced'] : others.length ? ['shared']
        : ['ended', 'directoryExists', 'unreferenced', ...workspace ? ['registered' as const] : ['unregistered' as const]]
    const deliverable = !!ticket.deliverableType || !!ticket.repos?.length || (ticket.follows ?? []).some(follow => follow.own)
    rows.push({
      ticketId: ticket.id,
      title: ticket.title,
      ...ticket.postId ? { postId: ticket.postId } : {},
      state: 'ended',
      ...ticket.ended.outcome ? { outcome: ticket.ended.outcome } : {},
      endedAt: ticket.ended.at,
      directory,
      ...workspace ? { workspaceId: workspace.id } : {},
      workspaceExists: scan.exists,
      sizeBytes: scan.sizeBytes,
      sizeCapped: scan.sizeCapped,
      ...scan.lastModified ? { lastModified: scan.lastModified } : {},
      sessions: sessions.filter(session => !!session.cwd && samePath(session.cwd, directory)).length,
      files: scan.files,
      deliverable,
      ...ticket.deliverableType ? { deliverableType: ticket.deliverableType } : {},
      removable: scan.exists && !live && !others.length,
      reasons,
    })
  }
  rows.sort((left, right) => right.sizeBytes - left.sizeBytes || left.ticketId.localeCompare(right.ticketId))
  const removable: MaintenancePlanItem[] = rows.filter(row => row.removable).map(row => ({ ticketId: row.ticketId,
    title: row.title, directory: row.directory, ...row.workspaceId ? { workspaceId: row.workspaceId } : {},
    sizeBytes: row.sizeBytes, reasons: row.reasons }))
  const skipped: MaintenanceSkip[] = []
  for (const ticket of tickets) {
    const row = rows.find(item => item.ticketId === ticket.id)
    if (row) { if (!row.removable) skipped.push({ ticketId: row.ticketId, title: row.title, directory: row.directory, reasons: row.reasons }); continue }
    skipped.push({ ticketId: ticket.id, title: ticket.title, ...ticket.execution?.directory ? { directory: ticket.execution.directory } : {},
      reasons: ticket.ended ? ['noDirectory'] : ['open'] })
  }
  const totals = { count: rows.length, bytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0) }
  return { workspaces: rows, totals, notes: ['sessionsKept', 'filesOptional', 'endedOnly'], plan: { removable, skipped } }
}

/**
 * Cleans the safely removable workspaces a person selected: unregisters each workspace and, when `removeFiles` is set,
 * removes its directory after `checkRemovable` confirms it is below the executor root and away from the state directory.
 * Session logs are never deleted. Requests outside the safe plan are answered in `skipped` without touching anything.
 */
export async function clean(host: CleanHost, request: CleanRequest): Promise<MaintenanceCleanResult> {
  const report = await audit(host)
  const planned = new Map(report.plan.removable.map(item => [item.ticketId, item]))
  const reasonsById = new Map(report.plan.skipped.map(item => [item.ticketId, item.reasons]))
  const guard: DeleteGuard = { executionRoot: host.executionRoot(), stateDir: host.stateDir() }
  const cleaned: MaintenanceCleanResult['cleaned'] = []
  const skipped: MaintenanceCleanResult['skipped'] = []
  for (const ticketId of new Set(request.ticketIds)) {
    const item = planned.get(ticketId)
    if (!item) { skipped.push({ ticketId, reasons: reasonsById.get(ticketId) ?? ['unknown'] }); continue }
    if (!request.removeFiles && !item.workspaceId) { skipped.push({ ticketId, reasons: ['nothingToDo'] }); continue }
    let filesDeleted = false
    if (request.removeFiles) {
      const check = await checkRemovable(item.directory, guard)
      if (!check.ok) { skipped.push({ ticketId, reasons: [check.reason] }); continue }
      try { await rm(check.path, { recursive: true, force: false }); filesDeleted = true }
      catch { skipped.push({ ticketId, reasons: ['removeFailed'] }); continue }
    }
    let workspaceDeleted = false
    if (item.workspaceId) {
      try { workspaceDeleted = await host.deleteWorkspace(item.workspaceId) }
      catch { skipped.push({ ticketId, reasons: ['registryFailed'] }); continue }
    }
    cleaned.push({ ticketId, title: item.title, sizeBytes: item.sizeBytes, workspaceDeleted, filesDeleted })
  }
  return { cleaned, skipped }
}
