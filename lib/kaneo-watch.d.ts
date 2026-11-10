import { _t as DEFAULT_CLAIM_COLUMN, gt as DEFAULT_BASE_URL, vt as DEFAULT_PROJECT, yt as KaneoConfig } from "./intake-CMGpbNbA.js";
import { n as SourceKind, r as SourceContext } from "./kind-DEcPS-0m.js";
import { t as KaneoClient } from "./kaneo-api-Dn0KpjUW.js";
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
 * Cancels a ticket whose request disappeared on the board: the card lands in a cancel column, or the card itself is gone
 * (404). The ticket ends as a person-stopped duty with the reason, so the SuperAgent side matches the board.
 */
declare function syncCancellations(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<void>;
/**
 * Marks a card whose ticket waits for a person with the hold label, so the board shows the hold and the release is a board
 * action: the person writes the decision on the card and removes the label. The host never removes it itself.
 */
declare function syncHoldLabels(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<void>;
/**
 * Keeps the card's column in step with a hold: a ticket that waits for a person moves its card to `blockedColumn`, and one
 * that runs again moves it back to the claim column. The move is cosmetic — the decision itself reaches the Session as an
 * Input through observation. Empty `blockedColumn` disables the move entirely.
 */
declare function syncBlockedColumns(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<void>;
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
declare function pollRound(ctx: SourceContext, config: KaneoConfig, client: KaneoClient, signal?: AbortSignal): Promise<number>;
declare const name = "dsh-superagent-kaneo";
declare const inject: string[];
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
declare function apply(ctx: Context): void;
//#endregion
export { DEFAULT_BASE_URL, DEFAULT_CLAIM_COLUMN, DEFAULT_PROJECT, SOURCE, apply, inject, kaneoKind, name, observeCards, policyWorkspace, pollRound, refreshKaneoMembers, syncBlockedColumns, syncCancellations, syncHoldLabels };