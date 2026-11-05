/**
 * The project's charter: one document every post reads, whichever Host it runs on. Its home is the **Gitea repository
 * named on the Gitea Source card** — the repository's README.md is the charter's entry point and body (2026-11-06
 * user decision) — and the Kanban project's description is the mirror used when no Gitea repository is configured or
 * when this Host may not write to it. Publishing is a PM act bounded to at most once a week (RD.md §4.1, §8).
 */
import { DEFAULT_BASE_URL } from '../sources/kaneo-config.ts'
import { storedGiteaAccount, storedKaneoAccount } from '../sources/bdd-storage.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import { KaneoClient } from '../sources/kaneo-api.ts'
import { GiteaClient } from '../sources/gitea-api.ts'
import { DEFAULT_GITEA_URL, repositoryOf } from '../sources/gitea-config.ts'
import { charterOfText, flowOfCharter, hasCharterDraft, rememberCharterVersion, type ArchiveProject, type CharterInfo, type ProjectArchive }
  from './narrative.ts'
import type { Trigger } from '../core/index.ts'

/** How often a project's charter may be published: at most once a week, so the cadence is a ceiling, not a quota. */
export const CHARTER_INTERVAL_DAYS = 7
/** Where the charter lives inside the Gitea repository; the card may name another path. */
export const DEFAULT_CHARTER_PATH = 'README.md'

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

/** The Gitea repository that holds the charter: its server, credentials, **charter** repository and the charter's path. */
export interface GiteaCharterTarget {
  baseUrl: string
  user: string
  password: string
  token: string
  repository: string
  path: string
}

/**
 * The Gitea repository the charter comes from: the **charter repository** named on the Gitea Source card (`charterRepository`),
 * with the credentials the card holds or the ones this Host's storage record carries. Reading works anonymously on a
 * public repository; writing needs push rights, and without one the charter falls back to the Kanban project's description.
 */
export function giteaCharter (sources: SourceRegistry): GiteaCharterTarget | undefined {
  for (const instance of sources.instances()) {
    if (instance.kind !== 'gitea') continue
    const config = instance.config as Record<string, unknown> | undefined
    // The charter repository is its own field: the events repository may be a different one (user decision 2026-11-06).
    const repository = typeof config?.charterRepository === 'string' ? config.charterRepository.trim() : ''
    if (!repository) continue
    const server = typeof config?.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_GITEA_URL
    const stored = storedGiteaAccount(server)
    return {
      baseUrl: server,
      user: (typeof config?.user === 'string' && config.user.trim()) || stored?.user || '',
      password: (typeof config?.password === 'string' && config.password.trim()) || stored?.password || '',
      token: typeof config?.token === 'string' ? config.token.trim() : '',
      repository,
      path: typeof config?.charterPath === 'string' && config.charterPath.trim() ? config.charterPath.trim() : DEFAULT_CHARTER_PATH,
    }
  }
  return undefined
}

/** Everything the charter is read from or published to. */
export interface CharterTarget {
  kaneo?: { baseUrl: string, apiKey: string }
  gitea?: GiteaCharterTarget
}

/** The target this Host's Sources describe. */
export function charterTarget (sources: SourceRegistry): CharterTarget {
  return { ...kaneoAccount(sources) ? { kaneo: kaneoAccount(sources) } : {},
    ...giteaCharter(sources) ? { gitea: giteaCharter(sources) } : {} }
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

/** The charter as one carrier holds it: its text, the version it states, and where it was read. */
export interface ProjectCharter {
  text: string
  version: number
  publishedAt: string
  /** Which carrier this copy came from. */
  carrier: 'gitea' | 'kanban'
  /** The carrier's own reference: `owner/repo/README.md`, or the project id. */
  carrierRef: string
  /** The Gitea blob sha, needed to replace the file; present for the Gitea carrier. */
  sha?: string
}

const charterCache = new Map<string, { at: number; charter: ProjectCharter | undefined }>()
/** How long a charter is read from its carrier before it is read again. */
const CHARTER_TTL_MS = 30_000

/** Forgets the cached charter copies (tests, or after a carrier changed). */
export function invalidateCharterCache (): void { charterCache.clear() }

const charterOfFile = (text: string, publishedAt: string): Omit<ProjectCharter, 'carrier' | 'carrierRef' | 'sha'> | undefined => {
  const info = charterOfText(text, publishedAt)
  return info.version > 0 ? { text, version: info.version, publishedAt } : undefined
}

/**
 * Reads the charter from the Gitea repository: the file the card names, `README.md` by default. A repository without a
 * charter file answers undefined, so the Kanban mirror is used; a network failure answers the last read, if any.
 */
export async function readGiteaCharter (target: GiteaCharterTarget): Promise<ProjectCharter | undefined> {
  const key = `gitea:${target.repository}:${target.path}`
  const cached = charterCache.get(key)
  if (cached && Date.now() - cached.at < CHARTER_TTL_MS) return cached.charter
  const parsed = repositoryOf(target.repository)
  if (!parsed) return undefined
  const client = new GiteaClient(target)
  // The path the card names wins; a repository whose README is spelled differently is still read, not ignored.
  const candidates = [...new Set([target.path, 'README.md', 'readme.md'])]
  for (const path of candidates) {
    try {
      const file = await client.fileContents(parsed.owner, parsed.name, path, undefined, AbortSignal.timeout(10_000))
      const text = file.text.trim()
      const publishedAt = /^\s*publishedAt\s*:\s*(\S+)/im.exec(text)?.[1] ?? ''
      const base = charterOfFile(text, publishedAt)
      if (!base) continue
      const charter: ProjectCharter = { ...base, carrier: 'gitea', carrierRef: `${target.repository}/${path}`, sha: file.sha }
      charterCache.set(key, { at: Date.now(), charter })
      return charter
    } catch (error) {
      // A missing file is expected (the charter may not be published there yet); a refused read is not cached.
      if (error instanceof Error && /-> 404/.test(error.message)) continue
      return cached?.charter
    }
  }
  charterCache.set(key, { at: Date.now(), charter: undefined })
  return undefined
}

/** Reads the Kanban project and returns the charter its description holds; undefined when it holds none. */
export async function readServerCharter (account: { baseUrl: string; apiKey: string } | undefined,
  projectId: string): Promise<ProjectCharter | undefined> {
  if (!account) return undefined
  const key = `kanban:${projectId}`
  const cached = charterCache.get(key)
  if (cached && Date.now() - cached.at < CHARTER_TTL_MS) return cached.charter
  try {
    const project = await new KaneoClient(account).project(projectId, { signal: AbortSignal.timeout(8_000) })
    const text = String(project.description ?? '').trim()
    // The document states its own publication instant; without it the weekly window could not be enforced.
    const publishedAt = /^\s*publishedAt\s*:\s*(\S+)/im.exec(text)?.[1] ?? ''
    const base = text ? charterOfFile(text, publishedAt) : undefined
    const charter = base ? { ...base, carrier: 'kanban' as const, carrierRef: projectId } : undefined
    charterCache.set(key, { at: Date.now(), charter })
    return charter
  } catch {
    return cached?.charter
  }
}

/** The charter as the Sources describe its home: Gitea first, the Kanban mirror second. */
export async function readPrimaryCharter (target: CharterTarget, projectId: string): Promise<ProjectCharter | undefined> {
  if (target.gitea) {
    const fromGitea = await readGiteaCharter(target.gitea)
    if (fromGitea) return fromGitea
  }
  return target.kaneo ? readServerCharter(target.kaneo, projectId) : undefined
}

/**
 * Publishes one charter text: the Gitea README when the repository can be written, the Kanban project's description
 * otherwise. The version is stamped into the document, and the carrier that took it is reported back, so the panel can
 * say where the charter now lives.
 */
export async function publishCharter (target: CharterTarget, projectId: string, text: string, publishedBy: string,
  previous: ProjectCharter | undefined, now: Date = new Date()): Promise<ProjectCharter> {
  const version = (previous?.version ?? 0) + 1
  const stamped = stampCharter(text, version, publishedBy, now.toISOString())
  const publishedAt = now.toISOString()
  const target_repo = target.gitea
  if (target_repo) {
    const parsed = repositoryOf(target_repo.repository)
    if (parsed) {
      try {
        const client = new GiteaClient(target_repo)
        const readSha = async (): Promise<string | undefined> => {
          try {
            return (await client.fileContents(parsed.owner, parsed.name, target_repo.path, undefined, AbortSignal.timeout(10_000))).sha
          } catch { return undefined }
        }
        // A replacement always names the blob it commits on top of; without one Gitea refuses the write as stale.
        let sha = previous?.carrier === 'gitea' ? previous.sha : undefined
        if (!sha) sha = await readSha()
        const write = async (): Promise<string | undefined> => {
          try {
            return await client.putFile(parsed.owner, parsed.name, target_repo.path, {
              content: stamped, message: `charter v${version}: ${publishedBy}`, ...sha ? { sha } : {},
            }, AbortSignal.timeout(15_000))
          } catch (error) {
            // 409/422 means the blob moved under us: read it again and commit on top of that.
            const status = (error as { status?: number }).status
            if (status !== 409 && status !== 422) throw error
            sha = await readSha()
            return await client.putFile(parsed.owner, parsed.name, target_repo.path, {
              content: stamped, message: `charter v${version}: ${publishedBy}`, ...sha ? { sha } : {},
            }, AbortSignal.timeout(15_000))
          }
        }
        const newSha = await write()
        const charter: ProjectCharter = { text: stamped, version, publishedAt, carrier: 'gitea',
          carrierRef: `${target_repo.repository}/${target_repo.path}`, ...newSha ? { sha: newSha } : {} }
        charterCache.set(`gitea:${target_repo.repository}:${target_repo.path}`, { at: Date.now(), charter })
        return charter      } catch (error) {
        // Writing needs push rights: an anonymous or read-only account still publishes the mirror instead of failing.
        if (!target.kaneo) throw error
      }
    }
  }
  if (!target.kaneo) {
    throw new Error('No charter carrier is configured: set the Gitea repository (or a Kanban account for the mirror)')
  }
  const client = new KaneoClient(target.kaneo)
  // The project update replaces the whole project; the server validates every field, so the current one is read back
  // and only the description is changed.
  const current = await client.project(projectId)
  await client.updateProject(projectId, { name: current.name, slug: current.slug, icon: current.icon,
    isPublic: current.isPublic, description: stamped })
  const charter: ProjectCharter = { text: stamped, version, publishedAt, carrier: 'kanban', carrierRef: projectId }
  charterCache.set(`kanban:${projectId}`, { at: Date.now(), charter })
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
 * The charter of a project: the document its carrier holds, which every post reads. The local archive keeps the draft
 * and the version history; a carrier wins over the archive copy, because it is the shared one.
 */
export async function readCharter (project: ArchiveProject, target: CharterTarget = {}): Promise<CharterInfo> {
  const shared = await readPrimaryCharter(target, project.id)
  const text = shared?.text ?? project.charter.text
  const info = charterOfText(text, shared?.publishedAt ?? project.charter.publishedAt, project.charter.publishedBy)
  rememberCharterVersion(project.id, info.version)
  return {
    ...info,
    ...(shared ? { shared: true, carrier: shared.carrier, carrierRef: shared.carrierRef } : { carrier: 'archive' as const }),
    hasDraft: hasCharterDraft(project.charter),
    versions: project.charter.history.map(item => ({
      version: item.version, publishedAt: item.publishedAt, publishedBy: item.publishedBy,
    })),
  }
}

/**
 * Whether work may start on a trigger's project: a project this Host keeps in the archive needs a published charter
 * (version > 0); a trigger that names no project, or names one the archive does not know, has no charter to obey.
 */
export async function charterAllows (archive: ProjectArchive, target: CharterTarget, trigger: Trigger): Promise<boolean> {
  const projectId = typeof trigger.meta?.projectId === 'string' ? trigger.meta.projectId : undefined
  const project = projectId ? archive.projects.find(item => item.id === projectId) : undefined
  if (!project) return true
  const charter = await readCharter(project, target)
  return charter.version > 0
}

/** The flow the charter declares: the columns it names and what each one means now. */
export function declaredFlowOf (text: string | undefined) {
  return flowOfCharter(text)
}

/** The flow declared by the archive's copy of a project's charter (a Host that cannot reach the project keeps a mirror). */
export function declaredFlow (project: ArchiveProject) {
  return flowOfCharter(project.charter.text)
}
