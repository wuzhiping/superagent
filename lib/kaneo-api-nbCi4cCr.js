import { z } from "zod";
//#region src/sources/kaneo-config.ts
/** Kaneo Source configuration: the account fields deployment setup reads and the full kind schema. No Node-only imports (deployment imports this). */
/** Default project id: the FDEP pipeline board on pl.feg.cn (slug FDE). */
const DEFAULT_PROJECT = "dgctny8ibgpn72ei2j8qj2hc";
const DEFAULT_BASE_URL = "https://pl.feg.cn";
const DEFAULT_WATCH_COLUMNS = "ready";
const DEFAULT_CLAIM_COLUMN = "in-progress";
/**
* The account fields deployment setup resolves and restarts for. `apiKey` empty means the Kaneo Source is not configured;
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
* One Kaneo board as a Source. A task in `watchColumns` becomes a request; a reply goes back as a task comment and, when
* `claimColumn` is set, the task is moved there once the request is recorded. `bootstrap` decides what the first poll does
* with tasks already in the watched columns: `skip` records them without a request, `trigger` treats them as requests.
*/
const KaneoConfigSchema = z.object({
	baseUrl: z.string().trim().default(DEFAULT_BASE_URL).describe("Kaneo server, e.g. https://pl.feg.cn"),
	apiKey: z.string().trim().default("").describe("Kaneo API key; kept out of prompts and Session text"),
	projectId: z.string().trim().default(DEFAULT_PROJECT).describe("Kaneo project id whose board this Source watches"),
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
/** The account fields of a stored Kaneo Source config, or undefined when no API key is configured. */
function kaneoAccountOf(stored) {
	if (!stored) return void 0;
	const parsed = KaneoAccountSchema.safeParse(stored);
	const account = parsed.success ? parsed.data : void 0;
	return account?.apiKey ? account : void 0;
}
/** The API base URL of a configured Kaneo server (accepts a base without `/api`). */
const apiBase = (baseUrl) => {
	const trimmed = baseUrl.replace(/\/+$/, "");
	return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};
/** The web page of a Kaneo task; the Site is a single-page app, so the board page is the stable fallback until a task route is confirmed. */
const kaneoTaskUrl = (config, task) => {
	return `${config.baseUrl.replace(/\/+$/, "")}/dashboard/${config.workspaceId ? `workspace/${encodeURIComponent(config.workspaceId)}/` : ""}project/${encodeURIComponent(config.projectId)}?task=${encodeURIComponent(task.id)}`;
};
//#endregion
//#region src/sources/kaneo-api.ts
/**
* Minimal Kaneo REST client: fetch with the `x-api-key` header, JSON responses validated by zod, a timeout, and bounded
* retries for rate limits and transient server errors. Node's global fetch is used, so no dependency is added.
*/
const TIMEOUT_MS = 3e4;
const RETRIES = 3;
/** A Kaneo HTTP failure; `status` is the response status when the server answered. 404/403 mean the target is gone for a reply. */
var KaneoError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "KaneoError";
	}
};
/** The shape every Kaneo list/board answer uses: `data` for the payload and `pagination` for its bounds. */
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
/** A task as Kaneo answers a card creation: the id and number identify it, the column slug says where it landed. */
const CreatedTaskSchema = z.looseObject({
	id: z.string().min(1),
	number: z.number().int().optional(),
	title: z.string().default(""),
	status: z.string().default("")
});
/** A label as Kaneo answers a label creation; the same name answers with the label that already exists. */
const LabelSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().default("")
});
/** A workspace as Kaneo answers the workspace list; labels live in a workspace. */
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
const errorText = (text, status) => {
	try {
		const value = JSON.parse(text);
		if (typeof value.message === "string" && value.message) return `${value.message} (${status})`;
		if (typeof value.error === "string" && value.error) return `${value.error} (${status})`;
	} catch {}
	const trimmed = text.trim();
	return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `Kaneo answered ${status}`;
};
const retryAfter = (headers) => {
	const value = headers.get("retry-after");
	if (!value) return void 0;
	const seconds = Number(value);
	return Number.isFinite(seconds) ? seconds * 1e3 : void 0;
};
/** One Kaneo server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
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
			const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
	/** Tasks of one board column, newest position first as Kaneo returns them. */
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
	/** The comments of one task, oldest first as Kaneo returns them. */
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
	* waits in the pool until a person assigns it. Kaneo requires `priority`, so the caller always names one.
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
//#endregion
export { DEFAULT_PROJECT as a, claimColumnOf as c, kaneoTaskUrl as d, requiredLabelsOf as f, DEFAULT_CLAIM_COLUMN as i, doneColumnOf as l, KaneoError as n, DEFAULT_WATCH_COLUMNS as o, watchColumnsOf as p, DEFAULT_BASE_URL as r, KaneoConfigSchema as s, KaneoClient as t, kaneoAccountOf as u };
