// @vitest-environment jsdom
// The posts page: projects, posts, the charter, the duties in flight and the exception queue; plus the project
// and post settings page that edits the shared archive.
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, tab, click, text, settle } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

it('shows each project with its charter, posts, WIP and the exception queue', async () => {
  await mount()
  await click(tab(zh['tab.posts']))
  expect(tab(zh['tab.posts']).getAttribute('aria-selected')).toBe('true')
  expect(all('.dt-section-title').map(title => title.textContent)).toEqual(['FDEP宪章 v3', '异常队列1'])
  // The charter badge reads the version the host read from the published charter.
  expect(all('.dt-pill').map(pill => pill.textContent)).toEqual(['宪章 v3', '看板与宪章的流程一致'])
  expect(all('.dt-role').map(role => role.textContent)).toEqual(['PM 岗位'])
  expect(all('.dt-post-name').map(name => name.textContent)).toEqual(['SuperAgent PM (FDEP)'])
  expect(text()).toContain('在飞职责')
  expect(text()).toContain('u-pm')
  expect(text()).toContain('pub_fdep_pm')
  // The value stream: the board's columns with the meaning the charter gave them.
  expect(text()).toContain('待开工')
  expect(text()).toContain('看板与宪章的流程一致')
  // The exception queue lists what the PM has to handle.
  expect(all('.dt-att-error').map(row => row.textContent).join(' ')).toContain('需要确认验收口径')
  expect(server.requests.some(request => request.path === 'narrative')).toBe(true)
})

it('opens the duty of a post from the posts page', async () => {
  await mount()
  await click(tab(zh['tab.posts']))
  await click('修复回归')
  expect(tab(zh['tab.execution']).getAttribute('aria-selected')).toBe('true')
})

it('edits the project archive in the settings page and saves it', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  expect(find(zh['settingsGroup.project'], '.dt-settings-link').getAttribute('aria-current')).toBe('page')
  expect(all('.dt-field-label').map(label => label.textContent)).toContain(zh.projectPostKanban)
  const identity = [...document.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === 'u-pm')
  expect(identity).toBeDefined()
  await click(zh.projectSave)
  const saved = server.requests.find(request => request.path === 'project-archive' && request.method === 'PUT')
  expect(saved).toBeDefined()
  expect((saved?.body as { archive?: { projects?: unknown[] } })?.archive?.projects).toHaveLength(1)
})

it('names the team in the overview summary when a project archive is configured', async () => {
  await mount()
  await settle()
  expect(server.requests.map(request => request.path)).toContain('narrative')
  expect(all('.dt-section-title').some(title => title.textContent?.startsWith('队伍'))).toBe(true)
  expect(text()).toContain('宪章')
})

it('shows no rights banner in either perspective: the gate is paused', async () => {
  // The posts and settings pages used to carry the account banner; with the gate paused they show nothing about rights.
  await mount()
  await click(tab(zh['tab.posts']))
  expect(document.querySelector('.dt-permission')).toBeNull()
  await click(tab(zh['tab.settings']))
  expect(document.querySelector('.dt-permission')).toBeNull()
})
