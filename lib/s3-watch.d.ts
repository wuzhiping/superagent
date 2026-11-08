import { n as SourceKind, t as Localized } from "./kind-DEcPS-0m.js";
import { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
//#region src/sources/s3-config.d.ts
/** The endpoint and bucket the storage record names for this deployment family; used when the card leaves them empty. */
declare const DEFAULT_S3_ENDPOINT = "http://oss.feg.cn";
/**
 * The object store as a Source card: it is the supplement to the project's data assets (documents, plans, exports),
 * not a task source — it produces no requests. Empty credential fields fall back to this Host's storage record
 * (`/BDD/API/AI/dsh/storage/s3`), and the card may override all of them.
 */
declare const S3ConfigSchema: z.ZodObject<{
  endpoint: z.ZodDefault<z.ZodString>;
  bucket: z.ZodDefault<z.ZodString>;
  accessKey: z.ZodDefault<z.ZodString>;
  secretKey: z.ZodDefault<z.ZodString>;
  region: z.ZodDefault<z.ZodString>;
  prefix: z.ZodDefault<z.ZodString>;
  pollSeconds: z.ZodDefault<z.ZodNumber>;
  failuresBeforeError: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
type S3Config = z.infer<typeof S3ConfigSchema>;
/** The panel's note for the credentials: where an empty field's value comes from. */
declare const S3_STORAGE_NOTE = "留空即使用本机存储记录（/BDD/API/AI/dsh/storage/s3）里的值；填写可覆盖。";
//#endregion
//#region src/sources/s3.d.ts
declare const SOURCE = "s3";
declare const STORAGE_RECORD = "/BDD/API/AI/dsh/storage/s3";
/** One probe of the card's bucket; the failure names what to fix on the card. */
declare function probeS3(config: S3Config): Promise<string>;
declare const s3Kind: SourceKind<S3Config>;
declare const name = "dsh-superagent-s3";
declare const inject: string[];
/** Registers the kind and starts the check loop; both effects unwind on unload. */
declare function apply(ctx: Context): void;
/** The kinds whose health entries the panel groups as data sources (not task sources). */
declare const DATA_ASSET_KINDS: readonly Localized[];
//#endregion
export { DATA_ASSET_KINDS, DEFAULT_S3_ENDPOINT, S3_STORAGE_NOTE, SOURCE, STORAGE_RECORD, apply, inject, name, probeS3, s3Kind };