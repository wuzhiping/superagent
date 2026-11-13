/**
 * The Superagent sidebar icon: the entry a person clicks to open the panel, with the main Session's own state as a
 * light at the icon's bottom-right corner.
 *
 * The host gives this slot only the icon seat (`sidebar.panellist`), and its glyph container is a plain
 * `display: inline-flex` with no positioning context, so the icon is wrapped in a `position: relative` holder and the
 * light is placed against that holder instead of against the sidebar row, which the plugin cannot reach.
 */
import { useEffect, useState } from 'react'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { caller, type ApiMessages, type StateView } from './api.ts'
import type { T } from './text.ts'

/** What the light says: green while the main Session works, amber while it waits, red when the model service failed it. */
export type SessionLight = 'running' | 'idle' | 'error' | 'unknown'

/** How often the light asks the host for the main Session's state. */
const INTERVAL_MS = 10_000

/**
 * The light a reported main-Session state shows: `running` green, `idle` amber, `error` red, and no answer at all a
 * neutral light, since a host that cannot be reached has no state to show rather than a good one.
 */
export function sessionLight(session: StateView['session'] | undefined): SessionLight {
  switch (session?.status) {
    case 'running': return 'running'
    case 'idle': return 'idle'
    case 'error': return 'error'
    default: return 'unknown'
  }
}

/** The failure messages of the shared client, which the light never shows: it only reads the state. */
const MESSAGES: ApiMessages = {
  offline: 'dsh-superagent is not reachable', notRunning: 'dsh-superagent is not running',
  serverError: status => `dsh-superagent answered ${status}`, requestFailed: status => `dsh-superagent refused the request (${status})`,
  setup: () => 'dsh-superagent is waiting for setup', user: failure => failure.code,
}

/** Polls the host for the main Session's state, and reports no state while the host cannot be reached. */
function useMainSession(): StateView['session'] | undefined {
  const [session, setSession] = useState<StateView['session']>()
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const call = caller(() => MESSAGES)
    const once = async (): Promise<void> => {
      clearTimeout(timer)
      try {
        const state = await call('GET state')
        if (active) setSession(state.session)
      } catch {
        // An unreachable host has no state to show; the light goes neutral instead of keeping a stale colour.
        if (active) setSession(undefined)
      } finally {
        if (active) timer = setTimeout(() => { void once() }, document.hidden ? INTERVAL_MS * 4 : INTERVAL_MS)
      }
    }
    void once()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  return session
}

/** Sidebar icon colour, matched to the red used by the MCP gateway icon. */
const ICON_COLOR = '#EB3147'

function HammerGlyph({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR} strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: ICON_COLOR }}>
    <path d="M6 3.5h9l3.5 1.75v2.5L15 9.5H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M10 9.5v10.25a1.75 1.75 0 0 0 3.5 0V9.5" /><path d="M10 15.5h3.5" />
  </svg>
}

/** The colour of each light: the host's own state tokens, so the sidebar follows its theme. */
const LIGHT_COLOUR: Record<SessionLight, string> = {
  running: 'var(--dsw-alias-state-success-primary, #22c55e)',
  idle: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  error: 'var(--dsw-alias-state-error-primary, #f25a5a)',
  unknown: 'var(--dsw-alias-label-quaternary, #9ca3af)',
}

/**
 * The sidebar entry: the hammer, and a light at its bottom-right corner naming the main Session's state.
 *
 * The styles are inline rather than in `client.css`: the panel injects that stylesheet only while it is mounted, and this
 * icon lives in the sidebar, outside the panel, so a class here would have no styles until the panel was opened.
 * @param props - the icon seat's `size`, plus the bound translator for the light's words.
 */
export function SidebarIcon({ size = 18, t }: SidebarPanelIconOwnerProps & { t: T }) {
  const light = sessionLight(useMainSession())
  const label = `${t('mainSession')}：${t(`mainSessionState.${light}`)}`
  return <span title={label} data-light={light} style={{ position: 'relative', display: 'inline-flex' }}>
    <HammerGlyph size={size} />
    <span role="img" aria-label={label} data-state={light} style={{
      position: 'absolute', right: -2, bottom: -2, width: 7, height: 7, borderRadius: '50%', pointerEvents: 'none',
      background: LIGHT_COLOUR[light], boxShadow: '0 0 0 1.5px var(--dsw-specific-sidebar-fill, transparent)',
    }} />
  </span>
}
