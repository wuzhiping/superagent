import { z } from "zod";
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
	observeUpdates: z.boolean().default(true).describe("Watch the card of a live ticket for comment, title, description or column changes and deliver them as inputs"),
	bootstrap: z.enum(["skip", "trigger"]).default("skip").describe("First poll: record tasks already in the watched columns, or treat them as requests"),
	requiredLabels: z.string().trim().default("").describe("Only tasks with one of these labels (comma separated); empty accepts every task"),
	pollSeconds: z.number().int().min(15).max(3600).default(60).describe("Poll interval in seconds"),
	failuresBeforeError: z.number().int().min(1).max(20).default(3).describe("Consecutive failed polls before the health entry reports an error"),
	maxTasksPerColumn: z.number().int().min(1).max(200).default(50).describe("Tasks read per watched column each poll"),
	actorFallback: z.string().trim().default("kaneo").describe("Actor id used when a task names neither an assignee nor a creator")
}).strict();
/** The config fields of the removed board-hold design; a config saved before that removal still carries them. */
const REMOVED_BOARD_FIELDS = [
	"holdLabel",
	"blockedColumn",
	"cancelColumns"
];
/**
* A stored config without the fields the removed board-hold design used. A Source whose config this version refuses is
* not run at all, so a config saved before the removal must still parse; only those three names are dropped, and any
* other unknown field is still refused.
*/
function withoutRemovedBoardFields(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record = { ...value };
	for (const name of REMOVED_BOARD_FIELDS) delete record[name];
	return record;
}
/** The stored config schema: {@link KaneoConfigSchema} after dropping the removed board-hold fields. */
const KaneoStoredConfigSchema = z.preprocess(withoutRemovedBoardFields, KaneoConfigSchema);
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
/**
* The web page of a Kanban task: the project board opened on that card. The board route takes the task as `taskId`,
* which is what the app itself links to, so opening it shows the card rather than the plain board.
*/
const kaneoTaskUrl = (config, task) => {
	return `${config.baseUrl.replace(/\/+$/, "")}/dashboard/${config.workspaceId ? `workspace/${encodeURIComponent(config.workspaceId)}/` : ""}project/${encodeURIComponent(config.projectId)}/board?taskId=${encodeURIComponent(task.id)}`;
};
//#endregion
//#region src/sources/kaneo-api.ts
/**
* Minimal Kanban REST client: fetch with the `x-api-key` header, JSON responses validated by zod, a timeout, and bounded
* retries for rate limits and transient server errors. Node's global fetch is used, so no dependency is added.
*
* Kanban limits an API key to 100 requests a minute, and every consumer sharing that key — this Source, the Kanban web
* panel, a person's browser, a script — spends the same allowance. A spent allowance answers 429 to *any* request, so the
* client keeps the allowance the server reports (`x-ratelimit-remaining`, `x-ratelimit-reset`) and waits before the
* request that would spend the last of it, instead of walking into the refusal.
*/
const TIMEOUT_MS = 3e4;
/** Attempts for a transient server or network failure. */
const RETRIES = 3;
/** Attempts for a 429: a spent allowance resets on a timer, so waiting is what makes progress. */
const RATE_RETRIES = 6;
/** Requests kept in reserve: the last few of an allowance are left to the other consumers of the same key. */
const RESERVE = 3;
/** Longest single wait, so a hostile `Retry-After` cannot park the Source forever. */
const MAX_WAIT_MS = 9e4;
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
	/** The workspace the project lives in; the policy roster reads its members. */
	workspaceId: z.string().default(""),
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
/**
* Reads the allowance from a response's headers. `x-ratelimit-reset` is an epoch in milliseconds, but a server may report
* seconds, so a value too small to be milliseconds is read as seconds.
*/
function allowanceOf(headers, now) {
	const remaining = Number(headers.get("x-ratelimit-remaining"));
	const reset = Number(headers.get("x-ratelimit-reset"));
	return {
		...Number.isFinite(remaining) ? { remaining } : {},
		...Number.isFinite(reset) && reset > 0 ? { resetAt: reset < 0xe8d4a51000 ? reset * 1e3 : reset } : {}
	};
}
/** How long to wait for a 429, from the headers that say so, falling back to a growing wait. */
function waitFor(headers, allowance, attempt, now) {
	const wait = retryAfter(headers) ?? (allowance.resetAt === void 0 ? void 0 : Math.max(0, allowance.resetAt - now)) ?? 1e3 * 2 ** (attempt - 1);
	return Math.min(MAX_WAIT_MS, Math.max(50, wait));
}
/** One Kanban server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
var KaneoClient = class {
	config;
	fetchImpl;
	wait;
	base;
	/** What Kanban last said about the key's allowance, so the next request can wait instead of being refused. */
	allowance = {};
	/** The account behind the key, read once: it identifies the post and does not change while the process runs. */
	account;
	constructor(config, fetchImpl = (input, init) => fetch(input, init), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
		this.config = config;
		this.fetchImpl = fetchImpl;
		this.wait = wait;
		this.base = apiBase(config.baseUrl);
	}
	/**
	* Waits while the key's allowance is nearly spent, so the request that would empty it is not sent at all. `RESERVE`
	* requests are left for the other consumers of the same key; a reset that has already passed needs no wait.
	*/
	async throttle() {
		const { remaining, resetAt } = this.allowance;
		if (remaining === void 0 || remaining > RESERVE || resetAt === void 0) return;
		const waitForReset = resetAt - Date.now();
		if (waitForReset <= 0) return;
		await this.wait(Math.min(MAX_WAIT_MS, waitForReset));
		this.allowance = {};
	}
	/** Sends one request and parses its JSON body; 429 and 5xx are retried with backoff, and a 404/403 surfaces as `KaneoError` with its status. */
	async request(schema, method, path, body, options = {}) {
		let lastError;
		let rateAttempt = 0;
		for (let attempt = 1; attempt <= Math.max(RETRIES, RATE_RETRIES); attempt += 1) {
			await this.throttle();
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
				this.allowance = allowanceOf(response.headers, Date.now());
				if (response.ok) {
					const parsed = text ? JSON.parse(text) : void 0;
					return schema.parse(parsed);
				}
				const error = new KaneoError(errorText(text, response.status), response.status);
				if (response.status === 429) {
					rateAttempt += 1;
					if (rateAttempt >= RATE_RETRIES) throw error;
					lastError = error;
					await this.wait(waitFor(response.headers, this.allowance, rateAttempt, Date.now()));
					continue;
				}
				if (response.status < 500 || attempt >= RETRIES) throw error;
				lastError = error;
				await this.wait(retryAfter(response.headers) ?? 500 * attempt);
			} catch (caught) {
				if (options.signal?.aborted) throw caught;
				if (caught instanceof KaneoError) {
					if (attempt >= Math.max(RETRIES, RATE_RETRIES)) throw caught;
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
	/** The account behind the API key; its role (`admin` or `member`) says whether it may manage the board's flow. Read once and reused: it does not change while the process runs. */
	async me(options = {}) {
		this.account ??= await this.request(KaneoUserSchema, "GET", "/user/me", void 0, options);
		return this.account;
	}
	/** The members of a workspace: their ids are the board's assignees, their e-mails the friendly account a post names. */
	async workspaceMembers(workspaceId, options = {}) {
		return this.request(z.array(KaneoUserSchema), "GET", `/workspace/${encodeURIComponent(workspaceId)}/members`, void 0, options);
	}
};
//#endregion
export { DEFAULT_PROJECT as a, KaneoStoredConfigSchema as c, kaneoAccountOf as d, kaneoTaskUrl as f, withoutRemovedBoardFields as h, DEFAULT_CLAIM_COLUMN as i, claimColumnOf as l, watchColumnsOf as m, KaneoError as n, DEFAULT_WATCH_COLUMNS as o, requiredLabelsOf as p, DEFAULT_BASE_URL as r, KaneoConfigSchema as s, KaneoClient as t, doneColumnOf as u };
