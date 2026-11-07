/**
 * Posts page: the narrative view of a deployment — projects, the posts that staff them, the charter a PM published,
 * the duties each post runs, and the exceptions a PM has to handle (RD.md §4–§8).
 *
 * In the PM perspective it shows the whole team; in the post perspective it shows the seat of one post: its own
 * card, its own duties and its own exceptions. The data comes from the same host endpoint either way.
 */
import { usePoll, type ExceptionRow, type NarrativeView, type PostView, type ProjectView } from './api.ts'
import { PermissionBanner } from './capabilities.tsx'
import { Button, Icon } from './controls.tsx'
import { usePerspective } from './perspective.tsx'
import { usePanel } from './provider.tsx'

import { settingsRoute } from './route.ts'
import { Hint, LoadState, Section } from './widgets.tsx'

/** A post's Kanban identity as a person reads it: the login e-mail, else the board's user id. */
const kanbanIdentity = (post: { kaneoUser?: string, kaneoUserId: string }): string => post.kaneoUser || post.kaneoUserId

function CharterBadge({ project }: { project: ProjectView }) {
  const { t } = usePanel()
  const charter = project.charter
  if (!charter) return <span className="dt-pill dt-pill-muted">{t('postsCharterMissing')}</span>
  if (charter.stale) return <span className="dt-pill dt-pill-warn" title={charter.detail}>
    <Icon name="alert" size={12} />{t('postsCharterStale', { days: charter.ageDays < 0 ? '?' : charter.ageDays })}</span>
  return <span className="dt-pill dt-pill-ok" title={[charter.detail, charter.carrierRef].filter(Boolean).join(' · ')}>
    <Icon name="decision" size={12} />{t('postsCharterCurrent', { version: charter.version })}
    {charter.carrierRef && <span className="dt-pill-ref">{charter.carrierRef}</span>}</span>
}

/**
 * The value stream: the board's columns as they are now (read from the server), beside the flow the charter declares.
 * A column the board has and the charter does not is flow that grew without the PM confirming it yet (RD.md §6.4).
 */
function FlowLine({ project }: { project: ProjectView }) {
  const { t } = usePanel()
  const flow = project.flow
  if (!flow.declared.length) return <p className="dt-hint">{t('postsFlowUndeclared')}</p>
  const meaning = (column: string): string =>
    flow.declared.find(step => step.column === column)?.meaning ?? ''
  return <div className="dt-flowline">
    <p className="dt-hint">
      {flow.board.length
        ? flow.board.map(column => `${column.slug}${meaning(column.slug) ? `（${meaning(column.slug)}）` : ''} ${column.count}`).join(' · ')
        : t('postsUnset')}
    </p>
    {flow.aligned
      ? <p className="dt-hint dt-pill dt-pill-ok">{t('postsFlowAligned')}</p>
      : <>
        {flow.drift.added.length > 0 && <p className="dt-hint dt-pill dt-pill-warn">{t('postsFlowDrift', { added: flow.drift.added.join('、') })}</p>}
        {flow.drift.removed.length > 0 && <p className="dt-hint dt-pill dt-pill-warn">{t('postsFlowMissing', { removed: flow.drift.removed.join('、') })}</p>}
      </>}
  </div>
}

function PostLine({ post }: { post: PostView }) {
  const { t, navigate } = usePanel()
  return <li className={`dt-row dt-post${post.overLimit ? ' dt-post-over' : ''}`}>
    <div className="dt-row-main">
      <div className="dt-att-what">
        <span className={`dt-role dt-role-${post.role}`}>{post.role === 'pm' ? t('postsRolePm') : t('postsRoleWorker')}</span>
        <span className="dt-post-name">{post.name}</span>
      </div>
      <p className="dt-hint">
        {t('postsKanbanIdentity')}: <code className="dt-code">{kanbanIdentity(post) || t('postsUnset')}</code>
        {post.instance ? <> · {t('postsInstance')}: <code className="dt-code">{post.instance}</code></> : null}
      </p>
      <p className="dt-hint">
        {t('postsWip')}: <strong>{post.dutyCount}</strong> / {post.wipLimit}
        {post.overLimit && <span className="dt-error"> · {t('postsOverLimit')}</span>}
      </p>
      {post.duties.length > 0 && <ul className="dt-post-duties">
        {post.duties.map(duty => <li key={duty.ticketId}>
          <button type="button" className="dt-open" onClick={() => navigate({ page: 'execution', id: duty.ticketId })}>{duty.title}</button>
          <span className="dt-detail">{duty.state === 'running' ? t('postsDutyStateRunning') : t('postsDutyStateQueued')}
            {duty.waiting ? ` · ${t('postsDutyWaiting')}` : ''}</span>
        </li>)}
      </ul>}
    </div>
  </li>
}

function ExceptionLine({ row }: { row: ExceptionRow }) {
  const { t, navigate } = usePanel()
  const kind = row.kind === 'waiting' ? t('postsExceptionWaiting') : row.kind === 'blocked' ? t('postsExceptionBlocked')
    : row.kind === 'failed' ? t('postsExceptionFailed') : t('postsExceptionStale')
  return <li className="dt-row dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">
        <button type="button" className="dt-open dt-open-wrap" onClick={() => navigate({ page: 'execution', id: row.ticketId })}>{row.title}</button>
      </div>
      <p className="dt-error">{kind}: {row.detail}</p>
      {row.postId && <p className="dt-hint">{t('postsOwner')}: <code className="dt-code">{row.postId}</code></p>}
    </div>
  </li>
}

/** The seat picker of the post perspective: which post the reader is. */
export function PostChooser({ posts }: { posts: PostView[] }) {
  const { t } = usePanel()
  const { postId, setPostId } = usePerspective()
  return <Section title={t('postsWhoAreYou')} hint={t('postsWhoAreYouHint')}>
    <ul className="dt-list">
      {posts.map(post => <li key={post.postId} className="dt-row dt-link">
        <div className="dt-row-main">
          <div className="dt-att-what">
            <button type="button" className="dt-open" onClick={() => setPostId(post.postId)}>
              <span className={`dt-role dt-role-${post.role}`}>{post.role === 'pm' ? t('postsRolePm') : t('postsRoleWorker')}</span>
              {post.name}
            </button>
          </div>
          <p className="dt-hint">{kanbanIdentity(post) || t('postsUnset')} · {t('postsWip')} {post.dutyCount} / {post.wipLimit}</p>
        </div>
      </li>)}
    </ul>
    {postId && <p className="dt-hint">{t('postsCurrentSeat', { post: posts.find(post => post.postId === postId)?.name ?? postId })}</p>}
  </Section>
}

/** The posts page: one card per project with its posts, then the exception queue the PM works through. */
export function PostsPage() {
  const { t, navigate, call } = usePanel()
  const { perspective, postId, setPostId } = usePerspective()
  const { data, error } = usePoll<NarrativeView>(() => call('GET narrative'), [call], 10_000)

  if (error) return <LoadState error={error} loading={false} />
  if (!data) return <LoadState loading />
  if (!data.configured) return <div className="dt-empty">
    <p>{t('postsEmpty')}</p>
    <Button variant="outline" icon={<Icon name="settings" size={14} />} onClick={() => navigate(settingsRoute('project'))}>{t('postsOpenSettings')}</Button>
  </div>

  // The post perspective shows one seat: the post the reader picked, with the duties and exceptions that belong to it.
  if (perspective === 'post') {
    const mine = data.posts.filter(post => post.postId === postId)
    if (!mine.length) return <div className="dt-posts">
      <PostChooser posts={data.posts} />
    </div>
    const post = mine[0]!
    const project = data.projects.find(item => item.id === post.projectId)
    const exceptions = data.exceptions.filter(row => row.postId === post.postId)
    return <div className="dt-posts">
      <Section title={post.name} icon="inbox" badge={project ? <CharterBadge project={project} /> : undefined}
        hint={t('postsMyPostHint')} action={<Button variant="ghost" size="sm" onClick={() => setPostId('')}>{t('postsChangeSeat')}</Button>}>
        <ul className="dt-kv">
          <li><dt>{t('postsKanbanIdentity')}</dt><dd>{kanbanIdentity(post) || t('postsUnset')}</dd></li>
          {post.kaneoUserId && <li><dt>{t('postsKanbanUserId')}</dt><dd><code className="dt-code">{post.kaneoUserId}</code></dd></li>}
          <li><dt>{t('postsInstance')}</dt><dd>{post.instance || t('postsUnset')}</dd></li>
          <li><dt>{t('postsWip')}</dt><dd>{post.dutyCount} / {post.wipLimit}</dd></li>
          <li><dt>{t('postsWatchColumns')}</dt><dd>{post.watchColumns || t('postsUnset')}</dd></li>
          <li><dt>{t('postsTopics')}</dt><dd>{project?.topics.length ? project.topics.join('、') : t('postsUnset')}</dd></li>
        </ul>
        <ul className="dt-posts-list">{mine.map(item => <PostLine key={item.postId} post={item} />)}</ul>
      </Section>
      <Section title={t('postsMyExceptions')} count={exceptions.length} icon="alert" hint={t('postsExceptionsHint')}>
        {exceptions.length === 0 ? <Hint>{t('postsNoExceptions')}</Hint>
          : <ul className="dt-list">{exceptions.map(row => <ExceptionLine key={`${row.kind}-${row.ticketId}`} row={row} />)}</ul>}
      </Section>
    </div>
  }

  return <div className="dt-posts">
    <PermissionBanner />
    {data.projects.some(project => !project.charter?.version) &&
      <p className="dt-banner dt-danger" role="status"><span className="dt-banner-label">{t('noCharterTitle')}</span>{t('noCharterBody')}</p>}
    {data.projects.map(project => <Section key={project.id} title={project.name} icon="inbox"
      badge={<CharterBadge project={project} />}
      hint={t('postsProjectHint', { slug: project.slug || project.id })}>
      <ul className="dt-kv">
        <li><dt>{t('postsTopics')}</dt><dd>{project.topics.length ? project.topics.join('、') : t('postsUnset')}</dd></li>
        <li><dt>{t('postsFlow')}</dt><dd><FlowLine project={project} /></dd></li>
      </ul>
      <ul className="dt-posts-list">{project.posts.map(post => <PostLine key={post.postId} post={post} />)}</ul>
    </Section>)}
    <Section title={t('postsExceptions')} count={data.exceptions.length} icon="alert"
      hint={t('postsExceptionsHint')}>
      {data.exceptions.length === 0 ? <Hint>{t('postsNoExceptions')}</Hint>
        : <ul className="dt-list">{data.exceptions.map(row => <ExceptionLine key={`${row.kind}-${row.ticketId}`} row={row} />)}</ul>}
    </Section>
  </div>
}
