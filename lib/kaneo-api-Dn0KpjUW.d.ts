import { z } from "zod";
//#region src/sources/kaneo-api.d.ts
type KaneoFetch = (input: string, init?: RequestInit) => Promise<Response>;
interface RequestOptions {
  signal?: AbortSignal | undefined;
  retry?: boolean | undefined;
}
/** A task as Kanban answers a card creation: the id and number identify it, the column slug says where it landed. */
declare const CreatedTaskSchema: z.ZodObject<{
  id: z.ZodString;
  number: z.ZodOptional<z.ZodNumber>;
  title: z.ZodDefault<z.ZodString>;
  status: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** A label as Kanban answers a label creation; the same name answers with the label that already exists. */
declare const LabelSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** A workspace as Kanban answers the workspace list; labels live in a workspace. */
declare const WorkspaceSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** The account behind the API key: its id identifies the post on the board, its role says what it may manage. */
declare const KaneoUserSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
  email: z.ZodDefault<z.ZodString>;
  role: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** One project: the board's title, the description the charter is published into, and the columns' slugs. */
declare const KaneoProjectSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
  slug: z.ZodDefault<z.ZodString>;
  description: z.ZodDefault<z.ZodString>;
  icon: z.ZodDefault<z.ZodString>;
  isPublic: z.ZodDefault<z.ZodBoolean>;
  workspaceId: z.ZodDefault<z.ZodString>;
  columns: z.ZodDefault<z.ZodArray<z.ZodObject<{
    slug: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
  }, z.core.$loose>>>;
}, z.core.$loose>;
/** One project as the list answers it: what a picker needs to show a name and store an id. */
declare const KaneoProjectRefSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
  slug: z.ZodDefault<z.ZodString>;
  workspaceId: z.ZodDefault<z.ZodString>;
}, z.core.$loose>;
/** One board column as the workflow endpoints answer it: the cuid identifies it, the slug is what tasks are stored by. */
declare const KaneoColumnSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
  slug: z.ZodDefault<z.ZodString>;
  isFinal: z.ZodDefault<z.ZodBoolean>;
  position: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
/** One Kanban server; `request` is the only method that touches the network, so tests substitute `fetch` and the retry clock. */
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
  /** Tasks of one board column, newest position first as Kanban returns them. */
  columnTasks(projectId: string, status: string, limit: number, options?: RequestOptions): Promise<unknown[]>;
  /** Reads the project board once without a column filter; used by setup to check the key and project without touching a column. */
  board(projectId: string, options?: RequestOptions): Promise<void>;
  /** One task by id. */
  task(id: string, options?: RequestOptions): Promise<unknown>;
  /**
   * One project: its name, its columns and — the project-level charter's home — its description. Every post of the
   * project reads the same record, whichever Host it runs on (RD.md §4.1, §8).
   */
  project(id: string, options?: RequestOptions): Promise<z.infer<typeof KaneoProjectSchema>>;
  /**
   * The projects of one workspace. The panel lists them so a person picks the project instead of typing its id; the
   * list needs the workspace id because the server scopes projects to a workspace.
   */
  projects(workspaceId: string, options?: RequestOptions): Promise<z.infer<typeof KaneoProjectRefSchema>[]>;
  /**
   * Replaces one project. The server validates the whole project, so every field the request carries must be sent —
   * the caller reads the project first and sends it back with the field it changes (the charter publishes into
   * `description`).
   */
  updateProject(id: string, body: {
    name: string;
    slug: string;
    icon: string;
    isPublic: boolean;
    description: string;
  }, options?: RequestOptions): Promise<void>;
  /** The columns of one project's board, in board order; the value stream the team works in. */
  columns(projectId: string, options?: RequestOptions): Promise<z.infer<typeof KaneoColumnSchema>[]>;
  /** Adds a column to the end of a project's board: the flow grows by the PM confirming what the retrospective found. */
  createColumn(projectId: string, body: {
    name: string;
    icon?: string;
    color?: string;
    isFinal?: boolean;
  }, options?: RequestOptions): Promise<z.infer<typeof KaneoColumnSchema>>;
  /** The comments of one task, oldest first as Kanban returns them. */
  comments(taskId: string, options?: RequestOptions): Promise<unknown[]>;
  /** Posts a comment on a task. */
  comment(taskId: string, content: string, options?: RequestOptions): Promise<void>;
  /** Moves a task to another column of its project. */
  move(id: string, status: string, options?: RequestOptions): Promise<void>;
  /**
   * Creates a card in a project. `status` is the slug of the column it lands in; no assignee is written, so the card
   * waits in the pool until a person assigns it. Kanban requires `priority`, so the caller always names one.
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
  /** The account behind the API key; its role (`admin` or `member`) says whether it may manage the board's flow. */
  me(options?: RequestOptions): Promise<z.infer<typeof KaneoUserSchema>>;
  /** The members of a workspace: their ids are the board's assignees, their e-mails the friendly account a post names. */
  workspaceMembers(workspaceId: string, options?: RequestOptions): Promise<z.infer<typeof KaneoUserSchema>[]>;
}
//#endregion
export { KaneoClient as t };