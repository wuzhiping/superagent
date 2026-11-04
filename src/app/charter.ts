/**
 * The project's own truth: the board's columns (the value stream the team works in) come from the server, and the
 * charter the PM published comes from the panel's archive. Neither is configured twice (RD.md §6.4, §8).
 */
import { kaneoAccountOf } from '../sources/kaneo-config.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import { charterOfText, flowOfCharter, hasCharterDraft, readArchive, rememberCharterVersion, type ArchiveProject, type CharterInfo } from './narrative.ts'

/** The KanEO account the deployment uses, so the host can read the board it works on. */
export function kaneoAccount (sources: SourceRegistry): { baseUrl: string; apiKey: string } | undefined {
  for (const instance of sources.instances()) {
    if (instance.kind !== 'kaneo') continue
    const account = kaneoAccountOf(instance.config as Record<string, unknown> | undefined)
    if (account) return { baseUrl: account.baseUrl, apiKey: account.apiKey }
  }
  return undefined
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

/** The charter of a project that has none yet. */
export const EMPTY_CHARTER: CharterInfo = { version: 0, publishedAt: '', publishedBy: '', text: '', ageDays: -1, stale: true,
  hasDraft: false, versions: [], detail: 'No charter is published yet' }

/** The charter of a project: the document the PM published, read from the archive. */
export function readCharter (project: ArchiveProject): CharterInfo {
  const charter = project.charter
  const info = charterOfText(charter.text, charter.publishedAt, charter.publishedBy)
  rememberCharterVersion(project.id, info.version)
  return { ...info, hasDraft: hasCharterDraft(charter), versions: charter.history.map(item => ({
    version: item.version, publishedAt: item.publishedAt, publishedBy: item.publishedBy,
  })) }
}

/** The flow the charter declares: the columns it names and what each one means now. */
export function declaredFlow (project: ArchiveProject) {
  return flowOfCharter(project.charter.text)
}
