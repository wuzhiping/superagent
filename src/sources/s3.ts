/**
 * MinIO/S3 Source kind: the object store where a project's non-code deliverables and data assets live. It is not a task
 * source — it produces no requests — so its job is to be configured (credentials default to this Host's storage record,
 * every field may be overridden) and to report whether the bucket is readable, so the panel can tell a PM that the
 * carrier the charter names really works.
 */
import type { Context } from '@deepseek-ai/cordis'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { Localized, SourceKind } from './kind.ts'
import { pause } from './poll.ts'
import { S3Client } from './s3-api.ts'
import { DEFAULT_S3_ENDPOINT, S3_STORAGE_NOTE, S3ConfigSchema, s3AccountOf, type S3Config } from './s3-config.ts'
import { storedConnections } from './bdd-storage.ts'

export const SOURCE = 's3'
export const STORAGE_RECORD = '/BDD/API/AI/dsh/storage/s3'

/** One probe of the card's bucket; the failure names what to fix on the card. */
export async function probeS3 (config: S3Config): Promise<string> {
  // The storage record supplies every field the card leaves empty; a plugin entry has its own provider instance, so
  // it warms the record itself (the call is a no-op while the ten-minute cache is fresh).
  await storedConnections.warm(['s3'])
  const account = s3AccountOf(config as unknown as Record<string, unknown>)
  if (!account) throw new Error('The object store is not configured: set the endpoint and bucket, or run as a user whose storage record carries them')
  return new S3Client(account).probe()
}

export const s3Kind: SourceKind<S3Config> = {
  kind: SOURCE,
  title: { zh: 'MinIO 对象存储', en: 'MinIO object storage' },
  description: {
    zh: '项目数据资产的补充载体（文档、方案、报表、导出）：非代码产出存在这里，卡片上只留进度与结果。默认使用本机存储记录里的连接（' + STORAGE_RECORD + '），每个字段都可以在卡片上改。它不产生任务。',
    en: 'The supplemental carrier for a project\'s data assets (documents, plans, reports, exports): non-code deliverables live here and the card keeps only progress and the result. Its connection defaults to this Host\'s storage record (' + STORAGE_RECORD + '), and every field may be overridden. It produces no tasks.',
  },
  schema: S3ConfigSchema,
  /** Settings-panel probe: read the entered bucket with the entered account (or the storage record's). */
  async test (config: S3Config): Promise<void> {
    await probeS3(config)
  },
  fields: [
    { key: 'endpoint', type: 'text', label: { zh: '服务地址', en: 'Endpoint' },
      hint: { zh: `例如 ${DEFAULT_S3_ENDPOINT}。${S3_STORAGE_NOTE}`, en: `For example ${DEFAULT_S3_ENDPOINT}. ${S3_STORAGE_NOTE}` } },
    { key: 'bucket', type: 'text', label: { zh: '桶（bucket）', en: 'Bucket' },
      hint: { zh: '交付物与资产所在的桶；留空用存储记录里的桶。', en: 'The bucket deliverables and assets live in; empty uses the storage record\'s bucket.' } },
    { key: 'accessKey', type: 'text', label: { zh: 'Access key', en: 'Access key' },
      hint: { zh: `留空用存储记录里的 UID，填写可覆盖。`, en: 'Empty uses the storage record\'s UID; a value overrides it.' } },
    { key: 'secretKey', type: 'password', label: { zh: 'Secret key', en: 'Secret key' },
      hint: { zh: '留空用存储记录里的密码；密钥只用于宿主进程，不进入提示词。', en: 'Empty uses the storage record\'s password; the key is host-process only and never enters prompts.' } },
    { key: 'region', type: 'text', advanced: true, label: { zh: 'Region（可选）', en: 'Region (optional)' },
      hint: { zh: '留空即自动探测：服务端拒绝签名时会告诉客户端它要哪个 region，客户端记住并重试。', en: 'Empty auto-detects it: a refused signature names the region the server wants, and the client remembers it and retries.' } },
    { key: 'prefix', type: 'text', advanced: true, label: { zh: '前缀（可选）', en: 'Prefix (optional)' },
      hint: { zh: '只看这个前缀下的对象；留空看整桶。', en: 'Only look under this prefix; empty reads the whole bucket.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 30, max: 3600, label: { zh: '巡检间隔 / 秒', en: 'Check interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20,
      label: { zh: '连续失败几次后报告异常', en: 'Failed checks before reporting an error' } },
  ],
  health: ['s3'],
}

/** Checks the store on an interval; a card that names nothing stays paused instead of failing. */
async function watch (ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('s3', health('paused', 'setupPending')); return }
  // This plugin entry has its own storage provider: warm the record before the first look, not only inside a probe.
  await storedConnections.warm(['s3'])
  while (!signal.aborted) {
    const config = ctx.config<S3Config>(SOURCE)
    try {
      if (!config) ctx.report('s3', health('paused', 'sourceOff'))
      else {
        try {
          const detail = await probeS3(config)
          failures = 0
          ctx.report('s3', { state: 'ready', detail, at: new Date().toISOString() })
        } catch (error) {
          // A card that names nothing (and no storage record to fill it) is paused, not failing.
          if (/not configured/.test(String(error))) {
            ctx.report('s3', { state: 'paused', detail: 'The object store is not configured yet: set the endpoint and bucket, or let the storage record supply them' })
          } else throw error
        }
      }
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) {
        ctx.report('s3', health('error', 'pollFailures', { count: String(failures), error: String(error) }))
      }
    }
    await pause((config?.pollSeconds ?? 300) * 1000, signal)
  }
}

export const name = 'dsh-superagent-s3'
export const inject = ['orchestrator']
/** Registers the kind and starts the check loop; both effects unwind on unload. */
export function apply (ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(s3Kind), 's3: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, s3Kind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch((error: unknown) => { source.report('s3', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

/** The kinds whose health entries the panel groups as data sources (not task sources). */
export const DATA_ASSET_KINDS: readonly Localized[] = [{ zh: '数据资产', en: 'Data assets' }]

export { DEFAULT_S3_ENDPOINT, S3_STORAGE_NOTE }
