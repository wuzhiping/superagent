import { describe, expect, it } from 'vitest'
import { CHARTER_INTERVAL_DAYS, publishWindow, stampCharter } from '../src/app/charter.ts'

describe('charter: publishing stamps the document', () => {
  it('replaces the metadata lines that are already there', () => {
    const text = ['# 宪章 v1', 'version: 1', 'publishedBy: pm-old', 'publishedAt: 2026-01-01T00:00:00.000Z', '- 当期流程：ready 待開工 → done 完成'].join('\n')
    const stamped = stampCharter(text, 4, 'pm-fdep', '2026-11-05T00:00:00.000Z')
    expect(stamped).toContain('version: 4')
    expect(stamped).toContain('publishedBy: pm-fdep')
    expect(stamped).toContain('publishedAt: 2026-11-05T00:00:00.000Z')
    expect(stamped).not.toContain('version: 1')
    expect(stamped).toContain('- 当期流程：ready 待開工 → done 完成')
  })

  it('adds the metadata lines a new charter lacks', () => {
    const stamped = stampCharter('# 宪章\n\n- 当期流程：to-do 待辦 → done 完成\n', 1, 'pm-fdep', '2026-11-05T00:00:00.000Z')
    expect(stamped).toContain('version: 1')
    expect(stamped).toContain('publishedBy: pm-fdep')
    expect(stamped).toContain('publishedAt:')
    // The lines sit with the title, before the body.
    expect(stamped.indexOf('version: 1')).toBeLessThan(stamped.indexOf('- 当期流程'))
  })

  it('ends with exactly one newline and no triple blank lines', () => {
    const stamped = stampCharter('# 宪章\n\n\n\n- 当期流程：done 完成\n', 2, 'pm', '2026-11-05T00:00:00.000Z')
    expect(stamped.endsWith('\n')).toBe(true)
    expect(stamped.includes('\n\n\n')).toBe(false)
  })
})

describe('charter: at most one publication a week', () => {
  const day = 24 * 60 * 60 * 1000

  it('allows the first publication', () => {
    expect(publishWindow(undefined)).toMatchObject({ ok: true })
  })

  it('refuses a second publication inside the week and says when it is due', () => {
    const publishedAt = '2026-11-01T00:00:00.000Z'
    const now = Date.parse('2026-11-03T00:00:00.000Z')
    const window = publishWindow(publishedAt, now)
    expect(window.ok).toBe(false)
    expect(window.dueAt).toBe(Date.parse(publishedAt) + CHARTER_INTERVAL_DAYS * day)
    expect(window.daysLeft).toBe(5)
  })

  it('allows the next publication once the week has passed', () => {
    const publishedAt = '2026-11-01T00:00:00.000Z'
    expect(publishWindow(publishedAt, Date.parse('2026-11-08T00:00:01.000Z'))).toMatchObject({ ok: true })
  })
})
