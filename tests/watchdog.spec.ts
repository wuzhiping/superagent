import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { TurnOutcomes } from '../src/app/turn-outcomes.ts'
import { Watchdog, type WatchdogHost } from '../src/app/watchdog.ts'

const epoch = Date.parse('2026-09-21T08:00:00Z')
const event = (type: string, seq: number, data: unknown): SessionEvent => ({
  type, seq: SessionSeq(seq), time: epoch + seq * 1000, data,
}) as SessionEvent
const turnStart = (seq: number, turn: number) => event('turn/start', seq, { turn })
const turnEnd = (seq: number, turn: number, reason: unknown) => event('turn/end', seq, { turn, reason })
const spoke = (seq: number, turn: number) => event('assistant/message', seq, { turn, step: 1, message: { content: [] } })

it('marks a message lost when the turn that carried it failed without producing output', () => {
  const turns = new TurnOutcomes()
  turns.observe(turnStart(1, 7))
  turns.claimed('dsh-superagent:relay-1', 7)
  expect(turns.lost('dsh-superagent:relay-1')).toBe(false)
  turns.observe(turnEnd(2, 7, { kind: 'error', error: { code: 'RATE_LIMIT', message: 'Too many requests' } }))
  expect(turns.lost('dsh-superagent:relay-1')).toBe(true)
  expect(turns.turn(7)).toMatchObject({ outcome: 'error', spoke: false, failure: { code: 'RATE_LIMIT' } })
})

it('keeps a message that the model read before the turn failed', () => {
  const turns = new TurnOutcomes()
  turns.observe(turnStart(1, 3))
  turns.claimed('dsh-superagent:relay-2', 3)
  turns.observe(spoke(2, 3))
  turns.observe(turnEnd(3, 3, { kind: 'error', error: { code: 'SERVER', message: 'boom' } }))
  expect(turns.lost('dsh-superagent:relay-2')).toBe(false)
})

it('keeps a message of a turn that ended well', () => {
  const turns = new TurnOutcomes()
  turns.observe(turnStart(1, 1))
  turns.claimed('dsh-superagent:relay-3', 1)
  turns.observe(turnEnd(2, 1, { kind: 'completed' }))
  expect(turns.lost('dsh-superagent:relay-3')).toBe(false)
  expect(turns.turn(1)).toMatchObject({ outcome: 'completed' })
})

it('does not lose a message no turn claimed', () => {
  const turns = new TurnOutcomes()
  expect(turns.lost('dsh-superagent:relay-4')).toBe(false)
})

/** A watchdog host whose answers the test sets. */
interface FakeHost extends WatchdogHost {
  lost: { requestId: string; text: string }[]
  redelivered: string[]
  requeued: string[]
  working: boolean
  answered: boolean
  outage: boolean
}

function host (overrides: Partial<WatchdogHost> = {}): FakeHost {
  const h = {
    context: {} as WatchdogHost['context'], masterId: 'master',
    health: { get: () => undefined, set: vi.fn(), release: vi.fn() },
    reevaluate: (triggerId: string) => { h.requeued.push(triggerId); return true },
    redeliver: async (requestId: string) => { h.redelivered.push(requestId) },
    lostRelays: () => h.lost,
    droppedRequests: (): string[] => [],
    failing: () => h.outage,
    recovered: () => h.answered,
    busy: () => h.working,
    forget: vi.fn(),
    lost: [] as { requestId: string; text: string }[], redelivered: [] as string[], requeued: [] as string[],
    working: false, answered: true, outage: false,
    ...overrides,
  } as unknown as FakeHost
  return h
}

it('sends a lost relay again when the main Session is idle', async () => {
  const watchdogHost = host()
  watchdogHost.lost.push({ requestId: 'report:1', text: 'a worker report' })
  const watchdog = new Watchdog(watchdogHost)
  await watchdog.check()
  expect(watchdogHost.redelivered).toEqual(['report:1'])
})

it('judges the requests an outage dropped again, once the model answers', async () => {
  const watchdogHost = host({ droppedRequests: () => ['trigger-1', 'trigger-2'] })
  watchdogHost.outage = true
  const watchdog = new Watchdog(watchdogHost)
  await watchdog.check()
  expect(watchdogHost.requeued).toEqual(['trigger-1', 'trigger-2'])
})

it('waits for the model service instead of re-queuing while it is still failing', async () => {
  const watchdogHost = host({ droppedRequests: () => ['trigger-1'] })
  watchdogHost.answered = false
  watchdogHost.outage = true
  const watchdog = new Watchdog(watchdogHost)
  await watchdog.check()
  expect(watchdogHost.requeued).toEqual([])
})

it('judges a request the outage dropped again, and does not judge it twice', async () => {
  const watchdogHost = host({ droppedRequests: () => ['trigger-1'] })
  watchdogHost.outage = true
  const watchdog = new Watchdog(watchdogHost)
  await watchdog.check()
  await watchdog.check()
  expect(watchdogHost.requeued).toEqual(['trigger-1'])
})

it('leaves the main Session alone while it is working', async () => {
  const watchdogHost = host({ droppedRequests: () => ['trigger-1'] })
  watchdogHost.working = true
  const watchdog = new Watchdog(watchdogHost)
  await watchdog.check()
  expect(watchdogHost.requeued).toEqual([])
  expect(watchdogHost.redelivered).toEqual([])
})
