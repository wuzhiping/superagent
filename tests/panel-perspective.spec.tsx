// @vitest-environment jsdom
// The two panel perspectives: the PM's seat and a post's seat read the same host, but show different tabs,
// settings groups and pages.
import { beforeEach, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, tab, click, text, settle } from './fixtures/panel.tsx'
import { memberCapabilities, server } from './fixtures/panel-server.ts'

usePanel()

beforeEach(() => { localStorage.clear() })

it('opens in the PM perspective with every tab and settings group', async () => {
  await mount()
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['概览', '编队', '来源', '触发', '评估', '执行', '清理', '设置'])
  await click(tab(zh['tab.settings']))
  expect(all('.dt-settings-link').map(link => link.textContent)).toEqual(['项目与岗位', '来源', '评估', '执行', '提示词', '部署'])
  expect(find(zh['perspective.pm'], '.dt-perspective-option').getAttribute('aria-pressed')).toBe('true')
})

it('switches to the post perspective: fewer tabs, its own names, and it lands on the duties', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['概览', '我的任务', '来源', '触发', '设置'])
  expect(tab(zh['tab.execution.post']).getAttribute('aria-selected')).toBe('true')
  await click(tab(zh['tab.settings']))
  expect(all('.dt-settings-link').map(link => link.textContent)).toEqual([zh.settingsMyPost, '来源', '执行', '提示词', '部署'])
})

it('keeps one host behind both perspectives', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  await settle()
  const paths = server.requests.map(request => request.path)
  expect(paths).toContain('narrative')
  expect(paths).toContain('overview')
  // The post perspective asks the same endpoints; it does not talk to a second host.
  expect(new Set(paths.filter(path => path.startsWith('project'))).size).toBeLessThanOrEqual(1)
})

it('offers the seat picker in 我的岗位设置 and then shows only that post', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  await click(tab(zh['tab.settings']))
  await click(find(zh.settingsMyPost, '.dt-settings-link'))
  await settle()
  // The seat picker moved here: without a chosen seat the page asks which post the reader is.
  expect(text()).toContain(zh.postsWhoAreYou)
  const seat = () => [...document.querySelectorAll<HTMLElement>('.dt-open')].find(item => item.textContent?.includes('SuperAgent PM (FDEP)'))!
  await click(seat())
  await settle()
  // The reader is that post: its Kanban account is on screen and the picker marks the choice.
  expect(text()).toContain('pm@example.com')
  expect(all('.dt-post-name').length).toBe(0)
  expect(seat().getAttribute('aria-pressed')).toBe('true')
  expect(text()).toContain(zh.postsSeatSelected)
  // The choice can be taken back: clicking the selected post again clears it.
  await click(seat())
  await settle()
  expect(seat().getAttribute('aria-pressed')).toBe('false')
  expect(text()).not.toContain(zh.postsCurrentSeat.replace('{post}', 'SuperAgent PM (FDEP)'))
  // An explicit action does the same, without having to find the selected row again.
  await click(seat())
  await settle()
  await click(zh.postsClearSeat)
  await settle()
  expect(seat().getAttribute('aria-pressed')).toBe('false')
  // Choose it again for the rest of the check: the tasks tab lists that seat's own tickets.
  await click(seat())
  await settle()
  // 我的任务 lists the seat's own tickets and says where to pick a seat while none is chosen.
  await click(tab(zh['tab.execution.post']))
  await settle()
  expect(text()).toContain('修复回归')
})

it('shows the whole team in the PM perspective', async () => {
  await mount()
  await click(tab(zh['tab.posts']))
  await settle()
  expect(text()).toContain('SuperAgent PM (FDEP)')
  expect(text()).toContain(zh.postsExceptions)
})

it('names the perspectives in English too', async () => {
  await mount(en)
  expect(all('.dt-perspective-option').map(item => item.textContent)).toEqual([en['perspective.pm'], en['perspective.post']])
  await click(find(en['perspective.post'], '.dt-perspective-option'))
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['Overview', 'My tasks', 'Source', 'Trigger', 'Settings'])
})

it('asks before it lets a reader whose account may not manage the board into the PM seat', async () => {
  server.capabilities = memberCapabilities()
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  await click(find(zh['perspective.pm'], '.dt-perspective-option'))
  // The seat is not taken silently: the question names the account and the right it lacks.
  const dialog = document.querySelector('.dt-modal')
  expect(dialog?.textContent).toContain(zh.permissionSwitchConfirm)
  expect(dialog?.textContent).toContain('sa-w1-fdep')
  expect(dialog?.textContent).toContain('member')
  expect(find(zh['perspective.post'], '.dt-perspective-option').getAttribute('aria-pressed')).toBe('true')
  // The reader may refuse the seat, or take it knowing what is missing.
  await click(zh.cancel)
  expect(document.querySelector('.dt-modal')).toBeNull()
  await click(find(zh['perspective.pm'], '.dt-perspective-option'))
  await click(zh.permissionSwitchAnyway)
  expect(find(zh['perspective.pm'], '.dt-perspective-option').getAttribute('aria-pressed')).toBe('true')
})

it('takes the PM seat without a question when the account may manage the board', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  await click(find(zh['perspective.pm'], '.dt-perspective-option'))
  expect(document.querySelector('.dt-modal')).toBeNull()
  expect(find(zh['perspective.pm'], '.dt-perspective-option').getAttribute('aria-pressed')).toBe('true')
})

it('shows the Sources read-only in the post perspective', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  await click(tab(zh['tab.settings']))
  await click(find(zh['term.source'], '.dt-settings-link'))
  await settle()
  // The post does not own the deployment's Sources: the cards carry the PM's values and cannot be saved.
  expect(text()).toContain(zh.sourceReadOnlyPost)
  expect(all('.dt-savebar').length).toBe(0)
  // Fields renders a disabled fieldset; its controls inherit the lock.
  expect(document.querySelectorAll('fieldset[disabled]').length).toBeGreaterThan(0)
})
