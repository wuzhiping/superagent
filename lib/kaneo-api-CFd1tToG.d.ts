import { z } from "zod";
//#region src/sources/kaneo-api.d.ts
type KaneoFetch = (input: string, init?: RequestInit) => Promise<Response>;
interface RequestOptions {
  signal?: AbortSignal | undefined;
  retry?: boolean | undefined;
}
/** A task as Kaneo answers a card creation: the id and number identify it, the column slug says where it landed. */
declare const CreatedTaskSchema: z.ZodObject<{
  id: z.ZodString;
  number: z.ZodOptional<z.ZodNumber>;
  title: z.ZodDefault<z.ZodString>;
  status: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** A label as Kaneo answers a label creation; the same name answers with the label that already exists. */
declare const LabelSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** A workspace as Kaneo answers the workspace list; labels live in a workspace. */
declare const WorkspaceSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
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
  /**
   * Creates a card in a project. `status` is the slug of the column it lands in; no assignee is written, so the card
   * waits in the pool until a person assigns it. Kaneo requires `priority`, so the caller always names one.
   */
  createTask(projectId: string, body: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
  }, options?: RequestOptions): Promise<z.infer<typeof CreatedTaskSchema>>;
  /** Creates a label in a workspace; the same name answers with the label that already exists. */
  createLabel(name: string, color: string, workspaceId: string, options?: RequestOptions): Promise<z.infer<typeof LabelSchema>>;
  /** Attaches a label to a card, so the board shows where the card came from. */
  attachLabel(labelId: string, taskId: string, options?: RequestOptions): Promise<void>;
  /** The workspaces the API key can read; labels belong to one of them. */
  workspaces(options?: RequestOptions): Promise<z.infer<typeof WorkspaceSchema>[]>;
}
//#endregion
export { KaneoClient as t };