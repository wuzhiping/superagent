import { z } from "zod";
//#region src/sources/gitea-api.ts
/**
* Minimal Gitea REST client: token or user/password (HTTP Basic) authentication, JSON validated by zod, a timeout, and
* bounded retries. Gitea mirrors GitHub's API shape; the endpoints here are confirmed against /swagger.v1.json.
*/
const TIMEOUT_MS = 3e4;
const RETRIES = 3;
/** A Gitea HTTP failure; `status` is the response status when the server answered. */
var GiteaError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "GiteaError";
	}
};
/** `Authorization` headers for an account: token first, else HTTP Basic, else none (anonymous public reads). */
function giteaAuthHeaders(account) {
	if (account.token) return { authorization: `token ${account.token}` };
	if (account.user && account.password) return { authorization: `Basic ${Buffer.from(`${account.user}:${account.password}`, "utf8").toString("base64")}` };
	return {};
}
const RepositorySchema = z.looseObject({
	id: z.number(),
	full_name: z.string(),
	default_branch: z.string().default(""),
	private: z.boolean().default(false),
	has_issues: z.boolean().default(true),
	has_pull_requests: z.boolean().default(true),
	permissions: z.looseObject({
		admin: z.boolean().optional(),
		push: z.boolean().optional(),
		pull: z.boolean().optional()
	}).optional()
});
const UserSchema = z.looseObject({
	id: z.number(),
	login: z.string(),
	full_name: z.string().optional(),
	email: z.string().optional(),
	is_admin: z.boolean().optional()
});
const NotificationSchema = z.looseObject({
	id: z.string(),
	unread: z.boolean().default(false),
	updated_at: z.string(),
	subject: z.looseObject({
		title: z.string().default(""),
		url: z.string().optional(),
		type: z.string().optional()
	}),
	repository: z.looseObject({ full_name: z.string().optional() }).optional()
});
const IssueSchema = z.looseObject({
	id: z.number(),
	number: z.number(),
	title: z.string(),
	body: z.string().nullish(),
	state: z.string().default("open"),
	user: z.looseObject({ login: z.string() }).nullish(),
	assignee: z.looseObject({ login: z.string() }).nullish(),
	created_at: z.string(),
	updated_at: z.string(),
	html_url: z.string().optional(),
	pull_request: z.unknown().optional()
});
const CommentSchema = z.looseObject({
	id: z.number(),
	body: z.string().default(""),
	user: z.looseObject({ login: z.string() }).nullish(),
	created_at: z.string(),
	updated_at: z.string(),
	html_url: z.string().optional(),
	issue_url: z.string().optional()
});
const PullSchema = z.looseObject({
	id: z.number(),
	number: z.number(),
	title: z.string(),
	state: z.string().default("open"),
	user: z.looseObject({ login: z.string() }).nullish(),
	created_at: z.string(),
	updated_at: z.string(),
	html_url: z.string().optional(),
	merged: z.boolean().optional(),
	merged_at: z.string().nullish(),
	head: z.looseObject({ sha: z.string().optional() }).optional()
});
const errorText = (text, status) => {
	try {
		const value = JSON.parse(text);
		if (typeof value.message === "string" && value.message) return `${value.message} (${status})`;
	} catch {}
	const trimmed = text.trim();
	return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `Gitea answered ${status}`;
};
const retryAfter = (headers) => {
	const value = headers.get("retry-after");
	if (!value) return void 0;
	const seconds = Number(value);
	return Number.isFinite(seconds) ? seconds * 1e3 : void 0;
};
/** One Gitea server; tests substitute `fetch` and the retry clock. */
var GiteaClient = class {
	account;
	fetchImpl;
	wait;
	base;
	constructor(account, fetchImpl = (input, init) => fetch(input, init), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
		this.account = account;
		this.fetchImpl = fetchImpl;
		this.wait = wait;
		this.base = `${account.baseUrl.replace(/\/+$/, "")}/api/v1`;
	}
	/** Sends one request and parses its JSON body; 429 and 5xx retry with backoff, others surface `GiteaError`. */
	async request(schema, method, path, body, signal) {
		let lastError;
		for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
			const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
			try {
				const response = await this.fetchImpl(`${this.base}${path}`, {
					method,
					signal: requestSignal,
					headers: {
						accept: "application/json",
						...giteaAuthHeaders(this.account),
						...body === void 0 ? {} : { "content-type": "application/json" }
					},
					...body === void 0 ? {} : { body: JSON.stringify(body) }
				});
				const text = await response.text();
				if (response.ok) return schema.parse(text ? JSON.parse(text) : void 0);
				const error = new GiteaError(errorText(text, response.status), response.status);
				if (!(response.status === 429 || response.status >= 500) || attempt === RETRIES) throw error;
				lastError = error;
				await this.wait(retryAfter(response.headers) ?? 500 * attempt);
			} catch (caught) {
				if (signal?.aborted) throw caught;
				if (caught instanceof GiteaError) {
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
		throw lastError instanceof Error ? lastError : new GiteaError(String(lastError));
	}
	/** `GET /version`; works without a token and tells which Gitea the instance runs. */
	async version(signal) {
		return (await this.request(z.looseObject({ version: z.string() }), "GET", "/version", void 0, signal)).version;
	}
	/** `GET /user`; requires a token and is how deployment verifies the agent account. */
	async user(signal) {
		return this.request(UserSchema, "GET", "/user", void 0, signal);
	}
	/** `GET /repos/{owner}/{repo}`. */
	async repository(owner, name, signal) {
		return this.request(RepositorySchema, "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, void 0, signal);
	}
	/** `GET /notifications`; `since` is an RFC 3339 timestamp. */
	async notifications(options = {}, signal) {
		const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
		if (options.since) query.set("since", options.since);
		if (options.all) query.set("all", "true");
		return this.request(z.array(NotificationSchema), "GET", `/notifications?${query}`, void 0, signal);
	}
	/** `GET /repos/{owner}/{repo}/issues`; `since` is an RFC 3339 timestamp. */
	async issues(owner, name, options = {}, signal) {
		const query = new URLSearchParams({
			state: options.state ?? "all",
			limit: String(options.limit ?? 50)
		});
		if (options.since) query.set("since", options.since);
		return this.request(z.array(IssueSchema), "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?${query}`, void 0, signal);
	}
	/** `GET /repos/{owner}/{repo}/issues/comments`; repository-wide comments, `since` an RFC 3339 timestamp. */
	async issueComments(owner, name, options = {}, signal) {
		const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
		if (options.since) query.set("since", options.since);
		return this.request(z.array(CommentSchema), "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/comments?${query}`, void 0, signal);
	}
	/** `GET /repos/{owner}/{repo}/pulls`; Gitea has no `since`, so callers filter by `updated_at`. */
	async pulls(owner, name, options = {}, signal) {
		const query = new URLSearchParams({
			state: options.state ?? "all",
			sort: options.sort ?? "recentupdate",
			limit: String(options.limit ?? 50)
		});
		return this.request(z.array(PullSchema), "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query}`, void 0, signal);
	}
	/** `GET /repos/{owner}/{repo}/issues/{index}`; a pull request is an issue too and carries `pull_request`. */
	async issue(owner, name, index, signal) {
		return this.request(IssueSchema, "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${index}`, void 0, signal);
	}
	/** `GET /repos/{owner}/{repo}/issues/{index}/comments`; `since` an RFC 3339 timestamp. */
	async issueCommentsOf(owner, name, index, options = {}, signal) {
		const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
		if (options.since) query.set("since", options.since);
		return this.request(z.array(CommentSchema), "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${index}/comments?${query}`, void 0, signal);
	}
	/** `POST /repos/{owner}/{repo}/issues/{index}/comments`; returns the created comment. */
	async createIssueComment(owner, name, index, body, signal) {
		return this.request(CommentSchema, "POST", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${index}/comments`, { body }, signal);
	}
};
//#endregion
//#region src/sources/gitea-config.ts
/** Gitea Source configuration: the account fields deployment resolves and the kind's full schema. No Node-only imports. */
const DEFAULT_GITEA_URL = "https://git.feg.cn";
/** Account fields deployment setup reads (the password/token never leaves the host process or Session text). */
const GiteaAccountSchema = z.object({
	baseUrl: z.string().trim().default(DEFAULT_GITEA_URL),
	/** The agent account, by login or e-mail; with `password` this is the normal Gitea API login. */
	user: z.string().trim().default(""),
	password: z.string().default(""),
	/** Optional API token (for a 2FA account or a CI bot); when set it takes the place of user/password. */
	token: z.string().trim().default(""),
	/** `owner/name`; empty means the Source is not configured yet. */
	repository: z.string().trim().regex(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?$/, "owner/name").default("")
});
/**
* One Gitea repository as a Source. It reads the agent account's notifications (token) or repository-wide issue/comment
* increments, turns addressed events into Triggers, and posts replies as issue/PR comments.
*/
const GiteaConfigSchema = GiteaAccountSchema.extend({
	/** `notifications`: the agent account's notifications (needs a token); `repo`: repository-wide increments. */
	listen: z.enum(["notifications", "repo"]).default("repo"),
	/** The agent's Gitea login; an event that mentions `@{agent}` is an explicit request. */
	agent: z.string().trim().default("dsh-superagent"),
	/** Comma-separated logins treated as bots (they can produce inferred candidates only). */
	bots: z.string().trim().default(""),
	observeIssues: z.boolean().default(true),
	observePulls: z.boolean().default(true),
	observeComments: z.boolean().default(true),
	/** `skip`: the first poll records a baseline; `trigger`: the first poll reports what is already there. */
	bootstrap: z.enum(["skip", "trigger"]).default("skip"),
	pollSeconds: z.number().int().min(15).max(3600).default(60),
	failuresBeforeError: z.number().int().min(1).max(20).default(3),
	maxItems: z.number().int().min(1).max(200).default(50)
}).strict();
/** The account fields of a stored Gitea Source config, or undefined while no repository is configured. */
function giteaAccountOf(stored) {
	if (!stored) return void 0;
	const parsed = GiteaAccountSchema.safeParse(stored);
	return parsed.success && parsed.data.repository ? parsed.data : void 0;
}
/** Whether the account can authenticate: a token, or a login and password. */
const giteaHasAuth = (config) => !!config.token || !!config.user && !!config.password;
/** Split `owner/name`, or undefined when the repository is unset or malformed. */
function repositoryOf(value) {
	const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value.trim());
	return match ? {
		owner: match[1],
		name: match[2]
	} : void 0;
}
/** Comma-separated bot logins. */
const botsOf = (config) => config.bots.split(",").map((item) => item.trim()).filter(Boolean);
/** Whether a Gitea login is a bot: an explicit list entry or the `[bot]` suffix. */
const giteaBot = (login, config) => /\[bot\]$/.test(login) || botsOf(config).includes(login);
//#endregion
export { giteaHasAuth as a, GiteaError as c, giteaBot as i, GiteaConfigSchema as n, repositoryOf as o, giteaAccountOf as r, GiteaClient as s, DEFAULT_GITEA_URL as t };
