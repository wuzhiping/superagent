# 报告 — 三来源改造方案：Kanban（任务）+ Gitea（代码/PR）+ ntfy（IM）

> 状态：**调研/方案阶段（P0→P1）**。实施暂停，web profile 安装已回滚（见 §0）。
> 本报告只讲原理、流程与分阶段计划，不含实施指令；每阶段设门禁，评审通过再进入下一阶段。
> 关联：[HANDOFF.md](HANDOFF.md)（此前过程交接）、[TDD/](TDD/README.md)（既有设计与过程记录）。

| 项 | 值 |
| --- | --- |
| 报告日期 | 2026-11-03（第二版：范围扩展为三来源） |
| 任务来源 | **Kanban** `https://pl.feg.cn`，workspace **ATEAM**，项目 **FDEP**（`dgctny8ibgpn72ei2j8qj2hc`） |
| 代码来源 | **Gitea** `https://git.feg.cn`（实测 **v1.27.3**），API 基址 `/api/v1`，Swagger `/swagger.v1.json` |
| IM 来源 | **ntfy** `https://msn.feg.cn`（实测 `/v1/health` healthy），订阅/发布 topic |
| 目标 profile | `D:\Refine\Books\ntop\AI\dsh\profiles\web`（当前 GUI 3080；**暂不安装**） |
| 结论 | 三来源技术上均可行；**推荐**新增三个 Source kind（kaneo/gitea/ntfy）+ 最小上游部署适配；分 6 阶段推进，先评审口径 |

---

## 0. 当前环境状态（先对齐事实）

| 项 | 状态 |
| --- | --- |
| web profile | ✅ 已回滚：依赖移除、bundle 列表还原、profile patch 还原；`/orchestrator/api/state` 404；GUI 正常 |
| 仓库代码 | 上一轮探索性实现（Kanban 部分 + GitHub 适配）**已暂停、未提交、未部署**；Gitea/ntfy 尚未实现 |
| 惰性残留 | 状态目录 `D:/Refine/Books/ntop/AI/dsh/state/superagent` + DSH workspace 注册表 2 个条目（`...\state\superagent`、`...\work\kaneo-smoke-test-…`）；建议在 GUI 里删这两个 workspace 条目后再删目录 |
| 备份 | `D:\Refine\Books\ntop\AI\dsh\profiles\web\.dsh-superagent-backup-20261103-133726` |

> 本轮新增的调研（Gitea / ntfy）只做了**只读探测**，没有发布消息、没有改任何配置。

**最终状态（2026-11-03，按「完成改造和测试、完成部署」）**：Gitea / ntfy 已从只读骨架升级为**完整 Source**（Trigger、Channel 回复、Thread 上下文、策略、环境变量、部署账号校验），与 Kanban 一起以 bundle 形式**安装并运行在 dsh web profile**；三个来源 health 均 `ready`。**端到端实测通过**：Kanban 任务→工单→worker→评论回写（completed）；ntfy 消息→工单→worker→主题回复（已校验）。Gitea 的匿名/公开仓库只读轮询与读取已实测，写回/通知模式需 agent 账号 token（当前未提供，相关路径由单测覆盖）。中文界面产品名统一为「超级智能体」（技术标识 `dsh-superagent` 不变）。单测 34 项、typecheck、build 通过。详见 [`TDD/007-p2-readonly-skeleton.md`](TDD/007-p2-readonly-skeleton.md)。

---

## 1. 目标与边界

### 1.1 目标形态

```
[任务来源] Kanban FDEP 看板 ──任务进入监听列──┐
[IM 来源]  ntfy topic        ──消息──────────┼──> Trigger → Eval → Ticket → Executor
[代码来源] Gitea 仓库        ──Issue/PR/评论──┘         │
                                                        ├─> 代码改动推送到 Gitea（分支/PR）
                                                        └─> 回复写回：Kanban 评论 / Gitea 评论 / ntfy 消息
```

与上游 `dsh-superagent` 的差别：

| 维度 | 上游 | 本方案 |
| --- | --- | --- |
| 任务/请求来源 | GitHub Issue/PR/CI + Feishu | **Kanban 看板列** + **ntfy topic** + **Gitea Issue/PR/评论** |
| 代码托管与 PR | github.com + `gh` CLI | **自架 Gitea（REST API，无 CLI 依赖）** |
| 消息回写 | GitHub 评论 / Feishu 回复 | Kanban 评论 / Gitea 评论 / ntfy 消息 |
| 账号体系 | GitHub 账号 + Feishu bot | Kanban API key + Gitea token（agent 账号）+ ntfy topic/auth |
| 运行环境 | 假定 POSIX | Windows 本机（需适配） |

### 1.2 范围（建议）

| 包含 | 不包含（本期）或待定 |
| --- | --- |
| 三个 Source kind：`kaneo` / `gitea` / `ntfy` | 重写 Engine/Executor/面板 |
| 无 GitHub 的三来源部署（账号校验、Git 凭据） | GitHub Source 的 Windows 支持（保持关闭） |
| 任务→工单→执行→回写的闭环 | Kanban 全字段双向同步（工时/子任务等） |
| Gitea 上的分支/PR/评论/状态回写 | Gitea Actions/CI 深度集成（先读 commit status） |
| ntfy 订阅→Trigger、回复→发布 | 多人群聊语义（ntfy 无原生会话/线程） |
| 分阶段评审与验证 | 立即安装到活动 web profile（P1 前不做） |

### 1.3 成功标准（建议）

1. 构建/类型检查通过；三个 Source 各有单测（翻译、去重、幂等、错误处理）。
2. 无 GitHub 时插件能 setup 成功并 ready；三个来源各自 health 正常。
3. 任务进入 Kanban 监听列 → Ticket → Gitea 分支/PR（或至少评论）→ 三处回写闭环。
4. 安全可控：ntfy 公开 topic 低信任、私有 topic 可账号密码保护；Gitea token 不进 prompt；可 pause、可回滚。

---

## 2. 原理篇

### 2.1 DSH 插件/装配模型（宿主）

- profile 由「bundle patch 层 + profile patch 层 + home patch 层」叠加；`dsh.profile.bundles` 决定启用哪些 bundle。
- 插件行 = `id`（全局唯一）+ `name`（包名或子路径）+ `config` + `disabled`；Client 侧另有 `dsh.client` 声明。
- 插件 `apply(ctx, config)`；`ctx.inject([...])` 声明依赖；`ctx.effect()` 返回清理；`ctx.fiber.restart()` 重启自身。
- 管理/安装通过 DSH 的 Plugin Manager（`install_bundle` / `remove_bundle` / `set_plugin`）。
- **含义**：新增来源优先用 bundle 内的扩展点（Source kind），不碰内核。

### 2.2 dsh-superagent 领域模型与流程（不变的部分）

```
Source ──Trigger──> Thread ──batch──> Eval(Gate + 研判) ──Decision(accept)──> Ticket
  ▲                                                                             │
  └──────────── Channel（评论/回复/PR） ◄──── Assignment/Executor(Session) ◄─────┘
```

- **Trigger**：不可变事件；id 幂等；带 actor/human/addressed/threads/text/meta。
- **Thread**：同一话题的事件序列；Eval 串行；Subscription 扇出只提供上下文、不新增授权。
- **Eval**：Gate（allowed 名单/接收范围/强度）+ 模型研判（规则打分）；`explicit` 走主 Session 路由，`inferred` 受 accept mode 约束。
- **Mandate/Ticket/Assignment**：授权与工单状态由 Engine 唯一写；Executor 每工单一个 Session + 目录。
- **Effects/Passes**：持久化副作用队列 + 每 2s 的评估循环；失败退避。
- **Setup/Deployment**：账号探测 + worker 环境准备；未完成时 Runtime paused。

### 2.3 上游的 GitHub 强耦合（必须适配）

1. `resolveDeployment()` 强制 `repository` + `gh` CLI，探测账号与 push 权限；否则 Setup 永远失败。
2. Setup 成功后会写 `<stateDir>/worker-bin` 的 `gh`/`lark-cli` shim 与 `worker-gitconfig`（POSIX shell）。
3. `SETUP_FIELDS` 只认 github/feishu；`Commands` 的 `gh()/api()` 绑定 GitHub CLI。
4. `src/app/sessions.ts` 主 Session 工具 allow 列表硬编码 `bash`（Windows 上导致 `tools.restrict` 失败，fiber 无法重启）。

→ 三来源方案需要把「部署门禁」重写为 **Kanban/Gitea/ntfy 三个账号检查**，并把「worker 的 git 凭据」改为 **Gitea token 的跨平台配置**（不再写 POSIX shim）。

### 2.4 Kanban（任务来源）原理

对象：`Workspace → Project → Column → Task → Comment/Activity`；状态=列 slug；任务有内部 id 与票号（`FDE-470`）。

- 认证：MCP 用 `Authorization: Bearer`，REST 用 `x-api-key`；key 100 次/分钟。
- 读任务：`GET /task/tasks/{projectId}?status=<slug>&limit=N` → `{data:{columns:[{slug,tasks[]}]},pagination}`；只能按 `status`（slug）筛，中文列名静默 0。
- 写：`POST /comment/{taskId}`、`PUT /task/status/{id}`、`POST /task/{projectId}`（建任务）。
- 没有「进入列」事件推送 → **轮询**。
- 实测数据：FDEP 8 列，285 任务（待辦池 26 / 待開工 28 / 進行中 17 / Blocked 16 / 程式碼審查 20 / 測試驗證 22 / 預發布 8 / 已交付 148）。

### 2.5 Gitea（代码来源）原理（新增）

**实测环境**：`https://git.feg.cn`，版本 **1.27.3**；匿名可读公开仓库；`/api/v1` 与 `/swagger.v1.json` 均可用（308 个 path）。本机**没有** `tea`/`gitea`/`gh` CLI，也无 Gitea token 环境变量（Windows 凭据管理器里有 `git.feg.cn` 的 git 凭据，但那是 git 凭据，不视为 API token 可用的证据）。

**已确认的 API 能力**（swagger 实测）：

| 用途 | 端点 | 备注 |
| --- | --- | --- |
| 身份 | `GET /user` | 需 token（匿名 401） |
| 通知 | `GET /notifications`（`since/before/all/status-types/subject-type`）、`PUT /notifications` | agent 账号的 notifications；类似 GitHub 通知 |
| Issue 列表 | `GET /repos/{owner}/{repo}/issues`（`state/labels/q/type/since/before/...`） | `since` 支持增量轮询 |
| Issue 评论 | `GET /repos/{owner}/{repo}/issues/comments`（`since/before`）；`GET/POST .../issues/{index}/comments` | 仓库级评论流 + 单 Issue 评论 |
| PR | `GET/POST /repos/{owner}/{repo}/pulls`；`/{index}`、`/files`、`/commits`、`/merge` | 建 PR、读改动 |
| 提交状态 | `GET /repos/{owner}/{repo}/commits/{ref}/statuses` | 近似 CI 结果（Gitea commit status） |
| 分支/内容 | `GET /repos/{o}/{r}/branches`、`/contents` | 读取/对比 |
| Webhook | `GET/POST /repos/{o}/{r}/hooks` | 可选推送路径（见下） |
| 权限 | `GET /repos/{o}/{r}/collaborators`、`.../{collaborator}/permission` | 校验 push 权限 |

**认证**：`Authorization: token <token>`（或 Basic）。建议为 agent 建专用 Gitea 账号并签发 token（scope 按 Gitea 1.27 的 token 权限模型）。

**读事件的两条策略**：

- **A. 通知（notifications）**：agent 账号被 @、被指派、被 review 请求时收到通知 → 轮询 `GET /notifications?since=`；最接近上游 GitHub 行为。
- **B. 仓库级增量**：`issues?since=`、`issues/comments?since=`、`pulls?sort=recentupdate`；等价于上游的「observe all」开关，适合团队希望 agent 主动发现工作的场景。
- **C. Webhook（可选）**：Gitea 支持 repo hooks；但我们的 DSH Web 在操作员本机（127.0.0.1），服务器一般无法回调 → 除非有内网可达地址/反向代理，否则**默认轮询**。

**数据访问现状**：匿名搜索到公开仓库 `shawoo/fdep`（**空仓库**，无分支/提交/Issue/PR）、`shawoo/dsh-im`、`shawoo/cordis-plugins`。→ **目标仓库与 agent 账号待定**（见开放问题）。

### 2.6 ntfy（IM 来源）原理（新增）

**实测环境**：`https://msn.feg.cn`，`/v1/health` 返回 `{"healthy":true}`。消息以 topic 分组；topic 是「频道」，**没有会话/线程/回复引用**。

**实测消息 JSON 形状**（`GET /<topic>/json?poll=1&since=48h`）：

```json
{"id":"Xlx3jl4pz7fq","time":1793578355,"expires":1794874355,"event":"message",
 "topic":"pub_dsh","title":"…","message":"…markdown…","priority":3,
 "tags":["AI治理","fire","robot","newspaper"],"content_type":"text/markdown"}
```

关键结论：

1. **消息里没有发布者身份字段**（无 user/sender）。身份只能靠约定：`title` 形如 `#username`/`@username`（本机 `ntfy-teams` 用它做显示名）。
2. **发布体格式有服务器 quirk**（来自 `ntfy-teams` 实测注释）：该服务器**不解析 JSON 发布体**，`Content-Type: application/json` 的 body 会被当纯文本；可用的发布方式是 **body=纯文本消息 + 元数据走 HTTP 头 `Title` / `Priority` / `Tags` / `Click`**。设计发布时必须按这个来。
3. 订阅/历史：`GET /<topic>/json`（流式 NDJSON，可长连）与 `GET /<topic>/json?poll=1&since=<dur|all>`（历史 NDJSON）；服务端保留约 **15 天**。
4. 单条查询与更新不可用：`GET /<topic>/json/<id>` 恒 404；`PUT` 不支持（会当新消息发布）；`DELETE /<topic>/<id>` 支持（墓碑事件）。
5. 认证：本机 `ntfy-teams` 支持 `none` / `Basic(user,password)` / `Bearer(token)` 三种。**私有 topic 可以用账号+密码（HTTP Basic，服务器侧配置用户与权限）或访问令牌保护**，只有持凭据者能订阅/发布；`pub_` 前缀的 topic 是公开的、无需认证。
6. **安全结论（已修正）**：
   - `pub_` 开头的 topic 是公开 topic——**没有认证**，任何人可订阅/发送，所以其 inbound 消息不能作为「谁授权了工作」的可信依据；可用 `pub_<projectId>`（如 `pub_dgctny8ibgpn72ei2j8qj2hc`）做测试 topic（已实测往返）。
   - **ntfy 本身支持账号+密码（Basic）保护**：给私有 topic 配置用户/ACL 后，Source 用 `authMode=basic` + 账号密码即可读写，只有持凭据者能发布；也可用 bearer token。**正式接入应优先使用受保护的私有 topic，而不是公开 `pub_` topic。**
   - 即便用了账号密码，**同一凭据的持有者之间仍可冒用 title 身份**（ntfy 消息无发布者字段），因此还需要：allowed 名单 +（必要时）消息签名/HMAC 或网关转发来确认「谁授权」。
   - 可选处置：a) 私有 topic + 账号密码 + allowed 名单；b) 消息内签名/HMAC；c) 仅 inferred / 人工确认；d) 专用网关 topic。

### 2.7 三来源到领域模型的映射（建议）

| 领域 | Kanban | Gitea | ntfy |
| --- | --- | --- | --- |
| Source kind | `kaneo` | `gitea` | `ntfy` |
| Trigger | 任务进入监听列 | 通知/ Issue/PR/评论/状态变化 | topic 里的新消息 |
| Thread | 一条任务 | 一个 Issue/PR（`repo#index`） | 一个 topic（消息无法分组） |
| Channel | 任务评论 | Issue/PR 评论 | topic 发布（`title=#agent`） |
| ThreadContext | 任务描述+评论 | Issue/PR 正文+评论+改动 | 最近 N 条 topic 消息 |
| Policy allowed | Kanban 用户 id | Gitea username / bot | ntfy 发送者约定（私有 topic 可账号密码保护；公开 topic 低信任） |
| 触发强度 | 列位=explicit（可配） | @agent=explicit；observe 流=inferred | 私有 topic + 账号密码可 explicit；公开 topic 建议 inferred/人工确认 |
| 环境变量 | 任务 id/url/project | repo/account/base_url（token 不进 prompt） | topic/url（token 不进 prompt） |

### 2.8 集成方案对比

| 维度 | 方案 | 评价 |
| --- | --- | --- |
| 任务源 | **新增 `kaneo` Source kind** | ✅ 推荐 |
| 代码源 | **新增 `gitea` Source kind**（REST，不依赖 CLI） | ✅ 推荐；避免 `gh`/`tea` 依赖 |
| 代码源（备选） | 魔改 GitHub Source 指向 Gitea | ❌ API 差异与命名/语义扭曲，且 `gh` 不支持 Gitea |
| 代码源（备选） | 安装 `tea` CLI 复用上游 CLI 模式 | ❌ 需额外安装/登录；REST 更可控 |
| IM 源 | **新增 `ntfy` Source kind** | ✅ 推荐（与领域一致） |
| IM 源（备选） | 扩展 `dsh-im` 插件 | ❌ dsh-im 面向人机聊天桥，不是 Trigger 来源 |
| 推送 vs 轮询 | 三源都默认**轮询**；Gitea 留 webhook 扩展点 | ✅ 桌面环境无入站地址 |
| 部署形态 | **fork 上游 bundle，最小 diff** | ✅ 三源都要改 Setup 门禁，独立 bundle 绕不过 |

---

## 3. 流程篇（目标工作流）

```
① 任务进入 Kanban「待開工」
      └─(轮询)→ kaneo Source 生成 explicit Trigger → Gate → Ticket → Executor

② Executor 在工单目录工作
      ├─ git clone/fetch Gitea 仓库（token 经本地 git 配置，不进 prompt）
      ├─ 创建分支 agent/<ticket> → 提交 → push
      ├─ 创建 Gitea PR（host 工具或 prepare 脚本）→ 记录 PR 号
      └─ 报告进度/结果

③ Gitea 讨论（评论/评审/CI 状态）
      └─(轮询/通知)→ gitea Source 把后续消息扇出给 Ticket（上下文）或生成新 Trigger

④ 回写
      ├─ Kanban：任务评论（ack/result/attention）+ 认领列推进
      ├─ Gitea：Issue/PR 评论
      └─ ntfy：发布结果消息（title=#agent）

⑤ IM 请求
      └─ ntfy topic 新消息 → ntfy Source（公开 topic 低信任；私有 topic 可账号密码保护）→ 工单/回复
```

**幂等/可靠性要点**

| 关注点 | 机制 |
| --- | --- |
| 重复轮询不重复建单 | Trigger id 用「不可变键 + 观测时间/序号」；Source KV 记录游标/已见；Engine 幂等 |
| 重复评论 | 评论正文内嵌 marker（Kanban/ GitHub 已验证可行；Gitea 需实测 HTML 注释是否保留）+ 发送前查重 |
| 首次抓爆存量 | `bootstrap=skip`（Kanban）；Gitea `since=启动时间`；ntfy `since=启动时间` |
| 轮询失败 | 连续失败计数→health error；单次失败下轮重试；429/5xx 退避 |
| 大内容 | Trigger 摘要 + ThreadContext 按需读全文；限制 prompt 体积 |
| 凭据 | token 只在宿主配置/本地 git 配置；不写 prompt、不进环境变量提示文本 |
| 低信任 IM | 公开 topic：默认 inferred/人工确认；私有 topic：账号密码（Basic/Bearer）+ allowed 名单后可 explicit；更强用 HMAC |

---

## 4. 分阶段方案计划（本次不实施）

### P0 — 理解与学习（已完成）

- 产出：本报告 + [TDD/001-bundle-anatomy.md](TDD/001-bundle-anatomy.md) + 实测数据（Kanban/Gitea/ntfy）。
- 门禁：你确认「原理与问题定义无误」。

### P1 — 方案评审（本次交付）

需要拍板的口径（§8）。门禁：全部确认 + 方案取舍签字。

### P2 — 三来源接入（已完成，并升级为完整 Source + 部署）

目标（原）：三个 Source 都能注册、轮询、报 health。实际执行超出原计划：三个来源均实现完整 Trigger/Channel/ThreadContext/策略/部署校验，并完成安装与端到端验证（见下方「最终状态」及 [`TDD/007-p2-readonly-skeleton.md`](TDD/007-p2-readonly-skeleton.md)）。

### P3 — 任务闭环（Kanban → Ticket → 评论）

目标：任务进入监听列 → Ticket → Executor → Kanban 评论 + 认领列。范围同上一轮已验证的 Kanban 闭环。

- 门禁：单测 + 隔离环境端到端；测试卡可删。

### P4 — 代码闭环（Gitea 分支/PR/CI）

目标：Worker 在 Gitea 仓库产出分支与 PR；Gitea 讨论/状态回传 Ticket。

- 分支命名、PR 模板、reviewer、auto-merge/CI 门禁、评论 marker 幂等。
- 门禁：小范围真实仓库试点（推荐专用测试仓库）。

### P5 — IM 闭环（ntfy 双向）

目标：ntfy 消息 → Trigger →（公开 topic 低信任 / 私有 topic 账号密码）工单；回复发到 topic。

- 认证方式（none/basic/bearer）、私有 topic 账号密码或 ACL、发送者约定、发布头格式、流式订阅重连。
- 门禁：私有测试 topic（账号+密码）验证；公开 `pub_` topic 仅在低风险/测试场景使用。

### P6 — 业务化与硬化

- 完成列推进、@验收人、专用账号、观测/告警、文档定稿、回滚演练。
- 门禁：回滚演练通过 + 运行期无严重问题。

```
P0 理解 ✅ ──> P1 评审 ──> P2 只读骨架 ──> P3 任务闭环 ──> P4 代码闭环 ──> P5 IM 闭环 ──> P6 硬化
```

---

## 5. 影响面清单（基于代码阅读与实测；P2 前复核）

| 类别 | 文件/对象 | 说明 |
| --- | --- | --- |
| 新增 | `src/sources/kaneo*.ts` | 任务来源（kind/config/api/trigger/channel/read） |
| 新增 | `src/sources/gitea*.ts` | 代码来源（kind/config/api/trigger/channel/read/pull） |
| 新增 | `src/sources/ntfy*.ts` | IM 来源（kind/config/api/trigger/channel/read） |
| 新增 | `tests/{kaneo,gitea,ntfy}.spec.ts` | 三来源单测 |
| 改 | `src/deployment.ts` | 三账号模型；Windows 绝对路径；Gitea 仓库/账号 |
| 改 | `src/app/setup.ts` | 三来源校验；Gitea git 凭据写入；ntfy 校验；不再强制 GitHub |
| 改 | `src/infra/environment.ts` | 跨平台 Git 凭据（替代 POSIX shim）；避免 token 进入 prompt |
| 改 | `src/app/sessions.ts` | Windows shell 工具名（`pwsh`）修复 |
| 改 | `src/kv.ts` | 三来源游标/去重键 |
| 改 | `src/policy.ts` | `executor.directory` 跨平台；三来源 policy 扩展由各 kind 提供 |
| 改 | `src/executor/dsh.ts` / `src/app/tools/executor.ts` | Gitea PR 绑定/创建、CI 状态；环境变量 |
| 改 | `src/app/links.ts` / `resources.ts` / `cards.ts` | Gitea/Kanban/ntfy 资源链接与上下文 |
| 改 | `prompts/*`（P4/P5） | delivery 段改为 Gitea PR / ntfy 消息 |
| 改 | `package.json` / `tsdown.config.ts` / `cordis.patch.yml` | 三个 Source 入口/行；默认禁用 GitHub/Feishu |
| 改 | `src/client/locales.ts`、`src/setup.ts` | 文案与错误码 |
| 改 | `docs/007-architecture.md`、测试表 | 文档一致性 |
| 运维 | Gitea agent 账号 + token；ntfy 私有 topic/账号密码或 ACL；Kanban API key | 需创建/确认 |

---

## 6. 测试与验收计划

| 层级 | 内容 | 环境 |
| --- | --- | --- |
| 单测 | 三来源：任务/消息/事件→Trigger、去重/游标、Channel 幂等、404/401/429、ThreadContext | 本机（fake fetch） |
| 集成（无模型） | Source 注册、Gate/scope、setup 门禁、Gitea/ntfy 只读 | 本机独立进程 |
| E2E-任务 | Kanban 测试卡 → Ticket → Executor → 任务评论 | 隔离 profile |
| E2E-代码 | 测试仓库 → 分支/PR → 评论/状态回传 | 隔离 profile + 测试仓库 |
| E2E-IM | 私有 topic（账号+密码）→ Trigger → 回复发布；公开 topic 仅测试 | 隔离 profile + 私有 topic |
| 回归 | bundle-patch/locales/policy/registry 等 | 本机 |
| 安全 | ntfy 冒用/伪造、token 泄漏、prompt 注入、评论重复 | 评审 + 测试 |

> Windows 基线：上游测试大量依赖 `#!/bin/sh`、tmux、POSIX 路径，全量 `pnpm test` 约 39 项既有失败；新代码应写平台无关测试，只跑相关套件。

---

## 7. 风险登记（含新增来源）

| 风险 | 等级 | 说明/缓解 |
| --- | --- | --- |
| **ntfy 无发布者身份** | **高** | 公开 topic 无认证、身份可伪造；缓解：私有 topic + **账号密码（Basic）/ Bearer** 限制发布者（P2 已支持），必要时 HMAC；公开 topic 只走 inferred/人工确认 |
| ntfy 服务器不解析 JSON 发布体 | 中 | 发布必须用「纯文本 body + Title/Priority/Tags 头」；设计已纳入 |
| ntfy 消息无线程/引用 | 中 | 以 topic 为 Thread；消息批量进 Eval；回写是新消息 |
| ntfy 15 天保留 | 中 | 游标必须持久化；不能依赖历史重建 |
| Gitea token/账号 | 中 | 专用 agent 账号 + 最小 scope；token 只存宿主/本地 git 配置 |
| Gitea CI 语义与 GitHub 不同 | 中 | 先读 commit statuses；不假设 GitHub checks/Actions |
| Gitea 目标仓库未定/为空 | 中 | 实测 `shawoo/fdep` 是空仓库；需确认实际工作仓库 |
| 入站 webhook 不可达 | 中 | 默认轮询；webhook 作为二期可选 |
| 无 `tea`/`gh` CLI | 低 | 全走 REST；git 用系统 git |
| 装活动 web profile 影响日常 | 中 | P2 隔离验证；P6 才谈安装；保留回滚 |
| fork 维护成本 | 中 | 最小 diff；三来源尽量独立；可考虑向上游提 PR 通用化部署 |
| 内容注入/大任务描述 | 中 | 外部数据不改授权；token 不进 prompt；工具最小集 |
| Windows 平台 | 中 | 工具名、路径、git 凭据、测试基线 |

---

## 8. 开放问题（P1 需要确认）

### A. 三来源通用 / 安装
1. **安装目标与时机**：先隔离 profile 验证（推荐），还是直接目标 web profile？
2. 三来源是否**必须同时上线**，还是按 P3（Kanban）→ P4（Gitea）→ P5（ntfy）分步？

### B. Kanban（任务）
3. 监听列：`待開工`（默认）？是否加 label 收窄（如 `sprint-2026-W56`、`ai:`）？
4. 触发语义：进入列=explicit（默认）？完成后列推进目标（`qa`/`in-review`）？
5. 允许发起任务的 Kanban 用户范围（当前计划 owner+4 members）。

### C. Gitea（代码）
6. 目标仓库：哪个 `owner/name`？（`shawoo/fdep` 实测为空；是否另有仓库）
7. agent 账号与 token：谁提供？（建议专用账号，最小权限）
8. 监听范围：只要 @agent/通知，还是 issue/PR/评论全量（observe）？是否监听 commit status？
9. PR 工作流：分支前缀、reviewer、是否等待 CI、是否允许 auto-merge？
10. Executor 工作目录：`work/<ticket>` 克隆，还是指定本地 clone + worktree？

### D. ntfy（IM）
11. topic 名与归属：`pub_` 前缀 topic 是公开 topic、无认证；**私有 topic 支持账号+密码（Basic）或 token 保护**。建议测试用 `pub_<projectId>`（如 `pub_dgctny8ibgpn72ei2j8qj2hc`，已实测），正式用私有 topic + 账号密码。正式用哪个？
12. 认证：公开 `pub_` 用 none；私有 topic 用 **账号+密码（Basic）** 还是 Bearer token（P2 已支持三种）？
13. 发送者约定：`title=#username`？谁维护这个约定？
14. 授权策略：私有 topic + 账号密码 + allowed 名单 → explicit；公开 topic → ①直接 explicit（不推荐）②inferred（observe/auto）③人工确认 ④网关 HMAC？
15. 回复方式：发到同一 topic（title=#agent）？还是另设 outbound topic？
16. 触发规则：所有消息都收，还是必须 `@agent` 出现？

---

## 9. 附录：已写代码现状

| 内容 | 状态 | 可复用性 |
| --- | --- | --- |
| Kanban Source（`src/sources/kaneo*.ts`）+ 单测 11 项 | 已写、暂停、未提交 | **高**：P2/P3 主要复用 |
| 无 GitHub 部署适配（deployment/setup/policy/sessions/kv…） | 已写、暂停 | 中：需扩展为三来源账号模型 |
| **Gitea 只读骨架**（config/api/kind + 单测） | ✅ P2 第一增量：已写、已测、已构建；**未部署** | 高：P4 接 Trigger/Channel/PR |
| **ntfy 只读骨架**（config/api/kind + 单测） | ✅ P2 第一增量：已写、已测、已构建；**未部署** | 高：P5 接 Trigger/Channel |
| 端到端证据（`TDD/artifacts/`） | 已保存（回滚前） | 参考 |

> 上一轮曾把 Kanban 版安装进 web profile 并跑通闭环，但已按用户要求回滚；本报告不复用「已部署」结论。P2 只读骨架的细节与实测见 [`TDD/007-p2-readonly-skeleton.md`](TDD/007-p2-readonly-skeleton.md)。

---

## 10. 下一步（等待你）

1. 审阅本报告，回答 §8 的 16 个问题（至少 A/B/C/D 各一）。
2. 确认后进入 **P2 三来源只读骨架**（隔离环境，不安装活动 profile）。
3. P2 通过后再依次 P3/P4/P5，每阶段单独评审。
