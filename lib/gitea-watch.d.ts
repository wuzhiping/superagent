import { W as Trigger, ht as GiteaConfig, mt as DEFAULT_GITEA_URL } from "./intake-LzTuo899.js";
import { n as SourceContext, t as SourceKind } from "./kind-DUtZFUu7.js";
import { t as InboxEvent } from "./kaneo-inbox-EA3qOtMv.js";
import { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
//#region src/sources/gitea-api.d.ts
type GiteaFetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Authentication for one Gitea server: a token, or the account's login and password. */
interface GiteaAuth {
  baseUrl: string;
  user?: string | undefined;
  password?: string | undefined;
  token?: string | undefined;
}
interface GiteaRepository {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
  has_issues: boolean;
  has_pull_requests: boolean;
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}
interface GiteaUser {
  id: number;
  login: string;
  full_name?: string;
  email?: string;
  is_admin?: boolean;
}
declare const NotificationSchema: z.ZodObject<{
  id: z.ZodString;
  unread: z.ZodDefault<z.ZodBoolean>;
  updated_at: z.ZodString;
  subject: z.ZodObject<{
    title: z.ZodDefault<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodString>;
  }, z.core.$loose>;
  repository: z.ZodOptional<z.ZodObject<{
    full_name: z.ZodOptional<z.ZodString>;
  }, z.core.$loose>>;
}, z.core.$loose>;
declare const IssueSchema: z.ZodObject<{
  id: z.ZodNumber;
  number: z.ZodNumber;
  title: z.ZodString;
  body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  state: z.ZodDefault<z.ZodString>;
  user: z.ZodOptional<z.ZodNullable<z.ZodObject<{
    login: z.ZodString;
  }, z.core.$loose>>>;
  assignee: z.ZodOptional<z.ZodNullable<z.ZodObject<{
    login: z.ZodString;
  }, z.core.$loose>>>;
  created_at: z.ZodString;
  updated_at: z.ZodString;
  html_url: z.ZodOptional<z.ZodString>;
  pull_request: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>;
declare const CommentSchema: z.ZodObject<{
  id: z.ZodNumber;
  body: z.ZodDefault<z.ZodString>;
  user: z.ZodOptional<z.ZodNullable<z.ZodObject<{
    login: z.ZodString;
  }, z.core.$loose>>>;
  created_at: z.ZodString;
  updated_at: z.ZodString;
  html_url: z.ZodOptional<z.ZodString>;
  issue_url: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
declare const PullSchema: z.ZodObject<{
  id: z.ZodNumber;
  number: z.ZodNumber;
  title: z.ZodString;
  state: z.ZodDefault<z.ZodString>;
  user: z.ZodOptional<z.ZodNullable<z.ZodObject<{
    login: z.ZodString;
  }, z.core.$loose>>>;
  created_at: z.ZodString;
  updated_at: z.ZodString;
  html_url: z.ZodOptional<z.ZodString>;
  merged: z.ZodOptional<z.ZodBoolean>;
  merged_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  head: z.ZodOptional<z.ZodObject<{
    sha: z.ZodOptional<z.ZodString>;
  }, z.core.$loose>>;
}, z.core.$loose>;
type GiteaNotification = z.infer<typeof NotificationSchema>;
type GiteaIssue = z.infer<typeof IssueSchema>;
type GiteaComment = z.infer<typeof CommentSchema>;
type GiteaPull = z.infer<typeof PullSchema>;
/** One Gitea server; tests substitute `fetch` and the retry clock. */
declare class GiteaClient {
  private readonly account;
  private readonly fetchImpl;
  private readonly wait;
  private readonly base;
  constructor(account: GiteaAuth, fetchImpl?: GiteaFetch, wait?: (ms: number) => Promise<void>);
  /** Sends one request and parses its JSON body; 429 and 5xx retry with backoff, others surface `GiteaError`. */
  request<T>(schema: z.ZodType<T>, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  /** `GET /version`; works without a token and tells which Gitea the instance runs. */
  version(signal?: AbortSignal): Promise<string>;
  /** `GET /user`; requires a token and is how deployment verifies the agent account. */
  user(signal?: AbortSignal): Promise<GiteaUser>;
  /** `GET /repos/{owner}/{repo}`. */
  repository(owner: string, name: string, signal?: AbortSignal): Promise<GiteaRepository>;
  /** `GET /notifications`; `since` is an RFC 3339 timestamp. */
  notifications(options?: {
    since?: string;
    all?: boolean;
    limit?: number;
  }, signal?: AbortSignal): Promise<GiteaNotification[]>;
  /** `GET /repos/{owner}/{repo}/issues`; `since` is an RFC 3339 timestamp. */
  issues(owner: string, name: string, options?: {
    state?: string;
    since?: string;
    limit?: number;
  }, signal?: AbortSignal): Promise<GiteaIssue[]>;
  /** `GET /repos/{owner}/{repo}/issues/comments`; repository-wide comments, `since` an RFC 3339 timestamp. */
  issueComments(owner: string, name: string, options?: {
    since?: string;
    limit?: number;
  }, signal?: AbortSignal): Promise<GiteaComment[]>;
  /** `GET /repos/{owner}/{repo}/pulls`; Gitea has no `since`, so callers filter by `updated_at`. */
  pulls(owner: string, name: string, options?: {
    state?: string;
    sort?: string;
    limit?: number;
  }, signal?: AbortSignal): Promise<GiteaPull[]>;
  /** `GET /repos/{owner}/{repo}/issues/{index}`; a pull request is an issue too and carries `pull_request`. */
  issue(owner: string, name: string, index: number, signal?: AbortSignal): Promise<GiteaIssue>;
  /** `GET /repos/{owner}/{repo}/issues/{index}/comments`; `since` an RFC 3339 timestamp. */
  issueCommentsOf(owner: string, name: string, index: number, options?: {
    since?: string;
    limit?: number;
  }, signal?: AbortSignal): Promise<GiteaComment[]>;
  /** `POST /repos/{owner}/{repo}/issues/{index}/comments`; returns the created comment. */
  createIssueComment(owner: string, name: string, index: number, body: string, signal?: AbortSignal): Promise<GiteaComment>;
}
//#endregion
//#region src/sources/gitea.d.ts
declare const SOURCE = "gitea";
interface GiteaRef {
  owner: string;
  repo: string;
  index: number;
}
declare const giteaThreadId: (ref: GiteaRef) => string;
declare const giteaThreadKey: (ref: GiteaRef) => string;
/** Parse `gitea:owner/repo#123` back into a reference. */
declare function giteaRefOfThread(keyValue: string): GiteaRef | undefined;
/** A Trigger's Gitea reference, from its meta (written by every trigger builder). */
declare function giteaRef(trigger: Trigger): GiteaRef | undefined;
/** An issue (or pull request) that was created or updated since the cursor. */
declare function issueTrigger(issue: GiteaIssue, ref: GiteaRef, config: GiteaConfig, at?: string): Trigger;
/** A comment on an issue or pull request. A mention of the agent addresses it explicitly. */
declare function commentTrigger(comment: GiteaComment, ref: GiteaRef, config: GiteaConfig, at?: string, title?: string): Trigger;
/** A notification of the agent account; Gitea only notifies about things directed at the account. */
declare function notificationTrigger(notification: GiteaNotification, ref: GiteaRef, config: GiteaConfig, issue?: GiteaIssue, at?: string): Trigger;
/** `owner/repo/issues/5` (or `/pulls/5`) from a Gitea URL. */
declare function refFromUrl(value: string | null | undefined): GiteaRef | undefined;
/** The card an issue or a pull request becomes: its title, its body and its link. */
declare function issueEvent(issue: GiteaIssue): InboxEvent;
/** The card a comment becomes: the issue it belongs to, the comment itself and its link. */
declare function commentEvent(comment: GiteaComment, ref: GiteaRef, title?: string): InboxEvent;
/** The card a notification becomes: the title of the issue or pull request it points at. */
declare function notificationEvent(notification: GiteaNotification, issue?: GiteaIssue): InboxEvent;
declare const giteaKind: SourceKind<GiteaConfig>;
/**
 * One polling round: baseline on first poll, then issue/comment/notification increments are filed as cards in the
 * KanEO board. KanEO is the only direct source, so the events do not become requests here (unless the KanEO Source
 * switched its inbox off); they become cards in the `to-do` pool, and the board schedules them from there.
 */
declare function pollRound(ctx: SourceContext, config: GiteaConfig, client: GiteaClient, signal?: AbortSignal): Promise<number>;
declare const name = "dsh-superagent-gitea";
declare const inject: string[];
/** Registers the kind and starts the polling loop; both effects unwind on unload. */
declare function apply(ctx: Context): void;
//#endregion
export { DEFAULT_GITEA_URL, GiteaRef, SOURCE, apply, commentEvent, commentTrigger, giteaKind, giteaRef, giteaRefOfThread, giteaThreadId, giteaThreadKey, inject, issueEvent, issueTrigger, name, notificationEvent, notificationTrigger, pollRound, refFromUrl };