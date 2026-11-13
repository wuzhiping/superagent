# 003 — Kanban Source 设计

## 1. 目标

在**不改领域核心**的前提下，实现一个新的 `SourceKind`：把 Kanban FDEP 看板上「进入监听列的任务」变成 Trigger，把「一条任务」当成 Thread，把回复写回任务评论，并可自动推进列。

## 2. 映射

| 领域 | Kanban | 代码 |
| --- | --- | --- |
| Source kind | `kaneo` | `src/sources/kaneo.ts` |
| Thread key | `kaneo:<taskId>` | `kaneoThreadKey(taskId)` |
| Trigger id | `key('kaneo', taskId, enteredAt)`（进入列的观测时间参与 id，重复轮询幂等） | `kaneo-trigger.ts` |
| Trigger actor | `assigneeId ?? userId ?? 'kaneo'` | 同上 |
| Trigger human | `true`（人来放置卡片；无 bot 概念） | 同上 |
| addressed | `'direct'`（列位即委托） | 同上 |
| Channel | `POST /api/comment/{taskId}`，`{content}` | `kaneo-channel.ts` |
| Channel link | `${baseUrl}/dashboard`（后续精确到 task 路由） | 同上 |
| Thread context | root=任务描述，thread=评论（分页） | `kaneo-read.ts` |
| Policy | `policy.allowed` 行 = `{id}`；`explicit` 文案说明列位 | `kaneo.ts` 的 `policy` |
| Health | `kaneo` | `kaneo.ts` |

## 3. Source 配置 schema（zod）

```ts
KaneoConfigSchema = z.object({
  baseUrl: z.string().url(),                       // 默认 https://pl.feg.cn
  apiKey: z.string().min(1),                       // x-api-key；不出现在 prompt
  workspaceId: z.string().optional(),              // 仅供 policy sync / 展示
  projectId: z.string().min(1),                    // 默认 FDEP
  watchColumns: z.array(z.string()).default(['ready']),  // 列 slug
  claimColumn: z.string().default('in-progress'),  // '' = 不自动推进
  pollSeconds: z.number().int().min(30).max(3600).default(60),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  maxTasksPerColumn: z.number().int().min(1).max(200).default(50),
  actorFallback: z.string().default('kaneo'),      // 无 assignee/creator 时的 actor
}).strict()
```

`fields`（面板表单）：`baseUrl`(text)、`apiKey`(text)、`projectId`(text)、`watchColumns`(rows, 逗号分隔或 rows)、`claimColumn`(text)、`pollSeconds`(number advanced)、`failuresBeforeError`(number advanced)、`maxTasksPerColumn`(number advanced)。

> 面板 `FieldSpec` 只有 switch/select/number/text/fact/rows；`watchColumns` 用 `rows` 的 `columns:[{key:'slug',type:'text'}]`，或简化成 text（逗号分隔）以减少 UI 适配。**决定**：用 `text` 存 JSON 数组不方便；改 schema 为 `watchColumns: string`（逗号分隔）在 parse 时 transform 成数组，是更省事的做法——但 zod schema 输出类型需与面板提交一致。最终实现采用 `text` 字段 + `z.preprocess` 拆分。

## 4. 轮询算法

```
每 pollSeconds：
  cfg = ctx.config('kaneo')；若未启用 → report paused('sourceOff')；continue
  for slug of cfg.watchColumns:
    GET {base}/api/task/tasks/{projectId}?status={slug}&limit={maxTasksPerColumn}&sortBy=updatedAt&sortOrder=desc
    对每个 task：
      if seen(task.id, slug, enteredAt) → skip（KV 去重，带 TTL）
      trigger = kaneoTrigger(task, ...)
      await ctx.receive(trigger)
      ctx.threads.describe(`kaneo:${task.id}`, { label: `#${task.number} ${task.title}`, url, facts })
      if claimColumn && task.status !== claimColumn:
         PUT /api/task/status/{task.id} {status: claimColumn}
      mark seen
  记录 KV：KV.kaneo.cursor(column) = now（可选，仅诊断）
  report ready：`${count} tasks; next poll >= ${interval}s`
```

去重与幂等：
- Trigger id 用 `key('kaneo', taskId, enteredAt)`，`enteredAt` 取任务 `updatedAt`（移列会更新 updatedAt）或 observedAt。
- 另用 KV `kaneo-seen:<taskId>` 记录 `{status, updatedAt}`：同一任务同一状态不重复产生 Trigger；状态/更新时间变化才再次产生（这正是「重新进入监听列」的语义）。
- `receive` 返回 `stored|duplicate|filtered`；duplicate 也不算错误。

失败处理：
- 单列失败不影响其他列；`failures` 累计，超过 `failuresBeforeError` 报 `error` health；单次失败只 report ready 细节？——遵循 github 的 `pollFailure` 模式：连续 N 次才 error。
- 429：读 `Retry-After`，退避；本插件 `fetch` 封装最多重试 3 次。
- 中断：轮询用 AbortSignal，停止时立即返回。

## 5. Trigger 翻译

```ts
{
  id: kaneoTriggerId(task.id, task.updatedAt),
  source: 'kaneo',
  threads: [{ source:'kaneo', id: task.id }],
  actor: { source:'kaneo', id: task.assigneeId ?? task.userId ?? cfg.actorFallback },
  human: true,
  addressed: 'direct',
  at: task.updatedAt ?? now,
  text: `${task.title}\n\n${task.description}`  // 截断到合理长度，完整内容走 thread context
  url: link,
  meta: { taskId, number, status, priority, labels, projectId, columnSlug }
}
```

- 文本截断：description 可很长（FDEP 卡片常 2-5KB）。Trigger `text` 用于 Gate/卡片；完整内容由 `threadContext.read('thread'|'root')` 提供。限制 text 到 ~4000 字符并在 meta 标记。
- actor 合法性：Kanban userId 形如 `bsFdwgQXqZpYKvD5E2emqQ5TQ81eJ3zG`（32 字符），Policy `AllowedSchema` 的 id 无 pattern 限制（`min(1).max(200)`），OK。

## 6. Channel

`send(host, message)`：
- `message.channel.address.taskId`（由 Trigger.channel 提供）。
- 内容 = `message.text`（Outbox 已按 kind 语义组装 acknowledgement/answer/result/attention；不改内容语义）。
- `POST /api/comment/{taskId}` body `{content}`。
- 成功 → `'sent'`；404/403/「task not found」→ `'gone'`；429/5xx/网络 → throw（Outbox 会退避重试）。
- 幂等：Outbox 的 receipt 已保证一次发送；重复调用可能重复评论（可接受，或后续用「查找同 content 的最新评论」去重）。

`link(address, links)`：`{ url: taskUrl(baseUrl, projectId, taskId), label: {zh:'Kanban 任务', en:'Kanban task'} }`。`ChannelLinks` 目前只带 repository/feishu，Kanban URL 由 kind 自己拼（config 里有 baseUrl/projectId，但 `link` 签名只收到 address+links）→ 把 `url` 存进 `address`（Trigger 生成时写入），`link` 直接返回 address.url。**这是设计要点**：Channel.address 是自由 record，可放 `{taskId,url}`。

## 7. ThreadContext

- `messageId(trigger) = trigger.id`。
- `read(commands, trigger, part, cursor, config)`：
  - `part='root'|'thread'`：GET `/api/task/{taskId}` 取 description（root），GET `/api/comment/{taskId}` 取评论；按时间升序；`ContextMessage = {id, from: userName, at: createdAt, text: content, url?}`。
  - 分页：REST 评论列表可能一次全量（实测无分页参数）；若大，可按 `limit` 截断并在 `next` 返回 null。
  - `body` 放任务原始字段（title/status/labels/priority）。
  - `status` 放任务状态。
- 不实现 images（Kanban 评论无图片密钥）。

## 8. Policy

- `policy.schema`：`z.object({ allowed: z.array({id, name?}), bots: z.array(...).optional() }).catchall(z.unknown())`。
  - Kanban 没有 bot 概念；但保留 `bots` 可选以防未来（例如 AI PM 账号）。`explicit` 文案：`名单里的 Kanban 用户把任务放进监听列。`
- `rows(config)`：为每个 `watchColumns` 列给出一个 admission row（`id=slug`，`label=列名`），cells：`listedUnaddressed:true`（只要在列表且卡片在该列，即显式）、`unlistedAddressed:true`、`unlistedUnaddressed:true`？——注意 Trigger 一律 `addressed:'direct'`，所以 gate 走 `allowed && addressed` → explicit；未列出的 → `unlistedAddressed` cell 默认 ignore。为了让「任何放卡的人」都可行，可在初始配置把 `unlistedAddressed:'explicit'`，但默认保守 `ignore`。
- scope：`({meta}) => ({listened:true, observed:false})`（不 observe 全量；因为每个任务都 addressed）。
  - 但 gate 对 `human:true` 且 `addressed` 的 Trigger：`receivable = !!trigger.addressed` → 使用 `unlistedAddressed` cell；allowed+addressed 直接 explicit。OK。

## 9. 环境变量（仅提示文本）

`DSH_SUPERAGENT_KANEO_PROJECT`、`_TASK`、`_TASK_URL`、`_NUMBER`、`_STATUS`
（API key **不**注册为环境变量。）

## 10. Health

单一 `kaneo` 条目：
- `starting` → 未 ready。
- `paused`：source off / setup pending。
- `ready`：`${count} tasks from ${columns}; next poll >= ${interval}s`，附 `at`。
- `error`：连续 `failuresBeforeError` 次轮询失败，detail 含错误。

## 11. 测试计划（单测）

1. `kaneoTrigger`：字段映射、thread key、id 稳定性、长描述截断、无 assignee 回退。
2. 轮询：fake fetch 返回两列任务；断言只对未 seen 的任务产生 Trigger；重复轮询不重复；claimColumn 触发 PUT。
3. Channel：fake fetch 断言 URL/headers/body；404 → gone；429 → throw。
4. ThreadContext：description→root 消息、评论→消息、排序。
5. scope/gate 集成：`settingsPolicy` 里 allowed+addressed → explicit；不在列表 → filtered。

## 12. 与上游差异（风险）

- 上游 PR/CI 语义在 Kanban 不存在，所以 `pullEndNotices`、PR 绑定工具、`github/…` 资源对 Kanban 工单无意义（调用会失败或返回空）；文档标注。
- Ticket 结束的「完成」判定：Kanban 没有 merge 事件，`ready` report 足够让 Ticket 结束（无 follows 时）。Task 列推进到 `qa` 需要额外轮询逻辑，本期不做。

## 13. 实现差异与实测结论（2026-11-03）

设计与最终实现的差异，以及实测确认：

1. **`watchColumns` 是逗号分隔字符串**（面板 `text` 字段），不是数组；`watchColumnsOf()` 拆分。`requiredLabels` 同样。
2. **去重语义是「一个任务一生一次」**：`KV.kaneo.seen:<taskId>` 永久标记；`updatedAt` 变化不会重复触发。首次轮询 `bootstrap=skip` 标记监听列已有任务（FDEP 首次 28 张全部标为已见，实测 `kaneo=ready "0 new tasks from ready"`）。
3. **claim 时机**：Trigger `receive` 返回非 `filtered` 后立即 `PUT /task/status/{id}` 到 `claimColumn`；实测任务在 Eval 之前就进了 `in-progress`。
4. **URL（2026-11-13 已确认）**：`kaneoTaskUrl` 产出 `…/dashboard/workspace/<workspaceId>/project/<projectId>/board?taskId=<taskId>`，与 Kanban 应用自身的卡片链接一致，打开即定位到该卡。`ThreadDescription.url`、Ticket channels、`DSH_SUPERAGENT_KANEO_URL` 与环境变量都用它；单测覆盖了带/不带 workspace 两种形态。
5. **REST 列表形状**：`GET /task/tasks/{projectId}?status=<slug>&limit=N` 返回 `{data:{columns:[…]}}`（不是任务数组），`columnTasks()` 负责摊平；不传 `status` 时列内任务为空，因此验证账号用 `board()`（不带 status，只校验 200）。
6. **setup 账号校验走 REST**：`GET /task/tasks/{projectId}?limit=1`；401/403→`kaneoKeyRefused`，404→`kaneoProjectUnreadable`，其余→`kaneoUnreachable`。实测保存后 `restarting:true` 且重启成功。
7. **评论身份**：Kanban 评论作者 = API key 所属用户（实测显示「吴志平」）；没有 bot 身份概念。Markers `<!-- dsh-superagent:<messageId> -->` 保证 Outbox 重试不重复评论。
8. **Windows 运行阻塞**：主 Session 的 `tools.restrict` allow 列表需按平台选 `pwsh`（见 002 D9），否则插件重启后 fiber failed。
9. **实测端到端**：任务 #470 → Trigger → Decision accept(explicitRouted) → Ticket → Worker 创建 `smoke.txt` → ack/result 两条评论 → Ticket completed。证据见 [`artifacts/`](artifacts/)。
