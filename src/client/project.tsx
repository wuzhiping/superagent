/**
 * Project and post settings: the archive every post of a deployment shares (RD.md §4, §12.8).
 *
 * It is deliberately small: the board itself says what the board is (its columns are the value stream, a card says
 * which workfaces it touches), so the archive only holds what KanEO cannot — who the posts are, how they identify
 * themselves, which columns they take, and the charter the PM published. No secrets: passwords stay in the Source cards.
 */
import { useEffect, useState } from 'react'
import type { ProjectArchive } from './api.ts'
import { Button, Icon, Input } from './controls.tsx'
import { usePerspective } from './perspective.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Hint, Section } from './widgets.tsx'

type Post = ProjectArchive['projects'][number]['posts'][number]
type Project = ProjectArchive['projects'][number]

const emptyPost = (): Post => ({ postId: '', role: 'worker', name: '', kaneoUserId: '', giteaUser: '', ntfySender: '',
  wipLimit: 3, instance: '', watchColumns: '' })
const emptyCharter = () => ({ version: 0, publishedAt: '', publishedBy: '', text: '', draft: '', history: [] })
const emptyProject = (): Project => ({ id: '', name: '', slug: '', charter: emptyCharter(), topics: [], posts: [] })

/** A text field that keeps its own draft so typing does not rebuild the whole archive. */
function Field({ label, value, onChange, placeholder, readOnly }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; readOnly?: boolean
}) {
  return <label className="dt-archive-field">
    <span className="dt-field-label">{label}</span>
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
    {refused && <div className="dt-charter-refused"><p className="dt-error" role="alert">{refused}</p>
      {!readOnly && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void publish(true) }}>
        {t('projectCharterForce')}</Button>}</div>}
    {!readOnly && <Button variant="primary" size="sm" icon={<Icon name="decision" size={14} />} disabled={busy || !draft.trim()}
      onClick={() => { void publish(false) }}>{t('projectCharterPublish')}</Button>}
    {charter.history.length > 0 && <p className="dt-hint">
      {t('projectCharterHistory', { versions: charter.history.map(item => 'v' + item.version).join('、') })}</p>}
  </div>
}

function PostEditor({ post, onChange, onRemove, readOnly }: {
  post: Post; onChange: (post: Post) => void; onRemove: () => void; readOnly?: boolean
}) {
  const { t } = usePanel()
  return <div className="dt-archive-card dt-post-editor">
    <div className="dt-grid">
      <Field label={t('projectPostId')} value={post.postId} placeholder="w1-fdep" readOnly={readOnly}
        onChange={value => onChange({ ...post, postId: value })} />
      <Field label={t('projectPostName')} value={post.name} placeholder="SuperAgent Worker 1 (FDEP)" readOnly={readOnly}
        onChange={value => onChange({ ...post, name: value })} />
      <label className="dt-field">
        <span className="dt-field-label">{t('projectPostRole')}</span>
        <select className="dt-select" value={post.role} disabled={readOnly}
          onChange={event => onChange({ ...post, role: event.target.value as Post['role'] })}>
          <option value="worker">{t('postsRoleWorker')}</option>
          <option value="pm">{t('postsRolePm')}</option>
        </select>
      </label>
      <Field label={t('projectPostKanban')} value={post.kaneoUserId} placeholder="KanEO 用户 id" readOnly={readOnly}
        onChange={value => onChange({ ...post, kaneoUserId: value })} />
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
    {!readOnly && <Button variant="ghost" size="sm" icon={<Icon name="trash" size={14} />} onClick={onRemove}>{t('projectRemovePost')}</Button>}
  </div>
}

function ProjectEditor({ project, onChange, onRemove, onPublished, scoped, seat }: {
  project: Project; onChange: (project: Project) => void; onRemove: () => void; onPublished?: () => void
  scoped?: boolean; seat?: string
}) {
  const { t } = usePanel()
  // In the post perspective the project belongs to the PM: it is shown, not edited.
  const posts = scoped ? project.posts.filter(post => post.postId === seat) : project.posts
  return <div className="dt-archive-card">
    <div className="dt-grid">
      <Field label={t('projectId')} value={project.id} placeholder="KanEO project id" readOnly={scoped}
        onChange={value => onChange({ ...project, id: value })} />
      <Field label={t('projectName')} value={project.name} placeholder="FDEP" readOnly={scoped}
        onChange={value => onChange({ ...project, name: value })} />
      <Field label={t('projectSlug')} value={project.slug} placeholder="FDE" readOnly={scoped}
        onChange={value => onChange({ ...project, slug: value })} />
      <Field label={t('postsTopics')} value={project.topics.join('、')} placeholder="pub_fdep_pm" readOnly={scoped}
        onChange={value => onChange({ ...project, topics: value.split(/[、,]/).map(item => item.trim()).filter(Boolean) })} />
    </div>
    <div className="dt-section">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('projectCharter')}</span>
        <span className="dt-count">v{project.charter.version}</span></h3>
      <CharterEditor charter={project.charter} projectId={project.id} readOnly={scoped} onPublished={onPublished}
        onChange={charter => onChange({ ...project, charter })} />
    </div>
    <div className="dt-section">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('projectPosts')}</span>
        <span className="dt-count">{posts.length}</span></h3>
      {posts.map((post, index) => <PostEditor key={post.postId || index} post={post}
        onChange={next => onChange({ ...project, posts: project.posts.map(item => item.postId === post.postId ? next : item) })}
        onRemove={() => onChange({ ...project, posts: project.posts.filter(item => item.postId !== post.postId) })} />)}
      {!scoped && <Button variant="outline" size="sm" icon={<Icon name="plus" size={14} />}
        onClick={() => onChange({ ...project, posts: [...project.posts, emptyPost()] })}>{t('projectAddPost')}</Button>}
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

  const save = useAction(async () => {
    const result = await call('PUT project-archive', { body: { archive, revision } })
    setRevision(result.revision)
    notify(t('projectSaved'))
  }, {})

  if (error) return <p className="dt-error" role="alert">{error}</p>
  if (!loaded) return <p className="dt-hint">{t('loading')}</p>

  const update = (index: number, project: Project) =>
    setArchive(current => ({ ...current, projects: current.projects.map((item, at) => at === index ? project : item) }))

  // The post perspective edits only its own seat; the project it belongs to stays as the PM left it.
  const scoped = perspective === 'post'
  const shown = scoped
    ? archive.projects.map((project, index) => ({ project, index })).filter(item => item.project.posts.some(post => post.postId === postId))
    : archive.projects.map((project, index) => ({ project, index }))

  return <div className="dt-project-settings">
    <Hint>{scoped ? t('projectHintPost') : t('projectHint')}</Hint>
    {shown.map(({ project, index }) => <ProjectEditor key={index} project={project} scoped={scoped} seat={postId}
      onChange={next => update(index, next)} onPublished={() => { void save.run() }}
      onRemove={() => setArchive(current => ({ ...current, projects: current.projects.filter((_item, at) => at !== index) }))} />)}
    {!scoped && <div className="dt-row-buttons">
      <Button variant="outline" icon={<Icon name="plus" size={14} />}
        onClick={() => setArchive(current => ({ ...current, projects: [...current.projects, emptyProject()] }))}>{t('projectAdd')}</Button>
      <Button variant="primary" icon={<Icon name="decision" size={14} />} disabled={save.busy} onClick={() => { void save.run() }}>{t('projectSave')}</Button>
    </div>}
    {scoped && <div className="dt-row-buttons">
      <Button variant="primary" icon={<Icon name="decision" size={14} />} disabled={save.busy} onClick={() => { void save.run() }}>{t('projectSave')}</Button>
    </div>}
  </div>
}
