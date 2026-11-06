import { W as Trigger, ft as DEFAULT_NTFY_URL, pt as NtfyConfig } from "./intake-BMM76792.js";
import { n as SourceKind, r as SourceContext } from "./kind-Dfy9J4Q-.js";
import { t as InboxEvent } from "./kaneo-inbox-DPXhMW9G.js";
import { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
//#region src/sources/ntfy-api.d.ts
type NtfyFetch = (input: string, init?: RequestInit) => Promise<Response>;
/** One message as the server returns it in the `/<topic>/json` stream; deletes arrive as `message_delete` events. */
declare const NtfyMessageSchema: z.ZodObject<{
  id: z.ZodString;
  time: z.ZodNumber;
  expires: z.ZodOptional<z.ZodNumber>;
  event: z.ZodDefault<z.ZodString>;
  topic: z.ZodDefault<z.ZodString>;
  title: z.ZodDefault<z.ZodString>;
  message: z.ZodDefault<z.ZodString>;
  priority: z.ZodOptional<z.ZodNumber>;
  tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
  content_type: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type NtfyMessage = z.infer<typeof NtfyMessageSchema>;
interface NtfyAuth {
  mode: 'none' | 'basic' | 'bearer';
  user: string;
  password: string;
  token: string;
}
interface NtfyAccount {
  baseUrl: string;
  topic: string;
  auth: NtfyAuth;
  sender?: string | undefined;
}
/** One ntfy server; tests substitute `fetch`. */
declare class NtfyClient {
  private readonly account;
  private readonly fetchImpl;
  private readonly base;
  constructor(account: NtfyAccount, fetchImpl?: NtfyFetch);
  /** Reads the topic's recent history. `since` is a ntfy duration (e.g. `30m`, `3600s`) or `all`. */
  history(since: string, options?: {
    limit?: number;
    signal?: AbortSignal;
  }): Promise<NtfyMessage[]>;
  /**
   * Publishes a message. This server does not parse a JSON body: the text is the plain body and the metadata travels in
   * the `Title`/`Priority`/`Tags` headers (verified against msn.feg.cn).
   */
  publish(text: string, options?: {
    title?: string;
    priority?: number;
    tags?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{
    id?: string;
  }>;
}
//#endregion
//#region src/sources/ntfy.d.ts
declare const SOURCE = "ntfy";
/** The tags a message must carry to be handled, lower-cased; empty means every message is handled. */
declare const ingestTagsOf: (config: Pick<NtfyConfig, "ingestTags">) => string[];
/** Whether a message passes the intake tag filter; a message without tags passes only when no filter is set. */
declare const messageWanted: (config: Pick<NtfyConfig, "ingestTags">, tags: readonly string[] | undefined) => boolean;
/** The title convention for a sender: `#name` or `@name`. */
declare const ntfySenderOf: (title: string) => string | undefined;
declare function ntfyTrigger(message: NtfyMessage, config: NtfyConfig, at?: string): Trigger;
/** The card a message becomes: its title, or the first line of its text when it has no title. */
declare function messageEvent(message: NtfyMessage, config: NtfyConfig): InboxEvent;
declare const ntfyKind: SourceKind<NtfyConfig>;
/**
 * One polling round: baseline on first read, then every newer message is filed as a card in the Kanban board. Kanban is
 * the only direct source, so a message does not become a request here (unless the Kanban Source switched its inbox off);
 * it becomes a card in the `to-do` pool, and the board schedules it from there.
 */
declare function pollRound(ctx: SourceContext, config: NtfyConfig, client: NtfyClient, signal?: AbortSignal): Promise<number>;
declare const name = "dsh-superagent-ntfy";
declare const inject: string[];
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
declare function apply(ctx: Context): void;
//#endregion
export { DEFAULT_NTFY_URL, SOURCE, apply, ingestTagsOf, inject, messageEvent, messageWanted, name, ntfyKind, ntfySenderOf, ntfyTrigger, pollRound };