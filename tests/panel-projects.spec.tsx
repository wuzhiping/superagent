// @vitest-environment jsdom
// Choosing a project from the list the Kanban account can see, instead of typing an id from memory.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, find, tab, click, type, settle } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

it('offers the projects of the account in the project archive, with name, slug and workspace', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  // The project id field is a choice of the projects the account can see, not a free-text input.
  const pickup = [...document.querySelectorAll<HTMLSelectElement>('select.dt-select')]
    .find(element => element.value === 'p1')
  expect(pickup).toBeDefined()
  const options = [...(pickup?.options ?? [])].map(option => option.textContent ?? '')
  expect(options.some(option => option.includes('Superagent（RSI）'))).toBe(true)
  expect(options.some(option => option.includes('ATEAM'))).toBe(true)
  // Picking another project stores its id, and the host was asked for the list at all.
  await type(pickup as HTMLSelectElement, 'at8xrho45bisco2umjzgl1xp')
  expect((pickup as HTMLSelectElement).value).toBe('at8xrho45bisco2umjzgl1xp')
  expect(server.requests.some(request => request.path === 'projects')).toBe(true)
})

it('keeps the current project selectable when the account cannot see it any more', async () => {
  server.choices = { workspaces: [], projects: [], problem: 'the server refused the request' }
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  const pickup = [...document.querySelectorAll<HTMLSelectElement>('select.dt-select')]
    .find(element => element.value === 'p1')
  expect(pickup).toBeDefined()
  // The project already stored stays selectable even though the list could not be read.
  expect([...(pickup?.options ?? [])].map(option => option.value)).toContain('p1')
  // The reason the list is empty is on screen, not silently swallowed.
  expect(document.body.textContent).toContain('the server refused the request')
})
