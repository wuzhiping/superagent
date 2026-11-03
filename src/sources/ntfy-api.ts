/**
 * Minimal ntfy client (read-only subset for the P2 skeleton). The self-hosted server returns NDJSON for history and does
 * not expose publisher identity in a message; parsing here keeps the observed payload shape explicit.
 */
import { z } from 'zod'

const TIMEOUT_MS = 30_000
export type NtfyFetch = (input: string, init?: RequestInit) => Promise<Response>

export class NtfyError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'NtfyError' }
}

/** One message as the server returns it in the `/<topic>/json` stream; deletes arrive as `message_delete` events. */
export const NtfyMessageSchema = z.looseObject({
  id: z.string().min(1),
  time: z.number().int(),
  expires: z.number().int().optional(),
  event: z.string().default('message'),
  topic: z.string().default(''),
  title: z.string().default(''),
  message: z.string().default(''),
  priority: z.number().int().optional(),
  tags: z.array(z.string()).default([]),
  content_type: z.string().optional(),
})
export type NtfyMessage = z.infer<typeof NtfyMessageSchema>

export interface NtfyAuth { mode: 'none' | 'basic' | 'bearer'; user: string; password: string; token: string }
export interface NtfyAccount { baseUrl: string; topic: string; auth: NtfyAuth; sender?: string | undefined }

/** The authorization header for the configured mode; empty for a public topic. */
export function ntfyAuthHeader(auth: NtfyAuth): Record<string, string> {
  if (auth.mode === 'basic' && auth.user) return { authorization: `Basic ${Buffer.from(`${auth.user}:${auth.password}`, 'utf8').toString('base64')}` }
  if (auth.mode === 'bearer' && auth.token) return { authorization: `Bearer ${auth.token}` }
  return {}
}

const errorText = (text: string, status: number): string => {
  try {
    const value = JSON.parse(text) as { error?: unknown }
    if (typeof value.error === 'string' && value.error) return `${value.error} (${status})`
  } catch { /* Not JSON; keep the status. */ }
  const trimmed = text.trim()
  return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `ntfy answered ${status}`
}

/**
 * Parses a `/<topic>/json?poll=1` response: one JSON object per line. `message_delete` events are tombstones whose
 * `sequence_id` names the deleted message; this server keeps returning the deleted `message` event too, so a tombstone
 * removes its message from the result no matter which line comes first (verified against msn.feg.cn).
 */
export function parseNtfyHistory(text: string): NtfyMessage[] {
  const deleted = new Set<string>()
  const messages: NtfyMessage[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let value: unknown
    try { value = JSON.parse(trimmed) } catch { continue }
    const envelope = z.looseObject({ event: z.string().default('message'), sequence_id: z.string().optional() }).safeParse(value)
    if (!envelope.success) continue
    if (envelope.data.event === 'message_delete') {
      if (envelope.data.sequence_id) deleted.add(envelope.data.sequence_id)
      continue
    }
    const parsed = NtfyMessageSchema.safeParse(value)
    if (parsed.success && parsed.data.event === 'message') messages.push(parsed.data)
  }
  return messages.filter(message => !deleted.has(message.id))
}

/** One ntfy server; tests substitute `fetch`. */
export class NtfyClient {
  private readonly base: string
  constructor(private readonly account: NtfyAccount, private readonly fetchImpl: NtfyFetch = (input, init) => fetch(input, init)) {
    this.base = account.baseUrl.replace(/\/+$/, '')
  }

  /** Reads the topic's recent history. `since` is a ntfy duration (e.g. `30m`, `3600s`) or `all`. */
  async history(since: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<NtfyMessage[]> {
    const query = new URLSearchParams({ poll: '1', since })
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    try {
      const response = await this.fetchImpl(`${this.base}/${encodeURIComponent(this.account.topic)}/json?${query}`, {
        method: 'GET', signal, headers: { accept: 'application/x-ndjson', ...ntfyAuthHeader(this.account.auth) },
      })
      const text = await response.text()
      if (!response.ok) throw new NtfyError(errorText(text, response.status), response.status)
      return parseNtfyHistory(text)
    } catch (caught) {
      if (options.signal?.aborted) throw caught
      if (caught instanceof NtfyError) throw caught
      throw new NtfyError(caught instanceof Error ? caught.message : String(caught))
    } finally { clearTimeout(timeout) }
  }

  /**
   * Publishes a message. This server does not parse a JSON body: the text is the plain body and the metadata travels in
   * the `Title`/`Priority`/`Tags` headers (verified against msn.feg.cn).
   */
  async publish(text: string, options: { title?: string; priority?: number; tags?: readonly string[]; signal?: AbortSignal } = {}): Promise<{ id?: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    try {
      const response = await this.fetchImpl(`${this.base}/${encodeURIComponent(this.account.topic)}`, {
        method: 'POST', signal,
        headers: { 'content-type': 'text/plain; charset=utf-8', accept: 'application/json',
          ...options.title ? { Title: options.title } : {}, ...options.priority ? { Priority: String(options.priority) } : {},
          ...options.tags?.length ? { Tags: options.tags.join(',') } : {}, ...ntfyAuthHeader(this.account.auth) },
        body: text,
      })
      const body = await response.text()
      if (!response.ok) throw new NtfyError(errorText(body, response.status), response.status)
      try { const parsed = JSON.parse(body) as { id?: unknown }; return typeof parsed.id === 'string' ? { id: parsed.id } : {} }
      catch { return {} }
    } catch (caught) {
      if (options.signal?.aborted) throw caught
      if (caught instanceof NtfyError) throw caught
      throw new NtfyError(caught instanceof Error ? caught.message : String(caught))
    } finally { clearTimeout(timeout) }
  }
}
