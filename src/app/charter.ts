/**
 * The project's own truth: the board's columns (the value stream the team works in) and the charter come from the
 * project on the kanban server, not from a settings page. The charter is one document per project — the same one every
 * post reads, whichever Host it runs on — and publishing it is a PM act bounded to at most once a week (RD.md §4.1, §8).
 */
import { DEFAULT_BASE_URL } from '../sources/kaneo-config.ts'
import { storedKaneoAccount } from '../sources/bdd-storage.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import { KaneoClient } from '../sources/kaneo-api.ts'
import { charterOfText, flowOfCharter, hasCharterDraft, readArchive, rememberCharterVersion, type ArchiveProject, type CharterInfo }
  from './narrative.ts'

/** How often a project's charter may be published: at most once a week, so the cadence is a ceiling, not a quota. */
export const CHARTER_INTERVAL_DAYS = 7

/**
 * The Kanban account the host reads the project with: the API key the Source card holds, or the one this Host's storage
 * record carries (BDD storage, masked-key lookup), so a Host needs no hand-typed secret.
 */
export function kaneoAccount (sources: SourceRegistry): { baseUrl: string; apiKey: string } | undefined {
  let server = DEFAULT_BASE_URL
  for (const instance of sources.instances()) {
    if (instance.kind !== 'kaneo') continue
    const stored = instance.config as Record<string, unknown> | undefined
    if (typeof stored?.baseUrl === 'string' && stored.baseUrl.trim()) server = stored.baseUrl.trim()
    if (typeof stored?.apiKey === 'string' && stored.apiKey.trim()) return { baseUrl: server, apiKey: stored.apiKey.trim() }
  }
  return storedKaneoAccount(server)
}

/** One column of the board: its slug, its name now, and how many cards sit in it. */
export interface BoardColumn {
  slug: string
  name: string
  count: number
}

const boardCache = new Map<string, { at: number; columns: BoardColumn[] }>()
/** How long a board's columns are read from the server before they are read again. */
const BOARD_TTL_MS = 30_000

/**
 * Reads the board's columns — the value stream the team works in. The board endpoint answers with every column, each
 * carrying the slug the tasks are stored by and the name it has now. The answer is cached briefly, because the panel
 * asks for it on every refresh and the board's API is rate limited.
 */
export async function readBoardColumns (account: { baseUrl: string; apiKey: string } | undefined,
  projectId: string): Promise<BoardColumn[]> {
  if (!account) return []
  const cached = boardCache.get(projectId)
  if (cached && Date.now() - cached.at < BOARD_TTL_MS) return cached.columns
  try {
    const response = await fetch(`${account.baseUrl.replace(/\/+$/, '')}/api/task/tasks/${encodeURIComponent(projectId)}`, {
      headers: { 'x-api-key': account.apiKey },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return cached?.columns ?? []
    const payload = await response.json() as { data?: { columns?: unknown[] }, columns?: unknown[] }
    const columns = (payload.data?.columns ?? payload.columns ?? []).map(column => {
      const item = column as { slug?: string; name?: string; title?: string; tasks?: unknown[] }
      return { slug: String(item.slug ?? ''), name: String(item.name ?? item.title ?? ''), count: (item.tasks ?? []).length }
    }).filter(column => column.slug)
    boardCache.set(projectId, { at: Date.now(), columns })
    return columns
  } catch {
    return cached?.columns ?? []
  }
}

/** The charter as the project itself holds it: one text, the same for every Host that reads the project. */
export interface ProjectCharter { text: string, version: number, publishedAt: string }

const charterCache = new Map<string, { at: number; charter: ProjectCharter | undefined }>()
/** How long a project's charter is read from the server before it is read again. */
const CHARTER_TTL_MS = 30_000

/** Reads the project and returns the charter its description holds; undefined when it holds none. */
export async function readServerCharter (account: { baseUrl: string; apiKey: string } | undefined,
  projectId: string): Promise<ProjectCharter | undefined> {
  if (!account) return undefined
  const cached = charterCache.get(projectId)
  if (cached && Date.now() - cached.at < CHARTER_TTL_MS) return cached.charter
  try {
    const project = await new KaneoClient(account).project(projectId, { signal: AbortSignal.timeout(8_000) })
    const text = String(project.description ?? '').trim()
    // The document states its own publication instant; without it the weekly window could not be enforced.
    const publishedAt = /^\s*publishedAt\s*:\s*(\S+)/im.exec(text)?.[1] ?? ''
    const info = text ? charterOfText(text, publishedAt) : undefined
    const charter = info && info.version > 0 ? { text, version: info.version, publishedAt } : undefined
    charterCache.set(projectId, { at: Date.now(), charter })
    return charter
  } catch {
    return cached?.charter
  }
}

/**
 * Publishes one charter text for a project: the project's description becomes the charter, and its `version:` line is
 * stamped so every reader agrees on the number and the date. A project has exactly one charter, so this replaces the
 * previous text instead of adding another one.
 */
export async function publishCharter (account: { baseUrl: string; apiKey: string } | undefined, projectId: string,
  text: string, publishedBy: string, previous: ProjectCharter | undefined, now: Date = new Date()): Promise<ProjectCharter> {
  if (!account) throw new Error('No Kanban account is configured: a project charter is published to the project itself')
  const client = new KaneoClient(account)
  const version = (previous?.version ?? 0) + 1
  const stamped = stampCharter(text, version, publishedBy, now.toISOString())
  // The project update replaces the whole project; the server validates every field, so the current one is read back
  // and only the description is changed.
  const current = await client.project(projectId)
  await client.updateProject(projectId, { name: current.name, slug: current.slug, icon: current.icon,
    isPublic: current.isPublic, description: stamped })
  const charter = { text: stamped, version, publishedAt: now.toISOString() }
  charterCache.set(projectId, { at: Date.now(), charter })
  return charter
}

/** Rewrites the charter's own metadata lines so the published text states its version, author and date. */
export function stampCharter (text: string, version: number, publishedBy: string, publishedAt: string): string {
  const lines = text.split('\n')
  const meta: [RegExp, string][] = [
    [/^\s*version\s*:/i, `version: ${version}`],
    [/^\s*publishedBy\s*:/i, `publishedBy: ${publishedBy}`],
    [/^\s*publishedAt\s*:/i, `publishedAt: ${publishedAt}`],
  ]
  for (const [pattern, replacement] of meta) {
    const index = lines.findIndex(line => pattern.test(line))
    if (index >= 0) lines[index] = replacement
    else lines.splice(versionLineIndex(lines), 0, replacement)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Where to insert a missing metadata line: after the title and the metadata block that is already there. */
function versionLineIndex (lines: string[]): number {
  const first = lines.findIndex(line => line.trim() !== '')
  let index = first < 0 ? 0 : first + 1
  if (first >= 0 && /^#/.test(lines[first]!.trim())) index += 1
  while (index < lines.length && lines[index]!.trim() === '') index += 1
  return index
}

/**
 * Whether a project's charter may be published now: at most once a week, counted from the last publication. A PM may
 * override with `force` when the flow must change before the week is out; the panel says when it becomes due again.
 */
export function publishWindow (publishedAt: string | undefined, now: number = Date.now()):
{ ok: boolean, dueAt: number, daysLeft: number } {
  const published = publishedAt ? Date.parse(publishedAt) : Number.NaN
  if (!Number.isFinite(published)) return { ok: true, dueAt: 0, daysLeft: 0 }
  const dueAt = published + CHARTER_INTERVAL_DAYS * 24 * 60 * 60 * 1000
  const left = Math.max(0, dueAt - now)
  return { ok: left === 0, dueAt, daysLeft: Math.ceil(left / (24 * 60 * 60 * 1000)) }
}

/** The charter of a project that has none yet. */
export const EMPTY_CHARTER: CharterInfo = { version: 0, publishedAt: '', publishedBy: '', text: '', ageDays: -1, stale: true,
  hasDraft: false, versions: [], detail: 'No charter is published yet' }

/**
 * The charter of a project: the document held by the project itself, which every post reads. The local archive keeps
 * the draft and the version history; when the project holds a charter it wins, because it is the shared copy.
 */
export async function readCharter (project: ArchiveProject,
  account?: { baseUrl: string, apiKey: string } | undefined): Promise<CharterInfo> {
  const shared = account ? await readServerCharter(account, project.id) : undefined
  const text = shared?.text ?? project.charter.text
  const info = charterOfText(text, shared?.publishedAt ?? project.charter.publishedAt, project.charter.publishedBy)
  rememberCharterVersion(project.id, info.version)
  return {
    ...info,
    ...(shared ? { shared: true } : {}),
    hasDraft: hasCharterDraft(project.charter),
    versions: project.charter.history.map(item => ({
      version: item.version, publishedAt: item.publishedAt, publishedBy: item.publishedBy,
    })),
  }
}

/** The flow the charter declares: the columns it names and what each one means now. */
export function declaredFlowOf (text: string | undefined) {
  return flowOfCharter(text)
}

/** The flow declared by the archive's copy of a project's charter (a Host that cannot reach the project keeps a mirror). */
export function declaredFlow (project: ArchiveProject) {
  return flowOfCharter(project.charter.text)
}
