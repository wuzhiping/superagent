/** Settings tab shell routing between stage settings (Sources, Eval, Execution), Prompts, and Deployment. */
import type { StateView } from './api.ts'
import { PermissionBanner } from './capabilities.tsx'
import { DeploymentPage, type DeploymentForm } from './deployment.tsx'
import { EvalSettings } from './eval.tsx'
import { ExecutionSettings } from './execution.tsx'
import { usePoll } from './api.ts'
import { PostChooser } from './posts.tsx'
import { ProjectSettings } from './project.tsx'
import { PromptsPage } from './prompts.tsx'
import { usePanel } from './provider.tsx'
import { usePerspective } from './perspective.tsx'
import { SETTINGS_GROUPS_BY_PERSPECTIVE, settingsRoute, type SettingsGroup } from './route.ts'
import { SettingsProvider } from './settings-kit.tsx'
import { SettingsReadiness } from './readiness.tsx'
import { SourceSettings } from './source.tsx'

const STAGE_GROUPS: readonly SettingsGroup[] = ['source', 'eval', 'execution']

/**
 * In the post perspective the project group is the reader's own seat: first say which post you are, then read its
 * settings (the seat picker used to live on a tab of its own).
 */
function ProjectGroup () {
  const { call } = usePanel()
  const { perspective } = usePerspective()
  const { data } = usePoll(() => perspective === 'post' ? call('GET narrative') : Promise.resolve(undefined), [perspective])
  return <>{perspective === 'post' && data && <PostChooser posts={data.posts ?? []} />}<ProjectSettings /></>
}
export function SettingsPage({ group, query, state, deploymentForm }: {
  group: SettingsGroup; query: { source?: string; version?: string }; state: StateView; deploymentForm: DeploymentForm
}) {
  const { t, navigate } = usePanel()
  const { perspective } = usePerspective()
  const groups = SETTINGS_GROUPS_BY_PERSPECTIVE[perspective]
  // In the post perspective the project group is the post's own settings, not the project's.
  const groupLabel = (value: SettingsGroup): string => perspective === 'post' && value === 'project'
    ? t('settingsMyPost') : t(`settingsGroup.${value}`)
  // Each tab opens with one line saying what the tab is for; the project tab in the post perspective is the seat's own settings.
  const groupHint = perspective === 'post' && group === 'project' ? t('settingsGroupHint.myPost') : t(`settingsGroupHint.${group}`)
  const content = (() => {
    switch (group) {
      case 'project': return <ProjectGroup />
      case 'source': return <SourceSettings {...query.source ? { focus: query.source } : {}} readOnly={perspective === 'post'} />
      case 'eval': return <EvalSettings version={query.version} />
      case 'execution': return <ExecutionSettings />
      case 'prompts': return <PromptsPage />
      case 'deployment': return <DeploymentPage setup={state.setup} form={deploymentForm} />
    }
  })()
  return <div className="dt-settings">
    <nav className="dt-settings-nav" aria-label={t('tab.settings')}>
      {groups.map(value => <button key={value} type="button" className="dt-settings-link" data-stage={STAGE_GROUPS.includes(value)
        || undefined}
        aria-current={value === group ? 'page' : undefined} onClick={() => navigate(settingsRoute(value),
          true)}>{groupLabel(value)}</button>)}
    </nav>
    <div className="dt-settings-body">
      <h2 className="dt-settings-title">{groupLabel(group)}</h2>
      <p className="dt-settings-subtitle">{groupHint}</p>
      <SettingsProvider>
        <SettingsReadiness state={state} compact={perspective === 'post'} />
        <PermissionBanner />
        {content}
      </SettingsProvider>
    </div>
  </div>
}
