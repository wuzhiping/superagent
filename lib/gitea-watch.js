import { o as health, r as pause, s as sourceContext } from "./poll-drPbED0_.js";
import { n as key, t as KV } from "./kv-DC2Rgw_a.js";
import { t as KaneoClient } from "./kaneo-api-TcVNWDBo.js";
import { a as giteaHasAuth, c as GiteaClient, i as giteaBot, l as GiteaError, n as GiteaConfigSchema, o as giteaReader, s as repositoryOf, t as DEFAULT_GITEA_URL } from "./gitea-config-BSUrhdHf.js";
import { n as inboxAccount, r as ingestEvents, t as fileEventOnce } from "./kaneo-inbox-Bv1c5Ryc.js";
import { z } from "zod";
//#region src/sources/gitea.ts
const SOURCE = "gitea";
const now = () => (/* @__PURE__ */ new Date()).toISOString();
const clamp = (text, limit = 4e3) => text.length <= limit ? text : `${text.slice(0, limit)}…`;
const giteaThreadId = (ref) => `${ref.owner}/${ref.repo}#${ref.index}`;
const giteaThreadKey = (ref) => `${SOURCE}:${giteaThreadId(ref)}`;
/** Parse `gitea:owner/repo#123` back into a reference. */
function giteaRefOfThread(keyValue) {
	const match = /^gitea:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(keyValue);
	return match ? {
		owner: match[1],
		repo: match[2],
		index: Number(match[3])
	} : void 0;
}
/** The agent's mention in free text, e.g. `@dsh-superagent`. */
const mentioned = (text, agent) => !!agent && typeof text === "string" && text.toLowerCase().includes(`@${agent.toLowerCase()}`);
/** A Trigger's Gitea reference, from its meta (written by every trigger builder). */
function giteaRef(trigger) {
	if (trigger.source !== "gitea") return void 0;
	const meta = trigger.meta;
	if (typeof meta.owner !== "string" || typeof meta.repo !== "string" || typeof meta.index !== "number") return void 0;
	return {
		owner: meta.owner,
		repo: meta.repo,
		index: meta.index
	};
}
const channelOf = (ref, url) => ({
	source: SOURCE,
	thread: giteaThreadId(ref),
	address: {
		owner: ref.owner,
		repo: ref.repo,
		index: String(ref.index),
		...url ? { url } : {}
	}
});
const metaOf = (ref, kind, extra = {}) => ({
	owner: ref.owner,
	repo: ref.repo,
	index: ref.index,
	kind,
	...extra
});
/** An issue (or pull request) that was created or updated since the cursor. */
function issueTrigger(issue, ref, config, at = now()) {
	const login = issue.user?.login ?? "gitea";
	const addressed = mentioned(issue.body, config.agent) ? "mention" : void 0;
	return {
		id: key("gitea", giteaThreadId(ref), `i:${issue.updated_at}`),
		source: SOURCE,
		threads: [{
			source: SOURCE,
			id: giteaThreadId(ref)
		}],
		actor: {
			source: SOURCE,
			id: login
		},
		human: !giteaBot(login, config),
		...addressed ? { addressed } : {},
		at: issue.updated_at || issue.created_at || at,
		text: clamp(`#${ref.index} ${issue.title}\n\n${issue.body ?? ""}`),
		channel: channelOf(ref, issue.html_url),
		...issue.html_url ? { url: issue.html_url } : {},
		meta: metaOf(ref, "issue", {
			title: issue.title,
			isPr: !!issue.pull_request
		})
	};
}
/** A comment on an issue or pull request. A mention of the agent addresses it explicitly. */
function commentTrigger(comment, ref, config, at = now(), title = "") {
	const login = comment.user?.login ?? "gitea";
	const addressed = mentioned(comment.body, config.agent) ? "mention" : void 0;
	return {
		id: key("gitea", giteaThreadId(ref), `c:${comment.id}`),
		source: SOURCE,
		threads: [{
			source: SOURCE,
			id: giteaThreadId(ref)
		}],
		actor: {
			source: SOURCE,
			id: login
		},
		human: !giteaBot(login, config),
		...addressed ? { addressed } : {},
		at: comment.created_at || comment.updated_at || at,
		text: clamp(`${title ? `#${ref.index} ${title} — ` : `#${ref.index} `}${login}: ${comment.body}`),
		channel: channelOf(ref, comment.html_url),
		...comment.html_url ? { url: comment.html_url } : {},
		meta: metaOf(ref, "comment", { commentId: comment.id })
	};
}
/** A notification of the agent account; Gitea only notifies about things directed at the account. */
function notificationTrigger(notification, ref, config, issue, at = now()) {
	const type = notification.subject.type ?? "";
	const login = issue?.user?.login ?? "gitea";
	return {
		id: key("gitea", giteaThreadId(ref), `n:${notification.id}`),
		source: SOURCE,
		threads: [{
			source: SOURCE,
			id: giteaThreadId(ref)
		}],
		actor: {
			source: SOURCE,
			id: login
		},
		human: !giteaBot(login, config),
		addressed: "mention",
		at: notification.updated_at || at,
		text: clamp(`#${ref.index} ${notification.subject.title}${issue?.body ? `\n\n${issue.body}` : ""}\n\n(${type})`),
		channel: channelOf(ref, issue?.html_url),
		meta: metaOf(ref, "notification", {
			title: notification.subject.title,
			isPr: type === "Pull",
			notificationId: notification.id
		})
	};
}
/** `owner/repo/issues/5` (or `/pulls/5`) from a Gitea URL. */
function refFromUrl(value) {
	if (!value) return void 0;
	const match = /\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pulls)\/(\d+)/.exec(value);
	return match ? {
		owner: match[1],
		repo: match[2],
		index: Number(match[3])
	} : void 0;
}
/** The card an issue or a pull request becomes: its title, its body and its link. */
function issueEvent(issue) {
	return {
		source: SOURCE,
		title: issue.title,
		body: issue.body ?? "",
		url: issue.html_url,
		by: issue.user?.login
	};
}
/** The card a comment becomes: the issue it belongs to, the comment itself and its link. */
function commentEvent(comment, ref, title) {
	return {
		source: SOURCE,
		title: `#${ref.index} ${title ?? `${ref.owner}/${ref.repo} 的评论`}`,
		body: comment.body,
		url: comment.html_url,
		by: comment.user?.login
	};
}
/** The card a notification becomes: the title of the issue or pull request it points at. */
function notificationEvent(notification, issue) {
	return {
		source: SOURCE,
		title: notification.subject.title || "Gitea 通知",
		body: issue?.body ?? "",
		url: issue?.html_url,
		by: issue?.user?.login
	};
}
/** The key of one event, so the same event is filed as a card once. */
const eventKey = (ref, kind, id) => `${giteaThreadId(ref)}:${kind}:${id}`;
const messageOf = (error) => error instanceof Error ? error.message : String(error);
const giteaKind = {
	kind: SOURCE,
	title: {
		zh: "Gitea（宪章仓库）",
		en: "Gitea (charter repository)"
	},
	description: {
		zh: "私有部署的 Gitea（默认 https://git.feg.cn），只做**宪章仓库**：宪章与职责说明（README.md 与同目录的 duties/ 目录，每个职责一个文件）从这里读写，**不监听 Issue/PR，也不把事件入库成卡**。任务只来自 Kanban 卡；工单要用哪个 Gitea 仓库由卡片的 `repo:owner/name` 提供，不在这里配置。公开仓库只填服务器地址和仓库名即可匿名读取；私有仓库才需要邮箱+密码（或 API token）。",
		en: "A self-hosted Gitea (default https://git.feg.cn) that carries the **charter repository** only: the charter and its duties folder (README.md and a duties/ folder beside it, one file per duty) are read and published here; **issues and pull requests are not watched and no events are filed as cards**. Tasks come only from Kanban cards; when a ticket needs a repository, the card provides it as `repo:owner/name`, not this Source. A public repository needs only the server address and the repository name; a private repository needs the e-mail and password (or an API token)."
	},
	schema: GiteaConfigSchema,
	/** Settings-panel probe: the charter repository must exist and be readable (or writable, for publishing), without saving. */
	async test(config) {
		const charterRepo = repositoryOf(config.charterRepository);
		if (!charterRepo) throw new Error("The charter repository must be owner/name");
		const client = new GiteaClient(config);
		const repo = `${charterRepo.owner}/${charterRepo.name}`;
		if (giteaHasAuth(config)) try {
			await client.user();
		} catch (error) {
			throw new Error(`Gitea rejected the account on ${config.baseUrl}: ${messageOf(error)}. Check the e-mail/password or API token (a token wins when both are set).`);
		}
		try {
			await client.repository(charterRepo.owner, charterRepo.name);
		} catch (error) {
			const status = error.status;
			if (status === 404) throw new Error(`Charter repository ${repo} was not found on ${config.baseUrl}: it does not exist, or the account cannot see it (Gitea hides private repositories from unauthorized reads). Create the repository first, or fill in the e-mail/password (or API token) of an account that can read it.`);
			if (status === 401 || status === 403) throw new Error(`Gitea refused reading ${repo} on ${config.baseUrl}: the account may not have access. Use an account (e-mail/password or API token) that can read this repository.`);
			throw new Error(`Could not read the charter repository ${repo} on ${config.baseUrl}: ${messageOf(error)}`);
		}
	},
	fields: [
		{
			key: "baseUrl",
			type: "text",
			label: {
				zh: "Gitea 服务器",
				en: "Gitea server"
			},
			hint: {
				zh: "例如 https://git.feg.cn。公开仓库只需服务器地址和仓库名，账号可以留空。",
				en: "For example https://git.feg.cn. A public repository needs only the server and the repository name; the account may stay empty."
			}
		},
		{
			key: "user",
			type: "text",
			label: {
				zh: "邮箱（可选）",
				en: "E-mail (optional)"
			},
			hint: {
				zh: "公开仓库可以不填；私有仓库才需要。填写 agent 的 Gitea 登录邮箱（或登录名）。只用于宿主进程，不进入提示词。",
				en: "Empty for a public repository; a private repository needs it. The agent Gitea e-mail (or login); host process only, never prompts."
			}
		},
		{
			key: "password",
			type: "password",
			label: {
				zh: "密码（可选）",
				en: "Password (optional)"
			},
			hint: {
				zh: "公开仓库可留空（匿名读取）；私有仓库才需要，与邮箱配套（HTTP Basic）。留空表示不修改已保存的密码。",
				en: "Empty for a public repository (anonymous reads); a private repository needs it with the e-mail (HTTP Basic). Leave it empty to keep the saved password."
			}
		},
		{
			key: "token",
			type: "password",
			advanced: true,
			label: {
				zh: "API token（可选）",
				en: "API token (optional)"
			},
			hint: {
				zh: "私有仓库可用 token 代替邮箱+密码，设置后优先；留空表示不修改。",
				en: "For a private repository it takes the place of the e-mail and password and wins when set; leave empty to keep it."
			}
		},
		{
			key: "charterRepository",
			type: "text",
			label: {
				zh: "宪章仓库（owner/name）",
				en: "Charter repository (owner/name)"
			},
			hint: {
				zh: "宪章与职责说明的家（例如 `shawoo/rsi_superagent`）；留空则来源暂停、宪章退回 Kanban 项目描述。这里不监听任何 Issue/PR：任务只来自看板卡，工单要用的仓库由卡片的 `repo:` 标签给出。",
				en: "The home of the charter and its duties document (such as `shawoo/rsi_superagent`); empty keeps the Source paused and falls the charter back to the Kanban description. No issues or PRs are watched here: tasks come from board cards, and a ticket gets its repositories from the card's `repo:` labels."
			}
		},
		{
			key: "charterPath",
			type: "text",
			label: {
				zh: "宪章文件（仓库内路径）",
				en: "Charter file (path in the repository)"
			},
			hint: {
				zh: "默认 README.md：这个文件就是项目宪章的入口与主体；职责说明是同目录的 duties/ 目录（一个职责一个 .md）。",
				en: "Defaults to README.md: that file is the project charter's entry point and body; the duties are in a duties/ folder beside it, one file per duty."
			}
		}
	],
	scope: () => ({
		listened: true,
		observed: false
	}),
	health: ["gitea"],
	channel: {
		async send(host, message) {
			const account = host.commands.deployment.gitea;
			if (!account) throw new Error("The Gitea Source has no resolved account");
			const address = message.channel.address;
			const ref = {
				owner: address.owner ?? "",
				repo: address.repo ?? "",
				index: Number(address.index ?? 0)
			};
			if (!ref.owner || !ref.repo || !ref.index) throw new Error("Missing Gitea reply target");
			const client = new GiteaClient(account);
			const marker = `<!-- dsh-superagent:${message.id} -->`;
			try {
				if ((await client.issueCommentsOf(ref.owner, ref.repo, ref.index, { limit: 50 })).some((comment) => comment.body.includes(marker))) return "sent";
				await client.createIssueComment(ref.owner, ref.repo, ref.index, `${message.text.slice(0, 6e4)}\n\n${marker}`);
				return "sent";
			} catch (error) {
				if (error instanceof GiteaError && (error.status === 403 || error.status === 404)) return "gone";
				throw error;
			}
		},
		link(address) {
			const index = address.index ?? "";
			return {
				url: address.url ?? "",
				label: {
					zh: `Gitea #${index}`,
					en: `Gitea #${index}`
				}
			};
		}
	},
	threadContext: {
		messageId: (trigger) => trigger.id,
		async read(_commands, trigger, part, _cursor, config) {
			const ref = giteaRef(trigger);
			if (!ref) throw new Error("This Trigger is not a Gitea issue or pull request");
			const client = new GiteaClient(config);
			const issue = await client.issue(ref.owner, ref.repo, ref.index);
			const root = {
				id: `${giteaThreadId(ref)}:body`,
				from: issue.user?.login ?? "gitea",
				at: issue.created_at,
				text: issue.body || "(the issue has no description)"
			};
			const body = {
				title: issue.title,
				state: issue.state,
				...issue.html_url ? { url: issue.html_url } : {},
				isPr: !!issue.pull_request
			};
			if (part === "root" || part === "parent") return {
				messages: [root],
				body,
				status: issue.state
			};
			return {
				messages: [root, ...(await client.issueCommentsOf(ref.owner, ref.repo, ref.index, { limit: config.maxItems })).map((comment) => ({
					id: String(comment.id),
					from: comment.user?.login ?? "gitea",
					at: comment.created_at,
					text: comment.body,
					...comment.html_url ? { url: comment.html_url } : {}
				}))],
				body,
				status: issue.state
			};
		}
	},
	find: (query) => {
		return {
			threads: /^gitea:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)$/.exec(query.trim()) ? [query.trim()] : [],
			terms: []
		};
	},
	policy: {
		schema: z.object({ allowed: z.array(z.object({
			id: z.string().trim().min(1).max(200),
			name: z.string().trim().max(100).optional()
		}).strict()).default([]) }).strict(),
		fields: [{
			key: "allowed",
			type: "rows",
			label: {
				zh: "能发起任务的 Gitea 用户",
				en: "Gitea users that may originate work"
			},
			hint: {
				zh: "这些用户在 Issue/PR 评论或描述里 @ 智能体，即构成明确请求。",
				en: "When one of these users mentions the agent in an issue or pull request, it is an explicit request."
			},
			columns: [{
				key: "id",
				type: "text",
				label: {
					zh: "登录名",
					en: "Login"
				}
			}, {
				key: "name",
				type: "text",
				label: {
					zh: "名称（可选）",
					en: "Name (optional)"
				},
				optional: true
			}]
		}],
		explicit: {
			zh: "名单里的 Gitea 用户在 Issue/PR 的评论或描述里 @ 了智能体。",
			en: "A listed Gitea user mentions the agent in an issue or pull request."
		}
	},
	environment: {
		variables: [
			{
				key: "DSH_SUPERAGENT_GITEA_REPOSITORY",
				description: {
					zh: "工单来源的 Gitea 仓库（owner/name）",
					en: "Gitea repository of the ticket (owner/name)"
				}
			},
			{
				key: "DSH_SUPERAGENT_GITEA_ACCOUNT",
				description: {
					zh: "agent 的 Gitea 登录名",
					en: "The agent Gitea login"
				}
			},
			{
				key: "DSH_SUPERAGENT_GITEA_THREAD",
				description: {
					zh: "工单对应的 Issue/PR（owner/repo#index）",
					en: "Issue/PR behind the ticket (owner/repo#index)"
				}
			},
			{
				key: "DSH_SUPERAGENT_GITEA_URL",
				description: {
					zh: "Issue/PR 的页面地址",
					en: "The issue or pull request page"
				}
			}
		],
		values: ({ deployment, config, trigger }) => {
			const meta = trigger?.source === "gitea" ? trigger.meta : {};
			return {
				DSH_SUPERAGENT_GITEA_REPOSITORY: deployment.gitea?.repository ?? "",
				DSH_SUPERAGENT_GITEA_ACCOUNT: config.agent,
				DSH_SUPERAGENT_GITEA_THREAD: typeof meta.owner === "string" && typeof meta.repo === "string" && typeof meta.index === "number" ? `${meta.owner}/${meta.repo}#${meta.index}` : "",
				DSH_SUPERAGENT_GITEA_URL: trigger?.url ?? ""
			};
		}
	},
	facts: (deployment) => deployment?.gitea ? {
		repository: deployment.gitea.charterRepository,
		server: deployment.gitea.baseUrl
	} : {}
};
/**
* One polling round: baseline on first poll, then issue/comment/notification increments are filed as cards in the
* Kanban board. Kanban is the only direct source, so the events do not become requests here (unless the Kanban Source
* switched its inbox off); they become cards in the `to-do` pool, and the board schedules them from there.
*/
async function pollRound(ctx, config, client, signal) {
	const cursorKey = config.listen === "notifications" ? KV.gitea.notifications : KV.gitea.repo;
	const reader = giteaReader(config);
	const cursor = ctx.state.get(cursorKey);
	if (!cursor) {
		ctx.state.set(cursorKey, now());
		ctx.report("gitea", {
			state: "ready",
			detail: `baseline recorded; the next poll reports new activity, reading ${reader}`,
			at: now()
		});
		return config.pollSeconds;
	}
	let received = 0;
	let filed = 0;
	const ingest = ingestEvents(ctx);
	const account = ingest ? inboxAccount(ctx) : void 0;
	if (ingest && !account) throw new Error("The Kanban Source has no API key: Gitea events are filed as Kanban cards");
	const kaneo = account ? new KaneoClient(account) : void 0;
	/** Files one event as a card, or (with the Kanban inbox switched off) hands it to the Engine as a request. */
	const deliver = async (event, id, trigger) => {
		if (account && kaneo) {
			if (await fileEventOnce(ctx, account, event, id, {
				client: kaneo,
				signal
			})) filed += 1;
			return;
		}
		if (await ctx.receive(trigger()) !== "filtered") received += 1;
	};
	const repo = repositoryOf(config.repository);
	const problems = [];
	if (config.listen === "notifications") {
		const items = await client.notifications({
			since: cursor,
			all: false,
			limit: config.maxItems
		}, signal);
		for (const item of items) {
			const target = refFromUrl(item.subject.url) ?? refFromUrl(item.repository?.full_name ? `/repos/${item.repository.full_name}` : void 0);
			if (!target) continue;
			const issue = await client.issue(target.owner, target.repo, target.index).catch(() => void 0);
			await deliver(notificationEvent(item, issue), eventKey(target, "notification", item.id), () => notificationTrigger(item, target, config, issue));
		}
	} else if (repo) {
		let succeeded = 0;
		const attempt = async (label, work) => {
			try {
				await work();
				succeeded += 1;
			} catch (error) {
				problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			}
		};
		if (config.observeIssues) await attempt("issues", async () => {
			const issues = await client.issues(repo.owner, repo.name, {
				state: "all",
				since: cursor,
				limit: config.maxItems
			}, signal);
			for (const issue of issues) {
				const ref = {
					owner: repo.owner,
					repo: repo.name,
					index: issue.number
				};
				await deliver(issueEvent(issue), eventKey(ref, "issue", issue.updated_at), () => issueTrigger(issue, ref, config));
			}
		});
		if (config.observeComments) await attempt("comments", async () => {
			const comments = await client.issueComments(repo.owner, repo.name, {
				since: cursor,
				limit: config.maxItems
			}, signal);
			for (const comment of comments) {
				const ref = refFromUrl(comment.issue_url);
				if (!ref) continue;
				await deliver(commentEvent(comment, ref), eventKey(ref, "comment", String(comment.id)), () => commentTrigger(comment, ref, config));
			}
		});
		for (const thread of ctx.threads.subscribed(SOURCE)) {
			const ref = giteaRefOfThread(thread.key);
			if (!ref) continue;
			await attempt(`thread ${thread.key}`, async () => {
				const start = ctx.state.get(KV.gitea.thread(thread.key)) ?? thread.createdAt;
				const comments = await client.issueCommentsOf(ref.owner, ref.repo, ref.index, {
					since: start,
					limit: config.maxItems
				}, signal);
				for (const comment of comments) await deliver(commentEvent(comment, ref), eventKey(ref, "comment", String(comment.id)), () => commentTrigger(comment, ref, config));
				ctx.state.set(KV.gitea.thread(thread.key), now());
			});
		}
		if (succeeded === 0 && problems.length) throw new Error(problems.join("; "));
	} else throw new Error("The Gitea Source names no repository");
	ctx.state.set(cursorKey, now());
	const detail = ingest ? `${filed} card(s) filed in Kanban from ${config.repository || "notifications"}` : `${received} new event(s) from ${config.repository || "notifications"}`;
	ctx.report("gitea", {
		state: "ready",
		detail: `${detail}, reading ${reader}${problems.length ? ` (partial: ${problems.join("; ")})` : ""}`,
		at: now()
	});
	return config.pollSeconds;
}
/** Watches the charter repository (the Source's whole job now): readable, and nothing else is polled. */
async function charterHealth(ctx, signal) {
	await ctx.ready;
	while (!signal.aborted) {
		const config = ctx.config(SOURCE);
		const repo = config ? repositoryOf(config.charterRepository) : void 0;
		if (!config) ctx.report("gitea", health("paused", "sourceOff"));
		else if (!repo) ctx.report("gitea", {
			state: "paused",
			detail: "The Gitea Source names no charter repository (it carries the charter and its duties document)"
		});
		else try {
			await new GiteaClient(config).repository(repo.owner, repo.name, signal);
			ctx.report("gitea", {
				state: "ready",
				detail: `charter repository ${config.charterRepository} readable; issues and pull requests are not watched (tasks and their repositories come from Kanban cards)`,
				at: now()
			});
		} catch (error) {
			ctx.report("gitea", {
				state: "error",
				detail: `the charter repository is not readable: ${error instanceof Error ? error.message : String(error)}`
			});
		}
		await pause(6e4, signal);
	}
}
const name = "dsh-superagent-gitea";
const inject = ["orchestrator"];
/** Registers the kind and checks the charter repository; both effects unwind on unload. */
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(giteaKind), "gitea: source kind");
	ctx.effect(() => {
		const source = sourceContext(ctx.orchestrator, giteaKind);
		const controller = new AbortController();
		const running = charterHealth(source, controller.signal).catch((error) => {
			source.report("gitea", {
				state: "error",
				detail: String(error)
			});
		});
		return async () => {
			controller.abort();
			await running;
		};
	}, "gitea: charter health");
}
//#endregion
export { DEFAULT_GITEA_URL, SOURCE, apply, commentEvent, commentTrigger, giteaKind, giteaRef, giteaRefOfThread, giteaThreadId, giteaThreadKey, inject, issueEvent, issueTrigger, name, notificationEvent, notificationTrigger, pollRound, refFromUrl };
