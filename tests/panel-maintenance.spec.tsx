// @vitest-environment jsdom
// The cleanup page: ended duties sorted by size, preselected unless they carry a deliverable, and cleaned only after a
// person confirms the dialog.
import { act } from 'react'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, click, text, settle } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
const rows = () => all('.dt-maintenance-table tbody tr')
const boxes = () => rows().map(row => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
const toggle = async (input: HTMLInputElement) => { await act(async () => { input.click() }); await settle() }

it('lists ended duties by size, preselects the ones without a deliverable, and cleans only them after confirmation', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  expect(server.requests.some(request => request.path === 'maintenance')).toBe(true)
  const cells = rows().map(row => row.querySelector('td:nth-child(2)')?.textContent ?? '')
  expect(cells).toHaveLength(3)
  expect(cells[0]).toContain('旧工单')
  expect(cells[1]).toContain('已合并的工单')
  expect(cells[2]).toContain('目录已消失')
  // The deliverable is marked, its row is not checked by default, and a row without a directory cannot be selected.
  expect(text()).toContain(zh.maintenanceDeliverable)
  expect(boxes().map(box => box.checked)).toEqual([true, false, false])
  expect(boxes()[2]!.disabled).toBe(true)
  expect(text()).toContain(zh.maintenanceSelected.replace('{count}', '1'))
  await click(find(zh.maintenanceClean))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.maintenanceConfirmKeepFiles)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.maintenanceConfirmSessions)
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'maintenance/clean'))
    .toMatchObject({ method: 'POST', body: { ticketIds: ['t0'], removeFiles: false } })
  expect(server.maintenance.workspaces.map(row => row.ticketId)).toEqual(['t3', 't6'])
  expect(rows()).toHaveLength(2)
})

it('deletes the folder only when the separate option is checked, and says how many bytes that removes', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  expect(boxes()[0]!.checked).toBe(true)
  await toggle(all('.dt-maintenance-option input')[0] as HTMLInputElement)
  expect(server.requests.find(request => request.path === 'maintenance/clean')).toBeUndefined()
  await click(find(zh.maintenanceClean))
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog?.textContent).toContain(zh.maintenanceConfirmFiles)
  expect(dialog?.textContent).toContain(zh.maintenanceConfirmBytes.replace('{size}', '3.0 MB'))
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'maintenance/clean'))
    .toMatchObject({ method: 'POST', body: { ticketIds: ['t0'], removeFiles: true } })
  expect(server.maintenance.workspaces.map(row => row.ticketId)).toEqual(['t3', 't6'])
})

it('confirms nothing when the selection is emptied', async () => {
  await mount()
  await click(zh['tab.maintenance'])
  await toggle(boxes()[0]!)
  expect(text()).toContain(zh.maintenanceSelected.replace('{count}', '0'))
  expect(find(zh.maintenanceClean).hasAttribute('disabled')).toBe(true)
  expect(server.requests.some(request => request.path === 'maintenance/clean')).toBe(false)
})
