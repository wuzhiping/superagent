/**
 * The Kanban account behind this Host and the management rights that come with it.
 *
 * The PM seat manages the board's flow, and that right lives in Kanban: only a workspace admin may change a
 * project's columns, while a plain member may only work the cards (RD.md §4.1). The panel therefore asks the host
 * who this Host is before it lets someone sit as PM, and says so where the PM works when the right is missing.
 *
 * The panel writes its own words about the account and the right it lacks; the host's own sentence is shown as the
 * host's words, and only where the panel cannot say it itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Capabilities } from '../app/capabilities.ts'
import { usePerspective } from './perspective.tsx'
import { usePanel } from './provider.tsx'
import type { T } from './text.ts'

/** How often the panel re-reads the rights: an admin may grant them while the panel is open. */
const REFRESH_MS = 30_000

export interface CapabilitiesState {
  /** What the host answered; undefined while the first answer is on its way. */
  capabilities: Capabilities | undefined
  /** Why the host could not answer; the last known rights stay on screen. */
  error: Error | undefined
  /** Reads the rights again; the panel asks the host when the reader changes seat. */
  check: () => Promise<Capabilities | undefined>
}
const CapabilitiesContext = createContext<CapabilitiesState | undefined>(undefined)

export function useCapabilities(): CapabilitiesState {
  const value = useContext(CapabilitiesContext)
  if (!value) throw new Error('dsh-superagent page rendered outside its capabilities')
  return value
}

/** Holds the Kanban account of this Host and the rights it has; the panel reads them where the PM works. */
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { call } = usePanel()
  const { perspective } = usePerspective()
  const [state, setState] = useState<{ data?: Capabilities; error?: Error }>({})
  const check = useCallback(async (): Promise<Capabilities | undefined> => {
    try {
      const value = await call('GET capabilities')
      setState({ data: value })
      return value
    } catch (failure) {
      setState(current => ({ ...current, error: failure instanceof Error ? failure : new Error(String(failure)) }))
      return undefined
    }
  }, [call])
  useEffect(() => {
    // The rights matter in the PM seat; a post only needs an account to work its cards.
    if (perspective !== 'pm') return
    void check()
    const timer = setInterval(() => { void check() }, REFRESH_MS)
    return () => clearTimeout(timer)
  }, [check, perspective])
  const value = useMemo(() => ({ capabilities: state.data, error: state.error, check }),
    [state.data, state.error, check])
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
}

/**
 * The lines the panel says about the account's rights: which account it is, what that account may not do, and the
 * way out. The account and its role come from the host as facts; the wording is the panel's own.
 */
export function permissionLines(t: T, capabilities: Capabilities): string[] {
  const account = capabilities.account
  return [
    account ? t('permissionAccount', { name: account.name, role: account.role }) : t('permissionNoAccount'),
    account
      ? t('permissionWhy', { role: account.role })
      // Without an account the panel cannot say why itself, so the host's own sentence is shown as the host's words.
      : capabilities.reason ? t('permissionHostReason', { reason: capabilities.reason }) : '',
    account ? t('permissionNext') : t('permissionNextAccount'),
  ].filter(Boolean)
}

/**
 * The banner the PM perspective shows when this Host's Kanban account may not manage the board's flow: it names the
 * account and its role, says what is missing, and says what to do about it.
 */
export function PermissionBanner() {
  const { t } = usePanel()
  const { perspective } = usePerspective()
  const { capabilities } = useCapabilities()
  // A post only works its own cards; the management rights of the PM seat are none of its business.
  if (perspective !== 'pm' || !capabilities || capabilities.canManageFlow) return null
  return <p className="dt-banner dt-permission" role="status">
    <span className="dt-banner-label">{t('permissionTitle')}</span>
    {permissionLines(t, capabilities).map(line => <span key={line}>{line}</span>)}
  </p>
}
