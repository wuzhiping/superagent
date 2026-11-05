import { o as health, r as pause, s as sourceContext } from "./poll-drPbED0_.js";
import { a as storedS3Account, t as storedConnections } from "./bdd-storage-D7EFzxe4.js";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
//#region src/sources/s3-api.ts
/**
* Minimal S3 client for the MinIO Source card: AWS Signature V4 over one path-style request, with a timeout and bounded
* retries. It reads (list buckets, list one page of objects) so the card can prove the store is reachable; the
* deliverables themselves are written from the Executor Sessions' `minio_*` tools.
*/
const TIMEOUT_MS = 2e4;
const RETRIES = 2;
/** An S3 HTTP failure; `status` is the response status when the server answered. */
var S3Error = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "S3Error";
	}
};
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
/** The keys in one `<ListBucketResult>`; enough for a health probe without an XML dependency. */
function parseListing(xml) {
	return {
		keys: [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => decodeXml(match[1] ?? "")),
		truncated: /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
	};
}
const decodeXml = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/** A small S3 client; tests substitute `fetch` and the retry clock. */
var S3Client = class {
	account;
	fetchImpl;
	wait;
	constructor(account, fetchImpl = (input, init) => fetch(input, init), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
		this.account = account;
		this.fetchImpl = fetchImpl;
		this.wait = wait;
	}
	/** The region the server wants, once an answer named it; the account may also name one. */
	resolvedRegion;
	/**
	* Signs and sends one request; 429 and 5xx retry, other failures surface `S3Error`. A `400` that names the region
	* the server expects is not a failure: the client takes that region and sends the request again once.
	*/
	async send(method, path, query = {}, attempt = 1, probed = false) {
		const url = new URL(`${this.account.endpoint.replace(/\/+$/, "")}${path}`);
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		const amzDate = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
		const dateStamp = amzDate.slice(0, 8);
		const region = this.resolvedRegion || this.account.region || "us-east-1";
		const scope = `${dateStamp}/${region}/s3/aws4_request`;
		const payloadHash = sha256("");
		const canonicalQuery = [...url.searchParams.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
		const headers = {
			host: url.host,
			"x-amz-content-sha256": payloadHash,
			"x-amz-date": amzDate
		};
		const signedHeaders = Object.keys(headers).sort().join(";");
		const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
		const canonicalRequest = [
			method,
			url.pathname,
			canonicalQuery,
			canonicalHeaders,
			signedHeaders,
			payloadHash
		].join("\n");
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			amzDate,
			scope,
			sha256(canonicalRequest)
		].join("\n");
		const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.account.secretKey}`, dateStamp), region), "s3"), "aws4_request");
		const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
		const authorization = `AWS4-HMAC-SHA256 Credential=${this.account.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
		let lastError;
		try {
			const response = await this.fetchImpl(url.toString(), {
				method,
				headers: {
					...headers,
					authorization
				},
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
			const body = await response.text();
			if (response.ok) return body;
			const expected = /expecting\s+(?:&#39;|&quot;|['"])([a-z0-9-]+)/i.exec(body)?.[1];
			if (response.status === 400 && expected && !probed && expected !== region) {
				this.resolvedRegion = expected;
				return this.send(method, path, query, attempt, true);
			}
			const error = new S3Error(`S3 ${method} ${url.pathname} answered ${response.status}: ${body.slice(0, 200)}`, response.status);
			if (!(response.status === 429 || response.status >= 500) || attempt >= RETRIES) throw error;
			lastError = error;
			await this.wait(500 * attempt);
		} catch (caught) {
			if (caught instanceof S3Error && attempt < RETRIES && (caught.status === 429 || (caught.status ?? 0) >= 500)) {
				lastError = caught;
				await this.wait(500 * attempt);
			} else {
				if (attempt >= RETRIES) throw caught;
				lastError = caught;
				await this.wait(500 * attempt);
			}
		}
		if (attempt < RETRIES) return this.send(method, path, query, attempt + 1);
		throw lastError instanceof Error ? lastError : new S3Error(String(lastError));
	}
	/** `GET /` — every bucket the account can see, by name. */
	async listBuckets() {
		return [...(await this.send("GET", "/")).matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map((match) => decodeXml(match[1] ?? ""));
	}
	/** `GET /{bucket}?list-type=2` — one page of the bucket's objects under `prefix`. */
	async listObjects(options = {}) {
		const query = {
			"list-type": "2",
			"max-keys": String(options.max ?? 20)
		};
		if (options.prefix) query.prefix = options.prefix;
		if (options.recursive) query.delimiter = "";
		return parseListing(await this.send("GET", `/${encodeURIComponent(this.account.bucket)}`, query));
	}
	/** Whether the bucket named on the card can be read: the health probe. */
	async probe() {
		const listing = await this.listObjects({
			max: 5,
			recursive: true
		});
		return `${this.account.bucket}: ${listing.keys.length} object(s) readable${listing.keys.length ? `, first ${listing.keys[0]}` : ""}`;
	}
};
//#endregion
//#region src/sources/s3-config.ts
/** MinIO/S3 Source configuration: object-store settings with the storage record as their default. No Node-only imports. */
/** The endpoint and bucket the storage record names for this deployment family; used when the card leaves them empty. */
const DEFAULT_S3_ENDPOINT = "http://oss.feg.cn";
/**
* The object store as a Source card: it is the supplement to the project's data assets (documents, plans, exports),
* not a task source — it produces no requests. Empty credential fields fall back to this Host's storage record
* (`/BDD/API/AI/dsh/storage/s3`), and the card may override all of them.
*/
const S3ConfigSchema = z.object({
	/** e.g. `http://oss.feg.cn`; empty means the storage record's endpoint. */
	endpoint: z.string().trim().default(""),
	/** The bucket deliverables and assets live in; empty means the storage record's bucket. */
	bucket: z.string().trim().default(""),
	/** Access key (the record's UID); empty means the storage record's value. */
	accessKey: z.string().trim().default(""),
	/** Secret key (the record's PWD); empty means the storage record's value, and it is never written to the settings file. */
	secretKey: z.string().default(""),
	/** Empty means the server's own region: the first refused signature names it and the client follows. */
	region: z.string().trim().default(""),
	/** The prefix the panel and the deliverables use, when the bucket holds more than this project. */
	prefix: z.string().trim().default(""),
	pollSeconds: z.number().int().min(30).max(3600).default(300),
	failuresBeforeError: z.number().int().min(1).max(20).default(3)
}).strict();
/**
* The connection the Source works with: the card's values, with every empty field filled from this Host's storage
* record, so a Host needs no hand-typed secret and the card may still override any of it.
*/
function s3AccountOf(stored) {
	if (!stored) return void 0;
	const parsed = S3ConfigSchema.safeParse(stored);
	if (!parsed.success) return void 0;
	const config = parsed.data;
	const record = storedS3Account(config.endpoint || "http://oss.feg.cn");
	const endpoint = config.endpoint || record?.endpoint || "";
	const bucket = config.bucket || record?.bucket || "";
	const accessKey = config.accessKey || record?.accessKey || "";
	const secretKey = config.secretKey || record?.secretKey || "";
	if (!endpoint || !bucket || !accessKey || !secretKey) return void 0;
	return {
		endpoint,
		bucket,
		accessKey,
		secretKey,
		region: config.region
	};
}
/** The panel's note for the credentials: where an empty field's value comes from. */
const S3_STORAGE_NOTE = "留空即使用本机存储记录（/BDD/API/AI/dsh/storage/s3）里的值；填写可覆盖。";
//#endregion
//#region src/sources/s3.ts
const SOURCE = "s3";
const STORAGE_RECORD = "/BDD/API/AI/dsh/storage/s3";
/** One probe of the card's bucket; the failure names what to fix on the card. */
async function probeS3(config) {
	await storedConnections.warm(["s3"]);
	const account = s3AccountOf(config);
	if (!account) throw new Error("The object store is not configured: set the endpoint and bucket, or run as a user whose storage record carries them");
	return new S3Client(account).probe();
}
const s3Kind = {
	kind: "s3",
	title: {
		zh: "MinIO 对象存储",
		en: "MinIO object storage"
	},
	description: {
		zh: "项目数据资产的补充载体（文档、方案、报表、导出）：非代码产出存在这里，卡片上只留进度与结果。默认使用本机存储记录里的连接（" + STORAGE_RECORD + "），每个字段都可以在卡片上改。它不产生任务。",
		en: "The supplemental carrier for a project's data assets (documents, plans, reports, exports): non-code deliverables live here and the card keeps only progress and the result. Its connection defaults to this Host's storage record (" + STORAGE_RECORD + "), and every field may be overridden. It produces no tasks."
	},
	schema: S3ConfigSchema,
	/** Settings-panel probe: read the entered bucket with the entered account (or the storage record's). */
	async test(config) {
		await probeS3(config);
	},
	fields: [
		{
			key: "endpoint",
			type: "text",
			label: {
				zh: "服务地址",
				en: "Endpoint"
			},
			hint: {
				zh: `例如 ${DEFAULT_S3_ENDPOINT}。${S3_STORAGE_NOTE}`,
				en: `For example ${DEFAULT_S3_ENDPOINT}. ${S3_STORAGE_NOTE}`
			}
		},
		{
			key: "bucket",
			type: "text",
			label: {
				zh: "桶（bucket）",
				en: "Bucket"
			},
			hint: {
				zh: "交付物与资产所在的桶；留空用存储记录里的桶。",
				en: "The bucket deliverables and assets live in; empty uses the storage record's bucket."
			}
		},
		{
			key: "accessKey",
			type: "text",
			label: {
				zh: "Access key",
				en: "Access key"
			},
			hint: {
				zh: `留空用存储记录里的 UID，填写可覆盖。`,
				en: "Empty uses the storage record's UID; a value overrides it."
			}
		},
		{
			key: "secretKey",
			type: "password",
			label: {
				zh: "Secret key",
				en: "Secret key"
			},
			hint: {
				zh: "留空用存储记录里的密码；密钥只用于宿主进程，不进入提示词。",
				en: "Empty uses the storage record's password; the key is host-process only and never enters prompts."
			}
		},
		{
			key: "region",
			type: "text",
			advanced: true,
			label: {
				zh: "Region（可选）",
				en: "Region (optional)"
			},
			hint: {
				zh: "留空即自动探测：服务端拒绝签名时会告诉客户端它要哪个 region，客户端记住并重试。",
				en: "Empty auto-detects it: a refused signature names the region the server wants, and the client remembers it and retries."
			}
		},
		{
			key: "prefix",
			type: "text",
			advanced: true,
			label: {
				zh: "前缀（可选）",
				en: "Prefix (optional)"
			},
			hint: {
				zh: "只看这个前缀下的对象；留空看整桶。",
				en: "Only look under this prefix; empty reads the whole bucket."
			}
		},
		{
			key: "pollSeconds",
			type: "number",
			advanced: true,
			min: 30,
			max: 3600,
			label: {
				zh: "巡检间隔 / 秒",
				en: "Check interval / seconds"
			}
		},
		{
			key: "failuresBeforeError",
			type: "number",
			advanced: true,
			min: 1,
			max: 20,
			label: {
				zh: "连续失败几次后报告异常",
				en: "Failed checks before reporting an error"
			}
		}
	],
	health: ["s3"]
};
/** Checks the store on an interval; a card that names nothing stays paused instead of failing. */
async function watch(ctx, signal) {
	let failures = 0;
	await ctx.ready;
	if (!ctx.configured()) {
		ctx.report("s3", health("paused", "setupPending"));
		return;
	}
	await storedConnections.warm(["s3"]);
	while (!signal.aborted) {
		const config = ctx.config("s3");
		try {
			if (!config) ctx.report("s3", health("paused", "sourceOff"));
			else try {
				const detail = await probeS3(config);
				failures = 0;
				ctx.report("s3", {
					state: "ready",
					detail,
					at: (/* @__PURE__ */ new Date()).toISOString()
				});
			} catch (error) {
				if (/not configured/.test(String(error))) ctx.report("s3", {
					state: "paused",
					detail: "The object store is not configured yet: set the endpoint and bucket, or let the storage record supply them"
				});
				else throw error;
			}
		} catch (error) {
			failures += 1;
			if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) ctx.report("s3", health("error", "pollFailures", {
				count: String(failures),
				error: String(error)
			}));
		}
		await pause((config?.pollSeconds ?? 300) * 1e3, signal);
	}
}
const name = "dsh-superagent-s3";
const inject = ["orchestrator"];
/** Registers the kind and starts the check loop; both effects unwind on unload. */
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(s3Kind), "s3: source kind");
	ctx.effect(() => {
		const source = sourceContext(ctx.orchestrator, s3Kind);
		const controller = new AbortController();
		const running = watch(source, controller.signal).catch((error) => {
			source.report("s3", {
				state: "error",
				detail: String(error)
			});
		});
		return async () => {
			controller.abort();
			await running;
		};
	});
}
/** The kinds whose health entries the panel groups as data sources (not task sources). */
const DATA_ASSET_KINDS = [{
	zh: "数据资产",
	en: "Data assets"
}];
//#endregion
export { DATA_ASSET_KINDS, DEFAULT_S3_ENDPOINT, S3_STORAGE_NOTE, SOURCE, STORAGE_RECORD, apply, inject, name, probeS3, s3Kind };
