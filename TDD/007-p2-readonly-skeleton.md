# 007 — 三来源改造：实现、测试与部署记录

> 状态（2026-11-03，最终）：**已实现、已测试、已安装并运行在 dsh web profile；Kanban 与 ntfy 端到端实测通过；Gitea 只读路径实测通过，写回路径待 agent token。**
> 本文件原为「P2 只读骨架」记录，现更新为完整交付记录；方案见 [`../REPORT.md`](../REPORT.md)，过程流水见 [`006-process-log.md`](006-process-log.md)。

## 1. 交付范围

| 来源 | 实现 | 实测 |
| --- | --- | --- |
| **Kanban**（`https://pl.feg.cn`，项目 FDEP） | Trigger/Channel/Thread 上下文/策略/部署校验（此前已写） | ✅ 端到端：任务 → 工单 → worker 执行 → 任务评论回写，工单 `completed` |
| **Gitea**（`https://git.feg.cn`） | Trigger/Channel/Thread 上下文/策略/环境变量/部署校验；`repo` 增量与 `notifications` 两种模式 | ✅ 只读实测：版本/仓库/issues/comments/pulls 匿名读取；轮询 health `ready`。⏳ 写回与通知模式需 agent token |
| **ntfy**（`https://msn.feg.cn`） | Trigger/Channel 发布/Thread 上下文/策略/环境变量/部署校验 | ✅ 端到端：`pub_<projectId>` 消息 → 工单 → worker 执行 → 主题回复（标题 `#dsh-superagent`）已校验 |

技术标识仍为 `dsh-superagent`；中文界面产品名统一显示为「**超级智能体**」（见 §7）。

## 2. 新增/修改文件

| 文件 | 作用 |
| --- | --- |
| `src/sources/gitea-config.ts` | 账号/配置 schema（`baseUrl`/`token`/`repository`/`listen`/`agent`/`bots`/bootstrap/poll…）、`repositoryOf`、`giteaBot` |
| `src/sources/gitea-api.ts` | `GiteaClient`：token 头、zod、超时、429/5xx 重试；`version/user/repository/notifications/issues/issueComments/issue/issueCommentsOf/createIssueComment/pulls` |
| `src/sources/gitea.ts` | kind：`issueTrigger`/`commentTrigger`/`notificationTrigger`、`pollRound`、Channel（评论 + marker 幂等）、ThreadContext、策略、环境变量 |
| `src/sources/ntfy-config.ts` | 配置 schema（server/topic/auth/agent/sender/bootstrap/poll…）、`ntfyAccountOf`、topic URL |
| `src/sources/ntfy-api.ts` | `history`（NDJSON + 墓碑剔除）、`publish`（纯文本 body + Title/Priority/Tags 头）、auth 头 |
| `src/sources/ntfy.ts` | kind：`ntfyTrigger`、`pollRound`、Channel（发布 + marker 幂等）、ThreadContext、策略、环境变量 |
| `src/deployment.ts` | `Deployment.gitea/ntfy`、`SETUP_FIELDS` 扩展、`resolveDeployment` 支持无 GitHub 的三来源解析 |
| `src/app/setup.ts` | `verifyGitea`/`verifyNtfy`、`source:gitea`/`source:ntfy` 的 checkAccounts |
| `src/setup.ts` / `src/client/locales.ts` | Gitea/ntfy 部署问题码与文案、来源/health 文案、中文产品名「超级智能体」 |
| `src/kv.ts` | `gitea.thread` 游标 |
| `tests/gitea.spec.ts` / `tests/ntfy.spec.ts` | 触发映射、轮询 baseline/增量、Channel 幂等、Thread 上下文、配置与错误路径 |

## 3. 信任设计（ntfy：公开 topic 低信任，私有 topic 可账号密码保护）

- ntfy 支持三种认证：`none` / `Basic(账号, 密码)` / `Bearer(token)`。**私有 topic 可以配置用户/权限，用账号+密码（HTTP Basic）或 token 保护**，只有持凭据者能订阅/发布；本项目的 `source:ntfy` 已支持 `authMode=basic/bearer`。
- `pub_` 前缀的 topic 是**公开 topic**：无认证、任何人可订阅/发布，其发送者身份只能靠消息 `title` 的 `#name` 约定，**可被冒用**。因此公开 topic 上：`addressed` 只在提到 `@<agent>` 时设置，是否 explicit 由 policy 的 `allowed` 名单决定，**只能作为低信任约束**。
- 即使使用账号密码保护的私有 topic，同一凭据的持有者之间仍可冒用 title 身份（ntfy 消息没有发布者字段），所以仍需 allowed 名单；需要更强保证时叠加消息签名/HMAC 或专用网关。
- 生产建议：**优先私有 topic + 账号密码（Basic）或 token + allowed 名单**；公开 `pub_` topic 只用于测试或低风险通知（inferred / 人工确认）。本轮测试在 `pub_dgctny8ibgpn72ei2j8qj2hc` 上把 `wu.zhiping` 列入 allowed，仅用于验证链路。

## 4. 测试结果

```
pnpm typecheck                                  # 通过
pnpm exec vitest run tests/gitea.spec.ts tests/ntfy.spec.ts tests/kaneo.spec.ts tests/bundle-patch.spec.ts tests/locales.spec.ts
Test Files  5 passed (5)
     Tests  34 passed (34)
pnpm build                                      # gitea-watch / ntfy-watch / kaneo-watch 入口与 client 均构建通过
```

真实只读实测（运行时代码）：

- ntfy：发布 → `history` 读回 → DELETE 清理，往返成功；发现并修复「墓碑与已删消息同时返回」的解析问题（单测覆盖两种顺序）。
- Gitea：匿名读取 `shawoo/PDP` 的版本/仓库/issues/comments/pulls 成功；`shawoo/cordis-plugins` 的 `/pulls` 404 时客户端正确抛 `GiteaError(404)`。

## 5. 部署（dsh web profile）

- 安装：`plugin_manager install_bundle` 链接本仓库到 `D:\Refine\Books\ntop\AI\dsh\profiles\web`；profile patch 增加 `dsh-superagent` 的 `stateDir`（`D:/Refine/Books/ntop/AI/dsh/state/superagent`）。
- 配置（管理 API）：
  - `source:kaneo`：`https://pl.feg.cn` + API key + 项目 FDEP；
  - `source:gitea`：`https://git.feg.cn`、`shawoo/PDP`、`listen=repo`、公开只读（无 token）；
  - `source:ntfy`：`https://msn.feg.cn`、`pub_dgctny8ibgpn72ei2j8qj2hc`、无认证（测试用公开 topic；生产建议私有 topic + 账号密码）、`sender=#dsh-superagent`、poll 30s；
  - `policy`：保留 Kanban 5 人名单，新增 Gitea `shawoo`、ntfy `wu.zhiping` 的 allowed。
- 校验：`/orchestrator/api/state` → `runtime/kaneo/gitea/ntfy` 均 `ready`；GUI HTTP 200。
- 回滚材料：安装前备份 `profiles/web/.dsh-superagent-backup3-20261103-144840`。

## 6. 端到端证据

| 链路 | 结果 |
| --- | --- |
| Kanban | 测试卡 #471 → Trigger → Decision `accept(explicitRouted)` → Ticket `bfff5a79…` → worker 新建 `kaneo-3src.txt` → 注释「收到 / 已完成」→ Ticket `ended(completed)`；测试卡已删除 |
| ntfy | 消息 `E6HlTEeq9Udu`（`#wu.zhiping`，含 `@dsh-superagent`）→ Trigger → accept → Ticket `9f2766ac…` → 主题回复 2 条（标题 `#dsh-superagent`，含 marker）→ Ticket ended(dropped，因指令只要求回复)；测试消息与回复已 DELETE |
| Gitea | 轮询 health `ready`、`0 new event(s)`（公开仓库无新事件）；写回未做（缺 token） |

## 7. 界面文案

- 中文 `locales.ts` 中产品名改为「超级智能体」：侧栏面板 `panel`、页面标题 `title`、health 标签、错误/部署/术语等 23 处；技术标识（loader id、包名、配置条目、`dsh-superagent status` 命令、`DSH_SUPERAGENT_*` 变量）保持不变。
- 构建产物 `lib/client.js` 已包含「超级智能体」；刷新 GUI 页面即生效。

## 8. 2026-11-03 安全与健壮性补丁（Gitea 账号密码）

### 8.1 Gitea 邮箱+密码登录

- `GiteaAccount` 增加 `user`（邮箱/登录名）+ `password`；`GiteaClient` 优先用 token，否则用 HTTP Basic；`/api/v1/user` 校验登录。部署与 `source:gitea` 的 checkAccounts 同步支持。
- 端到端实测：`shawoo/PDP` 用 `wu.zhiping@feg.cn` + 密码登录成功；测试 issue #1（正文 @shawoo）→ Trigger → accept → Ticket `7ca650f8…` → worker 执行 → **2 条评论回写**（含幂等 marker）→ Ticket `completed`；测试 issue 已删除（204），相关线程已退订。

### 8.2 密码不再明文显示

- `FieldSpec` 新增 `password` 类型；Gitea `password`/`token`、Kanban `apiKey`、ntfy `authPassword`/`authToken` 均改为该类型。
- 设置视图对 `password` 字段一律返回空串（**不再把已存密钥下发到浏览器**），UI 渲染为 `type=password` 掩码输入；保存时若该字段为空，服务端合并回已存值（不会清空）。已实测：空密码保存后 DB 中 11 位密码仍在，配置 revision 正常。

### 8.3 测试连接按钮（保存前必须通过）

- 每个可测试的 Source（Gitea / Kanban / ntfy）的设置卡片新增「**测试连接**」按钮：用**当前表单里的值**调用 `POST /orchestrator/api/sources/:id/test`（密码留空时由服务端与已存密钥合并），返回 `{ok:true}` 或 `{ok:false,error}`。
- 客户端在测试通过前**禁用保存**（SaveBar `saveDisabled`），任何编辑都会让上次测试结果失效；保存时服务端仍会再做一次账号校验（`checkAccounts`），双重兜底。
- 实测：正确 Gitea 配置 → `{"ok":true}`；错误密码 → `{"ok":false,"error":"invalid username, password or token (401)"}`；Kanban / ntfy 均 `ok:true`。

### 8.4 轮询健壮性

- 删除测试 issue 后，Gitea 的仓库级评论接口因孤儿评论返回 500，导致来源卡在 error。`pollRound` 改为**每个流独立容错**（issues/comments/各订阅线程分别 try/catch），部分失败时照常推进游标并报 ready+partial；全部失败才计失败。订阅线程侧对已删除 issue 也做退订清理。

## 9. 遗留与建议

1. **密钥存储**：目前密码/token 以明文存于宿主状态目录的 settings SQLite（仅本机可读）；如需静态加密，可后续加 KMS/DPAPI 包装。
2. **Gitea notifications 模式**：账号密码已可用，但尚未切换验证（repo 模式已端到端）。
3. **ntfy 认证**：已支持 `none / basic（账号+密码）/ bearer（token）`。正式启用建议把 topic 改为**私有并配置账号密码（或 token）**，而不是继续使用公开 `pub_` topic；再叠加 allowed 名单 / HMAC 约束「谁授权」。
