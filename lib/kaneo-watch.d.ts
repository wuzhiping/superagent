import { _t as DEFAULT_CLAIM_COLUMN, gt as DEFAULT_BASE_URL, vt as DEFAULT_PROJECT, yt as KaneoConfig } from "./intake-ilgXfm6V.js";
import { n as SourceKind, r as SourceContext } from "./kind-B876vTuF.js";
import { t as KaneoClient } from "./kaneo-api-BaNgAWFU.js";
import { Context } from "@deepseek-ai/cordis";
//#region src/sources/kaneo.d.ts
declare const SOURCE = "kaneo";
/**
 * The workspace whose members the Policy roster reads: the configured workspace, else the watched project's workspace, else
 * the first workspace the account can see. Members' ids are the assignee/creator ids the board reports as actors.
 */
declare function policyWorkspace(client: KaneoClient, config: KaneoConfig, signal?: AbortSignal): Promise<string | undefined>;
/**
 * Refreshes the Kanban member roster (`id -> name`) the Policy's "who may originate work" column chooses from, and stores
 * it for the panel. A missing account or workspace answers an empty roster instead of failing the panel.
 */
declare function refreshKaneoMembers(ctx: SourceContext, signal?: AbortSignal): Promise<Record<string, string>>;
/** The Source kind declaration: configuration form, policy part, Channel, Thread context, environment and health. */
declare const kaneoKind: SourceKind<KaneoConfig>;
/**
 * Polls the cards of live tickets and turns a comment, title or description change into an Input for the running
 * assignment. Kanban itself only requests a task when it enters a watched column, so this is what keeps feedback written
 * on the card from being lost while a post is already working on it. The first look only records a baseline.
 */
declare function observeCards(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<number>;
/**
 * One polling round: read each watched column, record a Trigger for a task not seen before, describe its Thread, and move
 * it to the claim column. The first round under `bootstrap: 'skip'` only records what is already there. A failed column is
 * reported but does not stop the others; once every column has been tried, a failure makes the round fail so health sees it.
 */
/**
 * Points every stored Kanban card page at the board route that opens the card, repairing the addresses of Threads
 * described before that route was known. Idempotent and offline: it rewrites only addresses that differ, so the first
 * round after a change repairs them and later rounds write nothing.
 */
declare function refreshThreadPages(ctx: SourceContext, config: KaneoConfig): void;
declare function pollRound(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<number>;
declare const name = "dsh-superagent-kaneo";
declare const inject: string[];
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
declare function apply(ctx: Context): void;
//#endregion
export { DEFAULT_BASE_URL, DEFAULT_CLAIM_COLUMN, DEFAULT_PROJECT, SOURCE, apply, inject, kaneoKind, name, observeCards, policyWorkspace, pollRound, refreshKaneoMembers, refreshThreadPages };