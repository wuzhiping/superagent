/**
 * Project and post settings: the archive every post of a deployment shares (RD.md §4, §12.8).
 *
 * It is deliberately small: the board itself says what the board is (its columns are the value stream, a card says
 * which workfaces it touches), so the archive only holds what Kanban cannot — who the posts are, how they identify
 * themselves, which columns they take, and the charter the PM published. No secrets: passwords stay in the Source cards.
 */
import { useEffect, useState } from 'react'
import { topicsAfterPick } from '../app/narrative.ts'
import type { ApiResponse } from '../app/api.ts'
import type { KaneoMember } from '../app/kaneo-users.ts'
import { usePoll, type ProjectArchive, type ProjectChoices } from './api.ts'
import { Button, Icon, Input } from './controls.tsx'
import { usePerspective } from './perspective.tsx'
import { useAction, usePanel } from './provider.tsx'
import type { T } from './text.ts'
import { Hint, Section } from './widgets.tsx'

type Post = ProjectArchive['projects'][number]['posts'][number]
type Project = ProjectArchive['projects'][number]

const emptyPost = (role: Post['role'], name = ''): Post => ({ postId: '', role, name, kaneoUser: '', kaneoUserId: '',
  giteaUser: '', ntfySender: '', wipLimit: 3, instance: '', watchColumns: '', duties: [] })
const emptyCharter = () => ({ version: 0, publishedAt: '', publishedBy: '', text: '', draft: '', history: [] })

/** What must be fixed before the archive can be saved: a project id, and each post's own id (they start empty). */
function archiveProblem (archive: ProjectArchive, t: T): string | undefined {
  for (const project of archive.projects) {
    if (!project.id.trim()) return t('projectValidationProject')
    const seen = new Set<string>()
    for (const post of project.posts) {
      const id = post.postId.trim()
      if (!id) return t('projectValidationPostId', { project: project.name || project.id })
      if (seen.has(id)) return t('projectValidationPostDuplicate', { post: id, project: project.name || project.id })
      seen.add(id)
    }
  }
  return undefined
}
const emptyProject = (posts: Post[] = []): Project => ({ id: '', name: '', slug: '', charter: emptyCharter(), topics: [], posts })

/** A text field that keeps its own draft so typing does not rebuild the whole archive. */
function Field({ label, value, onChange, placeholder, readOnly, required }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; readOnly?: boolean; required?: boolean
}) {
  return <label className="dt-archive-field">
    <span className={required ? 'dt-field-label dt-required' : 'dt-field-label'}>{label}</span>
    <Input value={value} placeholder={placeholder} readOnly={readOnly} onChange={event => onChange(event.target.value)} />
  </label>
}

/** The charter editor: the PM writes in the draft and publishes it into the project, which mints the version every duty pins. */
function CharterEditor({ charter, projectId, onChange, onPublished, readOnly }: {
  charter: Project['charter']; projectId: string; onChange: (charter: Project['charter']) => void
  onPublished?: () => void; readOnly?: boolean
}) {
  const { t, call, notify } = usePanel()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string>()
  const draft = charter.draft || charter.text
  // A project's charter is one document every post reads, so publishing replaces it; at most once a week.
  const publish = async (force: boolean) => {
    setBusy(true)
    setRefused(undefined)
    try {
      const result = await call('POST narrative/charter', { body: {
        projectId, text: draft, publishedBy: charter.publishedBy || 'pm', ...(force ? { force: true } : {}),
      } })
      onChange({ ...charter, version: result.charter.version, publishedAt: result.charter.publishedAt,
        publishedBy: result.charter.publishedBy, text: result.charter.text, draft: '',
        history: charter.version > 0
          ? [...charter.history, { version: charter.version, publishedAt: charter.publishedAt, publishedBy: charter.publishedBy, text: charter.text }]
          : charter.history })
      notify(t('projectCharterPublished'))
      onPublished?.()
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  return <div className="dt-archive-card">
    <div className="dt-grid">
      <Field label={t('projectCharterVersion')} value={String(charter.version)} readOnly onChange={() => {}} />
      <Field label={t('projectCharterPublishedAt')} value={charter.publishedAt} readOnly onChange={() => {}} />
      <Field label={t('projectCharterPublishedBy')} value={charter.publishedBy} placeholder="pm-fdep" readOnly={readOnly}
        onChange={value => onChange({ ...charter, publishedBy: value })} />
    </div>
    <label className="dt-field">
      <span className="dt-field-label">{t('projectCharterDraft')}</span>
      <textarea className="dt-textarea" rows={10} readOnly={readOnly} value={draft} placeholder={t('projectCharterPlaceholder')}
        onChange={event => onChange({ ...charter, draft: event.target.value })} />
    </label>
    <p className="dt-hint">{t('projectCharterHint')}</p>
    <p className="dt-hint">{t('projectCharterCarrier')}</p>
    {refused && <div className="dt-charter-refused"><p className="dt-error" role="alert">{refused}</p>
      {!readOnly && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void publish(true) }}>
        {t('projectCharterForce')}</Button>}</div>}
    {!readOnly && <Button variant="primary" size="sm" icon={<Icon name="decision" size={14} />} disabled={busy || !draft.trim()}
      onClick={() => { void publish(false) }}>{t('projectCharterPublish')}</Button>}
    {charter.history.length > 0 && <p className="dt-hint">
      {t('projectCharterHistory', { versions: charter.history.map(item => 'v' + item.version).join('、') })}</p>}
  </div>
}

function PostEditor({ post, onChange, onRemove, readOnly, duties, members }: {
  post: Post; onChange: (post: Post) => void; onRemove: () => void; readOnly?: boolean; duties?: DutiesView['duties']
  members?: KaneoMember[]
}) {
  const { t } = usePanel()
  // The duties this post takes: the dropdown selection wins; without one, a duty's 承接岗位 line still binds it (legacy).
  const taken = post.duties.length
    ? (duties ?? []).filter(duty => post.duties.includes(duty.id))
    : (duties ?? []).filter(duty => duty.posts.includes(post.postId))
  const available = (duties ?? []).filter(duty => !post.duties.includes(duty.id))
  return <div className="dt-archive-card dt-post-editor">
    <div className="dt-grid">
      <Field label={t('projectPostId')} value={post.postId} placeholder="w1-fdep" readOnly={readOnly} required
        onChange={value => onChange({ ...post, postId: value })} />
      <Field label={t('projectPostName')} value={post.name} placeholder="SuperAgent Worker 1 (FDEP)" readOnly={readOnly}
        onChange={value => onChange({ ...post, name: value })} />
      <label className="dt-field">
        <span className="dt-field-label dt-required">{t('projectPostRole')}</span>
        <select className="dt-select" value={post.role} disabled={readOnly}
          onChange={event => onChange({ ...post, role: event.target.value as Post['role'] })}>
          <option value="worker">{t('postsRoleWorker')}</option>
          <option value="pm">{t('postsRolePm')}</option>
        </select>
      </label>
      <label className="dt-archive-field">
        <span className="dt-field-label dt-required">{t('projectPostKanban')}</span>
        <Input value={post.kaneoUser} list={`kaneo-users-${post.postId || 'new'}`} placeholder="name@example.com" readOnly={readOnly}
          onChange={event => onChange({ ...post, kaneoUser: event.target.value })} />
        <datalist id={`kaneo-users-${post.postId || 'new'}`}>
          {(members ?? []).filter(member => member.email).map(member =>
            <option key={member.id} value={member.email}>{member.name ? `${member.name}（${member.id}）` : member.id}</option>)}
        </datalist>
      </label>
      <Field label={t('postsWatchColumns')} value={post.watchColumns} placeholder="ready" readOnly={readOnly}
        onChange={value => onChange({ ...post, watchColumns: value })} />
      <Field label={t('projectPostGitea')} value={post.giteaUser} placeholder="邮箱或用户名（可选）" readOnly={readOnly}
        onChange={value => onChange({ ...post, giteaUser: value })} />
      <Field label={t('projectPostNtfy')} value={post.ntfySender} placeholder="#sa-w1-fdep" readOnly={readOnly}
        onChange={value => onChange({ ...post, ntfySender: value })} />
      <Field label={t('projectPostInstance')} value={post.instance} placeholder="web" readOnly={readOnly}
        onChange={value => onChange({ ...post, instance: value })} />
      <label className="dt-field">
        <span className="dt-field-label">{t('projectPostWip')}</span>
        <Input type="number" min={1} max={20} value={String(post.wipLimit)} readOnly={readOnly}
          onChange={event => onChange({ ...post, wipLimit: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} />
      </label>
    </div>
    <label className="dt-field">
      <span className="dt-field-label">{t('projectPostDutiesPick')}</span>
      <select className="dt-select" value="" disabled={readOnly || available.length === 0}
        onChange={event => {
          const id = event.target.value
          if (id) onChange({ ...post, duties: [...post.duties, id] })
        }}>
        <option value="">{available.length ? t('projectPostDutiesChoose') : t('projectPostDutiesAll')}</option>
        {available.map(duty => <option key={duty.id} value={duty.id}>{duty.name}（{duty.id}）</option>)}
      </select>
    </label>
    {post.duties.length > 0 && <div className="dt-duties-picked">
      {post.duties.map(id => {
        const duty = (duties ?? []).find(item => item.id === id)
        return <button key={id} type="button" className="dt-tag" data-tone="info" disabled={readOnly}
          title={t('projectPostDutiesRemove')}
          onClick={() => onChange({ ...post, duties: post.duties.filter(item => item !== id) })}>{duty?.name || id} ×</button>
      })}
    </div>}
    <p className="dt-hint">{t('projectPostDutiesPickHint')}</p>
    <p className="dt-hint">{post.kaneoUserId
      ? t('projectPostKanbanMapped', { email: post.kaneoUser || t('postsUnset'), id: post.kaneoUserId })
      : t('projectPostKanbanHint')}</p>
    {post.postId && (taken.length > 0
      ? <p className="dt-hint">{t('projectPostDuties', { duties: taken.map(duty => duty.name || duty.id).join('、') })}</p>
      : <p className="dt-hint">{t('projectPostDutiesNone')}</p>)}
    {!readOnly && <Button variant="ghost" size="sm" icon={<Icon name="trash" size={14} />} onClick={onRemove}>{t('projectRemovePost')}</Button>}
  </div>
}

type DutiesView = ApiResponse<'GET duties'>
/**
 * The duties document the project keeps beside its charter in Gitea: the panel shows the parsed duties and commits an edit
 * as one file. It is project governance, not a Host setting, so no post configures duties locally.
 */
function DutiesEditor({ duties, onChanged, readOnly }: { duties?: DutiesView; onChanged: () => void; readOnly?: boolean }) {
  const { t, call, notify } = usePanel()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const publish = async () => {
    try {
      await call('POST duties', { body: { text: draft } })
      setEditing(false); setDraft(''); setError(undefined); notify(t('projectDutiesPublished')); onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const list = duties?.duties ?? []
  return <div className="dt-duties">
    <p className="dt-hint">{t('projectDutiesHint')}</p>
    {duties?.carrierRef && <p className="dt-hint">{t('projectDutiesSource', { ref: duties.carrierRef })}</p>}
    {duties?.mode === 'file' && <p className="dt-hint">{t('projectDutiesLegacy')}</p>}
    {duties?.detail && list.length === 0 && <p className="dt-hint">{t('projectDutiesUnavailable', { detail: duties.detail })}</p>}
    {editing ? <>
      <textarea className="dt-textarea" rows={14} value={draft} placeholder={t('projectDutiesPlaceholder')}
        onChange={event => setDraft(event.target.value)} />
      {error && <p className="dt-error" role="alert">{error}</p>}
      <div className="dt-row">
        <Button variant="primary" size="sm" onClick={() => { void publish() }}>{t('projectDutiesPublish')}</Button>
        <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(''); setError(undefined) }}>{t('cancel')}</Button>
      </div>
    </> : <>
      {list.length === 0
        ? <p className="dt-hint">{t('projectDutiesEmpty')}</p>
        : <ul className="dt-list">
          {list.map(duty => <li key={duty.id} className="dt-duty">
            <div className="dt-row">
              <span className="dt-tag" data-tone="info">{duty.id}</span>
              <b>{duty.name}</b>
              {duty.carrier && <span className="dt-tag" data-tone="quiet">{duty.carrier}</span>}
            </div>
            {duty.posts.length > 0 && <p className="dt-hint">{t('projectDutiesPosts', { posts: duty.posts.join('、') })}</p>}
            {duty.goal && <p className="dt-hint">{duty.goal}</p>}
          </li>)}
        </ul>}
      {!readOnly && <Button variant="outline" size="sm"
        onClick={() => { setEditing(true); setDraft(duties?.text ?? '') }}>{t('projectDutiesEdit')}</Button>}
    </>}
  </div>
}

function ProjectEditor({ project, onChange, onRemove, onPublished, scoped, seat, choices, duties, onDutiesChanged, members }: {
  project: Project; onChange: (project: Project) => void; onRemove: () => void; onPublished?: () => void
  scoped?: boolean; seat?: string; choices?: ProjectChoices; duties?: DutiesView; onDutiesChanged?: () => void
  members?: KaneoMember[]
}) {
  const { t } = usePanel()
  // In the post perspective the project belongs to the PM: it is shown, not edited.
  const rows = project.posts.map((post, index) => ({ post, index }))
    .filter(row => !scoped || row.post.postId === seat)
  // The project is picked from what the Kanban account can see; the choice brings its own name, slug and, when the topic
  // list is empty or still the previous project's default, the topic `pub_<chosen project id>` along with it.
  const pick = (id: string) => {
    if (id === project.id) return
    const chosen = choices?.projects.find(item => item.id === id)
    onChange({ ...project, id, ...(chosen ? { name: chosen.name, slug: chosen.slug } : {}),
      topics: topicsAfterPick(project.topics, project.id, id) })
  }
  return <div className="dt-archive-card">
    <div className="dt-grid">
      <label className="dt-archive-field">
        <span className="dt-field-label dt-required">{t('projectId')}</span>
        <select className="dt-select" value={project.id} disabled={scoped} onChange={event => pick(event.target.value)}>
          <option value="">{t('projectPick')}</option>
          {project.id && !choices?.projects.some(item => item.id === project.id) &&
            <option value={project.id}>{project.id}</option>}
          {(choices?.projects ?? []).map(item => <option key={item.id} value={item.id}>
            {item.name}（{item.slug}）· {choices?.workspaces.find(workspace => workspace.id === item.workspaceId)?.name ?? item.workspaceId}
          </option>)}
        </select>
        {choices?.problem && <span className="dt-hint">{t('pickUnavailable', { error: choices.problem })}</span>}
      </label>
      <Field label={t('projectName')} value={project.name} placeholder="FDEP" readOnly={scoped}
        onChange={value => onChange({ ...project, name: value })} />
      <Field label={t('projectSlug')} value={project.slug} placeholder="FDE" readOnly={scoped}
        onChange={value => onChange({ ...project, slug: value })} />
      <Field label={t('postsTopics')} value={project.topics.join('、')} placeholder={project.id ? `pub_${project.id}` : 'pub_<project id>'}
        readOnly={scoped}
        onChange={value => onChange({ ...project, topics: value.split(/[、,]/).map(item => item.trim()).filter(Boolean) })} />
    </div>
    <p className="dt-hint">{t('projectTopicsHint')}</p>
    <div className="dt-section">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('projectCharter')}</span>
        <span className="dt-count">v{project.charter.version}</span></h3>
      <CharterEditor charter={project.charter} projectId={project.id} readOnly={scoped} onPublished={onPublished}
        onChange={charter => onChange({ ...project, charter })} />
    </div>
    <div className="dt-section">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('projectDuties')}</span>
        <span className="dt-count">{duties?.duties.length ?? 0}</span></h3>
      <DutiesEditor duties={duties} onChanged={() => onDutiesChanged?.()} readOnly={scoped} />
    </div>
    <div className="dt-section">
      <h3 className="dt-section-title"><span className="dt-section-name">{scoped ? t('settingsMyPost') : t('projectPosts')}</span>
        <span className="dt-count">{rows.length}</span></h3>
      {rows.map(({ post, index }) => <PostEditor key={index} post={post} duties={duties?.duties} members={members}
        onChange={next => onChange({ ...project, posts: project.posts.map((item, at) => at === index ? next : item) })}
        onRemove={() => onChange({ ...project, posts: project.posts.filter((_item, at) => at !== index) })} />)}
      {!scoped && <Button variant="outline" size="sm" icon={<Icon name="plus" size={14} />}
        onClick={() => onChange({ ...project, posts: [...project.posts, emptyPost('worker')] })}>{t('projectAddPost')}</Button>}
    </div>
    {!scoped && <Button variant="ghost" size="sm" icon={<Icon name="trash" size={14} />} onClick={onRemove}>{t('projectRemove')}</Button>}
  </div>
}

/** The project and post settings page: edit the archive and save it to the host. */
export function ProjectSettings() {
  const { t, call, notify } = usePanel()
  const { perspective, postId } = usePerspective()
  const [archive, setArchive] = useState<ProjectArchive>({ version: 1, projects: [] })
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()
  const [duties, setDuties] = useState<DutiesView>()
  // The workspace members of each project, so a post picks its Kanban account by e-mail.
  const [members, setMembers] = useState<Record<string, KaneoMember[]>>({})
  // The project is chosen from the list this Host's Kanban account can see, not typed from memory.
  const { data: choices } = usePoll(() => call('GET projects'), [])

  useEffect(() => {
    let active = true
    call('GET project-archive').then(value => {
      if (!active) return
      setArchive(value.archive)
      setRevision(value.revision)
      setLoaded(true)
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { active = false }
  }, [call])

  const loadDuties = () => { call('GET duties').then(setDuties).catch(() => {}) }
  useEffect(() => { loadDuties() }, [call])

  const projectIds = archive.projects.map(project => project.id).filter(Boolean).join('|')
  useEffect(() => {
    if (!projectIds) return
    let active = true
    void Promise.all(projectIds.split('|').map(id =>
      call('GET kaneo-users', { query: { projectId: id } })
        .then(value => [id, value.users] as const).catch(() => [id, [] as KaneoMember[]] as const)))
      .then(entries => { if (active) setMembers(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [call, projectIds])

  const [saveError, setSaveError] = useState<string>()
  const save = useAction(async () => {
    const problem = archiveProblem(archive, t)
    if (problem) { setSaveError(problem); return }
    setSaveError(undefined)
    const result = await call('PUT project-archive', { body: { archive, revision } })
    setRevision(result.revision)
    notify(t('projectSaved'))
  }, {})

  if (error) return <p className="dt-error" role="alert">{error}</p>
  if (!loaded) return <p className="dt-hint">{t('loading')}</p>

  const update = (index: number, project: Project) => {
    setSaveError(undefined)
    setArchive(current => ({ ...current, projects: current.projects.map((item, at) => at === index ? project : item) }))
  }

  // The post perspective edits only its own seat; the project it belongs to stays as the PM left it.
  const scoped = perspective === 'post'
  const shown = scoped
    ? archive.projects.map((project, index) => ({ project, index })).filter(item => item.project.posts.some(post => post.postId === postId))
    : archive.projects.map((project, index) => ({ project, index }))

  return <div className="dt-project-settings">
    <Hint>{scoped ? t('projectHintPost') : t('projectHint')}</Hint>
    {!scoped && <Hint>{t('projectMinimalHint')}</Hint>}
    {shown.map(({ project, index }) => <ProjectEditor key={index} project={project} scoped={scoped} seat={postId} duties={duties} onDutiesChanged={loadDuties} members={members[project.id]}
      onChange={next => update(index, next)} onPublished={() => { void save.run() }} choices={choices}
      onRemove={() => setArchive(current => ({ ...current, projects: current.projects.filter((_item, at) => at !== index) }))} />)}
    {!scoped && <Hint>{t('projectAddDefaultPosts')}</Hint>}
    {saveError && <p className="dt-error" role="alert">{saveError}</p>}
    {!scoped && <div className="dt-row-buttons">
      <Button variant="outline" icon={<Icon name="plus" size={14} />}
        onClick={() => setArchive(current => ({ ...current, projects: [...current.projects,
          emptyProject([emptyPost('pm', t('postsRolePm')), emptyPost('worker', t('postsRoleWorker'))])] }))}>{t('projectAdd')}</Button>
      <Button variant="primary" icon={<Icon name="decision" size={14} />} disabled={save.busy} onClick={() => { void save.run() }}>{t('projectSave')}</Button>
    </div>}
    {scoped && <div className="dt-row-buttons">
      <Button variant="primary" icon={<Icon name="decision" size={14} />} disabled={save.busy} onClick={() => { void save.run() }}>{t('projectSave')}</Button>
    </div>}
  </div>
}
