# HANDOFF — dsh-superagent 改造为「Kaneo FDEP pipeline 看板提取任务」并移植到 dsh web profile

> 本文件记录整个历程：**解读 → 学习 → 改造 → 移植**。所有阶段的过程细节、设计文档、决策记录放在 [`TDD/`](TDD/README.md)。
> 本文件随工作推进持续更新；最后更新见文末「变更记录」。

> **⚠ 2026-11-03 状态更新（按用户要求）**：实施阶段已**暂停**；web profile 的安装与配置已**回滚**（依赖/bundle 列表/patch 已还原，插件不再运行，`/orchestrator/api/state` 已 404，GUI 正常）。
>
> **✅ 2026-11-03 最终状态（本轮目标「完成改造和测试、完成部署」）**：
> - 三来源（**Kaneo** 任务 + **Gitea** 代码/PR，默认 `https://git.feg.cn` + **ntfy** IM，默认 `https://msn.feg.cn`）**均已实现为完整 Source**：Trigger、Channel 回复、Thread 上下文、策略、环境变量、部署账号校验。
> - **已安装并运行**在 dsh web profile（`D:\Refine\Books\ntop\AI\dsh\profiles\web`），stateDir=`D:/Refine/Books/ntop/AI/dsh/state/superagent`；三个来源 health 均为 `ready`。
> - **端到端实测通过**：Kaneo 任务 → 工单 → worker 执行 → 评论回写（completed）；ntfy 消息 → 工单 → worker 执行 → 主题回复（已发布并校验）。
> - **Gitea**：匿名/公开仓库的只读轮询与读取已实测；写回/通知模式需要 agent 账号 API token（当前未提供），相关路径以单测验证。
> - 中文界面产品名统一为「**超级智能体**」（技术标识 `dsh-superagent` 不变）；单测 34 项、typecheck、build 通过。
> - 详见 [REPORT.md](REPORT.md)、[TDD/007-p2-readonly-skeleton.md](TDD/007-p2-readonly-skeleton.md) 与 [TDD/006-process-log.md](TDD/006-process-log.md)。
> - 想先读"它是怎么被用的"：看用户故事 **[STORY.md](STORY.md)**（三来源使用场景 + 全生命周期）。
>
> **范围已扩展为三来源**：Kaneo（任务）+ Gitea（代码/PR，默认 `https://git.feg.cn`）+ ntfy（IM，默认 `https://msn.feg.cn`）。
> 后续改为「先理解/方案、评审通过再实施」的流程，新的原理/流程/分阶段方案见 **[REPORT.md](REPORT.md)**。
> 本文件 §5 记录的是回滚前那次探索性安装的过程，仅作参考；**当前环境已按最终状态重新安装并验证**。

| 项目 | 值 |
| --- | --- |
| 工作目录 | `C:\Users\shawoo\Desktop\feg.cn\dsh-superagent-prototype` |
| 上游项目 | `dsh-superagent`（DSH bundle，research prototype，v0.1.0） |
| 改造目标 | 从 **Kaneo**（`https://pl.feg.cn`）的 **FDEP pipeline 看板**提取任务，替代 GitHub / Feishu 作为工作来源 |
| Kaneo 实例 | `https://pl.feg.cn`（自架；MCP 端点 `/api/mcp`，REST 端点 `/api`） |
| 工作区 / 项目 | workspace **ATEAM**（`lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o`）、项目 **FDEP**（slug `FDE`，id `dgctny8ibgpn72ei2j8qj2hc`）；另有项目 `pipeline`（slug `PIP`，id `wwo9d2mmqddjq8otbj8jh2hs`）备用 |
| 移植目标 | **dsh web profile**：`D:\Refine\Books\ntop\AI\dsh\profiles\web`（DSH_HOME=`D:\Refine\Books\ntop\AI\dsh`，当前 GUI `http://127.0.0.1:3080`） |
| 运行环境 | Windows 10 / PowerShell 5.1 / Node v24.19.0 / pnpm 11.7.0 / dsh `0.2.1-rc.5` |
| 起始日期 | 2026-11-03 |

---

## 0. 一句话摘要

上游 `dsh-superagent` 是一个「给一个 GitHub 仓库打工」的主动式 agent bundle：Source 产生 Trigger → Engine 评估（Gate + 模型研判）→ 接单成 Ticket → 独立 Executor Session 干活 → 通过 Channel 回到原会话。本次改造**保留其领域模型、Engine、Executor、管理面板与权限体系**，新增一个 **Kaneo Source Kind**：轮询 FDEP 看板指定列（默认 `待開工/ready`）的任务，把「任务进入该列」变成显式 Trigger，把「一条任务」当作一个 Thread，回复以 **Kaneo 任务评论**写回，并可自动把任务列推进到 `進行中/in-progress`；同时把只支持 GitHub 的部署检查（`Deployment`/`Setup`）与 Windows 路径约束适配成「无 GitHub 也能启动」，最后以 DSH bundle 形式安装进 web profile。

---

## 1. 背景与目标

### 1.1 用户原话（目标）

> 第一步，创建 HANDOFF.md，记录解读，学习，改造，移植该 bundle 的全部历程。
> 目标是把该插件改造成从我们的 pipeline kanban 提取任务，并适配移植安装到 dsh web profile。
> 改造文档和过程放到子目录 TDD\。
>
> 补充：我们的 pipeline kanban 通过 skills `kaneo-mcp` 来访问，先暂定 project 为 `fdep`。

### 1.2 拆解成可执行目标

1. **解读/学习**：读懂上游 bundle 的架构与 DSH 集成方式。
2. **改造**：新增 Kaneo Source，取代 GitHub Source 作为任务来源；适配部署检查与 Windows。
3. **移植**：构建并以 bundle 形式安装进 dsh web profile，配置并端到端验证。
4. **记录**：本文件 + `TDD/` 子目录保存设计、过程、决策、验证与回滚。

### 1.3 成功标准（验收口径）

- [x] K1：`pnpm typecheck` + `pnpm build` 通过；本次相关单测全部通过。（`pnpm test` 全量在 Windows 有 39 个**既有平台失败**，见 [`TDD/005-test-verification.md`](TDD/005-test-verification.md) §3。）
- [x] K2：新增 Kaneo Source 单测 11/11 覆盖「任务 → Trigger → Thread」翻译、轮询游标/去重、Channel 幂等、ThreadContext、REST 重试。
- [x] K3：bundle 安装进 web profile 后，`/orchestrator/api/state` 返回 `setup.problem=null`、`runtime=ready`、`kaneo=ready`。
- [x] K4：Kaneo `待開工` 任务 #470 被提取成 Ticket（Decision `accept`/explicitRouted），并自动推进到 `進行中`。
- [x] K5：Executor 的回复以 Kaneo 任务评论写回（ack + result，带幂等 marker）。
- [x] K6：HANDOFF.md 与 `TDD/` 文档完整，含回滚步骤与真实证据（`TDD/artifacts/`）。

---

## 2. 解读（理解这个 bundle 是什么）

> 详细代码级解剖见 [`TDD/001-bundle-anatomy.md`](TDD/001-bundle-anatomy.md)。

### 2.1 它是什么

`dsh-superagent` 是 **DeepSeek Harness（DSH）的 bundle**，不是一个独立应用：它通过 Cordis 插件系统挂进某个 DSH profile 的进程里，在 Web UI 侧边栏加一个 **Superagent** 面板，同时注册一系列 host 服务/工具/Session 预设。

`package.json` 的 `dsh` 字段声明它是 bundle：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [ … dsh-client-ui-* … ] },
  "manifestVersion": 1
}
```

`cordis.patch.yml` 是 bundle 的 Loader 补丁层，`insert` 了三个插件行 + 两个 agent preset：

| Loader id | name | 作用 |
| --- | --- | --- |
| `dsh-superagent` | `dsh-superagent` | 主插件：`Runtime` 组合根（Store/Engine/Sources/Executor/Panel/HTTP） |
| `dsh-superagent-github` | `dsh-superagent/github-watch` | GitHub Source kind 插件 |
| `dsh-superagent-feishu` | `dsh-superagent/feishu-watch` | Feishu Source kind 插件（默认 disabled） |
| `dsh-superagent-worker-preset` | `@deepseek-ai/dsh-agent-preset` | 执行器 Session 用的 agent preset（id `dsh-superagent-worker`） |
| `dsh-superagent-router-preset` | `@deepseek-ai/dsh-agent-preset` | 主 Session 用的 agent preset（id `dsh-superagent-router`） |

### 2.2 领域模型（与 docs/001 一致）

```
Source ──Trigger──> Thread ──batch──> Eval ──Decision(accept)──> Ticket ──Assignment──> Executor(Session)
   ▲                                                                  │
   └──────────────────────── Channel(回复/评论/PR) ◄──────────────────┘
```

- **Source**：事件流（kind 是可复用实现，instance 是一份配置）。维护自己的读取游标，丢弃自己的消息，把原生事件翻译成 Trigger。
- **Trigger**：不可变事件（id 幂等、actor、human、addressed、threads、text、meta）。
- **Thread**：同一 Thread 上 Eval 串行；Subscription 把后续消息扇出给 Ticket（只有上下文、不新增授权）。
- **Eval**：Gate（确定性：谁能发起、强度 explicit/inferred）+ 模型研判（主 Session 按规则打分）→ Decision（accept/stop/ignore/unavailable）。
- **Mandate**：accept 授予的授权（策略版本/范围/强度/来源身份），不可变；停止/重新校验失败才失效。
- **Ticket**：一张工单，open→ended，可被人员消息 resume；有自己的 Assignment/Inputs/Channels/follows。
- **Executor**：`DshExecutor` 为每张 Ticket 建一个独立 DSH Session + 独立目录；Report（progress/waiting/ready/blocked/failed/dropped）回传。
- **Channel**：Source 的写入侧（GitHub 评论、Feishu 话题回复、PR…）。

**Panel**（`src/client/*`）：侧边栏 Superagent 入口，呈现 Overview/来源/触发/评估/执行/线程/工单/设置/提示词。

### 2.3 运行结构（代码层）

| 层 | 关键文件 | 职责 |
| --- | --- | --- |
| 组合根 | [`src/app/runtime.ts`](src/app/runtime.ts) | 加锁 stateDir、开 SQLite、构建各部件、注册 HTTP、启动 Source/Effects/Passes |
| 领域核心 | [`src/core/engine.ts`](src/core/engine.ts) + `part.ts`/`intake.ts`/`evals.ts`/`tickets.ts`/`assignments.ts`/`replies.ts` | 唯一写 Trigger/Thread/Decision/Ticket/Assignment 的地方，事务化 |
| 策略 | [`src/policy.ts`](src/policy.ts) | settings schema、gate、Mandate 重校验、策略版本 |
| 来源 | [`src/sources/registry.ts`](src/sources/registry.ts) + `host.ts` + `kind.ts` | SourceKind 注册、SourceContext 能力面、scope 判定 |
| 执行 | [`src/executor/dsh.ts`](src/executor/dsh.ts) | Worker Session、目录、prepare、Report、WorkerSlots |
| 副作用队列 | [`src/app/effects.ts`](src/app/effects.ts) | 持久化 side-effect（assessment/launch/delivery/relay/notice/reply），失败退避 |
| 设置/提示词 | `src/app/settings.ts`、`src/app/prompts.ts` | 分块版本化保存、策略变更影响面、prompt 组装 |
| 部署 | [`src/deployment.ts`](src/deployment.ts)、[`src/app/setup.ts`](src/app/setup.ts)、`src/infra/environment.ts` | 探测 GitHub/Feishu CLI、写 worker shim/git 配置、判定 `configured()` |
| 面板 | `src/client/*` + `src/app/http.ts`、`src/app/api.ts`、`src/app/views/*` | Web UI 与管理 API |

### 2.4 与 DSH / profile 的集成方式

- bundle 安装 = 往 profile 的 `package.json` 加依赖 + 往 `dsh.profile.bundles` 加 bundle 名；DSH 的 `plugin_manager` `install_bundle` 会替我们完成 profile 的 `package.json` / `pnpm install` / patch 合成。
- 插件通过 `export const inject = ['agents','sessionController',…]` 注入 DSH 服务；主插件把 `Runtime` 作为 Cordis service **`orchestrator`** 暴露给 Source 插件（`declare module '@deepseek-ai/cordis'`）。
- Source 插件只 `inject: ['orchestrator']`，调用 `ctx.orchestrator.sources.register(kind)` 注册自己，并通过 `sourceContextOf` 拿到受限能力面。
- agent preset 由 bundle patch 以 `@deepseek-ai/dsh-agent-preset` 行插入；`Runtime` 用 `dsh-superagent-worker` / `dsh-superagent-router` 创建 Session。

---

## 3. 学习（本次踩过的机制、接口、外部系统）

> 详见 [`TDD/001-bundle-anatomy.md`](TDD/001-bundle-anatomy.md) 与 [`TDD/002-requirements-assumptions.md`](TDD/002-requirements-assumptions.md)。

### 3.1 DSH bundle / profile 机制要点

1. **bundle patch 是叠加层**：profile 自己的 `cordis.patch.yml` 在 bundle 层之后应用；home 级 patch 再优先。
2. **一个 loader id 只能出现一次**（`duplicate loader entry id`）。profile 里手工插入的行与 `dsh.profile.bundles` 不能重复。
3. **装载失败会阻止插件启动**；`plugin_manager.install_bundle` 返回 `application`/`warnings` 才是判据。
4. **profile 隔离**：上游文档强烈建议单独 copie 一个 Web profile（避免改进程级 `PATH`/git 配置、独立重启）。本次按用户要求装进 **web profile**，属于有意偏离，风险与回滚写入 [`TDD/004-port-deployment.md`](TDD/004-port-deployment.md)。
5. **本机两个 DSH home**：`D:\Refine\Books\ntop\AI\dsh`（DSH_HOME，当前 GUI 所在）与 `C:\Users\shawoo\.dsh`（默认 home，也有 profile）。当前 3080 进程用的是 **`D:\...\dsh\profiles\web`**（mtime 最新、含 kaneo-web 等本机 bundle）。

### 3.2 关键接口（改造必须遵守）

- `SourceKind`（[`src/sources/kind.ts`](src/sources/kind.ts)）：`kind`、`title/description`、`schema(zod)`、`fields`(UI 表单)、`health`、可选 `scope/channel/threadContext/find/policy/environment/refreshLabels/repliesTo`。
- `SourceContext`（[`src/sources/host.ts`](src/sources/host.ts)）：`deployment`、`commands`、`ready`、`configured()`、`config(kind)`、`receive(trigger)`、`atomic`、`state`(KV)、`threads`(get/subscribed/describe/patch)、`tickets`(get/open/bindThread/threadClosed)、`triggers`、`notify`、`report`。
- `SourceHost`：`sources: SourceRegistry` + `context(kind)`；主插件以 `orchestrator` service 暴露。
- `Deployment`（[`src/deployment.ts`](src/deployment.ts)）：`stateDir` + `repository` + `github{cli,login,noreply}` + 可选 `feishu`。**这是「必须有 GitHub」的关键耦合点**。
- `Setup`（[`src/app/setup.ts`](src/app/setup.ts)）：`run()` 决定 `configured()`；未配置时 Runtime 处于 paused，Passes 不评估、Source 不轮询。
- `Settings`（[`src/policy.ts`](src/policy.ts)）：`sources` 是 `Record<string, {enabled, config}>`，**本身泛化**；每个 Source 的配置由 kind 的 zod schema 校验，所以新增 Kaneo Source 无需改 SettingsSchema。
- `Outbox/Channel`：回复按 `OutboundMessage` 走 `SourceRegistry.send` → `kind.channel.send`，失败重试、`gone` 丢弃。

### 3.3 持久化

- `node:sqlite` 的 `DatabaseSync` 单库（`<stateDir>/orchestrator.sqlite`），`store.atomic` 事务；domain repositories + `read` 查询 + `kv`。
- Source 自己的游标/状态用 `ctx.state`（KV，按 family 前缀），`ctx.threads.describe/patch` 写 Thread 的展示信息与 meta。
- **stateDir 必须绝对路径**，且上游 schema 用 `^\//` 校验（只认 POSIX 风格），Windows 需适配。
- 上游 `Setup` 会写 `<stateDir>/worker-bin` 的 `#!/bin/sh` shim 与 `worker-gitconfig`（GitHub credential helper），**Windows 上不适用**；本次无 GitHub 时跳过这些写入。

### 3.4 Kaneo（`https://pl.feg.cn`）要点

- 认证：MCP 端点 `Authorization: Bearer <API key>`；REST 端点 `x-api-key: <API key>`。skill 已带 `.key`（`C:\...\dsh-superagent-prototype\.dsh\skills\kaneo-mcp\.key`）。
- 身份：`吴志平 / wu.zhiping@feg.cn`，workspace owner；workspace **ATEAM**（id `lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o`）。
- 项目 **FDEP**：id `dgctny8ibgpn72ei2j8qj2hc`，slug `FDE`，397 tasks（含归档），lastTaskNumber 469；8 列：

  | 列名 | slug | 数量 | isFinal |
  | --- | --- | ---: | --- |
  | 待辦池 | `to-do` | 26 | |
  | 待開工 | `ready` | 28 | |
  | 進行中 | `in-progress` | 17 | |
  | Blocked | `blocked` | 16 | |
  | 程式碼審查 | `in-review` | 20 | |
  | 測試驗證 | `qa` | 22 | |
  | 預發布 | `staging` | 8 | |
  | 已交付 | `done` | 148 | ✅ |

- 任务对象关键字段：`id`、`title`、`number`、`description`(Markdown)、`status`(列 slug)、`columnId`(CUID)、`priority`、`userId`(创建者)、`assigneeId/assigneeName`、`projectId`、`workspaceId`、`createdAt`、`updatedAt`、`labels[]`。
- 需要的 REST（MCP 没暴露的写入/读列表，本插件直接用 REST）：
  - `GET /api/task/tasks/{projectId}?status=<slug>&limit=&page=&sortBy=&sortOrder=`：按列取任务（**status 只吃 slug**，喂中文列名静默返回 0）。
  - `GET /api/task/{id}`：任务详情。
  - `GET /api/comment/{taskId}`：评论列表（含作者、content、createdAt）。
  - `POST /api/comment/{taskId}`，body `{content}`：发评论（本插件的 Channel 写回）。
  - `PUT /api/task/status/{id}`，body `{status}`：移动列（本插件的自动认领/推进）。
  - `GET /api/column/{projectId}`：列定义（CUID/id/name/slug/isFinal）。
- 限流：API key 每分钟 100 次；轮询需控制请求数。
- 已知坑（来自 skill）：`list_tasks` 无 `columnId` 过滤；`status` 大小写敏感；列 CUID 与 slug 两种形态不要混用；`search` 需要 `workspaceId`；web 端登录路径 `/dashboard`。

### 3.5 本机环境坑

- PowerShell 5.1；`node -v` 24.19.0；`pnpm -v` 11.7.0；`dsh --version` 0.2.1-rc.5（满足 `engines.dsh ^0.2.1-alpha.2`）。
- `git clone` 到的仓库只有 1 个提交（`6337fc8 feat: add the dsh-superagent research prototype`），`lib/` 与 `node_modules/` 均未生成。
- 本机默认 shell 的 `pwsh`/`powershell.exe` 会经 DSH subprocess 包装；**进程 stdout 被捕获时会走 named pipe**，sandbox 受限模式会 EPERM（本会话是 danger-full-access，不受影响）。
- Windows 上 `stateDir` 需改成 `D:/...` 或 `C:/...` 形式才能通过上游正则；`executor.directory` 同理。

---

## 4. 改造（设计）

> 完整设计见 [`TDD/003-kaneo-source-design.md`](TDD/003-kaneo-source-design.md) 与 [`TDD/004-port-deployment.md`](TDD/004-port-deployment.md)。

### 4.1 总体思路

**不重写领域核心**，把「来源」换掉：

```
[旧] GitHub notifications / PR / CI ──Trigger──> Engine ──> Ticket ──> DshExecutor ──> GitHub comment/PR
[新] Kaneo FDEP 看板任务（进入监听列）──Trigger──> Engine ──> Ticket ──> DshExecutor ──> Kaneo 任务评论 + 列推进
```

### 4.2 Kaneo Source 设计要点（映射表）

| 领域概念 | Kaneo 映射 |
| --- | --- |
| Source kind | `kaneo`（插件行 id `dsh-superagent-kaneo`，entry `dsh-superagent/kaneo-watch`） |
| Source instance config | `{ baseUrl, apiKey, projectId, watchColumns[], claimColumn?, pollSeconds, maxTasks }` |
| Thread | 一条任务 = 一个 Thread，key `kaneo:<taskId>` |
| Trigger | 任务进入监听列（新任务或从别的列移入）→ `human:true`、`addressed:'direct'`（看板列位本身视为显式请求）、actor=assignee/creator、text=标题+描述摘要、meta 记录 taskId/status/labels/priority |
| Channel | 评论写回 `POST /comment/{taskId}`；消息去重靠 Outbox 的 receipt（自带幂等） |
| Channel link | 任务页 URL（`baseUrl` + 站点内路由；先用 `/dashboard` 回退） |
| Thread context | 任务标题+描述作为 root，评论作为消息，供研判读取 |
| Policy | `policy.allowed` = 允许发起任务的 Kaneo 用户 id / 显示名；`explicit` = 任务进入监听列；admission 行按列给出 |
| 自动推进 | `claimColumn`（如 `in-progress`）：Trigger 成功入库后把任务移入该列，表示已被认领；可关闭 |
| 环境变量 | 只放非敏感信息（KANEO_TASK_ID/URL/PROJECT_ID）；**API key 不进入 prompt 文本** |
| Health | `kaneo` 健康项：轮询失败连续 N 次报 error；source off / setup pending 报 paused |

### 4.3 部署适配（Kaneo-only）

1. `Deployment.github` 允许为空：`resolveDeployment` 在 `repository` 与 `cli` 都为空时返回「无 GitHub」的 Deployment（空字符串占位），而不是抛 `repositoryUnset/agentCliUnset`。
2. `Setup.resolve`：仅当 `deployment.github.cli` 非空时才写 worker shim/git 配置并 `verifyEnvironment`；否则跳过（Windows 上本来也不可用）。
3. `Setup.checkAccounts`：`source:kaneo` 不做账号探测（Kaneo 无 CLI 身份）。
4. Windows 绝对路径：`stateDir` / `executor.directory` 的 schema 正则放宽到 `^([/]|[A-Za-z]:[\\/])`。
5. `Setup.check()`：无 GitHub 时仍按「configured 即健康」处理。
6. `runtime.links()`：`repository` 为空时仍可构造（GitHub link 返回空 url），不影响 Kaneo。

### 4.4 代码变更清单（计划）

新增：
- `src/sources/kaneo.ts` — kind 定义 + 插件入口 + 轮询循环（`kaneo-watch` entry）
- `src/sources/kaneo-trigger.ts` — 任务/评论 → Trigger、thread key、address、URL
- `src/sources/kaneo-channel.ts` — 评论写回 + link
- `src/sources/kaneo-read.ts` — Thread context（任务+评论）
- `src/sources/kaneo-api.ts` — 轻量 REST client（fetch + x-api-key + 超时/重试）
- `src/app/kaneo-config.ts`?（如需要）
- `tests/kaneo.spec.ts` — 单测（翻译/轮询游标/幂等/去重）

修改：
- `src/deployment.ts`：空 GitHub 容忍、Windows 路径正则、`Deployment.kaneo`、`SETUP_FIELDS.kaneo`
- `src/app/setup.ts`：跳过 GitHub 环境写入、`source:kaneo` 走 REST 账号检查、`blockCommands` 守卫
- `src/infra/environment.ts`：`writeEnvironment` 由 Setup 守卫（空 CLI 不再写 POSIX shim）
- `src/policy.ts`：`executor.directory` 跨平台绝对路径
- **`src/app/sessions.ts`**：主 Session 的 `tools.restrict` allow 列表按平台选择 `bash`/`pwsh`（Windows 修复；否则重启后 fiber failed）
- `src/setup.ts`：新增 `sourceUnset` / `kaneo*` SetupError 码
- `src/kv.ts`：新增 `KV.kaneo.*` 家族
- `tsdown.config.ts`：新增 `kaneo-watch` 入口
- `package.json`：新增 `./kaneo-watch` 导出
- `cordis.patch.yml`：插入 `dsh-superagent-kaneo`，并把 `dsh-superagent-github` 默认 `disabled: true`（Feishu 保持 disabled）
- `src/client/locales.ts`：新增 `source.kaneo`、`health.kaneo`、`setup.kaneo*`、`problemSetupFix.kaneo`
- `tests/bundle-patch.spec.ts`：patch 行期望加入 kaneo
- `docs/007-architecture.md`：模块表/测试表补新文件，说明四个插件行
- `HANDOFF.md`、`TDD/*`：本次文档

### 4.5 非目标（本期不做）

- 不做 Kaneo ↔ GitHub 双来源深度融合（可同时运行，但默认只开 Kaneo）。
- 不做到「任务评论里 @agent 触发新 Eval」的完整 follow-up 流（先做列进入触发；评论上下文可读）。
- 不改前端面板视觉；沿用上游 Superagent 面板。
- 不解决 GitHub Source 在 Windows 的 shim/git 凭据支持（保持原样，默认关闭）。
- 不引入 npm 新依赖（用 Node 内置 `fetch` + 已有 `zod`）。

---

## 5. 移植（安装到 dsh web profile）

> 详细步骤与回滚见 [`TDD/004-port-deployment.md`](TDD/004-port-deployment.md)。以下为执行时的实际记录。

### 5.1 构建

```powershell
cd C:\Users\shawoo\Desktop\feg.cn\dsh-superagent-prototype
pnpm install
pnpm check        # typecheck + vitest + build
```

### 5.2 安装（已完成）

- 备份：`D:\Refine\Books\ntop\AI\dsh\profiles\web\.dsh-superagent-backup-20261103-133726`（package.json / cordis.patch.yml / pnpm-lock.yaml / pnpm-workspace.yaml / cordis.yml）。
- 在 profile `cordis.patch.yml` 末尾加入：
  ```yaml
  - id: dsh-superagent
    config:
      stateDir: D:/Refine/Books/ntop/AI/dsh/state/superagent
  ```
  （bundle patch 只插入插件行，stateDir 必须由 profile 提供。）
- `plugin_manager` → `install_bundle`，target = 本仓库绝对路径。结果：`application: applied`，`warnings: []`；profile 自动添加 `"dsh-superagent": "link:…"` 与 `dsh.profile.bundles` 行，并执行 pnpm install。

### 5.3 配置（已完成）

- `source:kaneo`：`baseUrl=https://pl.feg.cn`、`projectId=dgctny8ibgpn72ei2j8qj2hc`、`workspaceId=lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o`、`watchColumns=ready`、`claimColumn=in-progress`、`bootstrap=skip`、`pollSeconds=60`；保存时校验 Kaneo API，随后 `restarting:true`。
- `policy`：`sources.kaneo.allowed` = 5 位团队成员（吴志平/郑琪俊/解雨心/王常军/高洁）。**PowerShell 提交中文须用 UTF-8 字节体**，否则 `name` 会变 `???`（已重存 revision 2 修复）。
- `eval`/`executor` 保持默认（`observe`、`maxWorkers=3`、目录 `<stateDir>/work`）。

### 5.4 验证（已完成）

- `/orchestrator/api/state`：`setup.problem=null`、`runtime=ready`、`kaneo=ready`（"0 new tasks from ready"）。
- 烟雾任务 #470：在 `待辦池` 创建 → 移到 `ready` → 一个轮询周期内 `stats.received=1`、任务自动进 `in-progress`、Decision `accept`（explicitRouted）、Ticket 创建、Worker 执行并创建 `smoke.txt`、Kaneo 收到 ack + result 两条评论、Ticket `completed`。
- 验证后删除 #470（404 确认），证据保存在 [`TDD/artifacts/`](TDD/artifacts/)。
- 最终代码删除临时诊断后重新 build，并通过禁用/启用插件做冷重载：`setup.problem=null`、`runtime=ready`、`kaneo=ready`。

> 过程中定位并修复了一个 **Windows 阻塞问题**：主 Session 的 `tools.restrict` allow 列表硬编码 `bash`，而 Windows profile 只有 `pwsh` → 重启后 fiber failed。修复见 `src/app/sessions.ts`。

### 5.5 回滚

1. 用备份覆盖 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`。
2. 在 profile 目录执行 `pnpm install`，重启 DSH web 进程。
3. 可选：删除 `D:/Refine/Books/ntop/AI/dsh/state/superagent`（sqlite、锁、work 目录）；保留则历史仍在。
4. 确认 GUI 正常、无 `dsh-superagent` 行。

完整步骤与运维注意见 [`TDD/004-port-deployment.md`](TDD/004-port-deployment.md)。

---

## 6. 过程日志（时间线）

| 时间 | 事件 |
| --- | --- |
| 2026-11-03 12:47 | 接收任务；确认工作目录、git 历史（仅 1 个初始提交）、DSH 版本 0.2.1-rc.5、当前 GUI 3080 |
| 2026-11-03 12:5x | 摸清 DSH_HOME（`D:\Refine\Books\ntop\AI\dsh`）与活动 web profile（`...\profiles\web`）；发现 profile 已装 `kaneo-web` 等本地 bundle |
| 2026-11-03 13:0x | 读 README/SETUP/docs 001/002/006/007；建立领域模型与部署模型 |
| 2026-11-03 13:1x | 用 `kaneo-mcp` skill 查询：whoami=吴志平、workspace=ATEAM、projects=FDEP/pipeline；FDEP 8 列、285 任务；确认 REST 端点 |
| 2026-11-03 13:14 | 实现 Kaneo Source（6 个新文件）+ 部署/Windows 适配 + 测试 |
| 2026-11-03 13:10–13:20 | `pnpm install`、typecheck、Kaneo 单测 11/11、全量测试（39 个 Windows 基线失败） |
| 2026-11-03 13:34 | `pnpm build` 成功，产出 `lib/kaneo-watch.js` |
| 2026-11-03 13:37 | 备份 profile → 加 stateDir 配置 → `plugin_manager install_bundle` → `applied` |
| 2026-11-03 13:38 | 保存 `source:kaneo` → `restarting:true` |
| 2026-11-03 13:38–13:52 | **故障**：重启后 fiber failed / 404；借 `set_plugin` 诊断 + 临时文件日志定位到 `tools.restrict` 的 `bash`（Windows）→ 修 `sessions.ts` → rebuild → 重启用成功 |
| 2026-11-03 13:53 | 保存 policy（首次中文乱码，UTF-8 重存修复） |
| 2026-11-03 13:54–13:57 | **端到端**：#470 移入 ready → Trigger → Ticket → Worker 执行 → 评论回写 → 删除测试卡 |
| 2026-11-03 13:58–14:00 | 移除诊断/临时文件 → 最终 build → 禁用/启用冷重载 → 再验证 ready |
| 2026-11-03 14:0x | 回填 HANDOFF 与 TDD/002/003/004/005/006 |

---

## 7. 当前状态与下一步

**当前阶段：⏸ 实施暂停；web profile 已回滚为「未部署」。等待方案评审（见 [REPORT.md](REPORT.md) P1）。**

> 历史进展（回滚前完成、仅作参考）：改造/移植/端到端验证曾全部跑通；用户要求先出原理与方案，故已暂停并回滚部署。代码与文档保留在仓库中，未提交。

- [x] 解读 bundle 架构与 DSH 集成
- [x] 学习 Kaneo API 与 FDEP 数据
- [x] 建立 HANDOFF.md 与 TDD 索引
- [x] Kaneo Source 实现（6 个新文件 + 11 项单测）
- [x] 部署/Windows 适配（含 `tools.restrict` 的 Windows 修复）
- [x] 构建（`lib/kaneo-watch.js`）
- [x] 安装到 web profile（备份 + `install_bundle`）
- [x] 配置与端到端验证（#470 全链路 + 冷重载复核）
- [x] 文档回填（HANDOFF + TDD/001–006 + artifacts）

**下一步（建议，按优先级）**：

1. **确认业务口径**：监听列是否 `ready`、是否用 label 收窄（如 `sprint-2026-W56`）、允许发起人名单、完成后的列推进目标（`qa`／`in-review`）。
2. **执行器工作目录**：若任务需要真实代码仓库，配置 `executor.prepare` 与 `directory`（当前是空目录 `work/<ticket>`）。
3. **任务链接路由**：在 Kaneo Web 中确认任务页 URL 格式，修正 `kaneoTaskUrl`（当前 `?task=` 未实测）。
4. **专用身份**：为 agent 建专用 Kaneo 账号 + API key，使评论作者可区分（当前是吴志平）。
5. **二期**：任务完成后自动进 `qa`、评论 @验收人、webhook 替代轮询、多项目/多列。
6. **Windows 测试基线**（可选）：给上游 POSIX 测试补平台分支，使 `pnpm test` 全绿。

---

## 8. 风险、开放问题与决策

### 8.1 开放问题（待用户确认）

| # | 问题 | 当前落地 | 影响 |
| --- | --- | --- | --- |
| Q1 | 监听列/标签范围？ | 已按 `ready`（`待開工`）运行；`requiredLabels` 为空（不限） | 决定 Trigger 边界与噪声量 |
| Q2 | 提取后动作与回写？ | 执行任务 → 评论写回 → 自动进 `進行中`；完成列推进未做 | 决定自动化程度 |
| Q3 | 执行器工作目录/仓库？ | 默认 `<stateDir>/work/<ticket>`；`prepare` 为空 | 决定能否真正改代码 |
| Q4 | 装进活动 web profile 可接受？ | 已装并验证；备份可回滚 | 隔离性下降 |
| Q5 | 允许发起任务的用户？ | 已配置 5 位成员（owner + 4 members） | 决定谁能触发工作 |

### 8.2 风险

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 装进活动 web profile 影响现有会话/目录 | 中 | 备份 profile 配置；只启用 Kaneo、GitHub/Feishu disabled；回滚步骤见 TDD/004 |
| 上游代码面向 POSIX，Windows 下 shim/git 不可用 | 中 | 跳过 GitHub 环境写入；已修主 Session 工具名；其余为既有基线问题 |
| Kaneo API 限流（100/min） | 低 | 轮询 60s、单列 1 读 + 认领 1 写 |
| 任务内容不可信（prompt injection） | 中 | 外部数据不改变授权；API key 不进 prompt；Gate 按 allowed 名单 |
| 真实看板会真的产生工单/消费模型额度 | 中 | `bootstrap=skip` 避免抓爆已有任务；`maxWorkers=3`、`maxTasksPerColumn=50`；可随时 pause |
| 评论作者 = API key 用户 | 低 | 建专用 agent 账号/key（二期） |
| 任务链接路由未验证 | 低 | 打开 `/dashboard` 兜底；修正 `kaneoTaskUrl` 即可 |

### 8.3 决策记录

见 [`TDD/002-requirements-assumptions.md`](TDD/002-requirements-assumptions.md) 的探索与决策小节（ADR 风格，含 D1–D9）。

---

## 9. 文件地图（本次交付）

| 文件 | 说明 |
| --- | --- |
| `HANDOFF.md` | 本文件：总历程与交接 |
| `TDD/README.md` | TDD 目录索引与方法论 |
| `TDD/001-bundle-anatomy.md` | 上游 bundle 代码级解剖（解读/学习） |
| `TDD/002-requirements-assumptions.md` | 需求、假设、开放问题、决策 |
| `TDD/003-kaneo-source-design.md` | Kaneo Source 详细设计 |
| `TDD/004-port-deployment.md` | 移植/安装/配置/验证/回滚（实际执行记录） |
| `TDD/005-test-verification.md` | 测试与验收矩阵（含 Windows 基线说明） |
| `TDD/006-process-log.md` | 逐次操作过程日志（含故障与修复） |
| `TDD/artifacts/` | 端到端验证证据（Ticket/Decision/Comment/State JSON） |
| `src/sources/kaneo.ts` | Kaneo Source kind + 插件入口 + 轮询 |
| `src/sources/kaneo-config.ts` | 账号字段与完整配置 schema、URL |
| `src/sources/kaneo-api.ts` | REST 客户端（x-api-key、zod、重试） |
| `src/sources/kaneo-trigger.ts` | 任务 → Trigger / Thread / Channel / 过滤 |
| `src/sources/kaneo-channel.ts` | 评论写回 + 幂等 marker + link |
| `src/sources/kaneo-read.ts` | Thread context（描述 + 评论） |
| `tests/kaneo.spec.ts` | 11 项单测 |

---

## 10. 变更记录

| 时间 | 变更 |
| --- | --- |
| 2026-11-03 13:05 | 初版：完成解读/学习，建立 TDD 骨架，记录假设与计划 |
| 2026-11-03 13:20 | 实现完成：6 个 Kaneo 源文件 + 部署适配 + 测试 |
| 2026-11-03 13:37 | 安装到 web profile 并配置 |
| 2026-11-03 13:52 | 修复 Windows `tools.restrict`；插件 ready |
| 2026-11-03 13:57 | 端到端验证通过；清理测试卡 |
| 2026-11-03 14:05 | 文档回填：HANDOFF + TDD/001–006 + artifacts |
