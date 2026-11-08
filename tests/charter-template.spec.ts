// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDutyId, parseDutyFile } from '../src/app/duties.ts'
import { applyCharterTemplate, capabilitySection, listTemplateFiles } from '../scripts/lib/charter-template.mjs'

const target = () => mkdtempSync(join(tmpdir(), 'charter-template-'))

describe('generic charter template', () => {
  it('is complete enough for a Quick Small Start', () => {
    const files = listTemplateFiles()
    expect(files).toEqual(expect.arrayContaining([
      'README.md', 'CAPABILITY.md', 'duties/README.md', 'duties/_TEMPLATE-code.md', 'duties/_TEMPLATE-doc.md',
      'reviews/README.md', 'reviews/weekly/TEMPLATE.md', 'context/retrospectives.md',
      'context/domain/_TEMPLATE.md', 'context/ontology/team-model.md',
      'KE/README.md', 'KE/index.md', 'KE/_TEMPLATE.md', 'skills/README.md', 'skills/registry.md',
    ]))
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  it('adds every missing file to an empty repository', () => {
    const dir = target()
    const result = applyCharterTemplate(dir)
    expect(result.kept).toEqual([])
    expect(result.added).toEqual(expect.arrayContaining(['README.md', 'duties/_TEMPLATE-code.md', 'KE/index.md']))
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('能力供给')
    expect(existsSync(join(dir, 'reviews/weekly/TEMPLATE.md'))).toBe(true)
  })

  it('is idempotent and never overwrites existing content', () => {
    const dir = target()
    writeFileSync(join(dir, 'README.md'), '# 我的宪章\n\n已有人写的内容\n', 'utf8')
    const first = applyCharterTemplate(dir)
    expect(first.kept).toEqual(['README.md'])
    expect(first.added).not.toContain('README.md')
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# 我的宪章\n\n已有人写的内容\n')

    const second = applyCharterTemplate(dir)
    expect(second.added).toEqual([])
    expect(second.kept.length).toBe(first.added.length + first.kept.length)
  })

  it('keeps the duty templates non-duties so they are never dispatched', () => {
    const files = listTemplateFiles().filter(path => path.startsWith('duties/_TEMPLATE-'))
    expect(files.length).toBe(3)
    for (const path of files) {
      const id = path.split('/').pop().replace(/\.md$/, '')
      expect(isDutyId(id)).toBe(false)
    }
  })

  it('the duty templates still parse when copied under a real id', () => {
    const text = readFileSync('templates/charter/duties/_TEMPLATE-code.md', 'utf8')
    const spec = parseDutyFile(text, 'my-code')
    expect(spec.id).toBe('my-code')
    expect(spec.goal.length).toBeGreaterThan(10)
    expect(spec.done.length).toBeGreaterThan(0)
    expect(spec.steps.length).toBeGreaterThan(0)
    expect(spec.carrier).toBe('code')
  })

  it('prints a capability section for merging into an existing README', () => {
    const section = capabilitySection()
    expect(section).toContain('## 能力供给')
    expect(section).toContain('reviews/')
    expect(section).toContain('KE/')
  })
})
