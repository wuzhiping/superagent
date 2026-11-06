import { t as KV } from "./kv-DJWROOhi.js";
import { d as kaneoTaskUrl, t as KaneoClient } from "./kaneo-api-xt0nqz4b.js";
import { r as storedKaneoAccount } from "./bdd-storage-D7EFzxe4.js";
//#region src/sources/kaneo-inbox.ts
/**
* Kanban 入库助手：其它来源（Gitea、ntfy）的事件先在 Kanban 看板里落成一张卡，再由 Kanban 统一调度。
* Kanban 是唯一的直接来源：入库的卡停在 `to-do` 待辦池，不指派任何人；PM 指派并移进监听列之后，卡片才成为请求。
*/
/** 待辦池：入库的卡先落在这里，还没排进价值流（RD.md §10.2）。 */
const INBOX_COLUMN = "to-do";
/** 每个来源一个入库标签；颜色自定，同名标签由 Kanban 复用。 */
const LABEL_COLORS = {
	gitea: "#2563eb",
	ntfy: "#16a34a"
};
/** The label name of one source: `from:<source>`. */
const inboxLabel = (source) => `from:${source}`;
/** The card description: the original text, the original link, and one line saying where the card came from. */
function inboxDescription(event) {
	const parts = [];
	const body = (event.body ?? "").trim();
	if (body) parts.push(body);
	if (event.url) parts.push(`Source URL: ${event.url}`);
	parts.push(`此卡由 ${event.source} 入库${event.by ? `（${event.by}）` : ""}，等 PM 指派并移入监听列后才成为职责。`);
	return parts.join("\n\n");
}
/**
* The Kanban account of the deployment, or undefined when the Kanban Source is not configured. Without it an event
* cannot be filed, so the Sources report the missing account instead of dropping the event.
*/
function inboxAccount(ctx) {
	let account;
	try {
		account = ctx.deployment.kaneo;
	} catch {
		return;
	}
	if (account?.apiKey) return {
		baseUrl: account.baseUrl,
		apiKey: account.apiKey,
		projectId: account.projectId,
		workspaceId: account.workspaceId
	};
	const stored = storedKaneoAccount(account?.baseUrl ?? "https://pl.feg.cn");
	if (!stored) return void 0;
	return {
		baseUrl: stored.baseUrl,
		apiKey: stored.apiKey,
		projectId: account?.projectId ?? ctx.config("kaneo")?.projectId ?? "dgctny8ibgpn72ei2j8qj2hc",
		workspaceId: account?.workspaceId ?? ctx.config("kaneo")?.workspaceId
	};
}
/**
* Whether the other Sources file their events as cards (the default) or produce requests themselves. The switch lives
* on the Kanban Source, because Kanban is the only direct source and owns the board the events are filed into.
*/
function ingestEvents(ctx) {
	return ctx.config("kaneo")?.ingestEvents !== false;
}
/**
* Files one event as a Kanban card: the source label, a card in the `to-do` pool without an assignee, and the label
* attached to that card. The card is the inbox entry, not a request: only Kanban's own polling turns it into work.
*/
async function fileEvent(account, event, options = {}) {
	const client = options.client ?? new KaneoClient(account);
	const label = await ensureLabel(client, account, event.source, options.signal);
	const task = await client.createTask(account.projectId, {
		title: event.title,
		description: inboxDescription(event),
		status: INBOX_COLUMN,
		priority: "no-priority"
	}, { signal: options.signal });
	await client.attachLabel(label.id, task.id, { signal: options.signal });
	return {
		id: task.id,
		number: task.number,
		title: task.title,
		label: label.name,
		column: task.status,
		url: kaneoTaskUrl({
			baseUrl: account.baseUrl,
			projectId: account.projectId,
			workspaceId: account.workspaceId ?? ""
		}, task)
	};
}
/**
* Files one event unless this Source filed it before; the marker keeps a half-finished round from filing the same
* event twice. Returns the new card, or undefined when the event was filed already.
*/
async function fileEventOnce(ctx, account, event, eventKey, options = {}) {
	const marker = KV.inbox.filed(event.source, eventKey);
	if (ctx.state.get(marker)) return void 0;
	const card = await fileEvent(account, event, options);
	ctx.state.set(marker, {
		cardId: card.id,
		at: (/* @__PURE__ */ new Date()).toISOString()
	});
	return card;
}
/** The source's label, created on first use; Kanban answers a known name with the label that already exists. */
async function ensureLabel(client, account, source, signal) {
	const workspaceId = account.workspaceId || await firstWorkspace(client, signal);
	const label = await client.createLabel(inboxLabel(source), LABEL_COLORS[source] ?? "#64748b", workspaceId, { signal });
	return {
		id: label.id,
		name: label.name
	};
}
/** The workspace of the API key; labels live in a workspace. */
async function firstWorkspace(client, signal) {
	const id = (await client.workspaces({ signal }))[0]?.id;
	if (!id) throw new Error("Kanban has no workspace for this API key");
	return id;
}
//#endregion
export { inboxAccount as n, ingestEvents as r, fileEventOnce as t };
