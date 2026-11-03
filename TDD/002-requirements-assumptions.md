# 002 — 需求、假设与决策

## 1. 需求拆解

| ID | 需求 | 来源 | 验收 |
| --- | --- | --- | --- |
| R1 | 从 Kaneo FDEP 看板提取任务（而非 GitHub/Feishu） | 用户 | `待開工` 任务 → Trigger |
| R2 | 「一条任务 = 一个可被评估/执行的工单」 | 领域模型 | 面板出现 Ticket |
| R3 | 执行结果写回 Kaneo（评论） | 用户 | 任务评论出现 agent 回复 |
| R4 | 适配并安装到 dsh web profile | 用户 | profile 加载、`/orchestrator/api/state` ready |
| R5 | 保留上游管理面板与权限/引擎 | 用户意图 | Superagent 侧边栏可用 |
| R6 | 全过程文档化到 `HANDOFF.md` + `TDD/` | 用户 | 文档可交接 |
| R7 | Windows 本机可运行 | 环境 | 构建/启动通过 |

## 2. 关键假设（先按此推进，用户可改）

| # | 假设 | 依据 | 若假设错误的代价 |
| --- | --- | --- | --- |
| A1 | 「pipeline kanban」= Kaneo 实例 `https://pl.feg.cn`；「project 为 fdep」= 项目 **FDEP**（id `dgctny8ibgpn72ei2j8qj2hc`），不是项目 `pipeline`(PIP) | 用户补充 + 查询到两项目 | 只需改配置 `projectId`，代码不变 |
| A2 | 监听列默认 `待開工`（slug `ready`），可配置多个 slug | 流程上「待開工」= 可执行队列 | 改配置即可 |
| A3 | 「任务进入监听列」= 显式请求（`addressed:'direct'`），actor 取 assignee 否则 creator | 看板列位是一种明确委托 | 若希望先研判，可改 `inferred`（需 mode=auto） |
| A4 | 任务作者/执行人用 Kaneo workspace 成员身份（`userId`/`assigneeId`）进 Policy allowed | 与上游「按 Source 自有身份授权」一致 | 配错则 gate 拒绝，健康面板可见 filtered |
| A5 | 回写方式 = 任务评论；自动把任务移入 `進行中`；暂不自动进 `qa/done` | MCP/REST 能力 + 最小闭环 | 可配置 `claimColumn: ''` 关闭 |
| A6 | 执行器目录默认 `<stateDir>/work/<ticket>`，可用 `executor.prepare` 定制 | 上游默认 | 需要真实仓库时配 prepare |
| A7 | 目标 profile = 当前活动 `D:\Refine\Books\ntop\AI\dsh\profiles\web`（3080） | 用户明确「dsh web profile」 | 若应装独立 profile，则改用 `dsh-superagent` profile 并重装 |
| A8 | API key 放 Source 配置（DB/配置文件明文），不进 prompt 文本 | 上游同样把凭据放在 profile 配置 | 安全评估另议 |
| A9 | 不新增 npm 依赖 | 减小安装风险 | 复杂 HTTP 客户端退化为 fetch |

## 3. 验收口径（Definition of Done）

- **DoD-1**：`pnpm check` 通过（typecheck + vitest + build）。
- **DoD-2**：`tests/kaneo.spec.ts` 覆盖触发翻译/去重/轮询游标/ID 稳定。
- **DoD-3**：bundle 安装后 `GET /orchestrator/api/state`：`setup` 无阻断、`health.runtime.state === 'ready'`、`health.kaneo` 存在且非 error。
- **DoD-4**：把一张测试任务移入 `待開工`，一个轮询周期内 `GET /api/tickets`（或面板）出现 Ticket；任务被移到 `進行中`。
- **DoD-5**：Ticket 结束后任务评论收到 agent 的消息（ack/result）。
- **DoD-6**：文档：HANDOFF §6 时间线回填、TDD/006 有实际命令与输出、TDD/004 回滚步骤可用。

## 4. 决策记录（ADR 风格）

### D1 — 用「新增 Source kind」而非「替换 GitHub payload」✅

- 背景：上游把 GitHub/Feishu 作为 kind；Kaneo 是另一套 API/身份/语义。
- 备选：改造 `github.ts` 冒充 GitHub（丑、耦合）；新增 kind（干净、保留原能力）。
- 决定：新增 `kaneo` kind，独立插件入口 `kaneo-watch`。
- 后果：bundle patch 新增一行；GitHub/Feishu 可默认关闭；面板自动出现 Kaneo 卡片。

### D2 — 任务进入监听列视为显式请求 ✅

- 理由：看板列位由人放置，等价于「请做这张卡」；比要求评论 @agent 更符合现有 FDEP 工作流。
- 后果：Gate 需要 allowed 列表命中 actor；若 actor 不在列表则 filtered（可在来源页看到）。为降低摩擦，初始化配置把 workspace owner + assignee 放进 allowed。

### D3 — 自动认领 = 入库后移动列（可关）✅

- 理由：让看板立刻反映「已被 agent 接手」，避免重复派发；比等 accept/launch 简单可靠。
- 风险：若 Eval 拒绝，任务仍被移动。缓解：先 `observe` 模式验证；提供 `claimColumn: ''` 关闭；后续可改成「accepted 事件后移动」。

### D4 — 无 GitHub 也能启动 ✅

- 背景：`resolveDeployment` 强制 GitHub account；Kaneo-only 部署会被卡在 setup。
- 决定：当 `repository` 与 `cli` 都为空时返回空 GitHub 的 Deployment；Setup 跳过 worker shim/git 环境写入与校验。
- 后果：GitHub/Feishu Source 若误开启会报错（默认 disabled）；Kaneo 正常。Windows 上本来也不需要 shim。

### D5 — API key 只存在于宿主进程/配置，不进 prompt ✅

- 理由：外部内容不可信，prompt 可能被泄漏到日志/会话。
- 后果：worker 不能直接调 Kaneo REST；所有回写由 Host 的 Channel/轮询完成（够用）。

### D6 — 默认只启用 Kaneo，GitHub/Feishu 关闭 ✅

- 理由：用户目标是 Kaneo；避免空 GitHub 配置造成轮询错误噪声；保留原插件可随时打开。
- 后果：bundle patch 中 `dsh-superagent-github` 设 `disabled: true`；`kaneo` 行默认启用。

### D7 — Windows 路径正则放宽 ✅

- 背景：`stateDir` schema `^\//`、`executor.directory` `startsWith('/')` 只认 POSIX。
- 决定：接受 `/` 或 `X:/`、`X:\`。
- 后果：Windows 配置可用；不影响 POSIX。

## 5. 待用户确认（不阻塞，先按假设推进）

1. 监听列是否就是 `待開工`？是否需要只挑带某个 label（如 `ai:`/`sprint-2026-W56`）的任务？
2. 执行器工作目录：是否有固定仓库/目录？`prepare` 命令写什么？
3. 是否接受「装进当前 web profile」的隔离性下降？是否改为独立 `superagent` profile？
4. 完成后的列推进目标（`qa`？`in-review`？）与是否要自动评论 @验收人？
5. 允许发起任务的 Kaneo 用户范围（owner 之外还有谁）？

---

## 6. 实现后的补充决策（2026-11-03）

### D8 — 「一个任务一次请求」：用 KV 永久去重 + 首次轮询 bootstrap ✅

- 背景：Kaneo 列表接口没有「变更历史」；若以 `updatedAt` 判断，编辑描述会重复触发；若只靠状态，需要轮询全部列。
- 决定：每个任务首次被看到时写 `KV.kaneo.seen:<taskId>`，之后不再触发（一个任务 = 一次请求）。首次轮询按 `bootstrap` 处理：`skip` 把监听列已有任务记为已见（默认，避免 28 张既有卡一次全部触发）；`trigger` 则把已有任务也当请求（用于演练/测试）。
- 后果：任务被忽略/失败后不会自动再次触发；需要时用面板「重新评估」或重开卡。二期可改为监听列「进入事件」。

### D9 — 主 Session 的 shell 工具名按平台选择 ✅

- 背景：`src/app/sessions.ts` 硬编码 `tools.restrict({allow:[…,'bash',…]})`；Windows profile 只有 `pwsh`，重启后 `tools.restrict() names unknown global tool "bash"` → fiber failed。
- 决定：`process.platform === 'win32' ? 'pwsh' : 'bash'`；`noWait` guard 同时识别两者。
- 后果：Windows 可运行；POSIX 行为不变。这是本次唯一的「运行阻塞级」Windows 适配。

### D10 — policy 的 allowed 名单以「任务 actor（assignee→creator）」匹配 ✅

- 实测：任务 assignee=吴志平 → Trigger actor=吴志平 → Gate 命中 allowed → explicit。
- 若任务无 assignee 且无 creator，actor 用 `actorFallback`（默认 `kaneo`），此时需要把 `kaneo` 放进 allowed 或补 actor。

### D11 — 管理 API 写入中文必须显式 UTF-8 ✅

- 实测：PowerShell `Invoke-WebRequest -Body $string` 会把中文写成 `???`（id 不受影响，仅显示名）。
- 决定：文档中固定使用 `[System.Text.Encoding]::UTF8.GetBytes($body)` + `Content-Type: application/json; charset=utf-8`。

## 7. 验收结果（回填）

| DoD | 结果 |
| --- | --- |
| DoD-1 构建/类型 | ✅ |
| DoD-2 Kaneo 单测 | ✅ 11/11 |
| DoD-3 安装/setup/health | ✅ setup.problem=null、runtime=ready、kaneo=ready |
| DoD-4 任务→Ticket | ✅ #470 |
| DoD-5 评论回写 | ✅ ack + result |
| DoD-6 文档/回滚 | ✅ HANDOFF + TDD/004 |

详见 [`005-test-verification.md`](005-test-verification.md) 与 [`artifacts/`](artifacts/)。
