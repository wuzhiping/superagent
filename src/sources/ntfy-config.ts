/**
 * ntfy Source configuration. Flat so the management panel can render every field. The server keeps history about 15 days,
 * so the read position is stored on the host. `pub_` topics are public and need no authentication; a private topic can be
 * protected with an account and password (HTTP Basic) or a bearer token.
 */
import { z } from 'zod'

export const DEFAULT_NTFY_URL = 'https://msn.feg.cn'

export const NtfyConfigSchema = z.object({
  baseUrl: z.string().trim().default(DEFAULT_NTFY_URL),
  /** The topic to read and publish to, e.g. `pub_<projectId>`; empty means the Source is not configured yet. */
  topic: z.string().trim().default(''),
  /** none for a public `pub_` topic; basic (account + password) or bearer for a protected private topic. */
  authMode: z.enum(['none', 'basic', 'bearer']).default('none'),
  authUser: z.string().trim().default(''),
  authPassword: z.string().default(''),
  authToken: z.string().trim().default(''),
  /** The agent's handle: `@<agent>` in a message addresses it explicitly. */
  agent: z.string().trim().default('dsh-superagent'),
  /** `title` published for the agent's own messages (the ntfy-teams convention is `#name`). */
  sender: z.string().trim().default('#dsh-superagent'),
  pollSeconds: z.number().int().min(15).max(3600).default(60),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  maxMessages: z.number().int().min(1).max(500).default(100),
  /** `skip`: the first read starts now; `history`: the first read files the retained history as cards. */
  bootstrap: z.enum(['skip', 'history']).default('skip'),
}).strict()
export type NtfyConfig = z.infer<typeof NtfyConfigSchema>

export interface NtfyAuth { mode: 'none' | 'basic' | 'bearer'; user: string; password: string; token: string }
export interface NtfyAccount { baseUrl: string; topic: string; sender: string; auth: NtfyAuth }

/** The account fields a client needs, or undefined while the topic is unset. */
export function ntfyAccountOf(config: Record<string, unknown> | undefined): NtfyAccount | undefined {
  if (!config) return undefined
  const parsed = NtfyConfigSchema.safeParse(config)
  if (!parsed.success || !parsed.data.topic) return undefined
  const value = parsed.data
  return { baseUrl: value.baseUrl, topic: value.topic, sender: value.sender,
    auth: { mode: value.authMode, user: value.authUser, password: value.authPassword, token: value.authToken } }
}

/** The web page of a topic (the PWA subscribes there). */
export const ntfyTopicUrl = (baseUrl: string, topic: string): string => `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`
