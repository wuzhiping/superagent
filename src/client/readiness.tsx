/**
 * The Settings readiness check: the ABC quick start's "is the environment ready?" as a live card at the top of the
 * Settings page. Eight checks in the PM perspective (the ABC list), three read-only checks in the post perspective.
 * Every row is a shortcut to the tab that fixes it, so the person sees at a glance what is done and what is left.
 */
import { useEffect, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { ProjectArchive, SourceStatusRow, StateView } from './api.ts'
import { sourceMark } from './marks.ts'
import { usePerspective } from './perspective.tsx'
import { useSettings } from './settings-kit.tsx'
import { usePanel } from './provider.tsx'
import { settingsRoute, type SettingsGroup } from './route.ts'

type ReadyState = 'done' | 'warning' | 'error' | 'idle'
interface ReadyItem { key: string; label: string; detail: string; state: ReadyState; group: SettingsGroup }
interface ReadyData {
  sources: SourceStatusRow[]
  archive: ProjectArchive
  duties: ApiResponse<'GET duties'>
}

/** The sources that make up the four homes the ABC guide wires (Kanban, Gitea, ntfy, MinIO). */
const HOME_SOURCES = new Set(['kaneo', 'gitea', 'ntfy', 's3'])

export function SettingsReadiness({ state, compact = false }: { state: StateView, compact?: boolean }) {
  const { t, call, navigate } = usePanel()
  const { settings } = useSettings()
  const { perspective, postId } = usePerspective()
  const [data, setData] = useState<ReadyData>()
  const [busy, setBusy] = useState(false)
  const scoped = compact || perspective === 'post'

  const load = async () => {
    setBusy(true)
    try {
      const [sources, projectArchive, duties] = await Promise.all([
        call('GET sources'), call('GET project-archive'), call('GET duties'),
      ])
      setData({ sources, archive: projectArchive.archive, duties })
    } catch {
      // The readiness card is a convenience: a failed read leaves the previous values and the tabs below still work.
    } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [call])

  const items: ReadyItem[] = []
  if (data) {
    const project = data.archive.projects.find(item => item.id)
    const sources = data.sources.filter(source => source.installed)
    const homes = data.sources.filter(source => HOME_SOURCES.has(source.id))
    const ready = homes.filter(source => source.state === 'ready').length
    const sourceState: ReadyState = homes.some(source => source.state === 'error' || source.state === 'setup') ? 'error'
      : homes.length > 0 && ready === homes.length ? 'done' : 'warning'
    const states = homes.map(source => sourceMark(t, source.state).label).join('、')
    items.push({ key: 'sources', group: 'source', label: t('readiness.sources'),
      detail: homes.length ? t('readinessSourcesDetail', { ready: String(ready), total: String(homes.length) }) : states || t('readinessNotConfigured'),
      state: sourceState })
    if (scoped) {
      const mine = postId ? project?.posts.find(post => post.postId === postId) : undefined
      items.push({ key: 'myPost', group: 'project', label: t('readiness.myPost'),
        detail: mine?.kaneoUserId ? t('readinessMappedOne', { post: mine.postId }) : t('readinessNoPost'),
        state: mine?.kaneoUserId ? 'done' : 'warning' })
      if (sources.length) items.push({ key: 'sourcesScoped', group: 'source', label: t('readiness.sourcesScoped'),
        detail: t('readinessSourcesDetail', { ready: String(ready), total: String(homes.length) }),
        state: sourceState })
    } else {
      items.push({ key: 'project', group: 'project', label: t('readiness.project'),
        detail: project ? (project.name || project.id) : t('readinessNoProject'),
        state: project ? 'done' : 'warning' })
      const posts = project?.posts ?? []
      const mapped = [posts.some(post => post.role === 'pm' && post.kaneoUserId),
        posts.some(post => post.role === 'worker' && post.kaneoUserId)].filter(Boolean).length
      items.push({ key: 'posts', group: 'project', label: t('readiness.posts'),
        detail: posts.length ? t('readinessMapped', { mapped: String(mapped), total: '2' }) : t('readinessNoPosts'),
        state: posts.length && mapped === 2 ? 'done' : 'warning' })
      const charterVersion = project?.charter.version ?? 0
      items.push({ key: 'charter', group: 'project', label: t('readiness.charter'),
        detail: charterVersion > 0 ? `v${charterVersion}` : t('readinessNotPublished'),
        state: charterVersion > 0 ? 'done' : 'warning' })
      const duties = data.duties.duties.length
      items.push({ key: 'duties', group: 'project', label: t('readiness.duties'),
        detail: duties > 0 ? t('readinessCount', { count: String(duties) }) : t('readinessNotPublished'),
        state: duties > 0 ? 'done' : 'warning' })
      const mode = settings.blocks.eval.value.mode
      items.push({ key: 'eval', group: 'eval', label: t('readiness.eval'),
        detail: t(`mode.${mode}`), state: mode === 'auto' ? 'done' : 'warning' })
      const max = settings.blocks.executor.value.maxWorkers
      items.push({ key: 'executor', group: 'execution', label: t('readiness.executor'),
        detail: t('readinessExecutorDetail', { max: String(max), running: String(state.load.running) }),
        state: max >= 1 && !state.setup.problem ? 'done' : 'warning' })
      items.push({ key: 'deployment', group: 'deployment', label: t('readiness.deployment'),
        detail: state.setup.problem ? t('readinessProblem') : t('readinessDeploymentOk'),
        state: state.setup.problem ? 'error' : 'done' })
    }
  }
  const done = items.filter(item => item.state === 'done').length
  return <section className="dt-readiness" aria-label={t('readinessTitle')}>
    <div className="dt-readiness-head">
      <div className="dt-readiness-title-row">
        <span className="dt-readiness-title">{t('readinessTitle')}</span>
        {data && <span className="dt-readiness-score" data-ready={done === items.length || undefined}>{t('readinessScore',
          { done: String(done), total: String(items.length) })}</span>}
      </div>
      <p className="dt-hint">{scoped ? t('readinessHintPost') : t('readinessHint')}</p>
      <button type="button" className="dt-readiness-refresh" disabled={busy} onClick={() => { void load() }}>
        {busy ? t('readinessChecking') : t('readinessRefresh')}
      </button>
    </div>
    {items.length > 0 && <ol className="dt-readiness-list">
      {items.map(item => <li key={item.key}>
        <button type="button" className="dt-readiness-item" data-state={item.state} onClick={() => navigate(settingsRoute(item.group), true)}>
          <span className="dt-state-dot" data-state={item.state === 'done' ? 'done' : item.state === 'error' ? 'error' : 'warning'} />
          <span className="dt-readiness-label">{item.label}</span>
          <span className="dt-readiness-detail">{item.detail}</span>
        </button>
      </li>)}
    </ol>}
  </section>
}
