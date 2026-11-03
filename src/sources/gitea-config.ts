/** Gitea Source configuration: the account fields deployment resolves and the kind's full schema. No Node-only imports. */
import { z } from 'zod'

export const DEFAULT_GITEA_URL = 'https://git.feg.cn'

/** Account fields deployment setup reads (the password/token never leaves the host process or Session text). */
export const GiteaAccountSchema = z.object({
  baseUrl: z.string().trim().default(DEFAULT_GITEA_URL),
  /** The agent account, by login or e-mail; with `password` this is the normal Gitea API login. */
  user: z.string().trim().default(''),
  password: z.string().default(''),
  /** Optional API token (for a 2FA account or a CI bot); when set it takes the place of user/password. */
  token: z.string().trim().default(''),
  /** `owner/name`; empty means the Source is not configured yet. */
  repository: z.string().trim().regex(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?$/, 'owner/name').default(''),
})
export type GiteaAccount = z.infer<typeof GiteaAccountSchema>

/**
 * One Gitea repository as a Source. It reads the agent account's notifications (token) or repository-wide issue/comment
 * increments, turns addressed events into Triggers, and posts replies as issue/PR comments.
 */
export const GiteaConfigSchema = GiteaAccountSchema.extend({
  /** `notifications`: the agent account's notifications (needs a token); `repo`: repository-wide increments. */
  listen: z.enum(['notifications', 'repo']).default('repo'),
  /** The agent's Gitea login; an event that mentions `@{agent}` is an explicit request. */
  agent: z.string().trim().default('dsh-superagent'),
  /** Comma-separated logins treated as bots (they can produce inferred candidates only). */
  bots: z.string().trim().default(''),
  observeIssues: z.boolean().default(true),
  observePulls: z.boolean().default(true),
  observeComments: z.boolean().default(true),
  /** `skip`: the first poll records a baseline; `trigger`: the first poll reports what is already there. */
  bootstrap: z.enum(['skip', 'trigger']).default('skip'),
  pollSeconds: z.number().int().min(15).max(3600).default(60),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  maxItems: z.number().int().min(1).max(200).default(50),
}).strict()
export type GiteaConfig = z.infer<typeof GiteaConfigSchema>

/** The account fields of a stored Gitea Source config, or undefined while no repository is configured. */
export function giteaAccountOf(stored: Record<string, unknown> | undefined): GiteaAccount | undefined {
  if (!stored) return undefined
  const parsed = GiteaAccountSchema.safeParse(stored)
  return parsed.success && parsed.data.repository ? parsed.data : undefined
}

/** Whether the account can authenticate: a token, or a login and password. */
export const giteaHasAuth = (config: Pick<GiteaAccount, 'user' | 'password' | 'token'>): boolean =>
  !!config.token || (!!config.user && !!config.password)

/** Split `owner/name`, or undefined when the repository is unset or malformed. */
export function repositoryOf(value: string): { owner: string; name: string } | undefined {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value.trim())
  return match ? { owner: match[1]!, name: match[2]! } : undefined
}

/** Comma-separated bot logins. */
export const botsOf = (config: Pick<GiteaConfig, 'bots'>): string[] => config.bots.split(',').map(item => item.trim()).filter(Boolean)
/** Whether a Gitea login is a bot: an explicit list entry or the `[bot]` suffix. */
export const giteaBot = (login: string, config: Pick<GiteaConfig, 'bots'>): boolean =>
  /\[bot\]$/.test(login) || botsOf(config).includes(login)

/** The web page of a repository, issue or pull request. */
export const giteaRepoUrl = (config: Pick<GiteaConfig, 'baseUrl' | 'repository'>): string => {
  const base = config.baseUrl.replace(/\/+$/, '')
  return config.repository ? `${base}/${config.repository}` : base
}
