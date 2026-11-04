// @vitest-environment jsdom
// The two panel perspectives: the PM's seat and a post's seat read the same host, but show different tabs,
// settings groups and pages.
import { beforeEach, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, tab, click, text, settle } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

beforeEach(() => { localStorage.clear() })

it('opens in the PM perspective with every tab and settings group', async () => {
  await mount()
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['概览', '编队', '来源', '触发', '评估', '执行', '设置'])
  await click(tab(zh['tab.settings']))
  expect(all('.dt-settings-link').map(link => link.textContent)).toEqual(['项目与岗位', '来源', '评估', '执行', '提示词', '部署'])
  expect(find(zh['perspective.pm'], '.dt-perspective-option').getAttribute('aria-pressed')).toBe('true')
})

it('switches to the post perspective: fewer tabs, its own names, and it lands on the duties', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['概览', '我的职责', '我的岗位', '来源', '触发', '设置'])
  expect(tab(zh['tab.execution.post']).getAttribute('aria-selected')).toBe('true')
  await click(tab(zh['tab.settings']))
  expect(all('.dt-settings-link').map(link => link.textContent)).toEqual(['项目与岗位', '来源', '执行', '提示词', '部署'])
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

it('shows the seat picker in the post perspective and then only that post', async () => {
  await mount()
  await click(find(zh['perspective.post'], '.dt-perspective-option'))
  await click(tab(zh['tab.posts.post']))
  await settle()
  // Without a chosen seat the page asks which post the reader is.
  expect(text()).toContain(zh.postsWhoAreYou)
  const seat = [...document.querySelectorAll<HTMLElement>('.dt-open')].find(item => item.textContent?.includes('SuperAgent PM (FDEP)'))
  await click(seat!)
  await settle()
  expect(all('.dt-post-name').map(name => name.textContent)).toEqual(['SuperAgent PM (FDEP)'])
  expect(text()).not.toContain('SuperAgent Worker 1 (FDEP)')
  expect(text()).toContain(zh.postsMyExceptions)
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
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['Overview', 'My duties', 'My post', 'Source', 'Trigger', 'Settings'])
})
