/**
 * The project's duty descriptions: one markdown file per duty in a `duties/` folder beside the charter, in the same Gitea
 * repository (user decision 2026-11-07 — a folder, so the panel can list the duties and a post picks its duties from a
 * dropdown instead of typing ids). A single legacy `duties.md` is still read when the folder does not exist yet, and a
 * publish writes the folder and retires that file.
 *
 * A card names the duty it needs with a `duty:<id>` label; the host resolves the spec, refuses a duty that is not defined
 * or that the card's post does not take, and turns the spec into a compact brief the worker reads before it starts.
 */
import type { Trigger } from '../core/index.ts'
import { GiteaClient } from '../sources/gitea-api.ts'
import { repositoryOf } from '../sources/gitea-config.ts'
import type { CharterTarget } from './charter.ts'
import { postOfActor, type ProjectArchive } from './narrative.ts'

/** One duty as the project describes it: what it is for, what it must read, and how a post finishes it. */
export interface DutySpec {
  /** Stable id the cards name: `duty:<id>`. It is also the file name under `duties/`. */
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
  /** The post ids that may take this duty; empty means any post. A post's own selection (`duties`) takes precedence. */
  posts: string[]
}

/** The duty descriptions as one carrier holds them. */
export interface DutiesDoc {
  text: string
  duties: DutySpec[]
  /** Where they live: `owner/repo/duties/` for the folder, `owner/repo/duties.md` for the legacy file, or empty. */
  carrierRef: string
  /** Whether the carrier holds one file per duty, one legacy document, or nothing yet. */
  mode: 'folder' | 'file' | 'none'
  /** The repository path of each duty file, keyed by duty id, when the folder holds them. */
  files?: Record<string, string>
  /** The Gitea blob sha of the legacy file, needed to replace it. */
  sha?: string
  /** Why the document is empty, when it could not be read. */
  detail?: string
}

/** The legacy single file: a sibling of the charter file. */
export const DUTIES_FILE = 'duties.md'
/** The folder that holds one file per duty, beside the charter file. */
export const DUTIES_DIR = 'duties'

/** The directory part of a repository path (`docs/charter.md` → `docs`), empty at the root. */
function directoryOf (path: string): string {
  const clean = path.trim().replace(/^\/+/, '')
  return clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : ''
}

/** Where the legacy duties file lives, derived from the charter path so the Host configures nothing new. */
export function dutiesPathOf (charterPath: string): string {
  const dir = directoryOf(charterPath)
  return dir ? `${dir}/${DUTIES_FILE}` : DUTIES_FILE
}

/** Where the duties folder lives, beside the charter file. */
export function dutiesDirOf (charterPath: string): string {
  const dir = directoryOf(charterPath)
  return dir ? `${dir}/${DUTIES_DIR}` : DUTIES_DIR
}

/** A duty id that is also a safe file name: `duties/<id>.md`. */
export const isDutyId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)

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

/** An empty spec, so a file that only has a heading still becomes a duty the panel can list. */
const emptySpec = (id: string, name: string): DutySpec => ({ id, name, goal: '', done: [], carrier: '', charterFocus: [],
  knowledge: [], resources: [], tools: [], skills: [], intake: [], steps: [], pitfalls: [], posts: [] })

/**
 * Parses a duties document. The format is deliberately loose: a heading per duty (`### <id> · <name>`) and bullet lines
 * `- <field>：<value>`; unknown fields and prose are ignored, so a project can write the descriptions in its own words.
 */
export function parseDuties (text: string): DutySpec[] {
  return parseDutyText(text, /^#{2,3}\s/)
}

/** Parses one duty file, whose heading may be an `#` (the file's own title) as well as `##`/`###`. */
function parseDutyText (text: string, headingLevels: RegExp): DutySpec[] {
  const duties: DutySpec[] = []
  let current: DutySpec | undefined
  const push = (): void => { if (current) duties.push(current) }
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    const heading = headingLevels.test(line) ? headingOf(line) : undefined
    if (heading) {
      push()
      current = emptySpec(heading.id, heading.name)
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

/** One duty read from its own file: the file name is the id, the heading may give it a nicer name. */
export function parseDutyFile (text: string, id: string): DutySpec {
  const spec = parseDutyText(text, /^#{1,3}\s/)[0]
  return { ...(spec ?? emptySpec(id, id)), id }
}

/** One duty as the panel edits it: its id, name and the text to write into `duties/<id>.md`. */
export interface DutyFile {
  id: string
  name: string
  text: string
}

/** Splits one document into per-duty files, so the editor can keep a single textarea while the repository keeps one file per duty. */
export function splitDuties (text: string): DutyFile[] {
  const files: DutyFile[] = []
  let current: { id: string; name: string; body: string[] } | undefined
  const flush = (): void => {
    if (!current) return
    const body = current.body.join('\n').trim()
    files.push({ id: current.id, name: current.name, text: `# ${current.id} · ${current.name}\n\n${body}\n` })
  }
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{1,3}\s/.test(line) ? headingOf(line) : undefined
    // An `#` line is a duty only when its id is file-safe; a document title such as `# 职责说明` stays prose.
    if (heading && (line.startsWith('##') || isDutyId(heading.id))) {
      flush()
      current = { id: heading.id, name: heading.name, body: [] }
      continue
    }
    if (current) current.body.push(raw)
  }
  flush()
  const ids = new Set<string>()
  for (const file of files) {
    if (!isDutyId(file.id)) throw new Error(`职责 id「${file.id}」不能做文件名：只用字母、数字、短横线或下划线（如 req-analysis）`)
    if (ids.has(file.id)) throw new Error(`有两个职责用了同一个 id「${file.id}」：id 必须唯一`)
    ids.add(file.id)
  }
  return files
}

const dutiesCache = new Map<string, { at: number; doc: DutiesDoc }>()
/** How long the duties are trusted before they are read from Gitea again. */
const DUTIES_TTL_MS = 30_000
/** Forgets the cached duties documents (tests, or after a publish). */
export function invalidateDutiesCache (): void { dutiesCache.clear() }

const cache = (key: string, doc: DutiesDoc): DutiesDoc => {
  dutiesCache.set(key, { at: Date.now(), doc })
  return doc
}

/**
 * Reads the duties from the Gitea repository that holds the charter: one file per duty from the `duties/` folder, or a
 * single legacy `duties.md` when the folder does not exist yet.
 */
export async function readDuties (target: CharterTarget): Promise<DutiesDoc> {
  const gitea = target.gitea
  if (!gitea) return { text: '', duties: [], carrierRef: '', mode: 'none', detail: 'No Gitea charter repository is configured' }
  const dir = dutiesDirOf(gitea.path)
  const legacy = dutiesPathOf(gitea.path)
  const key = `duties:${gitea.repository}:${dir}`
  const cached = dutiesCache.get(key)
  if (cached && Date.now() - cached.at < DUTIES_TTL_MS) return cached.doc
  const parsed = repositoryOf(gitea.repository)
  if (!parsed) return { text: '', duties: [], carrierRef: `${gitea.repository}/${dir}`, mode: 'none', detail: 'The Gitea repository is not spelled owner/name' }
  const client = new GiteaClient(gitea)
  // The folder is the current shape: list it and read one file per duty. A missing folder falls through to the old file.
  try {
    const entries = await client.listDirectory(parsed.owner, parsed.name, dir, AbortSignal.timeout(10_000))
    const found = entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.md') && isDutyId(entry.name.slice(0, -3)))
      .sort((left, right) => left.name.localeCompare(right.name))
    const read = (await Promise.all(found.map(async entry => {
      const id = entry.name.slice(0, -3)
      try {
        const file = await client.fileContents(parsed.owner, parsed.name, `${dir}/${entry.name}`, undefined, AbortSignal.timeout(10_000))
        return { id, text: file.text.trim(), spec: parseDutyFile(file.text, id) }
      } catch { return undefined }
    }))).filter((item): item is { id: string, text: string, spec: DutySpec } => !!item)
    const doc: DutiesDoc = { text: read.map(item => item.text).join('\n\n'), duties: read.map(item => item.spec),
      carrierRef: `${gitea.repository}/${dir}`, mode: 'folder',
      files: Object.fromEntries(read.map(item => [item.id, `${dir}/${item.id}.md`])),
      ...read.length ? {} : { detail: 'No duty files yet' } }
    return cache(key, doc)
  } catch { /* No folder yet: the legacy file (or nothing) answers below. */ }
  try {
    const file = await client.fileContents(parsed.owner, parsed.name, legacy, undefined, AbortSignal.timeout(10_000))
    const doc: DutiesDoc = { text: file.text, duties: parseDuties(file.text), carrierRef: `${gitea.repository}/${legacy}`,
      mode: 'file', ...file.sha ? { sha: file.sha } : {} }
    return cache(key, doc)
  } catch (error) {
    // A repository without duties is normal (the project has not written them yet): answer empty, not failed.
    const doc: DutiesDoc = { text: '', duties: [], carrierRef: `${gitea.repository}/${dir}`, mode: 'none',
      detail: error instanceof Error && /-> 404/.test(error.message) ? 'No duties file yet' : String(error instanceof Error ? error.message : error) }
    return cache(key, doc)
  }
}

/**
 * Publishes the duties into the Gitea repository as one file per duty, committing on top of what each file currently has.
 * A duty the document no longer names is removed, and so is the legacy single file the folder replaces.
 */
export async function publishDuties (target: CharterTarget, text: string, publishedBy: string):
Promise<{ sha?: string; carrierRef: string; files?: string[] }> {
  const gitea = target.gitea
  if (!gitea) throw new Error('No Gitea charter repository is configured: the duties live beside the charter')
  const parsed = repositoryOf(gitea.repository)
  if (!parsed) throw new Error('The Gitea repository is not spelled owner/name')
  const files = splitDuties(text)
  if (!files.length) throw new Error('职责说明至少要有一个职责（一行 `### <id> · <名称>` 开头）')
  const dir = dutiesDirOf(gitea.path)
  const legacy = dutiesPathOf(gitea.path)
  const client = new GiteaClient(gitea)
  const readSha = async (path: string): Promise<string | undefined> => {
    try { return (await client.fileContents(parsed.owner, parsed.name, path, undefined, AbortSignal.timeout(10_000))).sha } catch { return undefined }
  }
  const write = async (path: string, content: string, message: string, sha?: string): Promise<string | undefined> => {
    try {
      return await client.putFile(parsed.owner, parsed.name, path, { content, message, ...sha ? { sha } : {} }, AbortSignal.timeout(15_000))
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status !== 409 && status !== 422) throw error
      const fresh = await readSha(path)
      return await client.putFile(parsed.owner, parsed.name, path,
        { content, message, ...fresh ? { sha: fresh } : {} }, AbortSignal.timeout(15_000))
    }
  }
  const existing = await client.listDirectory(parsed.owner, parsed.name, dir, AbortSignal.timeout(10_000)).catch(() => [])
  const keep = new Set(files.map(file => file.id))
  let sha: string | undefined
  const written: string[] = []
  for (const file of files) {
    const path = `${dir}/${file.id}.md`
    sha = await write(path, file.text, `duties: ${file.id} (${publishedBy || 'pm'})`, await readSha(path))
    written.push(path)
  }
  for (const entry of existing) {
    const id = entry.name.endsWith('.md') ? entry.name.slice(0, -3) : ''
    if (!isDutyId(id) || keep.has(id)) continue
    const path = `${dir}/${entry.name}`
    const oldSha = await readSha(path)
    if (oldSha) {
      try {
        await client.deleteFile(parsed.owner, parsed.name, path, { sha: oldSha, message: `duties: remove ${id}` }, AbortSignal.timeout(15_000))
      } catch { /* A file that cannot be removed stays; the document still reads what it names. */ }
    }
  }
  const legacySha = await readSha(legacy)
  if (legacySha) {
    try {
      await client.deleteFile(parsed.owner, parsed.name, legacy, { sha: legacySha, message: 'duties: move to one file per duty' }, AbortSignal.timeout(15_000))
    } catch { /* The folder wins on read anyway. */ }
  }
  dutiesCache.clear()
  return { carrierRef: `${gitea.repository}/${dir}`, ...sha ? { sha } : {}, files: written }
}

/** What the host decides about a card's duty before the card becomes a ticket. */
export interface DutyGate {
  /** Set when the card must not start: an unknown duty, or a duty its post does not take. */
  refuse?: { code: 'dutyUndefined' | 'dutyUnsupported' | 'pmExecutionNotAllowed'; detail: string }
  /** The compact brief the worker reads before it starts. */
  brief?: string
  /** The spec itself, for the panel and `orchestrator_read duty`. */
  spec?: DutySpec
}

/**
 * Whether one post takes a duty: the post's own selection (the panel's dropdown) wins; otherwise the duty's 承接岗位
 * list decides, so documents written before selections existed keep working.
 */
export function dutyTakenBy (spec: DutySpec, post: { postId: string, duties?: string[] }): boolean {
  if (post.duties && post.duties.length) return post.duties.includes(spec.id)
  return spec.posts.length === 0 || spec.posts.includes(post.postId)
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
 * start; a card with a known duty gets its brief. A card with no duty label, or a project with no duties yet, keeps
 * working as before (backward compatible while projects fill their duties in).
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
    return { refuse: { code: 'dutyUndefined', detail: `Duty "${dutyId}" is not defined in ${doc.carrierRef || 'the duties'}` } }
  }
  const post = postOfActor(archive, trigger.actor.id)
  if (post && !dutyTakenBy(spec, post)) {
    return { refuse: { code: 'dutyUnsupported', detail: `Duty "${spec.name}" is taken by ${spec.posts.join(', ') || 'another post'}, not by ${post.postId}` } }
  }
  return { spec, brief: dutyBrief(spec) }
}
