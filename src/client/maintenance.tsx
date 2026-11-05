/**
 * The Cleanup page: audits what each ended duty left behind in its workspace and in Session persistence, and cleans a
 * workspace only after a person confirms the deliverable. Selection is stable across the page's background refresh:
 * rows start checked when they are removable and have no deliverable, and a person's own toggles win.
 */
import { useState } from 'react'
import { usePoll, type MaintenanceRow } from './api.ts'
import { Button, Icon, Modal, Tag } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { LoadState, Section, When } from './widgets.tsx'
import type { T } from './text.ts'

/** Formats a byte count with at most one decimal place. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024, index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}
/** The localized sentence for one finding code. */
const reasonText = (t: T, reasons: MaintenanceRow['reasons']): string =>
  reasons.map(reason => t(`maintenance.reason.${reason}`)).join(t('listSeparator'))
/** The size cell: a capped scan reads as a lower bound. */
const sizeText = (t: T, row: MaintenanceRow): string =>
  row.sizeCapped ? t('maintenanceSizeCapped', { size: formatBytes(row.sizeBytes) }) : formatBytes(row.sizeBytes)

export function MaintenancePage() {
  const { t, call, notify } = usePanel()
  // Audit runs on demand and on a slow poll: walking workspace sizes is heavier than the other pages' reads.
  const { data, error, reload } = usePoll(() => call('GET maintenance'), [], 30_000)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [removeFiles, setRemoveFiles] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const view = data
  const rows = view?.workspaces ?? []
  const defaultChecked = (row: MaintenanceRow): boolean => row.removable && !row.deliverable
  const checked = (row: MaintenanceRow): boolean => row.removable && (overrides[row.ticketId] ?? defaultChecked(row))
  const selected = rows.filter(row => checked(row))
  const removable = rows.filter(row => row.removable)
  const allChecked = removable.length > 0 && removable.every(row => checked(row))
  const setOne = (row: MaintenanceRow, next: boolean) => setOverrides(current => ({ ...current, [row.ticketId]: next }))
  const setAll = (next: boolean) => setOverrides(current => ({ ...current,
    ...Object.fromEntries(removable.map(row => [row.ticketId, next])) }))
  // The confirmation names what will actually disappear: bytes only when the folder removal is checked.
  const bytes = selected.reduce((sum, row) => sum + row.sizeBytes, 0)
  const workspaces = selected.filter(row => row.workspaceId).length
  const confirm = async () => {
    if (!selected.length || busy) return
    setBusy(true)
    try {
      const result = await call('POST maintenance/clean', { body: { ticketIds: selected.map(row => row.ticketId), removeFiles } })
      setConfirming(false)
      setOverrides({})
      setRemoveFiles(false)
      notify(t('maintenanceCleaned', { cleaned: result.cleaned.length, skipped: result.skipped.length }))
      await reload()
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure))
    } finally { setBusy(false) }
  }
  const action = <div className="dt-maintenance-bar">
    <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} onClick={() => { void reload() }}>{t('maintenanceRefresh')}</Button>
    <label className="dt-maintenance-option">
      <input type="checkbox" className="dt-maintenance-check" aria-label={t('maintenanceRemoveFiles')} checked={removeFiles}
        onChange={event => setRemoveFiles(event.target.checked)} />{t('maintenanceRemoveFiles')}
    </label>
    <span className="dt-maintenance-count">{t('maintenanceSelected', { count: selected.length })}</span>
    <Button variant="primary" size="sm" icon={<Icon name="trash" size={14} />} disabled={!selected.length} onClick={() => setConfirming(true)}>
      {t('maintenanceClean')}</Button>
  </div>
  return <Section title={t('tab.maintenance')} count={rows.length} hint={t('maintenanceIntro')}>
    <LoadState error={error} loading={!view} />
    {view && <>
      <p className="dt-hint">{t('maintenanceTotals', { count: view.totals.count, size: formatBytes(view.totals.bytes) })}</p>
      <ul className="dt-maintenance-notes">{view.notes.map(note => <li key={note}>{t(`maintenance.note.${note}`)}</li>)}</ul>
      {action}
      {rows.length ? <table className="dt-table dt-maintenance-table">
        <thead><tr>
          <th><input type="checkbox" className="dt-maintenance-check" aria-label={t('maintenanceSelectAll')} checked={allChecked}
            disabled={!removable.length} onChange={event => setAll(event.target.checked)} /></th>
          <th>{t('maintenanceColumnTicket')}</th><th>{t('maintenanceColumnState')}</th><th>{t('maintenanceColumnEnded')}</th>
          <th>{t('maintenanceColumnDirectory')}</th><th>{t('maintenanceColumnSize')}</th><th>{t('maintenanceColumnSessions')}</th>
          <th>{t('maintenanceColumnModified')}</th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.ticketId} data-removable={row.removable || undefined}
          data-deliverable={row.deliverable || undefined}>
          <td><input type="checkbox" className="dt-maintenance-check" aria-label={row.title} disabled={!row.removable} checked={checked(row)}
            onChange={event => setOne(row, event.target.checked)} /></td>
          <td><span className="dt-maintenance-ticket">{row.title}
            {row.deliverable && <Tag tone="warning" title={t('maintenanceDeliverableHint')}>{t('maintenanceDeliverable')}</Tag>}
            {!row.removable && <span className="dt-maintenance-reason" title={`${t('maintenanceReasonTitle')}: ${reasonText(t, row.reasons)}`}>
              {reasonText(t, row.reasons)}</span>}
          </span></td>
          <td>{row.outcome ? t(`outcome.${row.outcome}`) : t('ticket.ended')}</td>
          <td><When at={row.endedAt} /></td>
          <td className="dt-mono dt-maintenance-dir" title={row.files.join(t('listSeparator'))}>{row.directory}</td>
          <td>{sizeText(t, row)}</td>
          <td>{row.sessions}</td>
          <td>{row.lastModified ? <When at={row.lastModified} /> : t('empty')}</td>
        </tr>)}</tbody>
      </table> : <p className="dt-hint">{t('maintenanceEmpty')}</p>}
    </>}
    <Modal open={confirming} onClose={() => setConfirming(false)} title={t('maintenanceConfirmTitle')} closeLabel={t('close')}
      description={t('maintenanceConfirmIntro', { workspaces, count: selected.length })}
      footer={<>
        <Button variant="ghost" onClick={() => setConfirming(false)}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => { void confirm() }}>{t('confirm')}</Button>
      </>}>
      <p className="dt-hint">{removeFiles ? t('maintenanceConfirmFiles') : t('maintenanceConfirmKeepFiles')}</p>
      {removeFiles && <p className="dt-hint">{t('maintenanceConfirmBytes', { size: formatBytes(bytes) })}</p>}
      <p className="dt-hint">{t('maintenanceConfirmSessions')}</p>
    </Modal>
  </Section>
}
