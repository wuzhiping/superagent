// @vitest-environment jsdom
// The cleanup page: ended duties sorted by size, preselected unless they carry a deliverable, cleaned only after a
// person confirms, and Sessions removed only when the separate option is checked.
import { act } from 'react'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, click, text, settle } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
const rows = () => all('.dt-maintenance-table tbody tr')
const boxes = () => rows().map(row => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
const options = () => all('.dt-maintenance-option input') as HTMLInputElement[]
const toggle = async (input: HTMLInputElement) => { await act(async () => { input.click() }); await settle() }

it('lists ended duties by size, preselects the ones without a deliverable, and cleans only them after confirmation', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  expect(server.requests.some(request => request.path === 'maintenance')).toBe(true)
  const cells = rows().map(row => row.querySelector('td:nth-child(2)')?.textContent ?? '')
  expect(cells).toHaveLength(2)
  expect(cells[0]).toContain('旧工单')
  expect(cells[1]).toContain('已合并的工单')
  // The deliverable is marked and its row is not checked by default.
  expect(text()).toContain(zh.maintenanceDeliverable)
  expect(boxes().map(box => box.checked)).toEqual([true, false])
  expect(text()).toContain(zh.maintenanceSelected.replace('{count}', '1'))
  expect(text()).toContain(zh.maintenanceSessionHint.replace('{count}', '1'))
  await click(find(zh.maintenanceClean))
  const dialog = document.querySelector('[role="dialog"]')?.textContent ?? ''
  expect(dialog).toContain(zh.maintenanceConfirmKeepFiles)
  expect(dialog).toContain(zh.maintenanceConfirmKeepSessions.replace('{count}', '1'))
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'maintenance/clean'))
    .toMatchObject({ method: 'POST', body: { ticketIds: ['t0'], removeFiles: false, removeSessions: false } })
  // Unregistering alone leaves the directory and the Session: the row stays and can be cleaned again with the options.
  expect(rows()).toHaveLength(2)
})

it('deletes the folder only when the separate option is checked, and says how many bytes that removes', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  await toggle(options()[0]!) // removeFiles
  expect(server.requests.find(request => request.path === 'maintenance/clean')).toBeUndefined()
  await click(find(zh.maintenanceClean))
  const dialog = document.querySelector('[role="dialog"]')?.textContent ?? ''
  expect(dialog).toContain(zh.maintenanceConfirmFiles)
  expect(dialog).toContain(zh.maintenanceConfirmBytes.replace('{size}', '3.0 MB'))
  expect(dialog).toContain(zh.maintenanceConfirmKeepSessions.replace('{count}', '1'))
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'maintenance/clean'))
    .toMatchObject({ method: 'POST', body: { ticketIds: ['t0'], removeFiles: true, removeSessions: false } })
  // The directory is gone but one Session remains, so the row is still listed.
  expect(rows()).toHaveLength(2)
  expect(server.maintenance.workspaces[0]).toMatchObject({ ticketId: 't0', workspaceExists: false, sessions: 1 })
})

it('removes the row together with its Sessions when both options are checked', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  await toggle(options()[0]!) // removeFiles
  await toggle(options()[1]!) // removeSessions
  await click(find(zh.maintenanceClean))
  const dialog = document.querySelector('[role="dialog"]')?.textContent ?? ''
  expect(dialog).toContain(zh.maintenanceConfirmRemoveSessions.replace('{count}', '1'))
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'maintenance/clean'))
    .toMatchObject({ method: 'POST', body: { ticketIds: ['t0'], removeFiles: true, removeSessions: true } })
  expect(server.maintenance.workspaces.map(row => row.ticketId)).toEqual(['t3'])
  expect(rows()).toHaveLength(1)
})

it('confirms nothing when the selection is emptied', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  await toggle(boxes()[0]!)
  expect(text()).toContain(zh.maintenanceSelected.replace('{count}', '0'))
  expect(find(zh.maintenanceClean).hasAttribute('disabled')).toBe(true)
  expect(server.requests.some(request => request.path === 'maintenance/clean')).toBe(false)
})
