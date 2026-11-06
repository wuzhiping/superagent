import { _t as DEFAULT_CLAIM_COLUMN, gt as DEFAULT_BASE_URL, vt as DEFAULT_PROJECT, yt as KaneoConfig } from "./intake-CqqqeEtG.js";
import { n as SourceKind, r as SourceContext } from "./kind-Bpsd_DUt.js";
import { t as KaneoClient } from "./kaneo-api-BvU5fGZP.js";
import { Context } from "@deepseek-ai/cordis";
//#region src/sources/kaneo.d.ts
declare const SOURCE = "kaneo";
/** The Source kind declaration: configuration form, policy part, Channel, Thread context, environment and health. */
declare const kaneoKind: SourceKind<KaneoConfig>;
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
export { DEFAULT_BASE_URL, DEFAULT_CLAIM_COLUMN, DEFAULT_PROJECT, SOURCE, apply, inject, kaneoKind, name, pollRound };