/** Structured startup and configuration errors with the settings location where the operator can fix them. */
import { fill } from './infra/text.ts'

export type SetupPlace = 'deployment' | 'github' | 'feishu' | 'kaneo' | 'gitea' | 'ntfy'
export const SETUP_PROBLEMS = {
  foreignFile: ['deployment', '{file} was not written by dsh-superagent; move it, or choose another state directory.'],
  gitTooOld: ['deployment', 'git does not read the github.com credential configuration dsh-superagent writes; dsh-superagent needs git 2.32 or later.'],
  environmentFailed: ['deployment', 'Preparing the agent environment failed.'],
  sourceUnset: ['deployment', 'No Source is configured: set the Kanban card (server, API key, project id) or the GitHub card.'],
  repositoryUnset: ['github', 'The GitHub Source names no repository.'],
  agentCliUnset: ['github', 'The agent GitHub CLI is not set.'],
  agentCliMissing: ['github', 'The agent GitHub CLI was not found.'],
  agentCliSignedOut: ['github', 'The agent GitHub CLI cannot read its account.'],
  agentCliNoAccount: ['github', 'The agent GitHub CLI did not report a GitHub account.'],
  repositoryUnreadable: ['github', '@{account} cannot read {repository}.'],
  repositoryUnreported: ['github', 'The agent GitHub CLI did not return {repository}.'],
  repositoryReadOnly: ['github', '@{account} cannot push to {repository}.'],
  feishuCliFailed: ['feishu', 'The bot lark-cli does not work.'],
  feishuNoApp: ['feishu', 'auth status of the bot lark-cli did not report the app.'],
  feishuBotNotReady: ['feishu', 'The bot identity of app {app} is {status}; configure the app secret with lark-cli.'],
  feishuUserIdentity: ['feishu', 'The bot lark-cli allows user identities (strict mode {mode}); give the bot its own lark-cli configuration in strict mode bot, as docs/006-deployment.md describes.'],
  feishuNoBot: ['feishu', 'The Feishu bot API did not return the bot\'s open_id.'],
  kaneoKeyUnset: ['kaneo', 'The Kanban Source is on and its API key is not set.'],
  kaneoKeyRefused: ['kaneo', 'The Kanban API refused the API key: {output}'],
  kaneoProjectUnreadable: ['kaneo', 'The Kanban API could not read project {projectId}: {output}'],
  kaneoUnreachable: ['kaneo', 'The Kanban API did not answer: {output}'],
  giteaKeyRefused: ['gitea', 'The Gitea API refused the token or account password: {output}'],
  giteaCredentialsUnset: ['gitea', 'The Gitea Source has no account password or API token.'],
  giteaRepositoryUnreadable: ['gitea', 'The Gitea repository {repository} is not readable: {output}'],
  giteaUnreachable: ['gitea', 'The Gitea API did not answer: {output}'],
  ntfyTopicUnreadable: ['ntfy', 'The ntfy topic {topic} is not readable: {output}'],
  ntfyUnreachable: ['ntfy', 'The ntfy server did not answer: {output}'],
} as const satisfies Record<string, readonly [SetupPlace, string]>
export type SetupCode = keyof typeof SETUP_PROBLEMS
export interface SetupProblem { place: SetupPlace; code: SetupCode; values: Record<string, string>; detail: string }

/**
 * Thrown by deployment and account verification checks when a required CLI, account, or repository check fails.
 * `Setup` records it for the management overview, and the HTTP layer returns `problem` so the panel can localize it.
 */
export class SetupError extends Error {
  readonly place: SetupPlace
  constructor(readonly code: SetupCode, readonly values: Record<string, string> = {}) {
    const [place, text] = SETUP_PROBLEMS[code]
    const sentence = fill(text, values)
    super(values.output ? `${sentence}\n${values.output}` : sentence)
    this.place = place
  }
  get problem(): SetupProblem { return { place: this.place, code: this.code, values: this.values, detail: this.message } }
}
