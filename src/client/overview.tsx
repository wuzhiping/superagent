/** Overview page: pending Tickets requiring human action, active system problems, 24-hour flow counts, and Executor load. */
import type { ReactNode } from 'react'
import { usePoll, type NarrativeView, type Problem } from './api.ts'
import { Button, Dot, Icon } from './controls.tsx'
import { usePerspective } from './perspective.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { TicketLine } from './rows.tsx'
import { healthText, localized, reasonLabel, valueLabel, readableMarkers } from './text.ts'
import { CheckSetupButton, ConfirmButton, Hint, LoadState, Section, SetupMessage } from './widgets.tsx'

function ProblemLine({ problem, onChanged }: { problem: Problem; onChanged: () => Promise<void> }) {
  const { t, call, navigate } = usePanel()
  const post = useAction((request: () => Promise<unknown>) => request(), { reload: onChanged })
  const row = (title: string, detail: ReactNode, route: Route | undefined, hint?: string, actions?: ReactNode) => <li
    className="dt-row dt-link dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">{route ? <button type="button" className="dt-open dt-open-wrap"
        onClick={() => navigate(route)}>{title}</button> : title}</div>
      {detail}{hint && <Hint>{hint}</Hint>}{actions && <div className="dt-row-meta dt-row-buttons">{actions}</div>}
    </div>
  </li>
  const go = (label: string, route: Route) => <Button variant="outline" size="sm" icon={<Icon name="settings"
    size={14} />} onClick={() => navigate(route)}>{label}</Button>
  const raw = (text: string | undefined) => text && <p className="dt-error dt-clamp dt-mono">{text}</p>
  const worded = (text: string) => <p className="dt-error">{text}</p>
  switch (problem.kind) {
    // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
    case 'setup': return row(t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup'), <p className="dt-error"><SetupMessage
      problem={problem} /></p>,
      setupPage(problem.place), t(`problemSetupFix.${problem.place}`), <CheckSetupButton />)
    case 'no-source': return row(t('problemNoSource'), undefined, settingsRoute('source'), undefined, go(t('actionOpenSources'),
      settingsRoute('source')))
    case 'no-allowed': return row(t('problemNoAllowed'), undefined, settingsRoute('eval'), undefined, go(t('actionAddAllowed'),
      settingsRoute('eval')))
    case 'executor-paused': return row(t('problemPaused'), undefined, { page: 'execution' }, undefined,
      <ConfirmButton variant="outline" icon="play" label={t('resumeProcessing')} title={t('resumeProcessing')}
        message={t('resumeProcessingConfirm')}
        onConfirm={async () => { await call('POST executor/pause', { body: { paused: false } }); await onChanged() }} />)
    case 'runtime-error': return row(t('problemRuntime', { name: valueLabel(t, 'health', problem.name) }), raw(problem.detail), undefined)
    case 'source-error': {
      const health = problem.source.health
      return row(t('sourceError', { source: localized(t, problem.source.title) }), health.code ? worded(healthText(t, health))
        : raw(health.detail), { page: 'source' }, t('sourceErrorHint'))
    }
    case 'eval-overdue': return row(t('problemEvalOverdue', { thread: readableMarkers(t, problem.thread.title) }), undefined, { page: 'trigger',
      id: problem.thread.key })
    case 'eval-unavailable': return row(t('problemEvalUnavailable', { thread: readableMarkers(t, problem.thread.title) }), raw(reasonLabel(t,
      problem.reason)),
      { page: 'trigger', id: problem.thread.key, query: { trigger: problem.triggerId } }, undefined, <>
        <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST triggers/:id/requeue', { id: problem.triggerId })) }}>{t('requeue')}</Button>
        <Button variant="outline" size="sm" icon={<Icon name="dismiss" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST decisions/:id/dismiss', { id: problem.decisionId })) }}>{t('dismiss')}</Button>
      </>)
    case 'outgoing': return row(t('problemReply', { source: valueLabel(t, 'source', problem.outgoing.channel.source),
      attempts: problem.outgoing.attempts }),
      raw(problem.outgoing.error), undefined)
  }
}

export function OverviewPage() {
  const { t, call, navigate } = usePanel()
  const { setup, state } = usePanelData()
  const { perspective, postId } = usePerspective()
  const { data, error, reload } = usePoll(() => call('GET overview'), [])
  const { data: narrative } = usePoll(() => call('GET narrative'), [])
  if (!data) return <LoadState error={error} loading />
  const session = state?.session
  const sessionDot = session?.status === 'error' ? 'error' : session?.status === 'running' ? 'running' : 'warning'
  const stat = (label: string, value: ReactNode, route?: Route) => <span className="dt-stat">
    <span className="dt-stat-label">{label}</span>
    {route ? <button type="button" className="dt-textlink dt-stat-value" onClick={() => navigate(route)}>{value}</button> : <span
      className="dt-stat-value">{value}</span>}
  </span>
  const more = (route: Route) => <button type="button" className="dt-textlink dt-more-link"
    onClick={() => navigate(route)}>{t('details')}</button>
  return <>
    {error && <LoadState error={error} loading={false} />}
    {session && <Section title={t('mainSession')}>
      {/* The main Session's own state: green while it works, yellow while it waits, red when the model service failed it. */}
      <div className="dt-session-state">
        <Dot state={sessionDot} />
        <span className="dt-status-text" data-state={session.status}>{t(`mainSessionState.${session.status}`)}</span>
      </div>
      {session.status === 'error' && session.detail && <p className="dt-session-detail">{session.detail}</p>}
    </Section>}
    <Section title={t('pendingTickets')} count={data.person.length}>
      {data.person.length ? <ul className="dt-list dt-cards">{data.person.map(ticket => <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reload} />)}</ul>
        : <Hint>{t('needsYouNone')}</Hint>}
    </Section>
    {data.problems.length > 0 && <Section title={t('problems')} count={data.problems.length}>
      <ul className="dt-list dt-cards">{data.problems.map((problem, index) => <ProblemLine key={index} problem={problem}
        onChanged={reload} />)}</ul>
    </Section>}
    <Section title={t('lastDay')} action={more({ page: 'trigger', query: { filter: 'recent' } })}>
      {/* Received and evaluated counts operate on Triggers rather than Threads or Decisions, so they do not link to filtered views. */}
      <div className="dt-stats">
        {stat(t('flowReceivedLabel'), data.flow.received)}
        {stat(t('flowFilteredLabel'), data.flow.filtered, data.flow.filtered ? { page: 'source' } : undefined)}
        {stat(t('flowJudgedLabel'), data.flow.judged)}
        {stat(t('flowAcceptedLabel'), data.flow.accepted, { page: 'eval', query: { window: '24h' } })}
        {data.flow.dropped > 0 && stat(t('flowDroppedLabel'), data.flow.dropped, { page: 'source' })}
      </div>
    </Section>
    <Section title={t('term.executor')} action={more({ page: 'execution' })}>
      {/* Pauses surface in `problems` above, so Executor counts render the same in both states; while setup waits, nothing runs. */}
      {setup?.problem ? <Hint>{t('executorWaitingSetup')}</Hint> : <div className="dt-stats">
        {stat(t('executingLabel'), `${data.executor.running} / ${data.executor.maxWorkers}`)}
        {stat(t('queuedLabel'), data.executor.queued)}
        {stat(t('idleLabel'), data.executor.idle)}
      </div>}
    </Section>
    {narrative?.configured && (perspective === 'post' ? <PostSeatSummary narrative={narrative} postId={postId} />
      : <Section title={t('postsTeam')} action={more({ page: 'posts' })}>
        {/* The narrative summary: how many posts run, how many duties they carry, and whether a charter needs a new version. */}
        <div className="dt-stats">
          {stat(t('postsPostsCount'), narrative.posts.length)}
          {stat(t('postsDutiesCount'), narrative.duties.length)}
          {stat(t('postsExceptionsCount'), narrative.exceptions.length)}
          {stat(t('postsCharterFreshness'), narrative.projects.filter(project => project.charter?.stale).length
            ? t('postsCharterStaleCount', { count: narrative.projects.filter(project => project.charter?.stale).length })
            : t('postsCharterAllCurrent'), { page: 'posts' })}
        </div>
      </Section>)}
  </>
}

/** The post perspective's own summary: the seat, its duties, its exceptions and the charter it works under. */
function PostSeatSummary({ narrative, postId }: { narrative: NarrativeView; postId: string }) {
  const { t } = usePanel()
  const post = narrative.posts.find(item => item.postId === postId)
  const project = post ? narrative.projects.find(item => item.id === post.projectId) : undefined
  const exceptions = narrative.exceptions.filter(row => row.postId === postId)
  if (!post) return <Section title={t('postsMySeat')} icon="user" hint={t('postsWhoAreYouHint')}>
    <Hint>{t('postsChooseSeatOnPosts')}</Hint>
  </Section>
  return <Section title={t('postsMySeat')} icon="user" badge={project?.charter
    ? <span className={`dt-pill ${project.charter.stale ? 'dt-pill-warn' : 'dt-pill-ok'}`}>{project.charter.stale
      ? t('postsCharterStale', { days: project.charter.ageDays < 0 ? '?' : project.charter.ageDays })
      : t('postsCharterCurrent', { version: project.charter.version })}</span> : undefined}>
    <div className="dt-stats">
      <span className="dt-stat"><span className="dt-stat-label">{t('postsDutiesCount')}</span>
        <span className="dt-stat-value">{post.dutyCount} / {post.wipLimit}</span></span>
      <span className="dt-stat"><span className="dt-stat-label">{t('postsExceptionsCount')}</span>
        <span className="dt-stat-value">{exceptions.length}</span></span>
      <span className="dt-stat"><span className="dt-stat-label">{t('postsKanbanIdentity')}</span>
        <span className="dt-stat-value">{post.kaneoUser || post.kaneoUserId || t('postsUnset')}</span></span>
    </div>
  </Section>
}
