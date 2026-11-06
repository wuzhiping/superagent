/**
 * Mapping a post's friendly Kanban account (e-mail) to the board's user id: the host resolves it when the project
 * archive is saved, so a person types an e-mail and the board keeps using the id it needs.
 */

/** One member of the Kanban workspace: the id the board assigns to, and the e-mail a person recognises. */
export interface KaneoMember {
  id: string
  name?: string
  email?: string
  role?: string
}

/** A post that names a friendly account; the resolver fills its id. */
interface PostLike {
  postId: string
  kaneoUser: string
  kaneoUserId: string
}

/** The archive as the resolver reads it: projects with posts. */
interface ArchiveLike {
  projects: { id: string, posts: PostLike[] }[]
}

/** The account a post names: an e-mail matched case-insensitively, or an id matched exactly. */
export function matchKaneoMember (members: readonly KaneoMember[], value: string): KaneoMember | undefined {
  const wanted = value.trim().toLowerCase()
  if (!wanted) return undefined
  if (wanted.includes('@')) return members.find(member => member.email?.trim().toLowerCase() === wanted)
  return members.find(member => member.id === value.trim())
}

/** The e-mail a member carries, for display; empty when the member has none. */
export const memberEmail = (member: KaneoMember | undefined): string => member?.email?.trim() ?? ''

/**
 * Resolves every post's `kaneoUser` to its `kaneoUserId` with the members of the post's project. A post without a
 * friendly account keeps the id it has (the old, id-only archives stay valid); an account the workspace does not know
 * is an error naming the post and the account, so the save fails with something a person can fix.
 */
export async function resolveArchiveKaneoUsers<A extends ArchiveLike> (archive: A,
  membersOf: (projectId: string) => Promise<readonly KaneoMember[] | undefined>): Promise<{ archive: A, mapped: { postId: string, email: string, userId: string }[] }> {
  const mapped: { postId: string, email: string, userId: string }[] = []
  const members = new Map<string, readonly KaneoMember[] | undefined>()
  for (const project of archive.projects) {
    for (const post of project.posts) {
      const account = post.kaneoUser.trim()
      if (!account) continue
      if (!members.has(project.id)) members.set(project.id, await membersOf(project.id))
      const found = matchKaneoMember(members.get(project.id) ?? [], account)
      if (!found) {
        throw new Error(`Kanban 使用者「${account}」不在这个项目所在的工作区成员里；请填写成员的登录邮箱（岗位 ${post.postId}）`)
      }
      post.kaneoUserId = found.id
      mapped.push({ postId: post.postId, email: account, userId: found.id })
    }
  }
  return { archive, mapped }
}
