import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultTopic, readArchive, topicsAfterPick, topicsOfProject, withDefaultTopics, writeArchive } from '../src/app/narrative.ts'

const state = () => mkdtempSync(join(tmpdir(), 'archive-topics-'))
const project = (overrides: Record<string, unknown>) => ({
  id: 'at8xrho45bisco2umjzgl1xp', name: 'Superagent', slug: 'RSI', charter: {}, topics: [], posts: [], ...overrides,
})

describe('project topics: an empty list means pub_<project id>', () => {
  it('names the default topic after the project', () => {
    expect(defaultTopic('dgctny8ibgpn72ei2j8qj2hc')).toBe('pub_dgctny8ibgpn72ei2j8qj2hc')
    expect(topicsOfProject([], 'p1')).toEqual(['pub_p1'])
    expect(topicsOfProject(undefined, 'p1')).toEqual(['pub_p1'])
  })

  it('keeps the topics a project names', () => {
    expect(topicsOfProject(['pub_a', 'pub_b'], 'p1')).toEqual(['pub_a', 'pub_b'])
  })

  it('has no default without a project id', () => {
    expect(defaultTopic('')).toBe('')
    expect(topicsOfProject([], '')).toEqual([])
  })

  it('applies the convention to every project of an archive', () => {
    const archive = withDefaultTopics({ version: 1, projects: [project({ id: 'p1' }), project({ id: 'p2', topics: ['pub_x'] })] } as never)
    expect(archive.projects.map(item => item.topics)).toEqual([['pub_p1'], ['pub_x']])
  })

  it('reads an archive whose project names no topic with the default filled in', () => {
    const dir = state()
    writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [project({ id: 'p1' })] }), 'utf8')
    expect(readArchive(dir).projects[0]!.topics).toEqual(['pub_p1'])
  })

  it('writes the default rather than storing an empty list', () => {
    const dir = state()
    writeArchive(dir, { version: 1, projects: [project({ id: 'p1' })] }, 0)
    const stored = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'))
    expect(stored.projects[0].topics).toEqual(['pub_p1'])
  })
})

describe('project topics: choosing a project moves the default to the chosen one', () => {
  it('fills the chosen project default when the list is empty', () => {
    expect(topicsAfterPick([], '', 'at8xrho45bisco2umjzgl1xp')).toEqual(['pub_at8xrho45bisco2umjzgl1xp'])
    expect(topicsAfterPick(undefined, 'p1', 'p2')).toEqual(['pub_p2'])
  })

  it('replaces the previous project default when another project is chosen', () => {
    expect(topicsAfterPick(['pub_p1'], 'p1', 'p2')).toEqual(['pub_p2'])
    // The same project selected again keeps its default.
    expect(topicsAfterPick(['pub_p1'], 'p1', 'p1')).toEqual(['pub_p1'])
  })

  it('keeps topics somebody wrote', () => {
    expect(topicsAfterPick(['pub_fdep_pm'], 'p1', 'p2')).toEqual(['pub_fdep_pm'])
    expect(topicsAfterPick(['pub_p1', 'pub_extra'], 'p1', 'p2')).toEqual(['pub_p1', 'pub_extra'])
  })

  it('keeps the list when nothing is chosen', () => {
    expect(topicsAfterPick(['pub_p1'], 'p1', '')).toEqual(['pub_p1'])
  })
})
