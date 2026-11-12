/**
 * Watches the main Session and restores the work a model failure took from it.
 *
 * A model failure (a spent rate-limit budget, a provider outage) ends the main Session's turn with `error`. Two things
 * are then lost, and nothing restores them: the relay the failed turn carried was never read, and the evaluation whose
 * candidate card it carried was never judged — after the evaluation's own retries it is recorded `unavailable`, and the
 * request is gone. The host looks idle even though work is waiting, and the model service being back changes nothing.
 *
 * This watchdog restores both: it sends a lost relay again, and it re-queues the requests an outage dropped, once the
 * model answers again.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HealthEntry } from '../infra/health.ts'

/** What the watchdog needs from the host to notice the loss and to restore it. */
export interface WatchdogHost {
  /** DSH Cordis context, for the agent registry and the Session events. */
  readonly context: Context
  /** The main Session's id. */
  readonly masterId: string
  /** The `watchdog` health entry, which reports what the watchdog did. */
  readonly health: HealthEntry
  /** Queues a Trigger for a fresh evaluation, as a person's "evaluate again" does. */
  reevaluate(triggerId: string): boolean
  /** Sends a relay to the main Session again, under a request id of its own. */
  redeliver(requestId: string, text: string): Promise<void>
  /** The relays whose turn ended in failure, so the main Session never read them. */
  lostRelays(): { requestId: string; text: string }[]
  /** The Triggers whose evaluation was recorded unavailable while the model service was failing. */
  droppedRequests(): string[]
  /** Whether the model service did not answer the last time the main Session asked it. */
  failing(): boolean
  /** Whether the model service answers again after the last failure. */
  recovered(): boolean
  /** Whether the main Session is currently working. */
  busy(): boolean
  /** Forgets a relay the watchdog will not send again. */
  forget(requestId: string): void
}

/** How long the watchdog waits between checks. */
const INTERVAL_MS = 15_000

/**
 * Restores the work a model failure took from the main Session. The check runs on a timer: while the model service is
 * still failing, it only reports the outage; once the model answers again, it sends the lost relays again and re-queues
 * the requests the outage dropped.
 */
export class Watchdog {
  private timer?: ReturnType<typeof setInterval>
  /** The requests this watchdog already re-queued, so an outage cannot make it repeat itself. */
  private readonly restored = new Set<string>()

  constructor(private readonly host: WatchdogHost) {}

  /** Starts the periodic check; call once at startup. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.check() }, INTERVAL_MS)
    this.timer.unref?.()
  }

  /** Stops the periodic check. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** One check: restores what the model failure took from the main Session. */
  async check(): Promise<void> {
    if (this.host.busy()) return
    const relays = this.host.lostRelays()
    if (relays.length) {
      // A relay whose turn failed was never read; it is sent again, under its own request id, so it is delivered rather
      // than skipped as the one already delivered.
      for (const relay of relays) {
        await this.host.redeliver(relay.requestId, relay.text)
        this.host.forget(relay.requestId)
      }
      this.report(`The main Session's turn failed: ${relays.length} relay(s) sent again`)
      return
    }
    if (!this.host.failing()) { this.report('The main Session is working and no work was lost'); return }
    if (!this.host.recovered()) { this.report('The model service is not answering; the main Session waits for it'); return }
    const dropped = this.host.droppedRequests().filter(triggerId => !this.restored.has(triggerId))
    if (!dropped.length) { this.report('The main Session is working and no work was lost'); return }
    // The model answers again, so the requests the outage dropped are judged again.
    for (const triggerId of dropped) {
      if (this.host.reevaluate(triggerId)) this.restored.add(triggerId)
    }
    this.report(`${dropped.length} request(s) the outage dropped are judged again`)
  }

  /** Reports what the watchdog did, so the panel shows the loss instead of silence. */
  private report(detail: string): void {
    this.host.health.set({ state: 'ready', detail, at: new Date().toISOString() })
  }
}
