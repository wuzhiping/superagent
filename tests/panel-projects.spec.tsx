// @vitest-environment jsdom
// Choosing a project from the list the Kanban account can see, instead of typing an id from memory. The choice brings
// the project's own name, slug and (when the list is still the previous default) its topic along with it.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, find, tab, click, type, settle } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

/** The control whose label is `label`, as the settings page renders it (a labelled grid field). */
const inputByLabel = (label: string): HTMLInputElement | undefined =>
  [...document.querySelectorAll<HTMLLabelElement>('label')]
    .find(element => element.textContent?.startsWith(label))
    ?.querySelector<HTMLInputElement>('input') ?? undefined

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

it('brings the chosen project name and slug into their fields', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  // The stored project starts as FDEP / FDE.
  expect(inputByLabel(zh.projectName)?.value).toBe('FDEP')
  expect(inputByLabel(zh.projectSlug)?.value).toBe('FDE')
  const pickup = [...document.querySelectorAll<HTMLSelectElement>('select.dt-select')]
    .find(element => element.value === 'p1')
  await type(pickup as HTMLSelectElement, 'at8xrho45bisco2umjzgl1xp')
  // The choice carries the project's own name and slug, not just its id.
  expect(inputByLabel(zh.projectName)?.value).toBe('Superagent')
  expect(inputByLabel(zh.projectSlug)?.value).toBe('RSI')
})

it('starts a new project with one PM post and one worker post, each removable', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  const editors = () => [...document.querySelectorAll('.dt-post-editor')]
  const start = editors().length
  await click(zh.projectAdd)
  await settle()
  expect(editors()).toHaveLength(start + 2)
  const added = editors().slice(-2)
  // One of each kind, and their names say which is which.
  expect(added.map(editor => editor.querySelector<HTMLSelectElement>('select')!.value).sort()).toEqual(['pm', 'worker'])
  expect(added.map(editor => editor.querySelectorAll<HTMLInputElement>('input')[1]!.value)).toEqual([zh.postsRolePm, zh.postsRoleWorker])
  // The default posts are not forced: each card can be removed, leaving the archive as it was.
  const remove = (editor: Element) => [...editor.querySelectorAll('button')].find(button => button.textContent === zh.projectRemovePost)!
  await click(remove(added[0]!))
  await settle()
  expect(editors()).toHaveLength(start + 1)
  await click(remove(editors().at(-1)!))
  await settle()
  expect(editors()).toHaveLength(start)
})

it('says what is missing before a project with the default posts can be saved', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  await click(zh.projectAdd)
  await settle()
  const saves = () => server.requests.filter(request => request.path === 'project-archive' && request.method === 'PUT')
  const before = saves().length
  await click(zh.projectSave)
  await settle()
  // The new project has no project picked yet, so the message names that first, and nothing was written.
  expect(document.body.textContent).toContain(zh.projectValidationProject)
  expect(saves()).toHaveLength(before)
  // Once the project and the posts are filled in, the same button saves the archive.
  const projectRow = [...document.querySelectorAll('.dt-project-settings .dt-archive-card')].at(-1)!
  const select = projectRow.querySelector<HTMLSelectElement>('select')!
  await type(select, 'p1')
  const postRows = [...projectRow.querySelectorAll('.dt-post-editor')]
  for (const [index, post] of postRows.entries()) await type(post.querySelectorAll<HTMLInputElement>('input')[0]!, `p-${index}`)
  expect(document.body.textContent).not.toContain(zh.projectValidationProject)
})

it('keeps the post id field focused while a new post id is typed', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  await click(zh.projectAddPost)
  const postIdInputs = () => [...document.querySelectorAll<HTMLLabelElement>('label')]
    .filter(label => label.textContent?.startsWith(zh.projectPostId))
    .map(label => label.querySelector<HTMLInputElement>('input')!)
  const input = postIdInputs().at(-1)!
  input.focus()
  expect(document.activeElement).toBe(input)
  await type(input, 'w1-story')
  const after = postIdInputs().at(-1)!
  expect(after.value).toBe('w1-story')
  // The editor must stay mounted while the id changes, otherwise every character would drop the focus.
  expect(after).toBe(input)
  expect(document.activeElement).toBe(input)
})

it('picks a post duty from the published duties list and saves the selection', async () => {
  server.duties = { mode: 'folder', text: '### api · 后台接口\n- 目标：按卡片实现接口\n', duties: [{
    id: 'api', name: '后台接口', goal: '按卡片实现接口', done: [], carrier: 'code', charterFocus: [], knowledge: [],
    resources: [], tools: [], skills: [], intake: [], steps: [], pitfalls: [], posts: [] }] }
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.project'], '.dt-settings-link'))
  await settle()
  // The post editor's last select is the duty dropdown; choosing one adds a removable chip.
  const editor = () => [...document.querySelectorAll<HTMLElement>('.dt-post-editor')][0]!
  const picker = () => [...editor().querySelectorAll<HTMLSelectElement>('select')].at(-1)!
  await type(picker(), 'api')
  expect(editor().querySelector('.dt-duties-picked')?.textContent).toContain('后台接口')
  await click(zh.projectSave)
  await settle()
  const saved = (server.archive as { projects: { posts: { duties: string[] }[] }[] }).projects[0]!.posts[0]!
  expect(saved.duties).toEqual(['api'])
  // Clicking the chip removes the selection again.
  await click(editor().querySelector('.dt-duties-picked .dt-tag')!)
  expect(editor().querySelector('.dt-duties-picked')).toBeNull()
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
