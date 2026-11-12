/**
 * Tracks the outcome of each turn of the main Session, so a message the main Session was given can be judged by the
 * turn that carried it: a turn that ended in `error` (a model failure such as a spent rate-limit budget) or `aborted`
 * means the message was never processed, and the caller may send it again.
 *
 * The tracker reads the Session's own event log: `turn/start` opens a turn, `assistant/message` marks that the turn
 * produced model output, and `turn/end` closes it with its reason. A message is tied to the turn that claimed it, which
 * the host learns from the agent's `agent/inbox/claimed` event.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** How a turn ended; `error` and `aborted` mean its messages were not processed. */
export type TurnOutcome = 'completed' | 'error' | 'aborted' | 'blocked' | 'max-tokens' | 'interrupted' | 'forked' | 'open'

/** The failure a turn reported, when it reported one. */
export interface TurnFailure { code: string; message: string }

/** What the tracker knows about one turn. */
export interface TurnRecord {
  /** Whether the turn produced model output; a turn that failed before any output processed nothing. */
  spoke: boolean
  /** How the turn ended; `undefined` while it is still running. */
  outcome?: TurnOutcome
  /** The failure the turn reported, when it failed. */
  failure?: TurnFailure
}

/** Whether a turn's outcome means the messages it carried were not processed. */
export const failedTurn = (outcome: TurnOutcome | undefined): boolean => outcome === 'error' || outcome === 'aborted'

/**
 * Watches one Session's turns and the messages delivered into them. A message is tied to the turn that claimed it, so a
 * caller can ask whether the message it sent was processed: a turn that failed without producing output lost it.
 */
export class TurnOutcomes {
  private readonly turns = new Map<number, TurnRecord>()
  /** The turn each delivered message was claimed in, by the message's delivery id. */
  private readonly carried = new Map<string, number>()
  /** The turn currently running, if any. */
  private open?: number
  /** The last turn that ended, and whether a turn ended well after it. */
  private last?: { turn: number; outcome: TurnOutcome }
  /** Whether a turn ended well after the last failure. */
  private answered = false

  /** Records that the agent claimed a message into a turn; a message of another Session is ignored. */
  claimed(deliveryId: string, turn: number): void {
    this.carried.set(deliveryId, turn)
    if (!this.turns.has(turn)) this.turns.set(turn, { spoke: false })
  }

  /** Reads one event of the Session's log and applies it to the tracked turns. */
  observe(event: SessionEvent): void {
    const data = event.data as { turn?: unknown; reason?: unknown }
    if (event.type === 'turn/start') {
      if (typeof data.turn !== 'number') return
      this.open = data.turn
      if (!this.turns.has(data.turn)) this.turns.set(data.turn, { spoke: false })
      return
    }
    if (event.type === 'assistant/message') {
      if (typeof data.turn === 'number') {
        const record = this.turns.get(data.turn) ?? { spoke: false }
        record.spoke = true
        this.turns.set(data.turn, record)
      }
      return
    }
    if (event.type !== 'turn/end') return
    const reason = data.reason as { kind?: unknown; error?: { code?: unknown; message?: unknown } } | undefined
    const outcome = (typeof reason?.kind === 'string' ? reason.kind : 'error') as TurnOutcome
    const failure = outcome === 'error'
      ? { code: typeof reason?.error?.code === 'string' ? reason.error.code : 'UNKNOWN', message: typeof reason?.error?.message === 'string' ? reason.error.message : '' }
      : undefined
    if (typeof data.turn !== 'number') return
    this.open = undefined
    const record = this.turns.get(data.turn) ?? { spoke: false }
    record.outcome = outcome
    record.failure = failure
    this.turns.set(data.turn, record)
    this.last = { turn: data.turn, outcome }
    // A turn that ended well after a failed one means the model service answers again.
    if (outcome === 'completed') this.answered = true
  }

  /** The turn a message was claimed in, or `undefined` when no turn claimed it yet. */
  turnOf(deliveryId: string): number | undefined { return this.carried.get(deliveryId) }

  /** What is known about a turn. */
  turn(turn: number): TurnRecord | undefined {
    const record = this.turns.get(turn)
    return record ? { ...record } : undefined
  }

  /** Whether a delivered message was carried by a turn that failed without producing output, so it was never processed. */
  lost(deliveryId: string): boolean {
    const turn = this.carried.get(deliveryId)
    if (turn === undefined) return false
    const record = this.turns.get(turn)
    if (!record?.outcome || !failedTurn(record.outcome)) return false
    return !record.spoke
  }

  /** Whether the last turn ended in failure, which means the model service did not answer. */
  failing(): boolean { return this.last !== undefined && failedTurn(this.last.outcome) }

  /** Whether a turn ended well after the last failure, which means the model service answers again. */
  recovered(): boolean { return this.answered }

  /** Forgets a message the caller will not send again. */
  forget(deliveryId: string): void { this.carried.delete(deliveryId) }
}
