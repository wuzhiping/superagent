/** Probes repository and account CLIs, configures the worker execution environment and command shims, and tracks setup readiness. */
import type { Context } from '@deepseek-ai/cordis'
import { UserError } from '../core/index.ts'
import { SETUP_FIELDS, resolveDeployment, resolveFeishuBot, workerProbe, type Deployment, type Machine } from '../deployment.ts'
import { agentVariables, applyEnvironment, verifyEnvironment, withoutDirectory, workerBin, writeEnvironment } from '../infra/environment.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'
import { KaneoClient, KaneoError } from '../sources/kaneo-api.ts'
import { kaneoAccountOf, type KaneoAccount } from '../sources/kaneo-config.ts'
import { GiteaClient, GiteaError } from '../sources/gitea-api.ts'
import { giteaAccountOf, giteaHasAuth, repositoryOf, type GiteaAccount } from '../sources/gitea-config.ts'
import { NtfyClient, NtfyError } from '../sources/ntfy-api.ts'
import { ntfyAccountOf, type NtfyAccount } from '../sources/ntfy-config.ts'

export interface SetupHost {
  readonly context: Context
  readonly machine: Machine
  readonly lifetime: AbortSignal
  restart(): void
}

const setupFields = (settings: Settings) =>
  JSON.stringify(Object.entries(SETUP_FIELDS).map(([id, keys]) => keys.map(key => settings.sources[id]?.config[key] ?? '')))
export const setupChanged = (before: Settings, after: Settings): boolean => setupFields(before) !== setupFields(after)

/** Check that a saved Kaneo account can read its project board; the failure names the card that fixes it. */
async function verifyKaneo(account: KaneoAccount): Promise<void> {
  try {
    const client = new KaneoClient(account)
    await client.board(account.projectId)
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error)
    if (error instanceof KaneoError && (error.status === 401 || error.status === 403)) throw new SetupError('kaneoKeyRefused', { output })
    if (error instanceof KaneoError && error.status === 404) throw new SetupError('kaneoProjectUnreadable', { projectId: account.projectId, output })
    throw new SetupError('kaneoUnreachable', { output })
  }
}

/** Check that a saved Gitea account can read the repository, and that a supplied password/token logs in. */
async function verifyGitea(account: GiteaAccount): Promise<void> {
  const repo = repositoryOf(account.repository)
  if (!repo) throw new SetupError('giteaRepositoryUnreadable', { repository: account.repository || '(empty)', output: 'owner/name is required' })
  try {
    const client = new GiteaClient(account)
    // Anonymous is fine for a readable public repository; an account password or token must actually log in.
    if (giteaHasAuth(account)) await client.user()
    await client.repository(repo.owner, repo.name)
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error)
    if (error instanceof GiteaError && (error.status === 401 || error.status === 403)) throw new SetupError('giteaKeyRefused', { output })
    if (error instanceof GiteaError && error.status === 404) throw new SetupError('giteaRepositoryUnreadable', { repository: account.repository, output })
    throw new SetupError('giteaUnreachable', { output })
  }
}

/** Check that a saved ntfy topic is readable with the configured authentication. */
async function verifyNtfy(account: NtfyAccount): Promise<void> {
  try {
    const client = new NtfyClient(account)
    await client.history('1s', { limit: 1 })
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error)
    if (error instanceof NtfyError && (error.status === 401 || error.status === 403)) throw new SetupError('ntfyTopicUnreadable', { topic: account.topic, output })
    throw new SetupError('ntfyUnreachable', { output })
  }
}

/**
 * Resolves the target repository, GitHub account, and optional Feishu bot by probing CLIs, then writes and applies the isolated git and shim environment used by worker processes.
 * `Runtime` runs it at startup to gate orchestration readiness, while `Settings` uses it to validate account changes, update blocked command shims, and schedule restarts.
 */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  feishuProblem?: SetupProblem
  /** PATH with the worker shim directory removed so the host's own CLI calls invoke the real binaries. */
  private readonly path: string
  /** Environment variables pointing agent subprocesses at the isolated git config and command shims. */
  private readonly variables: Record<string, string | undefined>
  private restoreEnvironment?: () => void
  constructor(private readonly host: SetupHost) {
    this.path = withoutDirectory(process.env.PATH ?? '', workerBin(host.machine.stateDir))
    this.variables = agentVariables(host.machine.stateDir)
  }
  /** Host command environment with agent git variables applied and the worker shim directory excluded from PATH. */
  get commandEnvironment(): Record<string, string | undefined> { return { ...this.variables, PATH: this.path } }
  get deployment(): Deployment {
    if (!this.resolved) throw new Error(`dsh-superagent is waiting for setup: ${this.problem?.detail ?? 'setup has not run'}`)
    return this.resolved
  }
  configured(): boolean { return this.resolved !== undefined }
  /** Resolve deployment accounts and apply the worker environment, recording `SetupError` failures in `problem`/`feishuProblem` and rethrowing unexpected errors. */
  async run(settings: Settings): Promise<boolean> {
    try { this.resolved = await this.resolve(settings); return true }
    catch (error) {
      if (!(error instanceof SetupError)) throw error
      this.problem = error.problem
      return false
    }
  }
  /** Trigger a restart to re-run setup, refusing if setup and Feishu are already healthy so running assignments are not interrupted. */
  check(): void {
    if (this.configured() && !this.feishuProblem) throw new UserError('setupComplete')
    this.restart()
  }
  /** Defer the restart to the next macrotask so the current HTTP or tool caller receives its response first. */
  restart(): void { setTimeout(this.host.restart, 0) }
  /** Verify account CLIs for a modified source block before saving, ignoring setup errors belonging to other blocks. */
  async checkAccounts(block: SettingsBlock, settings: Settings): Promise<void> {
    const { machine } = this.host
    // The REST-backed sources have no CLI identity: their saved accounts are checked over their own APIs.
    if (block === 'source:kaneo') {
      const instance = settings.sources.kaneo
      if (!instance || instance.enabled === false) return
      const account = kaneoAccountOf(instance.config)
      if (!account) throw new SetupError('kaneoKeyUnset')
      await verifyKaneo(account)
      return
    }
    if (block === 'source:gitea') {
      const instance = settings.sources.gitea
      if (!instance || instance.enabled === false) return
      const account = giteaAccountOf(instance.config)
      if (!account) throw new SetupError('giteaRepositoryUnreadable', { repository: '(empty)', output: 'owner/name is required' })
      await verifyGitea(account)
      return
    }
    if (block === 'source:ntfy') {
      const instance = settings.sources.ntfy
      if (!instance || instance.enabled === false) return
      const account = ntfyAccountOf(instance.config)
      if (!account) throw new SetupError('ntfyTopicUnreadable', { topic: '(empty)', output: 'a topic is required' })
      await verifyNtfy(account)
      return
    }
    const check = block === 'source:feishu' ? resolveFeishuBot(machine, settings.sources.feishu?.config, this.probe())
      : resolveDeployment(machine, settings.sources.github?.config, this.probe())
    await check.catch((error: unknown) => { if (!(error instanceof SetupError) || error.place === block.slice(7)) throw error })
  }
  async blockCommands(blocked: readonly string[]): Promise<void> {
    // Only a deployment with a GitHub account writes and rewrites the worker shims.
    if (this.resolved?.github.cli) await writeEnvironment(this.resolved, blocked)
  }
  restore(): void { this.restoreEnvironment?.(); this.restoreEnvironment = undefined }
  /** Probes CLIs the way worker shells run them, using `stateDir` as `cwd` since it exists even before the repository clone is valid. */
  private probe() {
    const { context, machine, lifetime } = this.host
    return workerProbe(context.subprocess, machine.stateDir, machine.stateDir, lifetime)
  }
  private async resolve(settings: Settings): Promise<Deployment> {
    const { context, machine, lifetime } = this.host
    const probe = this.probe()
    const kaneo = kaneoAccountOf(settings.sources.kaneo?.enabled === false ? undefined : settings.sources.kaneo?.config)
    const gitea = giteaAccountOf(settings.sources.gitea?.enabled === false ? undefined : settings.sources.gitea?.config)
    const ntfy = ntfyAccountOf(settings.sources.ntfy?.enabled === false ? undefined : settings.sources.ntfy?.config)
    const deployment = await resolveDeployment(machine, settings.sources.github?.config, probe, undefined, kaneo, gitea, ntfy)
    // Without an API key/token/topic no REST-backed Source is configured, so only the GitHub checks above can have succeeded.
    if (kaneo) await verifyKaneo(kaneo)
    if (gitea) await verifyGitea(gitea)
    if (ntfy) await verifyNtfy(ntfy)
    const feishu = await resolveFeishuBot(machine, settings.sources.feishu?.config, probe).catch((error: unknown) => {
      if (!(error instanceof SetupError)) throw error
      this.feishuProblem = error.problem
      context.logger.warn('dsh-superagent leaves Feishu out: %s', error.message)
      return undefined
    })
    const resolved = { ...deployment, ...(feishu ? { feishu } : {}) }
    const machineProblem = (error: unknown): never => {
      if (error instanceof SetupError) throw error
      throw new SetupError('environmentFailed', { output: error instanceof Error ? error.message : String(error) })
    }
    // The shims and isolated git configuration bind workers to the GitHub account; a Kaneo-only deployment leaves the
    // operator's environment as it is instead of writing (and on Windows, failing to write) POSIX worker shims.
    if (resolved.github.cli) {
      await writeEnvironment(resolved, settings.executor.blockedCommands).catch(machineProblem)
      this.restoreEnvironment = applyEnvironment(this.variables, machine.stateDir, this.path)
      await verifyEnvironment(resolved, context.subprocess, lifetime).catch((error: unknown) => {
        this.restore()
        machineProblem(error)
      })
    }
    return resolved
  }
}
