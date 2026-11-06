/** The e-mail-to-Kanban-id mapping: a person names a login e-mail, the host fills the board's user id. */
import { describe, expect, it } from 'vitest'
import { matchKaneoMember, resolveArchiveKaneoUsers } from '../src/app/kaneo-users.ts'

const members = [
  { id: 'u-pm', name: 'PM', email: 'pm@example.com', role: 'admin' },
  { id: 'u-w1', name: 'W1', email: 'W1@Example.com', role: 'member' },
]
const archive = (posts: { postId: string, kaneoUser: string, kaneoUserId: string }[]) => ({ version: 1, projects: [{ id: 'p1', posts }] })

describe('matchKaneoMember', () => {
  it('matches an e-mail regardless of case and surrounding spaces', () => {
    expect(matchKaneoMember(members, ' PM@example.com ')?.id).toBe('u-pm')
    expect(matchKaneoMember(members, 'w1@example.com')?.id).toBe('u-w1')
  })
  it('also accepts the user id itself (old archives)', () => {
    expect(matchKaneoMember(members, 'u-w1')?.id).toBe('u-w1')
  })
  it('has no match for an unknown account or an empty value', () => {
    expect(matchKaneoMember(members, 'nobody@example.com')).toBeUndefined()
    expect(matchKaneoMember(members, '  ')).toBeUndefined()
  })
})

describe('resolveArchiveKaneoUsers', () => {
  it('fills the id from the e-mail and reports the mapping', async () => {
    const result = await resolveArchiveKaneoUsers(archive([{ postId: 'pm', kaneoUser: 'pm@example.com', kaneoUserId: '' }]),
      async () => members)
    expect(result.archive.projects[0]!.posts[0]!.kaneoUserId).toBe('u-pm')
    expect(result.mapped).toEqual([{ postId: 'pm', email: 'pm@example.com', userId: 'u-pm' }])
  })
  it('leaves a post without an e-mail on the id it already has', async () => {
    const result = await resolveArchiveKaneoUsers(archive([{ postId: 'w', kaneoUser: '', kaneoUserId: 'u-old' }]), async () => members)
    expect(result.archive.projects[0]!.posts[0]!.kaneoUserId).toBe('u-old')
    expect(result.mapped).toEqual([])
  })
  it('fails with a message naming the post and the unknown account', async () => {
    await expect(resolveArchiveKaneoUsers(archive([{ postId: 'pm', kaneoUser: 'ghost@example.com', kaneoUserId: '' }]),
      async () => members)).rejects.toThrow('ghost@example.com')
  })
  it('asks the members once per project', async () => {
    let calls = 0
    await resolveArchiveKaneoUsers(archive([
      { postId: 'pm', kaneoUser: 'pm@example.com', kaneoUserId: '' },
      { postId: 'w1', kaneoUser: 'w1@example.com', kaneoUserId: '' },
    ]), async () => { calls += 1; return members })
    expect(calls).toBe(1)
  })
})
