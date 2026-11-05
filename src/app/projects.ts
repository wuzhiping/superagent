/**
 * What a person picks from when the panel asks for a project: the Kanban workspaces this account belongs to and their
 * projects. Typing a project id from memory is an error waiting to happen — the panel offers the list the server
 * answers, and the choice fills in the id, the name and the slug.
 */
import { DEFAULT_BASE_URL } from '../sources/kaneo-config.ts'
import { KaneoClient } from '../sources/kaneo-api.ts'
/** One workspace the account can see. */
export interface WorkspaceChoice {
  id: string
  name: string
}

/** One project the account can see, with the workspace it belongs to. */
export interface ProjectChoice {
  id: string
  name: string
  slug: string
  workspaceId: string
}

/** The picker's data: both lists, or the reason the server could not answer. */
export interface ProjectChoices {
  workspaces: WorkspaceChoice[]
  projects: ProjectChoice[]
  problem?: string
}

const CACHE_MS = 60_000
const cache = new Map<string, { at: number, choices: ProjectChoices }>()

/**
 * Reads the workspaces and their projects. The answer is cached for a minute: the panel asks on every settings visit,
 * and the list endpoint costs one request per workspace.
 */
export async function readProjectChoices (account: { baseUrl: string, apiKey: string } | undefined,
  options: { force?: boolean, now?: number } = {}): Promise<ProjectChoices> {
  if (!account) {
    return { workspaces: [], projects: [],
      problem: 'This Host has no Kanban account yet: set the card, or run as a user whose credentials carry the storage reference' }
  }
  const key = `${account.baseUrl}|${account.apiKey.slice(-8)}`
  const cached = cache.get(key)
  const now = options.now ?? Date.now()
  if (!options.force && cached && now - cached.at < CACHE_MS) return cached.choices
  const client = new KaneoClient(account)
  try {
    const workspaces = await client.workspaces()
    const projects: ProjectChoice[] = []
    for (const workspace of workspaces) {
      const rows = await client.projects(workspace.id).catch(() => [])
      for (const row of rows) {
        projects.push({ id: row.id, name: row.name, slug: row.slug,
          workspaceId: row.workspaceId || workspace.id })
      }
    }
    // The workspace a project names may be the only one the account can see; keep both lists consistent.
    const choices: ProjectChoices = {
      workspaces: workspaces.map(workspace => ({ id: workspace.id, name: workspace.name })),
      projects: projects.sort((left, right) => left.name.localeCompare(right.name)),
    }
    cache.set(key, { at: now, choices })
    return choices
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error)
    // A failed read still answers with what was cached last time, so the picker is not empty for no reason.
    return { workspaces: cached?.choices.workspaces ?? [], projects: cached?.choices.projects ?? [], problem }
  }
}

/** Forgets the cached lists (after a settings save, or when the account changes). */
export function invalidateProjectChoices (): void {
  cache.clear()
}

/** The server the account talks to when the card names none. */
export const DEFAULT_PROJECT_SERVER = DEFAULT_BASE_URL
