# FLOW · 从来源到执行的数据与决策流

> 本文回答三个问题：**数据从哪来**（来源 → Trigger）、**谁在什么条件下接单**（准入 → 评估 → 决策）、
> **接单后怎么执行与回写**（工单 → 派工 → worker → 报告 → 回复）。
> 配套阅读：[docs/005-panel.md](docs/005-panel.md)（来源配置）、[docs/007-architecture.md](docs/007-architecture.md)（模块职责）、
> [BLK.md](BLK.md)（阻塞/裁决/取消）、[docs/003-execution.md](docs/003-execution.md)（工单阶段表）。

---

## 1. 总览

```mermaid
flowchart LR
  subgraph SRC["来源 Sources"]
    K["Kanban 看板<br/>监听列 + 标签"]
    N["ntfy 主题"]
    G["Gitea 宪章仓库"]
    S["MinIO 对象存储"]
    X["飞书 / GitHub<br/>（可选事件来源）"]
  end

  subgraph ING["摄入 Intake"]
    P["轮询 / 事件循环<br/>pollSeconds"]
    T["Trigger<br/>source · threads · actor · human · addressed · text · channel · meta"]
    I["Intake<br/>去重 → scope 过滤 → 记录 → 扇出"]
    TH[("Thread<br/>pending · evaluating · subscriptions")]
  end

  subgraph DEC["评估与决策"]
    PS["Passes<br/>每 2s + 新触发立即"]
    EV["Evals<br/>按 Thread 批量 · 截止时间"]
    MS["主 Session<br/>orchestrator_eval / orchestrator_route"]
    D{"Decision<br/>accept / ignore / stop / unavailable"}
  end

  subgraph EXE["执行"]
    TK["Tickets.create<br/>Mandate · Subscription · Assignment(pending)"]
    EX["DshExecutor<br/>launch / delivery / reply 效果"]
    W["worker Session<br/>worker-&lt;ticketId&gt;"]
    R["Report<br/>ready / waiting / progress / blocked / failed / dropped"]
  end

  subgraph OUT["回写"]
    A["Assignments · Tickets<br/>attention · answers · ended"]
    O["Outbox<br/>acknowledgement / answer / result / attention"]
    C["来源 Channel<br/>Kanban 评论+移列 · ntfy 消息 · Gitea 评论"]
  end

  N -->|"消息先建成 Kanban 卡"| K
  K --> P
  X --> P
  G -.->|"宪章/职责文本进入提示词"| MS
  S -.->|"worker 用 MinIO 工具存取资产"| W
  P --> T --> I --> TH
  TH --> PS --> EV --> MS --> D
  D -- "accept" --> TK --> EX --> W --> R --> A
  D -- "ignore / stop / unavailable" --> EV
  R -->|"报告与问题 relay 给主 Session"| MS
  A --> O --> C
  K -.->|"卡更新 → Input"| I
  K -.->|"卡取消/删除 → stopTicket"| A
```

一句话概括：**来源只负责把外部事实变成 Trigger；Intake 负责去重与扇出；Evals + 主 Session 负责“接不接”；Tickets 负责“以什么授权接”；DshExecutor 负责“谁、在哪个目录、用什么 Session 去执行”；Replies 负责“结果怎么回去”。**

---

## 2. 来源层：数据怎么进来

| 来源 | 角色 | 进入系统的形态 | 是否直接产生任务 |
| --- | --- | --- | --- |
| **Kanban 看板** | 唯一的直接任务来源 | 监听列中的任务 → `Trigger`（`human=true`，`addressed=direct`） | ✅ |
| **ntfy 主题** | 消息入口 | 新消息先**建成 Kanban 卡**（to-do 池），由看板调度 | ❌（间接） |
| **Gitea（宪章仓库）** | 文档/宪章来源 | 宪章与 `duties/` 文本进入评估与 worker 提示词 | ❌ |
| **MinIO 对象存储** | 资产/交付物载体 | worker 通过 MinIO 工具读写；不产生任务 | ❌ |
| **飞书 / GitHub** | 可选的事件来源 | 消息 / Issue / PR → Trigger（与 Kanban 同一管道） | ✅ |

### 2.1 Kanban 轮询

```mermaid
flowchart TD
  A["每 pollSeconds 一轮"] --> B["读监听列任务<br/>columnTasks(project, watchColumns)"]
  B --> C{"任务带必需标签?<br/>requiredLabels"}
  C -- 否 --> Z["跳过（不产生 Trigger）"]
  C -- 是 --> D{"KV.kaneo.seen 已见过?"}
  D -- 是 --> Z
  D -- 否 --> E{"首次轮询且 bootstrap=skip?"}
  E -- 是 --> F["只记录基线 seen，不产生 Trigger"]
  E -- 否 --> G["kaneoTrigger(task)<br/>actor=负责人/创建者<br/>threads=[kaneo:taskId]<br/>channel=卡片评论"]
  G --> H["ctx.receive(trigger) → Intake"]
  H --> I["记录 seen(task) 与线程描述"]
  I --> J["同一轮还做：观察卡更新 / hold 标签 / 取消同步"]
```

- **`bootstrap=skip`**：第一次看到的历史卡只登记、不接单；`bootstrap=trigger` 则把已有卡也当请求。
- **`KV.kaneo.seen`**：同一任务只产生一次 Trigger，之后靠“卡更新观察”产生增量 Input。
- **看板观察**（`observeUpdates`）：运行中工单的卡出现**评论/标题/描述/列**变化 → 生成更新 Trigger（`human=true`，`meta.update=true`）→ 作为 Input 送给同一工单的 Session，**不新开工单**。
- **hold 标签 / 取消列**：卡上 `holdLabel`（默认 `blocked`）存在时暂停投递、保留基线；移除标签 → `holdLifted` Trigger → 同一工单/同一 Session 恢复。卡进入 `cancelColumns` 或被删除（404）→ `ctx.cancel` → 工单 `stopped`。详见 [BLK.md](BLK.md)。

### 2.2 其他来源

- **ntfy**：轮询主题历史 → 每条消息调用 Kanban API 建卡（`to-do` 列）；卡进入看板后才走 Kanban 管道。
- **Gitea**：面板“测试连接”与实际健康检查都只校验 `charterRepository`；它不监听 Issue/PR，卡片的 `repo:owner/name` 才决定工单用哪个代码仓库。
- **MinIO**：`s3` 来源只做连通/桶探测与工具能力，不产生 Trigger。

---

## 3. 摄入 Intake：去重、过滤、扇出

```mermaid
flowchart TD
  T["Trigger（来自 Source）"] --> N["规范化时间 at"]
  N --> D{"Trigger.id 已存在?"}
  D -- 是 --> DUP["返回 duplicate（幂等）"]
  D -- 否 --> S{"scope.scope(trigger)<br/>来源是否接收?"}
  S -- 否 --> F["保存 Trigger + disposition.filtered(reason)<br/>返回 filtered"]
  S -- 是 --> SV["保存 Trigger，更新 Thread.lastAt / correlated"]
  SV --> L["遍历 Trigger.threads 下的 subscriptions"]
  L --> M{"工单 live？<br/>或 human 消息可复活已结束工单？"}
  M -- 否 --> L
  M -- 是 --> IN["Tickets.addInput<br/>kind=trigger，human/context 标记"]
  IN --> L
  L --> DISP["记录 disposition.fanout / context"]
  DISP --> OW{"有工单拥有这个 Trigger?<br/>followupOwners"}
  OW -- 否 --> Q["Thread.pending 入队，等待 Eval"]
  OW -- 是 --> NQ["不评估：由拥有它的工单处理"]
  Q --> W["未结束但有 undelivered 的工单：wake()"]
  NQ --> W
  W --> RET["返回 stored"]
```

要点：

1. **先过滤再落库**：被来源拒绝的触发也会保存，并带 `filtered.reason`（面板“被过滤”可查）。
2. **fan-out 到订阅该 Thread 的工单**：人写的消息送到（live 工单，或非 human-stop 的已结束工单——后者进入“可复活”队列）。
3. **没有工单拥有时才评估**：`owners(trigger)` 为空才 `queueForEval`；否则它只是该工单的 follow-up Input。
4. **human 消息可复活已结束工单**：`Tickets.wake` 在下一轮 `evaluateDue` 中按当前 Policy 重新验证 Mandate；不通过则 `refuse`。

---

## 4. 评估 Evals：批量、语义强度、截止时间

```mermaid
flowchart TD
  A["Passes：每 2s + receive 后立即"] --> B["engine.evaluateDue()"]
  B --> C["Thread 有 pending 且未 evaluating → Evals.start"]
  C --> D["同一 Thread 的 pending 合成一批<br/>一个 Eval.triggerIds"]
  D --> E["对每个 Trigger 调 Policy.gate<br/>得到 admissible / strength / basis"]
  E --> F{"已由别的 Eval 接单过?<br/>accepted"}
  F -- 是 --> G["ignore：startedTicket"]
  F -- 否 --> H["选出 primary Trigger<br/>（批次中决定性的一条）"]
  H --> I["MasterAssessor.request<br/>assessment 效果入队"]
  I --> J["主 Session 收到 candidate 卡"]
  J --> K["candidateDelivered<br/>deadline = now + evalTimeoutMs"]
  K --> L{"主 Session 决策<br/>orchestrator_eval_decide / orchestrator_route"}
  L --> M["Engine.decide"]
  M --> N["Decision 记录 + Eval 结束"]
  K -.->|"超时"| O["过期重排最多 2 次<br/>第 3 次记录 unavailable"]
```

- **一个 Thread 一个 Eval**：批处理让“同一线程里连续几条消息”只产生一次研判。
- **截止时间从 candidate 送达算起**；`paused` 时暂停过期，恢复后 deadline 顺延。
- **过期**：重新排队（`REQUEUES=2`），第三次记为 `unavailable`（面板显示为问题，可 dismiss）。
- 主 Session 拿到的是**候选卡**：线程上下文（`threadContext`，含仓库/线程读取边界）、批次内其他触发、匹配规则与授权信息。

---

## 5. 决策：接不接、以什么强度接

### 5.1 准入 gate（先后顺序）

```mermaid
flowchart TD
  T["Trigger"] --> H{"human?"}
  H -- 否 --> MG["machineGate：机器人/CI 只能推断"]
  H -- 是 --> A{"发送者在来源允许名单?<br/>policy.sources[source].allowed"}
  A -- 是 --> AD{"addressed?<br/>direct 或 @mention"}
  AD -- 是 --> E1["admissible，strength=explicit<br/>basis.via=addressed"]
  AD -- 否 --> ADM["查 admission 表<br/>(allowed, addressed) → cell"]
  A -- 否 --> ADM
  ADM --> R{"可接收?<br/>addressed 或来源 observed"}
  R -- 否 --> IGN1["不可接：no_mention / not_a_member"]
  R -- 是 --> CELL{"cell"}
  CELL -- explicit --> E2["admissible，strength=explicit<br/>basis.via=admission"]
  CELL -- inferred --> INF{"mode ≠ off?"}
  CELL -- ignore --> IGN2["不可接：admission_ignored"]
  INF -- 是 --> E3["admissible，strength=inferred<br/>basis.via=admission + observation"]
  INF -- 否 --> IGN2
  E3 --> FU
  ADM --> FU{"Follow-up?<br/>线程已有工单"}
  FU -- 是 --> F1["allowed → explicit；否则 inferred<br/>basis.via=followup（mode≠off）"]
  F1 --> OUT["返回 strength + basis"]
  E1 --> OUT
  E2 --> OUT
  MG --> OUT
```

`Mandate.basis` 会记录 `source / scope / row / sender / rules / via`，用于后续**重新验证**（Policy 变化、工单恢复）。

### 5.2 评估换成 outcome

```mermaid
flowchart TD
  A["主 Session 评估结果<br/>decision=accept|ignore|unavailable"] --> B{"decision = accept?"}
  B -- 否 --> C["按 ignore/unavailable 记录 Decision"]
  B -- 是 --> D{"方向已定?<br/>directionAllowed"}
  D -- 否 --> E["降级 ignore：directionUnsettled"]
  D -- 是 --> F{"至少命中一条启用规则?<br/>且每条规则恰好一个判断"}
  F -- 否 --> G["ignore：noRuleMatched"]
  F -- 是 --> H{"有 intent_evidence?"}
  H -- 否 --> X["报错：Acceptance requires intent_evidence"]
  H -- 是 --> I{"strength"}
  I -- explicit --> J["accept → 创建工单"]
  I -- inferred --> K{"eval.mode == auto?"}
  K -- 是 --> J
  K -- 否 --> O["ignore + would_accept<br/>reason=observed（“仅观察：本会接单”）"]
```

> **关键语义（常见误解）**：`off / observe / auto` 只决定**主动候选（inferred）**是否接单；
> **明确请求（explicit）在任何模式下都会按派工规则路由**（`src/policy.ts:55`、`src/app/prompts.ts:45`）。
> 因此“仅观察”下，看板卡进监听列仍会被接单——这是设计行为，不是漏拦。

### 5.3 常见 Decision reason

| reason | 含义 |
| --- | --- |
| `explicitRouted` | 明确请求，直接路由接单（Kanban 卡进监听列常见） |
| `observed` | 观察模式：本会接单，记为 `would_accept` |
| `startedTicket` | 该触发已经开过工单，不能重复接 |
| `timeout` | 评估超时（`unavailable`） |
| `policyChanged` | 评估期间 Policy 变了，重新评估/作废 |
| `noRuleMatched` / `directionUnsettled` | 规则未命中 / 方向未定 → 观察 |
| `not_a_member` / `no_mention` / `admission_ignored` | 来源过滤（面板可见） |

---

## 6. 接单：工单、授权、派工

```mermaid
flowchart TD
  A["Decision: accept"] --> B["Tickets.create"]
  B --> C["Mandate<br/>strength + basis + 接单时 Policy 版本"]
  B --> D["origin<br/>决定性的 Trigger + 批次 triggerIds"]
  B --> E["channels<br/>来自触发消息的 Channel"]
  B --> F["execution<br/>worktree 名 · 目录 · assignment 文本<br/>duty brief · 匹配规则 · 环境变量"]
  B --> G["Subscription<br/>订阅 Trigger.threads"]
  B --> H["first Assignment<br/>state=pending"]
  B --> I["Acknowledgement<br/>accept 自带则入 Outbox"]
  H --> J["DshExecutor.start → launch 效果"]
  J --> K["worker Session 启动"]
```

工单阶段（`ticketStage`，docs/003）：

| 阶段 | 条件 |
| --- | --- |
| `person:delivery` | 最近一次 Input 投递失败（`ticket.delivery`） |
| `person:answer` | 有 `attention` 问题 |
| `person:review` | 最新 report `ready`（等人验收/关闭） |
| `person:blocked` / `person:failed` | 最新 report 是 blocked/failed 且 **仍没有人**的消息 |
| `working:queued` | Assignment `pending` |
| `idle` | report `waiting`，或 Assignment 已结束 |
| `working` | 其余（有运行中的 Assignment） |
| `ended` | 有 `ended` |

工单生命周期：

```mermaid
stateDiagram-v2
  [*] --> Queued: Decision accept
  Queued --> Working: launch 成功
  Working --> Idle: report waiting / turn 结束
  Idle --> Working: Input 到达 / 人消息
  Working --> PersonBlocked: report blocked
  Working --> PersonFailed: report failed
  Working --> PersonReview: report ready（follows 未全部关闭）
  PersonBlocked --> Idle: 看板移除 hold（resume）/ 面板重试
  PersonFailed --> Idle: 同上
  PersonBlocked --> Stopped: 人停止 / 看板取消
  PersonReview --> [*]: followsDone → completed / merged / closed
  Working --> [*]: ready 且无 follows → completed
  Working --> [*]: dropped
  Working --> Stopped: 人停止 / 看板取消
  Idle --> Stopped: 人停止 / 看板取消
  Stopped --> [*]
```

---

## 7. 看板卡的全链路时序（显式请求）

```mermaid
sequenceDiagram
  autonumber
  participant KB as Kanban 看板
  participant KS as Kanban Source
  participant EN as Engine / Intake
  participant MS as 主 Session
  participant TK as Tickets / Executor
  participant WK as worker Session
  participant OB as Outbox → Kanban

  KB->>KS: 卡进入监听列（to-do）
  KS->>KS: 过滤标签 / seen / bootstrap
  KS->>EN: ctx.receive(Trigger)<br/>human=true, addressed=direct
  EN->>EN: 去重、scope、fanout、入 Thread.pending
  EN->>MS: 评估候选（批次 + 线程上下文）
  MS->>EN: orchestrator_route accept<br/>（显式请求 reason=explicitRouted）
  EN->>TK: Decision accept → Tickets.create
  TK->>TK: Mandate + Subscription + Assignment(pending) + ack
  TK->>WK: launch 效果 → 准备目录 → Session worker-id
  WK->>TK: orchestrator_report progress / waiting
  TK->>MS: relay 报告（主 Session 决策后续）
  WK->>TK: report ready（或 blocked）
  alt ready 且无 follow
    TK->>TK: ticket ended completed
    MS->>OB: orchestrator_reply result
    OB->>KB: 评论结果 + 卡移 done
  else blocked / 需要人
    TK->>TK: attention / stage=person
    MS->>OB: attention 消息（可选）
    Note over KB,WK: 人写裁决并移除 blocked 标签 → holdLifted → 同一 Session 恢复
  end
  alt 卡被取消/删除
    KS->>EN: syncCancellations → ctx.cancel
    EN->>TK: stopTicket（outcome=stopped）
  end
```

同一张卡在**运行中**被修改（评论/描述/列）时：`observeCards` 生成更新 Trigger → Intake → 该工单的 Input → `deliver` 效果 → worker 在同一条对话里读到，不新开工单。

---

## 8. 执行内部（DshExecutor）

```mermaid
flowchart TD
  A["launch 效果（assignment.id）"] --> B{"工单 live？<br/>latest assignment 仍是它？"}
  B -- 否 --> Z["丢弃"]
  B -- 是 --> C["Workerslots.reserve<br/>人消息可 +1，唤醒优先"]
  C --> D["prepareDirectory<br/>执行 executor.prepare（带工单环境变量）"]
  D --> E["ensure Session<br/>id=worker_ticketId<br/>role=worker, model=executor.model"]
  E --> F["下发 assignment 消息<br/>请求文本 + duty brief + 规则约束"]
  F --> G["模型执行：工具读写 / MinIO / 代码"]
  G --> H["orchestrator_report<br/>progress|waiting|ready|blocked|failed|dropped"]
  H --> I["Assignments.report<br/>attention / answers / undelivered 处理"]
  I --> J{"终态?"}
  J -- "ready 且无 follows" --> K["ended completed"]
  J -- "ready 且有 follows" --> L["等人/等线程关闭 → 合并或关闭"]
  J -- dropped --> M["ended dropped"]
  J -- "blocked / failed" --> N["attention，stage=person，等待人或看板释放"]
  G -.-> O["delivery 效果：把 undelivered Input 按顺序投给运行中 Session"]
  O --> G
```

效果（`src/app/effects.ts`）关键语义：

| 效果 | 作用 | 失败行为 |
| --- | --- | --- |
| `assessment` | 把候选卡送进主 Session 并通知“已送达” | 2s 起指数退避 |
| `launch` | 准备目录、建 Session、发 assignment | 模型/网络瞬时错误重试 3 次；prepare 失败直接判失败 |
| `delivery` | 把工单的待投 Input 交给运行中 Session | 2s 起退避；记录在 `ticket.delivery` |
| `relay` | worker 报告/问题、人的 follow-up 送入主 Session | 保序，失败阻塞后续同类 |
| `notice` | 不唤醒主 Session 的提示 | 保序 |
| `reply` | Outbox 发送到来源 Channel | 5s 起退避；前面同会话消息失败会阻塞 |

---

## 9. 失败、等待与恢复

```mermaid
flowchart TD
  Start["执行中 / 已排队"] --> R{"发生了什么"}
  R -- "report blocked/failed" --> P["stage=person<br/>attention 记录问题"]
  P --> P1["看板写裁决 + 移除 hold 标签<br/>holdLifted → resume 同一 Session"]
  P --> P2["面板重试（canRetry 时）<br/>结束停滞 Assignment，开新 Assignment"]
  P --> P3["人发消息到线程<br/>清 waitsForPerson（需后续恢复入口）"]
  R -- "Input 投递失败" --> D["ticket.delivery 记录错误<br/>stage=person:delivery"]
  D --> D1["delivery 效果退避重试"]
  D --> D2["面板重试"]
  R -- "宿主重启" --> H["assignmentInterrupted"]
  H --> H1["干到一半 → 新 Assignment + 恢复说明"]
  H --> H2["已报过 waiting/ready/blocked/failed → 保留 Session<br/>只补投未送达 Input"]
  R -- "Policy 变化" --> PC["policyChanged<br/>只通知受影响的工单；inferred 可能失效"]
  R -- "处理暂停（paused）" --> PA["不启动 launch/delivery<br/>Eval 不过期；恢复后 deadline 顺延"]
  R -- "看板取消 / 删卡" --> CN["ctx.cancel → stopTicket<br/>outcome=stopped, reason=card_canceled|card_deleted"]
```

> **注意**：blocked/failed 工单收到人的消息后，`waitsForPerson` 变 false，但当前实现**不会**因此自动起新 Assignment；
> 受支持的恢复入口是**看板移除 hold 标签**（`holdLifted` → `Tickets.resume`）或**面板重试**。这条边界值得后续改造成“人类消息即恢复”。

---

## 10. 数据模型

```mermaid
classDiagram
  class Trigger {
    id
    source
    threads
    actor
    human
    addressed
    at
    text
    channel
    url
    meta
    disposition
  }
  class Thread {
    key
    ref
    subscriptions
    context
    correlated
    pending
    evaluating
    lastAt
  }
  class Evaluation {
    id
    triggerIds
    primary
    strength
    basis
    delivered
    deadline
    pausedAt
    expired
  }
  class Decision {
    id
    triggerId
    kind
    strength
    reason
    ticketId
  }
  class Ticket {
    id
    title
    origin
    mandate
    channels
    execution
    assignments
    inputs
    undelivered
    follows
    attention
    answers
    delivery
    ended
  }
  class Mandate {
    strength
    basis
  }
  class Assignment {
    id
    state
    report
    startedAt
    deliveredAt
    idleAt
  }
  class TicketInput {
    id
    kind
    triggerId
    human
    context
    readAt
    deliveredTo
  }
  class OutboxMessage {
    id
    channel
    text
    kind
    ticketId
    status
  }

  Trigger "1" --> "*" Thread : belongs to
  Thread "1" --> "0..1" Evaluation : evaluating
  Evaluation "1" --> "0..1" Decision : ends with
  Decision "1" --> "0..1" Ticket : accept creates
  Ticket "1" --> "1" Mandate : authorized by
  Ticket "1" --> "*" Assignment : history
  Ticket "1" --> "*" TicketInput : inputs
  Ticket "1" --> "*" OutboxMessage : replies
  Ticket "*" --> "*" Thread : subscribes / follows
```

关键字段的用途：

- **`Trigger.disposition`**：记录了它到达了哪些工单、是否被过滤、被谁退还、被哪些工单认领。
- **`Thread.subscriptions`**：之后的触发会 fan-out 给这些工单；`context` 列出“只读上下文”的工单。
- **`Mandate.basis`**：`source/scope/row/sender/rules/via`，Policy 变化或工单复活时据此重新验证。
- **`Ticket.origin`**：开单的 Trigger 与批次；`execution` 决定 worker 目录与 assignment 文本；`follows` 决定 `ready` 何时真正结束工单。
- **`Assignment.report`**：最新报告（state/summary/at），`waitsForPerson` 与 `ticketStage` 都读它。
- **`TicketInput.readAt/deliveredTo`**：谁在什么时候把哪条输入交给 worker，用于面板与恢复。

---

## 11. 关键不变量与常见误解

| # | 不变量 / 事实 | 代码位置 |
| --- | --- | --- |
| 1 | 同一 Trigger 只存一次（幂等）；Kanban 同一任务只产生一次 Trigger | `core/intake.ts`、`KV.kaneo.seen` |
| 2 | 一个 Thread 同时只有一个 Eval；批次内触发共享强度与决策 | `core/evals.ts` |
| 3 | 一个 Trigger 最多开一个工单（`startedTicket`） | `core/evals.ts` |
| 4 | 每条启用规则必须恰好一个判断，accept 必须有 `intent_evidence` | `policy.ts` `assessmentOutcome` |
| 5 | `off/observe/auto` 只约束 **inferred**；**explicit 在任何模式都接单** | `policy.ts:55`、`app/prompts.ts:45` |
| 6 | `ready` 结束工单的前提是它跟随的 Thread 都已关闭；否则进入 `person:review` | `core/assignments.ts`、`core/tickets.ts` `followsDone` |
| 7 | 只有人写的消息能复活已结束工单；`cancel`/`stop` 不复活 | `core/tickets.ts` `wake` |
| 8 | 看板观察的更新走 Input，不新开工单；hold 标签是“暂停投递 + 释放后同 Session 恢复”的开关 | `sources/kaneo.ts`、`core/tickets.ts` `addInput` |
| 9 | 所有对外回复走 Outbox（幂等 id + 退避重试），失败会显示在面板 | `core/replies.ts`、`app/outbox.ts` |
| 10 | 面板的“仅观察”不是“全局暂停”；要全局停做用暂停/关来源/清监听列 | `policy.ts`、`docs/005-panel.md` |

---

## 12. 从代码读流程的入口索引

| 环节 | 入口 |
| --- | --- |
| 来源轮询与触发 | `src/sources/kaneo.ts` `pollRound` / `kaneoTrigger`；`src/sources/ntfy.ts`、`src/sources/gitea.ts`、`src/sources/s3.ts` |
| 摄入与扇出 | `src/core/intake.ts` `Intake.receive` |
| 轮次调度 | `src/app/passes.ts` `Passes.pump`、`src/core/engine.ts` `evaluateDue` |
| 评估批次与超时 | `src/core/evals.ts` `start` / `due` / `delivered` / `decide` |
| 候选送达与评估 | `src/app/assessment.ts`、`src/app/tools/main.ts`（`orchestrator_eval`、`orchestrator_route`） |
| 准入与判定 | `src/policy.ts` `gate`、`assessmentOutcome`、`revalidate` |
| 工单与授权 | `src/core/tickets.ts` `create` / `addInput` / `resume` / `retry` / `stop` |
| 执行 | `src/executor/dsh.ts` `start` / `deliver` / `launchQueued` / `prepare` |
| 报告与阶段 | `src/core/assignments.ts` `report`、`src/core/stage.ts` `ticketStage` |
| 回复与回写 | `src/core/replies.ts`、`src/app/outbox.ts`、`src/sources/kaneo-channel.ts` |
| 观察/阻塞/取消 | `src/sources/kaneo.ts` `observeCards` / `syncHoldLabels` / `syncCancellations`；[BLK.md](BLK.md) |

---

*本文只描述当前实现；图中“人/PM”指在 Kanban 或面板上操作的人。修改流程语义（例如让 observe 也拦明确请求）时，请同时更新本文件与 [docs/007-architecture.md](docs/007-architecture.md)。*
