/** Settings tab shell routing between stage settings (Sources, Eval, Execution), Prompts, and Deployment. */
import type { StateView } from './api.ts'
import { PermissionBanner } from './capabilities.tsx'
import { DeploymentPage, type DeploymentForm } from './deployment.tsx'
import { EvalSettings } from './eval.tsx'
import { ExecutionSettings } from './execution.tsx'
import { ProjectSettings } from './project.tsx'
import { PromptsPage } from './prompts.tsx'
import { usePanel } from './provider.tsx'
import { usePerspective } from './perspective.tsx'
import { SETTINGS_GROUPS_BY_PERSPECTIVE, settingsRoute, type SettingsGroup } from './route.ts'
import { SettingsProvider } from './settings-kit.tsx'
import { SourceSettings } from './source.tsx'

const STAGE_GROUPS: readonly SettingsGroup[] = ['source', 'eval', 'execution']
export function SettingsPage({ group, query, state, deploymentForm }: {
  group: SettingsGroup; query: { source?: string; version?: string }; state: StateView; deploymentForm: DeploymentForm
}) {
  const { t, navigate } = usePanel()
  const { perspective } = usePerspective()
  const groups = SETTINGS_GROUPS_BY_PERSPECTIVE[perspective]
  // In the post perspective the project group is the post's own settings, not the project's.
  const groupLabel = (value: SettingsGroup): string => perspective === 'post' && value === 'project'
    ? t('settingsMyPost') : t(`settingsGroup.${value}`)
  const content = (() => {
    switch (group) {
      case 'project': return <ProjectSettings />
      case 'source': return <SettingsProvider><SourceSettings {...query.source ? { focus: query.source } : {}} /></SettingsProvider>
      case 'eval': return <SettingsProvider><EvalSettings version={query.version} /></SettingsProvider>
      case 'execution': return <SettingsProvider><ExecutionSettings /></SettingsProvider>
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
      <PermissionBanner />
      {content}
    </div>
  </div>
}
