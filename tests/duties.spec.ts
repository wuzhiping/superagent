/**
 * The duty contract (TDD/016): the duties document beside the charter, the per-trigger gate (unknown duty, a post that
 * does not take it, the brief the worker reads) and the accept outcome that carries the brief into the assignment.
 */
import { expect, it } from 'vitest'
import { dutyBrief, dutyGate, dutiesDirOf, dutiesPathOf, parseDuties, parseDutyFile, splitDuties, type DutiesDoc } from '../src/app/duties.ts'
import { dutyOutcome } from '../src/app/assessment.ts'
import type { Trigger } from '../src/core/index.ts'

const doc = (text: string): DutiesDoc => ({ text, duties: parseDuties(text), carrierRef: 'acme/charter/duties', mode: 'folder' })

const sample = [
  '# 职责说明',
  '',
  '### req-analysis · 需求分析（RML）',
  '- 承接岗位：w-analyst, w-doc',
  '- 目标：把需求整理成 RML，澄清验收口径',
  '- 完成：RML 文档',
  '- 完成：评论里的验收清单',
  '- 载体：doc',
  '- 宪章关注：当期流程、交付标准',
  '- 知识：本卡与线程；旧需求目录',
  '- 资源：卡片、宪章、MinIO 只读',
  '- 工具：minio_read, minio_write',
  '- 技能：minio-file',
  '- 接单：确认指派给我',
  '- 步骤：读宪章 -> 整理 -> 交付',
  '- 常见坑：把方案写进评论',
  '',
  '### prd · PRD 编写',
  '- 承接岗位：w-doc',
  '- 目标：转成可评审的 PRD',
  '',
].join('\n')

const trigger = (labels: string[], actorId = 'u-mine'): Trigger => ({
  id: 't1', source: 'kaneo', threads: [{ source: 'kaneo', id: 'p1' }], actor: { source: 'kaneo', id: actorId },
  human: true, at: '2026-11-06T00:00:00.000Z', text: 'do it', meta: { labels, projectId: 'p1' },
})

const archive = (postId: string, kaneoUserId: string, duties: string[] = []) => ({
  version: 1,
  projects: [{ id: 'p1', name: 'Project', slug: 'P', topics: [], charter: { version: 0, publishedAt: '', publishedBy: '', text: '', draft: '', history: [] },
    posts: [{ postId, role: 'worker', name: postId, kaneoUser: '', kaneoUserId, duties, giteaUser: '', ntfySender: '', wipLimit: 3, instance: '', watchColumns: '' }] }],
}) as unknown as Parameters<typeof dutyGate>[1]

it('parses a duties document: headings name the duty, bullets bind its fields', () => {
  const duties = parseDuties(sample)
  expect(duties.map(duty => duty.id)).toEqual(['req-analysis', 'prd'])
  const first = duties[0]!
  expect(first.name).toBe('需求分析（RML）')
  expect(first.posts).toEqual(['w-analyst', 'w-doc'])
  expect(first.goal).toContain('RML')
  expect(first.done).toEqual(['RML 文档', '评论里的验收清单'])
  expect(first.carrier).toBe('doc')
  expect(first.charterFocus).toEqual(['当期流程', '交付标准'])
  expect(first.knowledge).toContain('本卡与线程')
  expect(first.tools).toEqual(['minio_read', 'minio_write'])
  expect(first.steps).toEqual(['读宪章 -> 整理 -> 交付'])
  expect(first.pitfalls).toEqual(['把方案写进评论'])
})

it('ignores prose, unknown fields and headings that are not duties', () => {
  const duties = parseDuties('# 标题\n### 职责\n随便写点什么\n### a · A\n- 未知字段：x\n- 目标：y\n')
  expect(duties).toHaveLength(1)
  expect(duties[0]).toMatchObject({ id: 'a', name: 'A', goal: 'y' })
})

it('puts the duties file beside the charter file', () => {
  expect(dutiesPathOf('README.md')).toBe('duties.md')
  expect(dutiesPathOf('docs/charter.md')).toBe('docs/duties.md')
  expect(dutiesPathOf('')).toBe('duties.md')
})

it('puts the duties folder beside the charter file', () => {
  expect(dutiesDirOf('README.md')).toBe('duties')
  expect(dutiesDirOf('docs/charter.md')).toBe('docs/duties')
  expect(dutiesDirOf('')).toBe('duties')
})

it('reads one duty per file: the file name is the id, the heading only names it', () => {
  const fromFile = parseDutyFile('# api · 后台接口实现\n- 目标：按卡片实现接口\n- 承接岗位：w-api\n', 'api')
  expect(fromFile.id).toBe('api')
  expect(fromFile.name).toBe('后台接口实现')
  expect(fromFile.goal).toBe('按卡片实现接口')
  expect(fromFile.posts).toEqual(['w-api'])
  // A heading that disagrees cannot re-id the file.
  expect(parseDutyFile('# other · 别的称呼\n- 目标：x\n', 'api').id).toBe('api')
})

it('splits one document into one file per duty, with the heading normalized', () => {
  const files = splitDuties('# 职责说明\n\n### req-analysis · 需求分析\n- 目标：整理需求\n\n### api · 接口\n- 目标：写接口\n')
  expect(files.map(file => file.id)).toEqual(['req-analysis', 'api'])
  expect(files[0]!.text.startsWith('# req-analysis · 需求分析')).toBe(true)
  expect(files[1]!.text).toContain('- 目标：写接口')
  expect(() => splitDuties('### bad id · x\n- 目标：y\n')).toThrow()
})

it('lets a card start when its duty is defined and its post takes it, with the brief', async () => {
  const gate = await dutyGate({}, archive('w-analyst', 'u-mine'), trigger(['duty:req-analysis']), async () => doc(sample))
  expect(gate.refuse).toBeUndefined()
  expect(gate.spec?.id).toBe('req-analysis')
  expect(gate.brief).toContain('Duty · 需求分析（RML）')
  expect(gate.brief).toContain('Before accepting')
  expect(gate.brief).toContain('orchestrator_read charter')
})

it('refuses a duty the document does not define', async () => {
  const gate = await dutyGate({}, archive('w-analyst', 'u-mine'), trigger(['duty:deploy']), async () => doc(sample))
  expect(gate.refuse?.code).toBe('dutyUndefined')
})

it('refuses a duty the card post does not take', async () => {
  const gate = await dutyGate({}, archive('w-builder', 'u-mine'), trigger(['duty:req-analysis']), async () => doc(sample))
  expect(gate.refuse?.code).toBe('dutyUnsupported')
  expect(gate.refuse?.detail).toContain('w-analyst')
})

it('lets the post own selection decide which duties it takes', async () => {
  // The dropdown selection wins over the duty's 承接岗位 line, in both directions.
  const takes = await dutyGate({}, archive('w-builder', 'u-mine', ['req-analysis']), trigger(['duty:req-analysis']), async () => doc(sample))
  expect(takes.refuse).toBeUndefined()
  const refuses = await dutyGate({}, archive('w-analyst', 'u-mine', ['prd']), trigger(['duty:req-analysis']), async () => doc(sample))
  expect(refuses.refuse?.code).toBe('dutyUnsupported')
})

it('does not gate a card without a duty label, or a project without a duties document', async () => {
  expect(await dutyGate({}, archive('w-analyst', 'u-mine'), trigger([]), async () => doc(sample))).toEqual({})
  expect(await dutyGate({}, archive('w-analyst', 'u-mine'), trigger(['duty:req-analysis']), async () => doc(''))).toEqual({})
})

it('turns a refused duty into an ignore and keeps the brief on an accept', async () => {
  const accept = { kind: 'accept', title: 'T', scope: 'T', reason: { code: 'said' }, acknowledgement: 'ok' } as const
  const refused = await dutyOutcome(accept, trigger(['duty:deploy']), async () => ({ refuse: { code: 'dutyUnsupported', detail: 'x' } }))
  expect(refused).toMatchObject({ kind: 'ignore', reason: { code: 'dutyUnsupported' } })
  const kept = await dutyOutcome(accept, trigger(['duty:prd']), async () => ({ brief: 'Duty brief text' }))
  expect(kept).toMatchObject({ kind: 'accept', brief: 'Duty brief text' })
  const ignored = { kind: 'ignore', reason: { code: 'noAdmissible' } } as const
  expect(await dutyOutcome(ignored, trigger([]), async () => ({ brief: 'x' }))).toBe(ignored)
})

it('builds a short brief with the goal, the done checks and the charter version', () => {
  const brief = dutyBrief(parseDuties(sample)[0]!, { version: 12, carrierRef: 'shawoo/rsi_superagent/README.md' })
  expect(brief).toContain('Charter v12')
  expect(brief).toContain('Done:')
  expect(brief.split('\n').length).toBeLessThan(30)
})
