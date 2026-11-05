# STORY — 超级智能体（SuperAgent）的一天：从三条消息流到一次交付

> 这是一篇**用户故事**：用一个人物、一天的工作，讲清超级智能体（SuperAgent，DSH bundle `dsh-superagent`）的使用场景与全生命周期。技术细节与配置见 [`REPORT.md`](REPORT.md)、[`TDD/007-p2-readonly-skeleton.md`](TDD/007-p2-readonly-skeleton.md)。

---

## 0. 人物与背景

- **小吴**：FEG 团队的开发负责人。团队用三类工具协作：
  - **Kanban**（`https://pl.feg.cn`）的 **FDEP 看板** 管任务（列：待開工/to-do、ready、進行中/in-progress、審查/review…）；
  - **Gitea**（`https://git.feg.cn`）管代码、Issue 与 Pull Request；
  - **ntfy**（`https://msn.feg.cn`）的主题（topic）做即时消息与提醒。
- **超级智能体**：一个"虚拟同事"。它没有自己的账号密码库，而是**借用**团队给的机器人身份（Kanban API key、Gitea 邮箱+密码、ntfy 主题）在三个来源上"听"和"说"。
- 小吴的诉求：**把"人把任务推进到 ready"变成"智能体自动接单、执行、回写结果"**，同时任何写入都必须有明确的授权边界。

超级智能体不是聊天窗口，而是一条流水线：

```
来源(Source) → 触发(Trigger) → 线程(Thread) → 评估(Eval: Gate + 研判)
   → 授权(Mandate) → 工单(Ticket) → 派工(Assignment) → 执行(Executor)
   → 回复(Channel) → 回执(Outbox) → 完成/结束
```

下面用小吴这一天的四个场景，把这条流水线走完。

---

## 1. 场景一：Kanban 看板任务（主故事）

**09:10**，小吴在 FDEP 看板新建一张卡：

> 标题：修复登录页在 1366×768 下的横向滚动
> 描述：`/login` 在窄屏出现横向滚动条。请只改样式，不改逻辑。完成后在评论里贴一句结果。
> 状态：to-do

他把卡片拖到 **ready** 列。对他来说这只是拖了一下；对超级智能体来说，这是流水线的起点。

### 1.1 Source → Trigger

- Kanban Source 每 60 秒轮询 `ready` 列（`GET /task/tasks/{projectId}?status=ready`）。
- 发现新卡 → 归一化为一条 **Trigger**：
  - 来源 `kaneo`，线程 `kaneo:<taskId>`（一条任务 = 一个 Thread）；
  - 操作者 = 卡片创建者/负责人（`actor`），`human: true`；
  - 文本 = 标题 + 描述，附任务 URL；
  - 通道地址 = 该任务（回复将变成 **任务评论**）。
- 首次轮询只记 **baseline**，不会把历史卡片当新任务重放；游标持久化在宿主状态目录。

### 1.2 Eval：Gate（策略闸门）

- **Gate** 先看"这是不是明确请求"：
  - 小吴在 Kanban 的允许名单（policy `sources.kaneo.allowed`）里，且任务进入了监听列 → **explicit（明确请求）**；
  - 若任务只是被改描述、且没有明确请求语义 → 可能落为 **inferred（候选）**，等研判；
  - 名单外的人 → 默认 **ignore**（可配置为 inferred）。
- 明确请求直接送主 Session 做研判；候选则按 `eval.mode`（observe 只记录 `would_accept`，auto 才自动接单）。

**09:11**，主 Session 收到一条明确请求的卡片，做一次轻量研判：

> 评估：这是明确的代码修复请求，范围集中在 `/login` 样式，可执行；建议接单。

### 1.3 Mandate → Ticket

- 研判通过后记录 **Mandate（授权依据）**：谁、通过哪条消息、授权了什么范围。
- 创建 **Ticket（工单）**：
  - 标题、来源、Thread、Channel 地址、授权摘要；
  - 状态从 `open` 开始；同一 Thread 的重复消息会合并/挂到已有工单，而不是重复开工。
- 与此同时，Kanban Source 可按配置把任务推进到 `進行中/in-progress`（claim），让小吴在板上一眼看到"已被接走"。

### 1.4 Assignment → Executor

- 引擎为工单创建 **Assignment（派工）**，在独立的 **Executor Session** 里执行（worker 预设 `dsh-superagent-worker`），与主 Session 隔离：主 Session 只负责"要不要做、做什么"，worker 负责"怎么做"。
- worker 拿到：
  - 任务文本与上下文（可回读 Thread 的评论/描述）；
  - 工作目录（`stateDir/work/<ticket>`，可用 prepare 命令自行 clone/worktree）；
  - 受限的工具与命令（blocked commands 不开放）；
  - 环境变量（来源相关的 `DSH_SUPERAGENT_*`，例如 Kanban 任务 id、Gitea 仓库/Issue、ntfy topic）。
- 小吴看到的不是过程日志，而是**结果**：worker 完成后回报 `ready`（或 `blocked` / `failed` / `dropped`）。

### 1.5 Channel → Outbox（回写给来源）

- 结果要回到来源。回复先进入 **Outbox**（持久化队列），由 Channel 适配器发送：
  - Kanban：`POST /comment/{taskId}`，把结果作为**任务评论**；
  - Gitea：`POST /repos/{owner}/{repo}/issues/{index}/comments`；
  - ntfy：`POST /<topic>`（纯文本 body + `Title` 头）。
- 每条回复带**幂等标记**（`<!-- dsh-superagent:<id> -->`），发送前先查最近消息/评论是否已有该标记——**重试不会刷屏**。
- 发送成功记 **回执（receipt）**；失败按退避重试；来源已关闭/被删则标记 `gone`，不阻塞其他工单。

**09:16**，小吴在 Kanban 卡片下看到评论：

> 已完成：已收窄 `/login` 容器宽度并给表格加横向滚动容器；改动仅样式，`pnpm test` 通过。

工单状态变为 **ended / completed**，Thread 自动退订，Kanban 列按配置推进。小吴在板上把卡拖到 `審查`。

---

## 2. 场景二：Gitea Issue 里 @ 一句（代码来源）

**10:05**，测试同事在 Gitea 的 `shawoo/PDP` 提了一个 Issue：

> `[登录页] 窄屏下按钮换行错位`
> 描述：`@shawoo 麻烦看一下，和 #12 可能同因。`

超级智能体（Gitea Source，`repo` 模式）轮询到仓库增量：

1. **Source**：`GET /repos/shawoo/PDP/issues?since=<cursor>` 与 `/issues/comments?since=<cursor>`；Cursor 只前移，不重复消费。
2. **Trigger**：正文/评论里出现 `@<agent 登录名>` → `addressed: mention`，操作者 = Issue 作者；文本 = Issue/评论内容；Channel = 该 Issue。
3. **Gate**：作者是否在 `policy.sources.gitea.allowed`？
   - 在名单 + 被 @ → **explicit** → 主 Session 研判 → 接单；
   - 不在名单 / 没被 @ → 默认 ignore（可配置 inferred，让主 Session 决定是否"主动看一眼"）。
4. **Ticket → Assignment → Executor**：worker 在工作目录里排查；若需要读评论/描述，通过 Thread 上下文按需回读（有上限，避免刷爆上下文）。
5. **Channel**：结果以 **Issue 评论** 写回，同样带幂等标记；小吴在 Gitea 页面看到回复，Issue 可以被人工关闭。
6. **补充**：如果小吴在 Issue 里连续追问（同一 Thread 的新评论），工单会把这批评论作为**上下文续传**给执行中的 Assignment，而不是另开一张工单。

小吴的账号是以**邮箱 + 密码（HTTP Basic）**配置的；设置卡片里密码显示为掩码，接口不回显；修改账号后点「**测试连接**」，通过才允许保存。

---

## 3. 场景三：ntfy 一条提醒（IM 来源；公开 topic 低信任，私有 topic 可账号密码保护）

**14:30**，值班同学在 ntfy 主题 `pub_<projectId>` 发了一条：

> 标题：`#wu.zhiping`
> 内容：`@dsh-superagent 线上告警：支付回调 500 突增，先看最近一次发布是否有异常。`

ntfy Source 每 30 秒读一次主题历史：

1. **Source**：`GET /<topic>/json?poll=1&since=<cursor>`；首次读取只记 baseline（或按 `bootstrap=history` 把保留期内历史当请求）。
2. **Trigger**：`title` 的 `#name` 约定给出**发送者身份**；消息里出现 `@<agent>` → `addressed: mention`。
3. **Gate（这个例子里是低信任边界，因为用的是公开 topic）**：`pub_` 主题**没有认证，任何人都能发**，所以 title 里的身份**可被冒用**。超级智能体不会因为"消息说自己是小吴"就当成授权：
   - 只有 policy `sources.ntfy.allowed` 里的发送者 + @ 了智能体 → **explicit**；
   - 否则 → inferred 或 ignore；
   - **ntfy 支持账号+密码保护**：把 topic 改为私有并配置用户/权限后，Source 填 `authMode=basic` + 账号密码（或 `bearer` token），只有持凭据者能订阅/发布。生产环境优先用这种方式，而不是公开 `pub_` topic；即便有账号密码，同一凭据持有者之间仍可能冒用 title 身份，所以还需要 allowed 名单 / HMAC。
4. 之后的流程与场景二相同：工单 → 执行 → **回复发布回同一个 topic**（标题 `#dsh-superagent`，带幂等标记），值班同学在 ntfy 里直接看到结论。

---

## 4. 场景四：人类始终握着方向盘

超级智能体的全生命周期里，人不是旁观者，而是**授权者和刹车**：

| 人的动作 | 系统反应 |
| --- | --- |
| 在设置里改来源账号 | 先「测试连接」，通过才保存；保存后相关来源重启，health 变成 `ready` |
| 改 Policy 名单 / admission | 立即生效：之后的消息按新规则被判 explicit / inferred / ignore |
| 暂停（Pause） | 不再产生新工单；已排队的效果停住，恢复后继续 |
| 停止某张工单 | 该 Ticket 结束，worker 被收尾，不再回复 |
| 重试失败工单 | 从失败点重新派工，来源线程不重复消费 |
| 在 Thread 里追问 | 新消息作为上下文续传给正在执行的 Assignment；结束后自动退订 |
| 查看「决策/工单/执行」面板 | 每条 Trigger 是接单、过滤还是仅候选，都有原因可查（决策记录） |

---

## 5. 全生命周期流程（逐阶段）

| 阶段 | 输入 | 系统动作 | 产出 | 可见性 / 失败恢复 |
| --- | --- | --- | --- | --- |
| **部署与检查** | 设置里的来源账号、stateDir、executor | 校验账号（Kanban/Gitea/ntfy 在线探测，GitHub/Feishu 走 CLI）、写执行环境 | Deployment（已解析的账号与仓库） | 设置面板显示问题与修复入口；来源 health `paused/ready/error` |
| **轮询 / 接收** | 来源的增量 | 读游标、拉取新事件、首次记 baseline；每个流独立容错 | Triggers（含 Thread、actor、addressed） | health 与统计；失败计数达阈值报 error，游标不丢 |
| **Gate（策略）** | Trigger + Policy | 名单 + addressed + admission 矩阵 → explicit/inferred/ignore；bot 至多 inferred | 准入结论与原因 | 决策记录可查；ignore 不打扰 |
| **Eval（研判）** | explicit 或 inferred 候选 + 上下文 | 主 Session 研判（范围、可行性、风险）；`setDecision` 接单/放弃 | Decision + Ticket | 决策原因、耗时、规则命中都可追溯 |
| **Mandate（授权）** | 接单决定 | 记录授权依据（谁、哪条消息、什么范围） | Mandate | 审计：工单能回答"凭什么做" |
| **Ticket（工单）** | 授权 | 建立/合并 Thread 绑定，选择 Channel 地址，进入 open | Ticket | 面板可见；Thread 后续消息挂到工单 |
| **Assignment（派工）** | Ticket + Executor 配置 | 建隔离 worker Session、工作目录、环境变量、工具白名单 | Assignment | 失败可重试/停止；执行结果回主 Session |
| **Executor（执行）** | 派工 | worker 读取上下文、干活、回报（ready/blocked/failed/dropped） | 结果文本 + 产物 | 与主 Session 隔离；blocked 命令不可用；预算/并发受控 |
| **Channel（回复）** | 结果 | 转成来源消息/评论，加幂等标记，落 Outbox | Outbox 消息 → 来源回执 | 失败退避重试；重试不重复发 |
| **结束 / 反馈** | 回执、工单终态 | 工单 ended（completed/失败/停止）；退订 Thread；任务列推进（如配置） | 完成状态 | 面板可审计；已发消息可追溯 |
| **恢复** | 重启、网络抖动、来源删除 | 游标续读、Outbox 幂等重放、health 恢复；partial 失败不毒化整条流 | 无需人工重放 | baseline + 游标 + 回执三件套保证"不丢不重" |

### 5.1 一张图：一次请求的旅程

```
Kanban/Gitea/ntfy 事件
        │
        ▼
   Source 轮询 ──baseline/游标──► Trigger（thread, actor, addressed）
        │
        ▼
   Gate（Policy 名单 + admission）──► ignore / inferred / explicit
        │                                      │
        │                            explicit  │  inferred（observe 只记录）
        ▼                                      ▼
   主 Session 研判（Eval） ◄────── 候选 ───────┘
        │ accept
        ▼
   Mandate（授权依据）──► Ticket（论坛绑定、Channel 地址）
        │
        ▼
   Assignment（隔离 worker：目录/环境/工具/预算）
        │
        ▼
   Executor 执行 → 结果
        │
        ▼
   Channel 回复（Kanban 评论 / Gitea 评论 / ntfy 发布）──► Outbox 幂等发送
        │
        ▼
   回执 + Ticket ended + Thread 退订 + （可选）看板列推进
```

---

## 6. 超级智能体"能做 / 不做"的边界（同一故事里的约束）

- **能做**：监听三类来源的增量；按策略把"明确授权"变成工单；在隔离 Session 里执行；把结果写回来源；对变更保持幂等与可审计。
- **不做**：
  - 不会把公开 `pub_` 主题上的一句"我是小吴"当成授权（公开 topic 无认证、身份可伪造）；私有 topic 的账号密码能限制"谁能发"，但同一凭据持有者之间仍可能冒用身份，所以仍需 allowed 名单 / 签名。
  - 不会在未获授权时修改用户仓库（Gitea 写权限按账号，Policy 决定谁可发起）；
  - 不会绕过配置的 blocked commands / 模型预算 / 并发上限；
  - 不会因为重启或重试而在来源上重复刷评论（幂等标记）；
  - 不会在 notify/IM 里承诺"已完成"而没有工单与回执支撑。

---

## 7. 配置速查（小吴的"第一次部署"）

1. 安装 bundle 到 DSH profile，设置 `stateDir`。
2. 三个来源卡片分别填：
   - **Kanban**：服务器 + API key + 项目 id（保存前自动探测，或点「测试连接」）；
   - **Gitea**：服务器 + **邮箱 + 密码**（或 API token）+ `owner/name` 仓库；点「测试连接」→ 通过再保存；
   - **ntfy**：服务器 + topic + 认证方式：公开 `pub_` topic 选 **none**；**私有 topic 用「账号 + 密码」（basic）或访问令牌（bearer）保护**，只有持凭据者能读写；点「测试连接」→ 通过再保存。
3. Policy：把允许发起任务的人/登录名/发送者加入各自 `allowed`。ntfy 若用私有 topic + 账号密码，账号密码只限制「谁能发布」，仍需 allowed 名单确认「谁授权」；若用公开 `pub_` topic，则按低信任姿态处理（ignore / inferred / 人工确认）。
4. Executor：选择 worker 模型、工作目录、可选 prepare 命令、blocked commands。
5. 验证：`/orchestrator/api/state` 中 `runtime / kaneo / gitea / ntfy` 全部 `ready`；在面板看一条真实消息走完全流程。

---

## 8. 读者下一步

- 想理解领域模型：读 [`REPORT.md`](REPORT.md) 与 [`docs/001-domain.md`](docs/001-domain.md)。
- 想看实现与验证记录：读 [`TDD/007-p2-readonly-skeleton.md`](TDD/007-p2-readonly-skeleton.md)。
- 想改来源行为：从 `src/sources/<kind>.ts` 的 `SourceKind` 实现（trigger / channel / threadContext / policy / environment）入手。
- 想调策略：改 Policy 的 allowed 名单与 admission，或切换 `eval.mode`（observe 先观察，auto 再自动接单）。
