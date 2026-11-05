/** MinIO/S3 Source configuration: object-store settings with the storage record as their default. No Node-only imports. */
import { z } from 'zod'
import { storedS3Account } from './bdd-storage.ts'

/** The endpoint and bucket the storage record names for this deployment family; used when the card leaves them empty. */
export const DEFAULT_S3_ENDPOINT = 'http://oss.feg.cn'

/**
 * The object store as a Source card: it is the supplement to the project's data assets (documents, plans, exports),
 * not a task source — it produces no requests. Empty credential fields fall back to this Host's storage record
 * (`/BDD/API/AI/dsh/storage/s3`), and the card may override all of them.
 */
export const S3ConfigSchema = z.object({
  /** e.g. `http://oss.feg.cn`; empty means the storage record's endpoint. */
  endpoint: z.string().trim().default(''),
  /** The bucket deliverables and assets live in; empty means the storage record's bucket. */
  bucket: z.string().trim().default(''),
  /** Access key (the record's UID); empty means the storage record's value. */
  accessKey: z.string().trim().default(''),
  /** Secret key (the record's PWD); empty means the storage record's value, and it is never written to the settings file. */
  secretKey: z.string().default(''),
  /** Empty means the server's own region: the first refused signature names it and the client follows. */
  region: z.string().trim().default(''),
  /** The prefix the panel and the deliverables use, when the bucket holds more than this project. */
  prefix: z.string().trim().default(''),
  pollSeconds: z.number().int().min(30).max(3600).default(300),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
}).strict()
export type S3Config = z.infer<typeof S3ConfigSchema>

/** One object store connection: what a request signs with. */
export interface S3Account {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
  region: string
}

/**
 * The connection the Source works with: the card's values, with every empty field filled from this Host's storage
 * record, so a Host needs no hand-typed secret and the card may still override any of it.
 */
export function s3AccountOf (stored: Record<string, unknown> | undefined): S3Account | undefined {
  if (!stored) return undefined
  const parsed = S3ConfigSchema.safeParse(stored)
  if (!parsed.success) return undefined
  const config = parsed.data
  const record = storedS3Account(config.endpoint || DEFAULT_S3_ENDPOINT)
  const endpoint = config.endpoint || record?.endpoint || ''
  const bucket = config.bucket || record?.bucket || ''
  const accessKey = config.accessKey || record?.accessKey || ''
  const secretKey = config.secretKey || record?.secretKey || ''
  if (!endpoint || !bucket || !accessKey || !secretKey) return undefined
  return { endpoint, bucket, accessKey, secretKey, region: config.region }
}

/** The panel's note for the credentials: where an empty field's value comes from. */
export const S3_STORAGE_NOTE = '留空即使用本机存储记录（/BDD/API/AI/dsh/storage/s3）里的值；填写可覆盖。'
