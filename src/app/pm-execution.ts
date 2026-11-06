/**
 * A PM post is a management seat: it plans, dispatches, watches and clears exceptions, and by default it does not
 * execute the worker duties itself. The published charter may say otherwise — it is the project's standing agreement —
 * with a line such as `- PM 可执行职责：doc, req-analysis` (or `PM 可执行职责：*` for any duty). Without that line, a card
 * whose assignee is a PM post is refused before a ticket exists, so nobody "dispatches work to the PM" by accident.
 */
import type { Trigger } from '../core/index.ts'
import { postOfActor, type ProjectArchive } from './narrative.ts'
import type { DutyGate } from './duties.ts'

/** The PM execution allowance a charter states: every duty, or the duty ids it names. */
export interface PmAllowance {
  all: boolean
  duties: string[]
}

/** Matches the charter line that grants the PM execution: `PM 可执行职责：doc, prd` or `pm-executes: *`. */
const ALLOWANCE_LINE = /^\s*[-*]?\s*(?:PM\s*可执行职责|pm-executes)\s*[:：]\s*(.+)$/i
const ALL = new Set(['*', 'all', 'any', '全部', '所有'])

/** Reads the PM execution allowance from the published charter text (the first matching line wins; unknown text = none). */
export function pmAllowance (charterText: string | undefined): PmAllowance {
  const duties: string[] = []
  let all = false
  for (const raw of (charterText ?? '').split(/\r?\n/)) {
    const match = ALLOWANCE_LINE.exec(raw.trim())
    if (!match) continue
    for (const item of match[1]!.trim().split(/[,，、\s]+/).filter(Boolean)) {
      if (ALL.has(item.toLowerCase())) { all = true; continue }
      duties.push(item.toLowerCase())
    }
  }
  return { all, duties }
}

/** The duty a card names with its `duty:<id>` label, if any. */
export function dutyIdOf (trigger: Trigger): string | undefined {
  const labels = Array.isArray(trigger.meta?.labels) ? trigger.meta.labels.filter((label): label is string => typeof label === 'string') : []
  return labels.map(label => label.toLowerCase()).find(label => label.startsWith('duty:'))?.slice(5).trim() || undefined
}

/**
 * Refuses an accept aimed at a PM post unless the published charter allows the PM to execute it. A worker post, an
 * unarchived actor, or a charter that names this duty (or every duty) passes through unchanged.
 */
export function pmExecutionGate (archive: ProjectArchive, charterText: string | undefined, trigger: Trigger): DutyGate {
  const post = postOfActor(archive, trigger.actor.id)
  if (!post || post.role !== 'pm') return {}
  const allowance = pmAllowance(charterText)
  if (allowance.all) return {}
  const dutyId = dutyIdOf(trigger)
  if (dutyId && allowance.duties.includes(dutyId)) return {}
  const named = dutyId ? `（职责 ${dutyId}）` : ''
  return { refuse: { code: 'pmExecutionNotAllowed',
    detail: `PM 岗位默认不执行工人职责${named}；把这张卡派给工人岗位，或在宪章里写明「PM 可执行职责：${dutyId ?? '*'}"` } }
}
