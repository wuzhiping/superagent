/**
 * The narrative layer of the management panel: projects, posts (a post is one SuperAgent instance holding one role),
 * the charter a PM publishes, the duties a post is running, and the exceptions a PM has to handle.
 *
 * The archive lives beside the runtime state (`<stateDir>/projects.json`) because it is shared by every post of a
 * deployment and by other instances of the same project (RD.md §4, §12.8). It holds no secrets: only identities,
 * project references, repository and topic names.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { Ticket } from '../core/model.ts'
import { latestAssignment, latestReport, liveTicket } from '../core/model.ts'
import type { Store } from './store.ts'

/** One post: a SuperAgent instance holding one role in one project (RD.md §5). */
export const ArchivePostSchema = z.object({
  postId: z.string().min(1),
  role: z.enum(['pm', 'worker']),
  name: z.string().min(1),
  /** The Kanban user id that identifies this post on the board; it is the task's `assignee`. */
  kaneoUserId: z.string().default(''),
  giteaUser: z.string().default(''),
  ntfySender: z.string().default(''),
  /** How many duties this post may run at once (the board calls it WIP). */
  wipLimit: z.number().int().min(1).max(20).default(3),
  /** Which SuperAgent instance plays this post; empty means "not deployed yet". */
  instance: z.string().default(''),
  /** The board columns whose cards this post takes; empty means "use the Source's own configuration". */
  watchColumns: z.string().default(''),
})
export type ArchivePost = z.infer<typeof ArchivePostSchema>

/** One published version of the charter, kept so a duty can be read against the rules it started under. */
export const ArchiveCharterVersionSchema = z.object({
  version: z.number().int().min(0),
  publishedAt: z.string().default(''),
  publishedBy: z.string().default(''),
  text: z.string().default(''),
})
export type ArchiveCharterVersion = z.infer<typeof ArchiveCharterVersionSchema>

/**
 * The charter a PM published: the document that says how this project works right now. It is a text the PM writes in
 * the panel (a single card on the board was too narrow a place for it) and it carries the version every duty pins.
 *
 * Publishing is explicit: the PM writes in `draft`, and publishing moves it to `text` with a new version, the time and
 * the author; the version it replaces stays in `history`, so a duty started earlier can still be read against the
 * rules it started under (RD.md §8).
 */
export const ArchiveCharterSchema = z.object({
  /** The published version; 0 means no charter has been published yet. */
  version: z.number().int().min(0).default(0),
  publishedAt: z.string().default(''),
  publishedBy: z.string().default(''),
  /** The published text. */
  text: z.string().default(''),
  /** The text the PM is writing; publishing it moves it into `text`. */
  draft: z.string().default(''),
  /** The published versions before the current one. */
  history: z.array(ArchiveCharterVersionSchema).default([]),
})
export type ArchiveCharter = z.infer<typeof ArchiveCharterSchema>

/**
 * One project: a Kanban project, the charter that says how it works, and the posts that staff it.
 *
 * The board itself is the source of truth for everything the board can say: its columns are the value stream (read
 * from the server), and a card says which repositories or workfaces it touches (RD.md §6.4, §9). The archive only
 * holds what Kanban cannot: who the posts are, how they identify themselves, and the charter.
 */
export const ArchiveProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().default(''),
  /** The charter the PM published for this project. */
  charter: ArchiveCharterSchema.default({ version: 0, publishedAt: '', publishedBy: '', text: '', draft: '', history: [] }),
  topics: z.array(z.string()).default([]),
  posts: z.array(ArchivePostSchema).default([]),
})
export type ArchiveProject = z.infer<typeof ArchiveProjectSchema>

export const ArchiveSchema = z.object({
  version: z.literal(1).default(1),
  projects: z.array(ArchiveProjectSchema).default([]),
})
export type ProjectArchive = z.infer<typeof ArchiveSchema>

export const EMPTY_ARCHIVE: ProjectArchive = { version: 1, projects: [] }

/** Where the archive lives inside the runtime state directory. */
export const archivePath = (stateDir: string): string => join(stateDir, 'projects.json')

/** Reads the archive; a missing or unreadable file reads as an empty archive rather than an error. */
export function readArchive (stateDir: string): ProjectArchive {
  try {
    const parsed = ArchiveSchema.safeParse(JSON.parse(readFileSync(archivePath(stateDir), 'utf8')))
    return parsed.success ? parsed.data : EMPTY_ARCHIVE
  } catch {
    return EMPTY_ARCHIVE
  }
}

/** A revision number that changes whenever the archive changes, so the panel can detect concurrent edits. */
export function archiveRevision (stateDir: string): number {
  try {
    const text = readFileSync(archivePath(stateDir), 'utf8')
    let hash = 0
    for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) | 0
    return Math.abs(hash)
  } catch {
    return 0
  }
}

/** Writes the archive after validating it; the caller supplies the revision it read to catch concurrent edits. */
export function writeArchive (stateDir: string, value: unknown, expectedRevision: number): { revision: number } {
  const archive = ArchiveSchema.parse(value)
  if (expectedRevision && archiveRevision(stateDir) !== expectedRevision) {
    throw new Error('The project archive changed since it was loaded; reload it and try again')
  }
  const path = archivePath(stateDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(archive, null, 2)}\n`, 'utf8')
  return { revision: archiveRevision(stateDir) }
}

/** The post a Kanban actor belongs to, matched by the Kanban user id it carries. */
export function postOfActor (archive: ProjectArchive, actorId: string | undefined): ArchivePost | undefined {
  if (!actorId) return undefined
  for (const project of archive.projects) {
    for (const post of project.posts) if (post.kaneoUserId && post.kaneoUserId === actorId) return post
  }
  return undefined
}

/** The project a post belongs to, and the post's position inside it. */
export function projectOfPost (archive: ProjectArchive, postId: string): { project: ArchiveProject; post: ArchivePost } | undefined {
  for (const project of archive.projects) {
    const post = project.posts.find(item => item.postId === postId)
    if (post) return { project, post }
  }
  return undefined
}

export interface CharterInfo {
  /** The charter version a duty pins when it starts; 0 when there is no charter yet. */
  version: number
  publishedAt: string
  publishedBy: string
  /** The charter text itself, so the panel can show what the PM wrote. */
  text: string
  /** How old the charter is in days; -1 when it was never published. */
  ageDays: number
  /** True when the charter is older than the weekly cadence or was never published. */
  stale: boolean
  /** Whether the PM has a draft that is not published yet. */
  hasDraft: boolean
  /** Whether this text is the project's own copy (read from the kanban project) rather than a local mirror. */
  shared?: boolean
  /** The published versions before the current one. */
  versions: { version: number; publishedAt: string; publishedBy: string }[]
  /** When the charter may be published again (ISO): a project's charter changes at most once a week. */
  nextPublishAt?: string
  detail: string
}

/** One step of the flow the charter declares: a board column and what it means now. */
export interface DeclaredFlowStep {
  column: string
  meaning: string
}

/**
 * Reads the charter version from its text; the format is `version: <n>`, and `publishedBy: <id>` names its author.
 * A charter without a version counts as not published.
 */
export function charterOfText (text: string | undefined, publishedAt = '', publishedBy = '', now = Date.now()): CharterInfo {
  const body = text ?? ''
  const version = Number(/version:\s*(\d+)/.exec(body)?.[1] ?? 0)
  const author = publishedBy || /publishedBy:\s*(\S+)/.exec(body)?.[1] || ''
  const ageDays = publishedAt ? Math.floor((now - Date.parse(publishedAt)) / 86_400_000) : -1
  const stale = version === 0 || ageDays < 0 || ageDays >= 7
  return {
    version, publishedAt, publishedBy: author, text: body, ageDays, stale, hasDraft: false, versions: [],
    detail: version === 0 ? 'No charter is published yet' : stale ? `The charter is ${ageDays} day(s) old` : 'The charter is current',
  }
}

/**
 * The flow the charter declares: the line that names it, read as `column meaning` steps joined by arrows. The board's
 * own columns come from the server; this is what the PM confirmed, so a difference means the flow grew unchecked.
 */
export function flowOfCharter (text: string | undefined): DeclaredFlowStep[] {
  for (const line of (text ?? '').split('\n')) {
    // A heading names the flow ("## 当期流程") without being it; the flow itself is a line of steps joined by arrows.
    if (!line.includes('流程') || /^\s*#/.test(line) || !/→|->/.test(line)) continue
    const steps = line.split(/→|->/).map(item => item.trim()).filter(Boolean)
    const parsed: DeclaredFlowStep[] = []
    for (const step of steps) {
      const withoutPrefix = step.replace(/^[-*\s]*.*?流程[:：]?\s*/, '').trim()
      // A step is the column's slug (whatever characters it has: a column named in Chinese gets a Chinese slug) and,
      // after the first space, what that column means now.
      const match = /^(\S+?)(?:\s+(\S.*))?$/.exec(withoutPrefix)
      if (match) parsed.push({ column: match[1]!, meaning: (match[2] ?? '').trim() })
    }
    // The first line that names the flow and reads as steps is the flow.
    if (parsed.length) return parsed
  }
  return []
}

/** Whether the charter has a draft the PM has not published yet. */
export function hasCharterDraft (charter: ArchiveCharter): boolean {
  return charter.draft.trim() !== '' && charter.draft !== charter.text
}

export interface DutyRow {
  ticketId: string
  title: string
  postId: string
  projectId: string
  state: string
  /** Whether the duty waits for a person, which is an exception for the PM. */
  waiting: boolean
  updatedAt: string
}

export interface ExceptionRow {
  ticketId: string
  title: string
  kind: 'waiting' | 'blocked' | 'failed' | 'stale'
  postId: string
  projectId: string
  detail: string
  updatedAt: string
}

/** A duty is one ticket a post is running; it is the unit the board calls WIP. */
export function dutyRows (store: Store, archive: ProjectArchive): DutyRow[] {
  const rows: DutyRow[] = []
  for (const ticket of store.tickets.open()) {
    const post = ticket.postId ? archive.projects.flatMap(project => project.posts).find(item => item.postId === ticket.postId) : undefined
    const project = post ? archive.projects.find(item => item.posts.some(entry => entry.postId === post.postId)) : undefined
    rows.push({
      ticketId: ticket.id,
      title: ticket.title,
      postId: post?.postId ?? ticket.postId ?? '',
      projectId: project?.id ?? ticket.projectId ?? '',
      state: liveTicket(ticket) ? 'running' : 'queued',
      waiting: !!ticket.attention,
      updatedAt: ticket.updatedAt,
    })
  }
  return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.ticketId.localeCompare(right.ticketId))
}

/** The exceptions a PM has to handle: a duty waiting for a person, a failed or blocked duty, or a duty gone quiet. */
export function exceptionRows (store: Store, archive: ProjectArchive, now = Date.now()): ExceptionRow[] {
  const staleAfter = 6 * 3_600_000
  const rows: ExceptionRow[] = []
  for (const ticket of store.tickets.open()) {
    const report = latestReport(ticket)
    const post = ticket.postId ? archive.projects.flatMap(project => project.posts).find(item => item.postId === ticket.postId) : undefined
    const project = post ? archive.projects.find(item => item.posts.some(entry => entry.postId === post.postId)) : undefined
    const base = { ticketId: ticket.id, title: ticket.title, postId: post?.postId ?? ticket.postId ?? '', projectId: project?.id ?? ticket.projectId ?? '', updatedAt: ticket.updatedAt }
    if (ticket.attention) rows.push({ ...base, kind: 'waiting', detail: ticket.attention.question })
    else if (report?.state === 'blocked') rows.push({ ...base, kind: 'blocked', detail: 'The duty is blocked' })
    else if (report?.state === 'failed') rows.push({ ...base, kind: 'failed', detail: 'The duty failed' })
    else if (now - Date.parse(ticket.updatedAt) > staleAfter) {
      rows.push({ ...base, kind: 'stale', detail: 'The duty has not moved for six hours' })
    }
  }
  return rows
}

/** The duties a post is running, newest first. */
export function dutiesOfPost (duties: DutyRow[], postId: string): DutyRow[] {
  return duties.filter(duty => duty.postId === postId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** The assignment count of a ticket, used by the panel to show how many duties a post runs. */
export const runningCount = (ticket: Ticket): number => (latestAssignment(ticket)?.state === 'running' ? 1 : 0)

/** The charter version last read for a project; the panel refreshes it, duties pin the version they started under. */
const charterVersions = new Map<string, number>()
export const rememberCharterVersion = (projectId: string, version: number): void => { charterVersions.set(projectId, version) }
export const charterVersionOf = (projectId: string | undefined): number | undefined =>
  projectId ? charterVersions.get(projectId) : undefined

const DELIVERABLES = new Set(['code', 'doc', 'plan', 'memo', 'log', 'quote', 'contract', 'complaint', 'shipment', 'review',
  'meeting', 'review-note', 'other'])

/**
 * Stamps a new duty with the narrative fields: the post that owns it, the project it belongs to, what it is expected
 * to produce, the repositories the task names, and the charter version it started under.
 */
export function enrichTicket (store: Store, archive: ProjectArchive, ticket: Ticket): Ticket {
  const trigger = store.triggers.get(ticket.origin.triggerId)
  const meta = trigger?.meta as { projectId?: string; labels?: string[] } | undefined
  const actorId = trigger?.actor.id
  const post = archive.projects.flatMap(project => project.posts)
    .find(item => item.kaneoUserId && item.kaneoUserId === actorId)
  const project = archive.projects.find(item => item.id === meta?.projectId)
    ?? (post ? archive.projects.find(item => item.posts.some(entry => entry.postId === post.postId)) : undefined)
  // A card names what it produces with a `kind:` label; any kind is accepted, because not every project is a software one.
  const kind = meta?.labels?.map(label => label.toLowerCase()).find(label => label.startsWith('kind:'))?.slice(5)
  const deliverableType = kind && DELIVERABLES.has(kind) ? kind as Ticket['deliverableType'] : undefined
  // The repositories a duty touches are named by the task itself (`repo:owner/name`), not by the project.
  const repos = (meta?.labels ?? []).map(label => label.toLowerCase()).filter(label => label.startsWith('repo:'))
    .map(label => label.slice(5).trim()).filter(label => /^[^/\s]+\/[^/\s]+$/.test(label))
  const charterVersion = charterVersionOf(project?.id)
  return {
    ...ticket,
    ...(post ? { postId: post.postId } : {}),
    ...(project ? { projectId: project.id } : {}),
    ...(deliverableType ? { deliverableType } : {}),
    ...(repos.length ? { repos } : {}),
    ...(charterVersion ? { charterVersion } : {}),
  }
}
