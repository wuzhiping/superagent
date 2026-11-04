import { z } from "zod";
//#region src/sources/ntfy-api.ts
/**
* Minimal ntfy client (read-only subset for the P2 skeleton). The self-hosted server returns NDJSON for history and does
* not expose publisher identity in a message; parsing here keeps the observed payload shape explicit.
*/
const TIMEOUT_MS = 3e4;
var NtfyError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "NtfyError";
	}
};
/** One message as the server returns it in the `/<topic>/json` stream; deletes arrive as `message_delete` events. */
const NtfyMessageSchema = z.looseObject({
	id: z.string().min(1),
	time: z.number().int(),
	expires: z.number().int().optional(),
	event: z.string().default("message"),
	topic: z.string().default(""),
	title: z.string().default(""),
	message: z.string().default(""),
	priority: z.number().int().optional(),
	tags: z.array(z.string()).default([]),
	content_type: z.string().optional()
});
/** The authorization header for the configured mode; empty for a public topic. */
function ntfyAuthHeader(auth) {
	if (auth.mode === "basic" && auth.user) return { authorization: `Basic ${Buffer.from(`${auth.user}:${auth.password}`, "utf8").toString("base64")}` };
	if (auth.mode === "bearer" && auth.token) return { authorization: `Bearer ${auth.token}` };
	return {};
}
const errorText = (text, status) => {
	try {
		const value = JSON.parse(text);
		if (typeof value.error === "string" && value.error) return `${value.error} (${status})`;
	} catch {}
	const trimmed = text.trim();
	return trimmed ? `${trimmed.slice(0, 300)} (${status})` : `ntfy answered ${status}`;
};
/**
* Parses a `/<topic>/json?poll=1` response: one JSON object per line. `message_delete` events are tombstones whose
* `sequence_id` names the deleted message; this server keeps returning the deleted `message` event too, so a tombstone
* removes its message from the result no matter which line comes first (verified against msn.feg.cn).
*/
function parseNtfyHistory(text) {
	const deleted = /* @__PURE__ */ new Set();
	const messages = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let value;
		try {
			value = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const envelope = z.looseObject({
			event: z.string().default("message"),
			sequence_id: z.string().optional()
		}).safeParse(value);
		if (!envelope.success) continue;
		if (envelope.data.event === "message_delete") {
			if (envelope.data.sequence_id) deleted.add(envelope.data.sequence_id);
			continue;
		}
		const parsed = NtfyMessageSchema.safeParse(value);
		if (parsed.success && parsed.data.event === "message") messages.push(parsed.data);
	}
	return messages.filter((message) => !deleted.has(message.id));
}
/** One ntfy server; tests substitute `fetch`. */
var NtfyClient = class {
	account;
	fetchImpl;
	base;
	constructor(account, fetchImpl = (input, init) => fetch(input, init)) {
		this.account = account;
		this.fetchImpl = fetchImpl;
		this.base = account.baseUrl.replace(/\/+$/, "");
	}
	/** Reads the topic's recent history. `since` is a ntfy duration (e.g. `30m`, `3600s`) or `all`. */
	async history(since, options = {}) {
		const query = new URLSearchParams({
			poll: "1",
			since
		});
		if (options.limit !== void 0) query.set("limit", String(options.limit));
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
		const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
		try {
			const response = await this.fetchImpl(`${this.base}/${encodeURIComponent(this.account.topic)}/json?${query}`, {
				method: "GET",
				signal,
				headers: {
					accept: "application/x-ndjson",
					...ntfyAuthHeader(this.account.auth)
				}
			});
			const text = await response.text();
			if (!response.ok) throw new NtfyError(errorText(text, response.status), response.status);
			return parseNtfyHistory(text);
		} catch (caught) {
			if (options.signal?.aborted) throw caught;
			if (caught instanceof NtfyError) throw caught;
			throw new NtfyError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			clearTimeout(timeout);
		}
	}
	/**
	* Publishes a message. This server does not parse a JSON body: the text is the plain body and the metadata travels in
	* the `Title`/`Priority`/`Tags` headers (verified against msn.feg.cn).
	*/
	async publish(text, options = {}) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
		const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
		try {
			const response = await this.fetchImpl(`${this.base}/${encodeURIComponent(this.account.topic)}`, {
				method: "POST",
				signal,
				headers: {
					"content-type": "text/plain; charset=utf-8",
					accept: "application/json",
					...options.title ? { Title: options.title } : {},
					...options.priority ? { Priority: String(options.priority) } : {},
					...options.tags?.length ? { Tags: options.tags.join(",") } : {},
					...ntfyAuthHeader(this.account.auth)
				},
				body: text
			});
			const body = await response.text();
			if (!response.ok) throw new NtfyError(errorText(body, response.status), response.status);
			try {
				const parsed = JSON.parse(body);
				return typeof parsed.id === "string" ? { id: parsed.id } : {};
			} catch {
				return {};
			}
		} catch (caught) {
			if (options.signal?.aborted) throw caught;
			if (caught instanceof NtfyError) throw caught;
			throw new NtfyError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			clearTimeout(timeout);
		}
	}
};
//#endregion
//#region src/sources/ntfy-config.ts
/**
* ntfy Source configuration. Flat so the management panel can render every field. The server keeps history about 15 days,
* so the read position is stored on the host. `pub_` topics are public and need no authentication; a private topic can be
* protected with an account and password (HTTP Basic) or a bearer token.
*/
const DEFAULT_NTFY_URL = "https://msn.feg.cn";
const NtfyConfigSchema = z.object({
	baseUrl: z.string().trim().default(DEFAULT_NTFY_URL),
	/** The topic to read and publish to, e.g. `pub_<projectId>`; empty means the Source is not configured yet. */
	topic: z.string().trim().default(""),
	/** none for a public `pub_` topic; basic (account + password) or bearer for a protected private topic. */
	authMode: z.enum([
		"none",
		"basic",
		"bearer"
	]).default("none"),
	authUser: z.string().trim().default(""),
	authPassword: z.string().default(""),
	authToken: z.string().trim().default(""),
	/** The agent's handle: `@<agent>` in a message addresses it explicitly. */
	agent: z.string().trim().default("dsh-superagent"),
	/** `title` published for the agent's own messages (the ntfy-teams convention is `#name`). */
	sender: z.string().trim().default("#dsh-superagent"),
	pollSeconds: z.number().int().min(15).max(3600).default(60),
	failuresBeforeError: z.number().int().min(1).max(20).default(3),
	maxMessages: z.number().int().min(1).max(500).default(100),
	/** `skip`: the first read starts now; `history`: the first read turns the retained history into requests. */
	bootstrap: z.enum(["skip", "history"]).default("skip")
}).strict();
/** The account fields a client needs, or undefined while the topic is unset. */
function ntfyAccountOf(config) {
	if (!config) return void 0;
	const parsed = NtfyConfigSchema.safeParse(config);
	if (!parsed.success || !parsed.data.topic) return void 0;
	const value = parsed.data;
	return {
		baseUrl: value.baseUrl,
		topic: value.topic,
		sender: value.sender,
		auth: {
			mode: value.authMode,
			user: value.authUser,
			password: value.authPassword,
			token: value.authToken
		}
	};
}
/** The web page of a topic (the PWA subscribes there). */
const ntfyTopicUrl = (baseUrl, topic) => `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(topic)}`;
//#endregion
export { NtfyClient as a, ntfyTopicUrl as i, NtfyConfigSchema as n, NtfyError as o, ntfyAccountOf as r, DEFAULT_NTFY_URL as t };
