import { _t as DEFAULT_PROJECT, gt as DEFAULT_CLAIM_COLUMN, ht as DEFAULT_BASE_URL, vt as KaneoConfig } from "./intake-Cr0pk4VV.js";
import { n as SourceContext, t as SourceKind } from "./kind-WF9My7tQ.js";
import { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
//#region src/sources/kaneo-api.d.ts
type KaneoFetch = (input: string, init?: RequestInit) => Promise<Response>;
interface RequestOptions {
  signal?: AbortSignal | undefined;
  retry?: boolean | undefined;
}
/** One Kaneo server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
declare class KaneoClient {
  private readonly config;
  private readonly fetchImpl;
  private readonly wait;
  private readonly base;
  constructor(config: {
    baseUrl: string;
    apiKey: string;
  }, fetchImpl?: KaneoFetch, wait?: (ms: number) => Promise<void>);
  /** Sends one request and parses its JSON body; 429 and 5xx are retried with backoff, and a 404/403 surfaces as `KaneoError` with its status. */
  request<T>(schema: z.ZodType<T>, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  /** Tasks of one board column, newest position first as Kaneo returns them. */
  columnTasks(projectId: string, status: string, limit: number, options?: RequestOptions): Promise<unknown[]>;
  /** Reads the project board once without a column filter; used by setup to check the key and project without touching a column. */
  board(projectId: string, options?: RequestOptions): Promise<void>;
  /** One task by id. */
  task(id: string, options?: RequestOptions): Promise<unknown>;
  /** The comments of one task, oldest first as Kaneo returns them. */
  comments(taskId: string, options?: RequestOptions): Promise<unknown[]>;
  /** Posts a comment on a task. */
  comment(taskId: string, content: string, options?: RequestOptions): Promise<void>;
  /** Moves a task to another column of its project. */
  move(id: string, status: string, options?: RequestOptions): Promise<void>;
}
//#endregion
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