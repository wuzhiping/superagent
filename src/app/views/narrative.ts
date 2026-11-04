/**
 * The narrative view the management panel shows: projects, posts, the charter each PM published, the duties a post
 * runs, and the exceptions a PM has to handle (RD.md §4–§8).
 */
import { declaredFlow, kaneoAccount, readBoardColumns, readCharter } from '../charter.ts'
import type { SourceRegistry } from '../../sources/registry.ts'
import {
  archiveRevision, dutyRows, dutiesOfPost, exceptionRows, readArchive,
  type ArchivePost, type ArchiveProject, type CharterInfo, type DutyRow, type ExceptionRow, type ProjectArchive,
} from '../narrative.ts'
import type { Store } from '../store.ts'

export interface PostView {
  postId: string
  role: 'pm' | 'worker'
  name: string
  projectId: string
  projectName: string
  kaneoUserId: string
  giteaUser: string
  ntfySender: string
  wipLimit: number
  instance: string
  /** The board columns whose cards this post takes. */
  watchColumns: string
  /** The duties this post runs right now. */
  dutyCount: number
  /** The duties this post runs, newest first. */
  duties: DutyRow[]
  /** Whether the post runs more duties than its limit allows. */
  overLimit: boolean
}

export interface ProjectView {
  id: string
  name: string
  slug: string
  topics: string[]
  /**
   * The value stream: the board's columns as they are now (read from the server), beside the flow the charter
   * declares. A column the board has and the charter does not is flow that grew without the PM confirming it.
   */
  flow: {
    /** The steps the charter declares. */
    declared: { column: string; meaning: string }[]
    /** The board's columns as they are now. */
    board: { slug: string; name: string; count: number }[]
    /** The columns the board has that the charter does not know, and the other way round. */
    drift: { added: string[]; removed: string[] }
    /** Whether the board and the charter describe the same flow. */
    aligned: boolean
  }
  posts: PostView[]
  charter: CharterInfo
}

export interface NarrativeView {
  /** Whether a project archive is configured at all. */
  configured: boolean
  projects: ProjectView[]
  posts: PostView[]
  duties: DutyRow[]
  exceptions: ExceptionRow[]
  /** The posts that run more duties than their limit allows. */
  overLimit: number
}

/** Builds the narrative view from the archive, the stored tickets, the boards and the charters. */
export async function narrativeView (store: Store, sources: SourceRegistry, stateDir: string): Promise<NarrativeView> {
  const archive: ProjectArchive = readArchive(stateDir)
  const duties = dutyRows(store, archive)
  const exceptions = exceptionRows(store, archive)
  const account = kaneoAccount(sources)
  const projects: ProjectView[] = []
  for (const project of archive.projects) {
    const charter = readCharter(project)
    const board = await readBoardColumns(account, project.id)
    const declared = declaredFlow(project)
    const boardSlugs = board.map(column => column.slug)
    const declaredSlugs = declared.map(step => step.column)
    const drift = {
      added: boardSlugs.filter(slug => !declaredSlugs.includes(slug)),
      removed: declaredSlugs.filter(slug => !boardSlugs.includes(slug)),
    }
    const posts: PostView[] = project.posts.map(post => {
      const own = dutiesOfPost(duties, post.postId)
      return {
        postId: post.postId, role: post.role, name: post.name, projectId: project.id, projectName: project.name,
        kaneoUserId: post.kaneoUserId, giteaUser: post.giteaUser, ntfySender: post.ntfySender,
        wipLimit: post.wipLimit, instance: post.instance, watchColumns: post.watchColumns,
        dutyCount: own.length, duties: own, overLimit: own.length > post.wipLimit,
      }
    })
    projects.push({
      id: project.id, name: project.name, slug: project.slug, topics: project.topics,
      flow: { declared, board, drift, aligned: drift.added.length === 0 && drift.removed.length === 0 },
      posts, charter,
    })
  }
  const posts = projects.flatMap(project => project.posts)
  return {
    configured: archive.projects.length > 0,
    projects, posts, duties, exceptions,
    overLimit: posts.filter(post => post.overLimit).length,
  }
}

/** The archive as the settings page edits it, with the revision that guards concurrent edits. */
export function archiveView (stateDir: string): { archive: ProjectArchive; revision: number } {
  return { archive: readArchive(stateDir), revision: archiveRevision(stateDir) }
}
