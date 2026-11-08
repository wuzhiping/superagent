import { createHash } from "node:crypto";
//#region src/core/ids.ts
/** Stable content-derived identifiers; equal inputs always produce the same id. */
function key(...values) {
	return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 32);
}
//#endregion
//#region src/kv.ts
/** Define a single typed KV key; external Source plugins use `record` and `family` to type their own keys. */
const record = (key) => key;
/** Define a KV key family whose keys join `prefix` and name parts with `:` (or a custom `format`). */
function family(prefix, format = (...name) => name.join(":")) {
	return Object.assign((...name) => `${prefix}${format(...name)}`, { prefix });
}
const KV = {
	/** Store: current database schema version. */
	store: { schema: record("schema") },
	/** Settings: current revision, per-block revision, and saved settings snapshots (including the current one). */
	settings: {
		revision: record("settings-revision"),
		block: family("settings-block-revision:"),
		version: family("settings-version:")
	},
	/** Prompts: current revision and saved prompt versions. */
	prompts: {
		revision: record("prompt-revision"),
		version: family("prompt-version:"),
		/** The built-in text of a prompt part an override was edited from, by its `base`, which shows what an upgrade changed. */
		builtIn: family("prompt-built-in:")
	},
	/** Runtime: the main Session's ID. */
	runtime: { masterId: record("master-id") },
	/** Sessions: prompt revisions each Session has worked under, ordered oldest first; the last entry (`.at(-1)`) is its active revision. */
	sessions: { prompts: family("session-prompts:") },
	/** Schema 11 migration: legacy main-Session queues imported into the effect table. */
	queues: {
		relays: record("relay-queue"),
		unsubscribed: record("subscription-results"),
		prompts: record("prompt-notification"),
		settings: record("settings-notification")
	},
	/** Per-Source resolved display names mapping a named ID (such as a Feishu chat ID) to its display name. */
	sources: { labels: family("source-labels:") },
	/**
	* GitHub Source: notification cursor and pending retries; per-Issue/PR read cursor shared by notification and polled reads;
	* per-stream cursor, start times by kind, and ETag; default-branch CI state; and per-PR CI fingerprint and revision (`revision`
	* counts reported CI changes so each produces a distinct Trigger ID).
	*/
	github: {
		since: record("github-since"),
		retries: record("github-retry"),
		cursor: family("github-cursor:"),
		stream: family("github-stream:"),
		branchCi: record("github-branch-ci"),
		ci: family("github-ci:")
	},
	/**
	* Feishu Source: known chats (`true` for direct messages); per-chat history cursor and active topics mapped from topic ID
	* to last-seen timestamp; and per-polled-thread seen message IDs and initialization flag.
	*/
	feishu: {
		chats: record("feishu-chats"),
		history: family("feishu-history:"),
		topics: family("feishu-history-threads:"),
		seen: family("thread-seen:"),
		initialized: family("thread-initialized:")
	},
	/**
	* Kanban Source: tasks already recorded (so one task becomes one request, even across restarts), whether the first poll
	* has run (its bootstrap records the tasks already in the watched columns instead of requesting them), and the time of
	* the last successful read of each watched column.
	*/
	kaneo: {
		seen: family("kaneo-seen:"),
		bootstrap: record("kaneo-bootstrap"),
		observe: family("kaneo-observe:"),
		holdSeen: family("kaneo-hold-seen:"),
		holdLabel: family("kaneo-hold-label:"),
		cursor: family("kaneo-cursor:")
	},
	/** Gitea Source: read cursors for notifications, repository-wide streams and each followed thread. */
	gitea: {
		notifications: record("gitea-notifications-since"),
		repo: record("gitea-repo-since"),
		thread: family("gitea-thread-since:")
	},
	/** ntfy Source: the read position in Unix seconds and the topic it belongs to (P2 read-only). */
	ntfy: {
		since: record("ntfy-since"),
		topic: record("ntfy-topic")
	},
	/**
	* Kanban 入库：其它来源的事件已经落成卡片的记录（来源 + 事件键），这样半个失败的轮询不会把同一事件建两次卡。
	*/
	inbox: { filed: family("inbox-filed:") }
};
//#endregion
export { key as n, KV as t };
