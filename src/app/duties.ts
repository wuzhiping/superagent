/**
 * The project's duty descriptions: one markdown file beside the charter, in the same Gitea repository (user decision
 * 2026-11-06 — the duty content is project governance, so the Host configures nothing about it). A card names the duty it
 * needs with a `duty:<id>` label; the host resolves the spec, refuses a duty that is not defined or that the card's post
 * does not take, and turns the spec into a compact brief the worker reads before it starts.
 */
import type { Trigger } from '../core/index.ts'
import { GiteaClient } from '../sources/gitea-api.ts'
import { repositoryOf } from '../sources/gitea-config.ts'
import type { CharterTarget } from './charter.ts'
import { postOfActor, type ProjectArchive } from './narrative.ts'

/** One duty as the project describes it: what it is for, what it must read, and how a post finishes it. */
export interface DutySpec {
  /** Stable id the cards name: `duty:<id>`. */
  id: string
  name: string
  /** What this duty is for. */
  goal: string
  /** What counts as done; one item per check. */
  done: string[]
  /** The default deliverable carrier (comment, doc, plan, code, deploy, memo); a card's `kind:` label may override it. */
  carrier: string
  /** The charter clauses this duty should pay attention to. */
  charterFocus: string[]
  /** What to read: charter, card/thread, MinIO prefixes, repository paths, links. */
  knowledge: string[]
  /** What may be read or written: the context and assets this duty is allocated. */
  resources: string[]
  /** The tools this duty is allowed to use, within what the host already permits. */
  tools: string[]
  /** The skills this duty should load. */
  skills: string[]
  /** Checks to do before accepting the card. */
  intake: string[]
  /** How to do the work, in order. */
  steps: string[]
  /** The traps this duty tends to fall into. */
  pitfalls: string[]
  /** The post ids that may take this duty; empty means any post. */
  posts: string[]
}

/** The duty descriptions as one carrier holds them. */
export interface DutiesDoc {
  text: string
  duties: DutySpec[]
  /** Where the document lives: `owner/repo/duties.md`, or empty when no carrier answered. */
  carrierRef: string
  /** The Gitea blob sha, needed to replace the file. */
  sha?: string
  /** Why the document is empty, when it could not be read. */
  detail?: string
}

/** The default name of the duties file: a sibling of the charter file. */
export const DUTIES_FILE = 'duties.md'

/** Where the duties file lives, derived from the charter path so the Host configures nothing new. */
export function dutiesPathOf (charterPath: string): string {
  const path = charterPath.trim().replace(/^\/+/, '')
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return dir ? `${dir}/${DUTIES_FILE}` : DUTIES_FILE
}

const LIST_KEYS: Record<string, keyof DutySpec> = {
  '承接岗位': 'posts', '岗位': 'posts', 'posts': 'posts', 'post': 'posts', 'for': 'posts',
  '知识': 'knowledge', 'knowledge': 'knowledge',
  '资源': 'resources', 'resources': 'resources',
  '工具': 'tools', 'tools': 'tools',
  '技能': 'skills', 'skills': 'skills',
  '宪章关注': 'charterFocus', '宪章': 'charterFocus', 'charterfocus': 'charterFocus', 'charter': 'charterFocus', 'focus': 'charterFocus',
  '完成': 'done', 'done': 'done', 'dod': 'done', '交付标准': 'done',
  '接单': 'intake', 'intake': 'intake', '接单检查': 'intake', 'acceptance': 'intake',
  '步骤': 'steps', 'steps': 'steps', '执行': 'steps', 'how': 'steps',
  '常见坑': 'pitfalls', '坑': 'pitfalls', 'pitfalls': 'pitfalls',
}
const TEXT_KEYS: Record<string, 'goal' | 'carrier'> = {
  '目标': 'goal', 'goal': 'goal', 'purpose': 'goal', '目的': 'goal',
  '载体': 'carrier', 'carrier': 'carrier', '交付载体': 'carrier', 'deliverable': 'carrier',
}

/** Splits one field value into items, keeping a comma inside a sentence such as `a, b` as a separator only for lists. */
const items = (value: string): string[] => value.split(/[，,、;；|]/).map(item => item.trim()).filter(Boolean)

/** The id and name a duty heading names: `### req-analysis · 需求分析（RML）`. */
function headingOf (line: string): { id: string; name: string } | undefined {
  const body = line.replace(/^#+\s*/, '').trim()
  if (!body) return undefined
  // A middle dot, a bar or a colon separates the id from its name; a dash only when spaces surround it, so a
  // kebab-case id keeps its dashes.
  let idPart = body
  let namePart = ''
  const split = /^(.+?)\s*[·|:：]\s*([\s\S]+)$/.exec(body) ?? /^(.+?)\s+[-—]\s+([\s\S]+)$/.exec(body)
  if (split) { idPart = split[1]!.trim(); namePart = split[2]!.trim() }
  const id = idPart.replace(/[`'"]/g, '').trim()
  if (!id || /^(职责|duties|duty)$/i.test(id)) return undefined
  return { id, name: namePart || id }
}

/**
 * Parses a duties document. The format is deliberately loose: a heading per duty (`### <id> · <name>`) and bullet lines
 * `- <field>：<value>`; unknown fields and prose are ignored, so a project can write the descriptions in its own words.
 */
export function parseDuties (text: string): DutySpec[] {
  const duties: DutySpec[] = []
  let current: DutySpec | undefined
  const push = (): void => { if (current) duties.push(current) }
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{2,3}\s/.test(line) ? headingOf(line) : undefined
    if (heading) {
      push()
      current = { id: heading.id, name: heading.name, goal: '', done: [], carrier: '', charterFocus: [], knowledge: [],
        resources: [], tools: [], skills: [], intake: [], steps: [], pitfalls: [], posts: [] }
      continue
    }
    if (!current) continue
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (!bullet) continue
    const body = bullet[1]!.trim()
    const split = /^([^:：]+)[:：]\s*(.*)$/.exec(body)
    if (!split) continue
    const key = split[1]!.trim().toLowerCase()
    const value = split[2]!.trim()
    if (!value) continue
    const textKey = TEXT_KEYS[key]
    if (textKey) { current[textKey] = value; continue }
    const listKey = LIST_KEYS[key]
    if (!listKey) continue
    const target = current[listKey] as string[]
    // Done, intake, steps and pitfalls are one check per bullet; the other lists are comma-separated references.
    if (target === current.done || target === current.intake || target === current.steps || target === current.pitfalls) target.push(value)
    else target.push(...items(value))
  }
  push()
  return duties.filter(duty => duty.id)
}

const dutiesCache = new Map<string, { at: number; doc: DutiesDoc }>()
/** How long the duties document is trusted before it is read from Gitea again. */
const DUTIES_TTL_MS = 30_000
/** Forgets the cached duties documents (tests, or after a publish). */
export function invalidateDutiesCache (): void { dutiesCache.clear() }

/** Reads the duties document from the Gitea repository that holds the charter, beside the charter file. */
export async function readDuties (target: CharterTarget): Promise<DutiesDoc> {
  const gitea = target.gitea
  if (!gitea) return { text: '', duties: [], carrierRef: '', detail: 'No Gitea charter repository is configured' }
  const path = dutiesPathOf(gitea.path)
  const key = `duties:${gitea.repository}:${path}`
  const cached = dutiesCache.get(key)
  if (cached && Date.now() - cached.at < DUTIES_TTL_MS) return cached.doc
  const parsed = repositoryOf(gitea.repository)
  if (!parsed) return { text: '', duties: [], carrierRef: `${gitea.repository}/${path}`, detail: 'The Gitea repository is not spelled owner/name' }
  try {
    const file = await new GiteaClient(gitea).fileContents(parsed.owner, parsed.name, path, undefined, AbortSignal.timeout(10_000))
    const doc: DutiesDoc = { text: file.text, duties: parseDuties(file.text), carrierRef: `${gitea.repository}/${path}`, ...file.sha ? { sha: file.sha } : {} }
    dutiesCache.set(key, { at: Date.now(), doc })
    return doc
  } catch (error) {
    // A repository without a duties file is normal (the project has not written its duties yet): answer empty, not failed.
    const doc: DutiesDoc = { text: '', duties: [], carrierRef: `${gitea.repository}/${path}`,
      detail: error instanceof Error && /-> 404/.test(error.message) ? 'No duties file yet' : String(error instanceof Error ? error.message : error) }
    dutiesCache.set(key, { at: Date.now(), doc })
    return doc
  }
}

/** Publishes the duties document into the Gitea repository, committing it on top of the blob it currently has. */
export async function publishDuties (target: CharterTarget, text: string, publishedBy: string): Promise<{ sha?: string; carrierRef: string }> {
  const gitea = target.gitea
  if (!gitea) throw new Error('No Gitea charter repository is configured: the duties live beside the charter')
  const parsed = repositoryOf(gitea.repository)
  if (!parsed) throw new Error('The Gitea repository is not spelled owner/name')
  const path = dutiesPathOf(gitea.path)
  const client = new GiteaClient(gitea)
  const readSha = async (): Promise<string | undefined> => {
    try { return (await client.fileContents(parsed.owner, parsed.name, path, undefined, AbortSignal.timeout(10_000))).sha } catch { return undefined }
  }
  let sha = await readSha()
  const write = async (): Promise<string | undefined> => {
    try {
      return await client.putFile(parsed.owner, parsed.name, path,
        { content: text, message: `duties: ${publishedBy || 'pm'}`, ...sha ? { sha } : {} }, AbortSignal.timeout(15_000))
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status !== 409 && status !== 422) throw error
      sha = await readSha()
      return await client.putFile(parsed.owner, parsed.name, path,
        { content: text, message: `duties: ${publishedBy || 'pm'}`, ...sha ? { sha } : {} }, AbortSignal.timeout(15_000))
    }
  }
  const newSha = await write()
  dutiesCache.clear()
  return { ...newSha ? { sha: newSha } : {}, carrierRef: `${gitea.repository}/${path}` }
}

/** What the host decides about a card's duty before the card becomes a ticket. */
export interface DutyGate {
  /** Set when the card must not start: an unknown duty, or a duty its post does not take. */
  refuse?: { code: 'dutyUndefined' | 'dutyUnsupported'; detail: string }
  /** The compact brief the worker reads before it starts. */
  brief?: string
  /** The spec itself, for the panel and `orchestrator_read duty`. */
  spec?: DutySpec
}

/** The short, readable brief a worker gets in its assignment: what this duty is and what it must not forget. */
export function dutyBrief (spec: DutySpec, charter?: { version?: number; carrierRef?: string }): string {
  const section = (label: string, values: string[] | string): string => {
    const list = Array.isArray(values) ? values.filter(Boolean) : (values ? [values] : [])
    return list.length ? `${label}: ${list.join('；')}` : ''
  }
  return [
    `Duty · ${spec.name} (${spec.id})`,
    ...charter?.version ? [`Charter v${charter.version}${charter.carrierRef ? ` (${charter.carrierRef})` : ''}`] : [],
    section('Goal', spec.goal),
    section('Done', spec.done),
    section('Carrier', spec.carrier),
    ...spec.charterFocus.length ? [`Charter focus: ${spec.charterFocus.join('；')}`] : [],
    section('Read first', spec.knowledge),
    ...spec.intake.length ? ['Before accepting: ' + spec.intake.join('；')] : [],
    ...spec.steps.length ? ['Steps: ' + spec.steps.join(' → ')] : [],
    ...spec.pitfalls.length ? [`Avoid: ${spec.pitfalls.join('；')}`] : [],
    ...spec.tools.length ? [`Tools: ${spec.tools.join(', ')}`] : [],
    ...spec.skills.length ? [`Skills: ${spec.skills.join(', ')}`] : [],
    'Read the current charter with orchestrator_read charter and report its version with your worklog.',
  ].filter(Boolean).join('\n')
}

/**
 * The duty gate for one trigger: a card whose `duty:` names an undefined duty, or a duty its post does not take, may not
 * start; a card with a known duty gets its brief. A card with no duty label, or a project with no duties document yet,
 * keeps working as before (backward compatible while projects fill their duties in).
 */
export async function dutyGate (target: CharterTarget, archive: ProjectArchive, trigger: Trigger,
  read: (target: CharterTarget) => Promise<DutiesDoc> = readDuties): Promise<DutyGate> {
  const labels = (trigger.meta as { labels?: string[] } | undefined)?.labels ?? []
  const dutyId = labels.map(label => label.toLowerCase()).find(label => label.startsWith('duty:'))?.slice(5).trim()
  if (!dutyId) return {}
  const doc = await read(target)
  if (!doc.duties.length) return {}
  const spec = doc.duties.find(duty => duty.id.toLowerCase() === dutyId)
  if (!spec) {
    return { refuse: { code: 'dutyUndefined', detail: `Duty "${dutyId}" is not defined in ${doc.carrierRef || 'the duties document'}` } }
  }
  const post = postOfActor(archive, trigger.actor.id)
  if (post && spec.posts.length && !spec.posts.includes(post.postId)) {
    return { refuse: { code: 'dutyUnsupported', detail: `Duty "${spec.name}" is taken by ${spec.posts.join(', ')}, not by ${post.postId}` } }
  }
  return { spec, brief: dutyBrief(spec) }
}
