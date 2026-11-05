import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { homedir } from "node:os";
//#region src/sources/kaneo-config.ts
/** Kanban Source configuration: the account fields deployment setup reads and the full kind schema. No Node-only imports (deployment imports this). */
/** Default project id: the FDEP pipeline board on pl.feg.cn (slug FDE). */
const DEFAULT_PROJECT = "dgctny8ibgpn72ei2j8qj2hc";
const DEFAULT_BASE_URL = "https://pl.feg.cn";
const DEFAULT_WATCH_COLUMNS = "ready";
const DEFAULT_CLAIM_COLUMN = "in-progress";
/**
* The account fields deployment setup resolves and restarts for. `apiKey` empty means the Kanban Source is not configured;
* `projectId` defaults to the FDEP board so a first save only needs the key; `workspaceId` names the workspace the
* labels of the inbox live in (empty: the first workspace the API key can read).
*/
const KaneoAccountSchema = z.object({
	baseUrl: z.string().trim().default(DEFAULT_BASE_URL),
	apiKey: z.string().trim().default(""),
	projectId: z.string().trim().default(DEFAULT_PROJECT),
	workspaceId: z.string().trim().default("")
});
/**
* One Kanban board as a Source. A task in `watchColumns` becomes a request; a reply goes back as a task comment and, when
* `claimColumn` is set, the task is moved there once the request is recorded. `bootstrap` decides what the first poll does
* with tasks already in the watched columns: `skip` records them without a request, `trigger` treats them as requests.
*/
const KaneoConfigSchema = z.object({
	baseUrl: z.string().trim().default(DEFAULT_BASE_URL).describe("Kanban server, e.g. https://pl.feg.cn"),
	apiKey: z.string().trim().default("").describe("Kanban API key; kept out of prompts and Session text"),
	projectId: z.string().trim().default(DEFAULT_PROJECT).describe("Kanban project id whose board this Source watches"),
	workspaceId: z.string().trim().default("").describe("Optional workspace id; used only for display and links"),
	watchColumns: z.string().trim().default(DEFAULT_WATCH_COLUMNS).describe("Column slugs whose tasks become requests, comma separated"),
	ingestEvents: z.boolean().default(true).describe("Other Sources file their events as cards in this project instead of producing requests"),
	claimColumn: z.string().trim().default(DEFAULT_CLAIM_COLUMN).describe("Column a task moves to when the post starts working on it; empty to never move"),
	doneColumn: z.string().trim().default("").describe("Column a task moves to when the post delivers its result; empty to never move"),
	bootstrap: z.enum(["skip", "trigger"]).default("skip").describe("First poll: record tasks already in the watched columns, or treat them as requests"),
	requiredLabels: z.string().trim().default("").describe("Only tasks with one of these labels (comma separated); empty accepts every task"),
	pollSeconds: z.number().int().min(15).max(3600).default(60).describe("Poll interval in seconds"),
	failuresBeforeError: z.number().int().min(1).max(20).default(3).describe("Consecutive failed polls before the health entry reports an error"),
	maxTasksPerColumn: z.number().int().min(1).max(200).default(50).describe("Tasks read per watched column each poll"),
	actorFallback: z.string().trim().default("kaneo").describe("Actor id used when a task names neither an assignee nor a creator")
}).strict();
const split = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
/** Watched column slugs from the comma-separated config field. */
const watchColumnsOf = (config) => split(config.watchColumns);
/** Required task labels from the comma-separated config field. */
const requiredLabelsOf = (config) => split(config.requiredLabels);
/** The claim column a task moves to when the post starts working on it; empty means the task never moves. */
const claimColumnOf = (config) => config?.claimColumn.trim() ?? "";
/** The column a task moves to when the post delivers its result; empty means the task never moves. */
const doneColumnOf = (config) => config?.doneColumn.trim() ?? "";
/** The account fields of a stored Kanban Source config, or undefined when no API key is configured. */
function kaneoAccountOf(stored) {
	if (!stored) return void 0;
	const parsed = KaneoAccountSchema.safeParse(stored);
	const account = parsed.success ? parsed.data : void 0;
	return account?.apiKey ? account : void 0;
}
/** The API base URL of a configured Kanban server (accepts a base without `/api`). */
const apiBase = (baseUrl) => {
	const trimmed = baseUrl.replace(/\/+$/, "");
	return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};
/** The web page of a Kanban task; the Site is a single-page app, so the board page is the stable fallback until a task route is confirmed. */
const kaneoTaskUrl = (config, task) => {
	return `${config.baseUrl.replace(/\/+$/, "")}/dashboard/${config.workspaceId ? `workspace/${encodeURIComponent(config.workspaceId)}/` : ""}project/${encodeURIComponent(config.projectId)}?task=${encodeURIComponent(task.id)}`;
};
//#endregion
//#region src/sources/kaneo-api.ts
/**
* Minimal Kanban REST client: fetch with the `x-api-key` header, JSON responses validated by zod, a timeout, and bounded
* retries for rate limits and transient server errors. Node's global fetch is used, so no dependency is added.
*/
const TIMEOUT_MS$1 = 3e4;
const RETRIES = 3;
/** A Kanban HTTP failure; `status` is the response status when the server answered. 404/403 mean the target is gone for a reply. */
var KaneoError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "KaneoError";
	}
};
/** The shape every Kanban list/board answer uses: `data` for the payload and `pagination` for its bounds. */
const KaneoBoardSchema = z.looseObject({
	data: z.looseObject({ columns: z.array(z.looseObject({
		id: z.string().optional(),
		slug: z.string(),
		name: z.string().default(""),
		tasks: z.array(z.unknown()).default([])
	})).default([]) }),
	pagination: z.looseObject({
		total: z.number().default(0),
		page: z.number().default(1),
		totalPages: z.number().default(1)
	}).default({
		total: 0,
		page: 1,
		totalPages: 1
	})
});
/** A task as Kanban answers a card creation: the id and number identify it, the column slug says where it landed. */
const CreatedTaskSchema = z.looseObject({
	id: z.string().min(1),
	number: z.number().int().optional(),
	title: z.string().default(""),
	status: z.string().default("")
});
/** A label as Kanban answers a label creation; the same name answers with the label that already exists. */
const LabelSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default("")
});
/** A workspace as Kanban answers the workspace list; labels live in a workspace. */
const WorkspaceSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default("")
});
/** The account behind the API key: its id identifies the post on the board, its role says what it may manage. */
const KaneoUserSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default(""),
	email: z.string().default(""),
	role: z.string().default("member")
});
/** One project: the board's title, the description the charter is published into, and the columns' slugs. */
const KaneoProjectSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default(""),
	slug: z.string().default(""),
	description: z.string().default(""),
	icon: z.string().default(""),
	isPublic: z.boolean().default(false),
	columns: z.array(z.looseObject({
		slug: z.string().optional(),
		name: z.string().optional()
	})).default([])
});
/** One project as the list answers it: what a picker needs to show a name and store an id. */
const KaneoProjectRefSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default(""),
	slug: z.string().default(""),
	workspaceId: z.string().default("")
});
/** One board column as the workflow endpoints answer it: the cuid identifies it, the slug is what tasks are stored by. */
const KaneoColumnSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default(""),
	slug: z.string().default(""),
	isFinal: z.boolean().default(false),
	position: z.number().optional()
});
const errorText = (text, status) => {
	try {
		const value = JSON.parse(text);
		if (typeof value.message === "string" && value.message) return `${value.message} (${status})`;
		if (typeof value.error === "string" && value.error) return `${value.error} (${status})`;
	} catch {}
	const trimmed = text.trim();
	return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `Kanban answered ${status}`;
};
const retryAfter = (headers) => {
	const value = headers.get("retry-after");
	if (!value) return void 0;
	const seconds = Number(value);
	return Number.isFinite(seconds) ? seconds * 1e3 : void 0;
};
/** One Kanban server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
var KaneoClient = class {
	config;
	fetchImpl;
	wait;
	base;
	constructor(config, fetchImpl = (input, init) => fetch(input, init), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
		this.config = config;
		this.fetchImpl = fetchImpl;
		this.wait = wait;
		this.base = apiBase(config.baseUrl);
	}
	/** Sends one request and parses its JSON body; 429 and 5xx are retried with backoff, and a 404/403 surfaces as `KaneoError` with its status. */
	async request(schema, method, path, body, options = {}) {
		let lastError;
		for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS$1);
			const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
			try {
				const response = await this.fetchImpl(`${this.base}${path}`, {
					method,
					signal,
					headers: {
						accept: "application/json",
						"x-api-key": this.config.apiKey,
						...body === void 0 ? {} : { "content-type": "application/json" }
					},
					...body === void 0 ? {} : { body: JSON.stringify(body) }
				});
				const text = await response.text();
				if (response.ok) {
					const parsed = text ? JSON.parse(text) : void 0;
					return schema.parse(parsed);
				}
				const error = new KaneoError(errorText(text, response.status), response.status);
				if (!(response.status === 429 || response.status >= 500) || attempt === RETRIES) throw error;
				lastError = error;
				await this.wait(retryAfter(response.headers) ?? 500 * attempt);
			} catch (caught) {
				if (options.signal?.aborted) throw caught;
				if (caught instanceof KaneoError) {
					if (attempt === RETRIES) throw caught;
					lastError = caught;
					continue;
				}
				if (attempt === RETRIES) throw caught;
				lastError = caught;
				await this.wait(500 * attempt);
			} finally {
				clearTimeout(timeout);
			}
		}
		throw lastError instanceof Error ? lastError : new KaneoError(String(lastError));
	}
	/** Tasks of one board column, newest position first as Kanban returns them. */
	async columnTasks(projectId, status, limit, options = {}) {
		return (await this.request(KaneoBoardSchema, "GET", `/task/tasks/${encodeURIComponent(projectId)}?status=${encodeURIComponent(status)}&limit=${limit}`, void 0, options)).data.columns.flatMap((column) => column.tasks);
	}
	/** Reads the project board once without a column filter; used by setup to check the key and project without touching a column. */
	async board(projectId, options = {}) {
		await this.request(KaneoBoardSchema, "GET", `/task/tasks/${encodeURIComponent(projectId)}?limit=1`, void 0, options);
	}
	/** One task by id. */
	async task(id, options = {}) {
		return this.request(z.unknown(), "GET", `/task/${encodeURIComponent(id)}`, void 0, options);
	}
	/**
	* One project: its name, its columns and — the project-level charter's home — its description. Every post of the
	* project reads the same record, whichever Host it runs on (RD.md §4.1, §8).
	*/
	async project(id, options = {}) {
		return this.request(KaneoProjectSchema, "GET", `/project/${encodeURIComponent(id)}`, void 0, options);
	}
	/**
	* The projects of one workspace. The panel lists them so a person picks the project instead of typing its id; the
	* list needs the workspace id because the server scopes projects to a workspace.
	*/
	async projects(workspaceId, options = {}) {
		return this.request(z.array(KaneoProjectRefSchema), "GET", `/project?workspaceId=${encodeURIComponent(workspaceId)}`, void 0, options);
	}
	/**
	* Replaces one project. The server validates the whole project, so every field the request carries must be sent —
	* the caller reads the project first and sends it back with the field it changes (the charter publishes into
	* `description`).
	*/
	async updateProject(id, body, options = {}) {
		await this.request(z.unknown(), "PUT", `/project/${encodeURIComponent(id)}`, body, options);
	}
	/** The columns of one project's board, in board order; the value stream the team works in. */
	async columns(projectId, options = {}) {
		return this.request(z.array(KaneoColumnSchema), "GET", `/column/${encodeURIComponent(projectId)}`, void 0, options);
	}
	/** Adds a column to the end of a project's board: the flow grows by the PM confirming what the retrospective found. */
	async createColumn(projectId, body, options = {}) {
		return this.request(KaneoColumnSchema, "POST", `/column/${encodeURIComponent(projectId)}`, body, options);
	}
	/** The comments of one task, oldest first as Kanban returns them. */
	async comments(taskId, options = {}) {
		return await this.request(z.array(z.unknown()), "GET", `/comment/${encodeURIComponent(taskId)}`, void 0, options);
	}
	/** Posts a comment on a task. */
	async comment(taskId, content, options = {}) {
		await this.request(z.unknown(), "POST", `/comment/${encodeURIComponent(taskId)}`, { content }, options);
	}
	/** Moves a task to another column of its project. */
	async move(id, status, options = {}) {
		await this.request(z.unknown(), "PUT", `/task/status/${encodeURIComponent(id)}`, { status }, options);
	}
	/**
	* Creates a card in a project. `status` is the slug of the column it lands in; no assignee is written, so the card
	* waits in the pool until a person assigns it. Kanban requires `priority`, so the caller always names one.
	*/
	async createTask(projectId, body, options = {}) {
		return this.request(CreatedTaskSchema, "POST", `/task/${encodeURIComponent(projectId)}`, body, options);
	}
	/** Creates a label in a workspace; the same name answers with the label that already exists. */
	async createLabel(name, color, workspaceId, options = {}) {
		return this.request(LabelSchema, "POST", "/label", {
			name,
			color,
			workspaceId
		}, options);
	}
	/** Attaches a label to a card, so the board shows where the card came from. */
	async attachLabel(labelId, taskId, options = {}) {
		await this.request(z.unknown(), "PUT", `/label/${encodeURIComponent(labelId)}/task`, { taskId }, options);
	}
	/** The workspaces the API key can read; labels belong to one of them. */
	async workspaces(options = {}) {
		return this.request(z.array(WorkspaceSchema), "GET", "/workspace", void 0, options);
	}
	/** The account behind the API key; its role (`admin` or `member`) says whether it may manage the board's flow. */
	async me(options = {}) {
		return this.request(KaneoUserSchema, "GET", "/user/me", void 0, options);
	}
};
/** The credential references tried in order; the first one present in the credentials file is used. */
const CREDENTIAL_REFS = [
	"AIFE_API_KEY",
	"FEG_API_KEY",
	"DEEPSEEK_API_KEY"
];
const TIMEOUT_MS = 8e3;
/** The credentials file: `DSH_CREDENTIALS_PATH`, else `$DSH_HOME/.credentials.yaml`, else `$HOME/.dsh/.credentials.yaml`. */
function credentialsFilePath(env = process.env) {
	const override = (env.DSH_CREDENTIALS_PATH ?? "").trim();
	if (override) return override;
	return join(env.DSH_HOME || join(homedir(), ".dsh"), ".credentials.yaml");
}
/**
* Reads `refs.<name>` out of the credentials file. The shape is fixed (a `refs:` block of two-space-indented
* `name: value` lines), so this parses it directly rather than depending on a YAML library.
*/
function readCredentialRef(text, name) {
	if (!text || !name) return null;
	let inRefs = false;
	let refsIndent = -1;
	for (const line of text.split(/\r?\n/)) {
		if (/^\s*#/.test(line) || line.trim() === "") continue;
		const indent = line.length - line.trimStart().length;
		const trimmed = line.trim();
		if (/^refs:\s*$/.test(trimmed)) {
			inRefs = true;
			refsIndent = indent;
			continue;
		}
		if (!inRefs) continue;
		if (indent <= refsIndent) {
			inRefs = false;
			continue;
		}
		const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed);
		if (!match || match[1] !== name) continue;
		let value = match[2].trim();
		if (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
		return value === "" ? null : value;
	}
	return null;
}
/**
* Masks one credential: `sk-` + base64(key@ISO8601), the shape the storage host family answers with real data for. The
* masked form is a bearer credential of its own, which is why it may only go to {@link STORAGE_HOST}.
*/
function maskKey(key, now = /* @__PURE__ */ new Date()) {
	if (!key) throw new TypeError("maskKey: the key must be a non-empty string");
	return `sk-${Buffer.from(`${key}@${now.toISOString()}`, "utf8").toString("base64")}`;
}
/** The credential reference to use, masked; undefined when the credentials file has none. */
function maskedCredential(options = {}) {
	const env = options.env ?? process.env;
	const readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
	const file = credentialsFilePath(env);
	let text;
	try {
		text = readFile(file);
	} catch {
		return;
	}
	for (const ref of CREDENTIAL_REFS) {
		const key = readCredentialRef(text, ref);
		if (key) return {
			masked: maskKey(key, options.now),
			ref,
			source: file
		};
	}
}
/** The fields each service's record may use, in the order they are tried (case-insensitive). */
const FIELD_CANDIDATES = {
	kaneo: {
		apiKey: [
			"API_KEY",
			"KANEO_API_KEY",
			"APIKEY",
			"KEY",
			"TOKEN"
		],
		baseUrl: [
			"KANEO_URL",
			"BASE_URL",
			"URL"
		]
	},
	gitea: {
		baseUrl: [
			"GIT_URL",
			"GITEA_URL",
			"BASE_URL",
			"URL"
		],
		email: [
			"EMAIL",
			"USER",
			"USERNAME"
		],
		password: [
			"PASSWD",
			"PASSWORD",
			"PASS",
			"SECRET",
			"TOKEN"
		]
	},
	ntfy: {
		user: [
			"uid",
			"UID",
			"USER",
			"USERNAME"
		],
		password: [
			"pwd",
			"PASSWORD",
			"PWD",
			"PASS",
			"SECRET"
		],
		server: [
			"NTFY_URL",
			"SERVER",
			"URL"
		]
	},
	s3: {
		endpoint: [
			"S3_URL",
			"S3_ENDPOINT",
			"ENDPOINT",
			"URL"
		],
		accessKey: [
			"S3_UID",
			"UID",
			"ACCESS_KEY",
			"ACCESS_KEY_ID"
		],
		secretKey: [
			"S3_PWD",
			"PWD",
			"SECRET_KEY",
			"SECRET_ACCESS_KEY",
			"PASSWORD"
		],
		bucket: [
			"S3_BUCK",
			"S3_BUCKET",
			"BUCKET",
			"BUCKET_NAME"
		]
	}
};
/** Picks the first non-empty value among `candidates`, regardless of the record's casing. */
function pickField(payload, candidates) {
	if (!payload) return "";
	const lowered = new Map(Object.entries(payload).map(([key, value]) => [key.toLowerCase(), value]));
	for (const name of candidates) {
		const value = lowered.get(name.toLowerCase());
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return "";
}
/** The fields of one service record, as the Sources need them; missing ones are simply absent. */
function connectionFields(service, payload) {
	const fields = {};
	for (const [name, candidates] of Object.entries(FIELD_CANDIDATES[service])) {
		const value = pickField(payload, candidates);
		if (value) fields[name] = value;
	}
	return fields;
}
/**
* Reads one service's connection. Nothing is thrown: a failure names the stage (`credential`: no reference in the
* credentials file, `request`: the storage host did not answer, `response`: it answered without the fields).
*/
async function fetchStoredConnection(service, options = {}) {
	const credential = maskedCredential(options);
	if (!credential) return {
		ok: false,
		service,
		stage: "credential",
		error: `no usable credential reference in ${credentialsFilePath(options.env ?? process.env)}`
	};
	const url = options.storageUrl ?? `https://abc.feg.com.tw/BDD/API/AI/dsh/storage/${service}`;
	const fetchImpl = options.fetchImpl ?? fetch;
	let response;
	let raw;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ apiKey: credential.masked }),
			signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)
		});
		raw = await response.text();
	} catch (error) {
		return {
			ok: false,
			service,
			stage: "request",
			error: `storage lookup failed: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	let payload;
	try {
		payload = raw ? JSON.parse(raw) : void 0;
	} catch {
		payload = void 0;
	}
	if (!response.ok) return {
		ok: false,
		service,
		stage: "request",
		error: `storage host answered HTTP ${response.status}`
	};
	if (!payload || typeof payload !== "object") return {
		ok: false,
		service,
		stage: "response",
		error: "storage host did not answer with JSON"
	};
	const fields = connectionFields(service, payload);
	if (Object.keys(fields).length === 0) return {
		ok: false,
		service,
		stage: "response",
		error: `the ${service} record has none of its fields (got ${Object.keys(payload).join(", ") || "nothing"})`
	};
	return {
		ok: true,
		service,
		fields,
		ref: credential.ref
	};
}
/**
* The process' store of resolved connections: one lookup per service per ten minutes, failures retried on the next use.
* Sources ask it synchronously (`peek`) during a request and a background warm-up fills it at startup, so a panel read
* never waits on the storage host.
*/
var StoredConnections = class {
	options;
	cache = /* @__PURE__ */ new Map();
	failures = /* @__PURE__ */ new Map();
	constructor(options = () => ({})) {
		this.options = options;
	}
	/** The fields cached for a service, or undefined when none were read (or they expired). */
	peek(service) {
		const entry = this.cache.get(service);
		if (!entry) return void 0;
		if (Date.now() - entry.at > 6e5) {
			this.cache.delete(service);
			return;
		}
		return entry.fields;
	}
	/** The last failure of a service, for the health entry to report; cleared by a successful read. */
	lastError(service) {
		return this.failures.get(service);
	}
	/** Reads one service now (or reuses the cache) and records the outcome. */
	async get(service, options = {}) {
		if (!options.force) {
			const cached = this.peek(service);
			if (cached) return {
				ok: true,
				service,
				fields: cached,
				ref: "cache"
			};
		}
		const settings = this.options();
		const result = await fetchStoredConnection(service, {
			...settings.env ? { env: settings.env } : {},
			...settings.readFile ? { readFile: settings.readFile } : {},
			...settings.fetchImpl ? { fetchImpl: settings.fetchImpl } : {},
			...settings.storageUrl ? { storageUrl: settings.storageUrl } : {},
			...settings.now ? { now: settings.now() } : {}
		});
		if (result.ok) {
			this.cache.set(service, {
				at: Date.now(),
				fields: result.fields
			});
			this.failures.delete(service);
		} else this.failures.set(service, result.error);
		return result;
	}
	/** Fills the cache for the services this Host uses; failures stay for the health entry, never thrown. */
	async warm(services) {
		for (const service of services) await this.get(service);
	}
	/** Drops the cache (a settings save, or a rotated reference). */
	invalidate(service) {
		if (service) this.cache.delete(service);
		else this.cache.clear();
	}
};
/** The process-wide store the Sources and the panel share. */
const storedConnections = new StoredConnections();
/** The Kanban account this Host reads from the storage record: its key, and the server the Source names or the default. */
function storedKaneoAccount(baseUrl) {
	const fields = storedConnections.peek("kaneo");
	const apiKey = fields?.apiKey ?? "";
	if (!apiKey) return void 0;
	return {
		baseUrl: fields?.baseUrl || baseUrl,
		apiKey
	};
}
//#endregion
export { DEFAULT_BASE_URL as a, DEFAULT_WATCH_COLUMNS as c, doneColumnOf as d, kaneoAccountOf as f, watchColumnsOf as h, KaneoError as i, KaneoConfigSchema as l, requiredLabelsOf as m, storedKaneoAccount as n, DEFAULT_CLAIM_COLUMN as o, kaneoTaskUrl as p, KaneoClient as r, DEFAULT_PROJECT as s, storedConnections as t, claimColumnOf as u };
