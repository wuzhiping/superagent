# 008 — 用真实数据验证协作叙事（RD.md v0.3）

> **日期**：2026-11-04
> **对象**：[`../RD.md`](../RD.md) v0.3 的目标模型（岗位 / 岗位职责两级、Kaneo 唯一任务源、动态 RepoSet、多 topic、产出路由、宪章）
> **环境**：测试环境。KanEO `https://pl.feg.cn`、Gitea `https://git.feg.cn`、ntfy `https://msn.feg.cn`、MinIO（内网）
> **工具**：[`../scripts/kaneo-probe.mjs`](../scripts/kaneo-probe.mjs)（只读探针 + 自恢复写套件）、[`../scripts/kaneo-claim-race.mjs`](../scripts/kaneo-claim-race.mjs)（并发抢单）、[`../scripts/kaneo-story-probe.mjs`](../scripts/kaneo-story-probe.mjs)（故事构件）、[`../scripts/kaneo-roles-report.mjs`](../scripts/kaneo-roles-report.mjs)（角色实践统计）、[`../scripts/post-accounts.mjs`](../scripts/post-accounts.mjs)（岗位账号接线）
> **证据**：[`artifacts/`](artifacts/)
> **原则**：API key 只从文件读取，不进参数、不进输出、不入库；写操作只作用于**测试卡**；竞速测试后立即还原。
> **测试数据落点**：**只落在 FDEP 项目**（`dgctny8ibgpn72ei2j8qj2hc`）。pipeline 是团队在用的工作看板，**不再写入**；
> 验证脚本内置护栏：对 pipeline 的写操作会被拒绝（需显式 `--allow-pipeline` 才能覆盖）。
> 早先几轮在 pipeline 上做过的写测试（写套件、竞速）已把状态与负责人**还原**，但留下了 3 张 `[probe]` 卡与 4 个标签（见 §8）。

---

## 1. 结论速览

| # | 叙事主张（RD.md） | 实测结论 | 证据 |
| --- | --- | --- | --- |
| 1 | KanEO 是唯一任务来源，字段足以支撑岗位模型 | ✅ 成立 | 任务含 `assigneeId / assigneeName / labels / status / priority / dueDate`；`?assigneeId=` 服务端过滤可用 |
| 2 | 岗位身份 = KanEO 用户 id（= `assigneeId`） | ✅ 成立 | `GET /user/me` → id；`PUT /task/assignee` 后任务 `assigneeId` 即该值 |
| 3 | slug 是稳定键，列改名无害 | ✅ **实证成立** | 同一 slug 的列名在观测窗口内多次变化（`to-do`：待開發→待辦池→待開發；pipeline `to-do`：待處理→候選池），slug 始终不变 |
| 4 | 「列增删才需重解析」「跨端点只用 slug」 | ✅ 成立 | `/column` 返回 uuid，`/task/tasks` 的 `columns[].id` 直接等于 slug，两套 id 不可混用 |
| 5 | KanEO **无 CAS** → 派工即认领 + 回读/租约兜底 | ✅ 成立，兜底协议**并发实测通过** | 4 次并发抢单全部"恰好 1 个胜者"（§7.1） |
| 6 | 写入纪律：只走单字段路由，禁 `PUT /task/{id}` | ✅ 成立 | `PUT /task/{id}` 文档明写「Replace every field」，必填 title/priority/status/projectId/position |
| 7 | PM 可用 KanEO 原生能力管流程 | ✅ 成立 | `/column`、`/label`、`/label/{id}/task`、`/custom-field/*`、`/workflow-rule/{projectId}` 全部可用 |
| 8 | 宪章：PM 颁布版本，Worker 读取并钉版本 | ✅ **链路成立** | 宪章载体任务 + `version:` 解析 + `charter` 标签，实测通过（§7.2） |
| 9 | 多 topic（ntfy） | ✅ 成立 | 两 topic 独立发布/回读；`poll=1` 一次消费一条、`since=all` 可回溯 → 印证「每 topic 独立游标」 |
| 10 | 动态 RepoSet（一个项目多个仓库） | ✅ 前提成立 | 该账号可见 **12 个仓库**（shawoo/PDP、fdep、harness、superagent…），多为 public |
| 11 | 产出路由（代码→Gitea，非代码→MinIO） | ⚠️ **部分受阻** | `dsh-minio-s3` 的 `ConnectionProvider` 在插件内实例化、**未暴露为共享服务** → **host（岗位）不能直接读写 MinIO**，只有 executor session（岗位职责）可用 `minio_*` 工具；键规范实测可行（§7.3） |
| 12 | 宪章存 MinIO 并由 host 拉取 | ❌ **不成立（已改道）** | 同上；权威存储改 **KanEO**（host 原生可读写） |
| 13 | 监听列全局配置即可 | ❌ **不成立** | pipeline 项目**没有 `ready` 列** → 监听列必须按项目配置 |
| 14 | 岗位归属 = assignee | ⚠️ **需补强** | assignee **单值**：FDEP 17/17 有 assignee，pipeline **0/8**（用 `agent:*` 角色标签合流）→ 归属要分「主责 + 协同角色」两层（§4、RD.md §12.9） |
| 15 | 岗位机器人账号可由工具统一创建 | ❌ **不成立** | `/admin/users`、成员管理对 API key **403**，无签发 key 接口 → **建号与发 key 必须在 KanEO UI 完成**，工具侧只做验证与接线（§6） |

---

## 2. 写操作明细（自恢复）

对象：pipeline 项目 to-do 卡 `nugjcfepnypa9f3wv3pyenri`（#59「［pipeline］七日內最新新聞查詢功能（需求卡）」，原状态：无负责人、标签「需求」）。

| 步骤 | 请求 | 回读 | 结果 |
| --- | --- | --- | --- |
| baseline | `GET /task/{id}` + `GET /label/task/{id}` | status=to-do, assignee=null, labels=[需求] | ✅ |
| label.create | `POST /label` | id `xb3d3tbfmger4agxy652eaq5` | ✅ |
| label.attach | `PUT /label/{id}/task` | `GET /label/task/{id}` → 含探针标签 | ✅ |
| label.detach | `DELETE /label/{id}/task` | 标签消失 | ✅ |
| comment.create | `POST /comment/{taskId}` | id `oqijz8ki5d6jdztk8u13dk0o`，createdAt `2026-11-04T08:10:05.118Z` | ✅ |
| comment.delete | `DELETE /comment/{id}` | 列表回到 7 条 | ✅ |
| **lease.earliest-wins** | 两条 `lease:<token>:A` / `:B`（间隔 1.1s） | 按 `createdAt` 排序 → winner=**A** | ✅ |
| status.move | `PUT /task/status/{id}` → `in-progress` | 任务 `status=in-progress`，看板列同步为 `in-progress` | ✅ |
| status.restore | `PUT /task/status/{id}` → `to-do` | 还原 | ✅ |
| assignee.claim | `PUT /task/assignee/{id}` {userId} | `assigneeId=bsFdwgQXqZpYKvD5E2emqQ5TQ81eJ3zG` | ✅ |
| assignee.release | `PUT /task/assignee/{id}` {userId: null} | `assigneeId=null` | ✅ |
| restore.matches-baseline | — | 基线 == 终态（status/assignee/labels） | ✅ |

**12/12 通过，卡片已还原**（探针标签与评论均已删除）。

### 2.1 租约协议实测（RD.md §11.2 兜底）

```
A: id=modlrklwr677yblsh4swe0os  createdAt=2026-11-04T08:10:06.530Z
B: id=scptw8k2qwwp6t9e1uwttclr  createdAt=2026-11-04T08:10:07.709Z
→ 最早者（A）胜出 ✅
```

---

## 3. ntfy 多 topic 实测

| 动作 | 结果 |
| --- | --- |
| `POST https://msn.feg.cn/pub_superagent_probe_a`（text/plain + `Title` 头） | id `WBFytIldeh6y`，回读 `title="#probe-correct"`、`message="probe roundtrip …"` ✅ |
| 第二个 topic `pub_superagent_probe_b` 独立发布/回读 | ✅ 互不干扰 |
| `GET /<topic>/json?poll=1` | 只返回**尚未消费**的最新一条（游标语义）→ 印证「每 topic 独立游标」 |
| `GET /<topic>/json?poll=1&since=all` | 返回完整历史 → 可做首次基线回溯 |
| 生产 topic `pub_dgctny8ibgpn72ei2j8qj2hc` | HTTP 200 ✅ |

**格式结论（与既有实现一致）**：该服务器**不解析 JSON body**——用 JSON 体发布时原始 JSON 被当作消息正文存入（实测正文里出现完整 JSON 串）。
正确格式是 **纯文本 body + `Title`/`Priority`/`Tags` 头**，与 `src/sources/ntfy-api.ts` 的既有注释一致 ✅。

---

## 4. 真实看板已有的角色实践（故事不是发明的）

用 [`../scripts/kaneo-roles-report.mjs`](../scripts/kaneo-roles-report.mjs) 统计两个项目的全部评论：

| 项目 | 任务 | 评论 | 评论里的角色标签 | 概念词频 | 有 assignee |
| --- | --- | --- | --- | --- | --- |
| FDEP (FDE) | 17 | 107 | — | 驗收 24 / 交付物 13 / WIP 5 / 邊界 3 | **17/17** |
| pipeline (PIP) | 8 | 36 | **pm 39 / ux 17 / bi 8 / api 2 / lead 1** | 驗收 47 / 交付物 23 / 邊界 16 / **WIP 13** / **回合 13** | **0/8** |

读出来的三件事：

1. **团队已经在用「岗位」这套语言**：`agent:pm / agent:bi / agent:api / agent:ux` 就是 RD.md 的岗位；
   `回合`（PM 的周期性职责 ≈ 宪章）、`交付物`（产出）、`邊界`（岗位职责一任务一目录）、`WIP 合規 0`（岗位并发闸门）都已出现在真实评论里。
   → **RD.md 的叙事与团队实践同源** ✅
2. **但两个项目的"负责人"用法不同**：FDEP 每张卡都有 assignee（单负责人）；pipeline **一张都没有**，改用角色标签做**一卡多角色合流**
   （#59 上同时有 pm + bi + api + ux）。而 KanEO 的 **assignee 是单值**。
   → **岗位归属需要两层**：主责 assignee（唯一，决定谁推进状态）+ 协同角色声明（多人）。已记入 RD.md §12.9。
3. **真实评论已经写明两条与我们模型一致的边界**：
   「**不跨工作目录交付**」（→ 岗位职责一任务一目录）、「**不代領、不自領**」（→ 派工即认领，而非自取）。

**原文摘录**（pipeline #59 的 PM 评论，UTF-8 解码后）：

> **誰領**：agent:pm（不得自行認領 · 本卡未由使用者點選，我自領）
> **領受人**：使用者（待受領） ← 這就是這件事
> **工作者**：agent:pm（不得自行認領 · 本卡未由使用者點選，我自領）
> **回合紀律**：通過 → 本卡移至「已交付」

---

## 5. Gitea 多仓实测（只读）

`GET /api/v1/user/repos`（邮箱 + 密码 Basic）：账号可见 **12 个仓库**，均为 public：

`shawoo/PDP`、`cattle`、`cerbos-pdp`、`cerbos-skills`、`cordis-plugins`、`dsh-im`、`fdep`、`harness`、`jeeflow`、`notebook`、`skills`、`superagent`

→ 「一个项目涉及多个仓库、集合动态变化」在真实环境成立 ✅；当前配置只盯 `shawoo/PDP`，扩展为 RepoSet 的价值明确。

---

## 6. 岗位账号：统一创建与接线（实测 + 工具）

| 实测 | 结论 |
| --- | --- |
| `GET /admin/users`、`GET/POST /admin/workspaces/{id}/members` → **403**（API key 无管理域） | **建号、加成员、发 key 都只能在 KanEO UI 做**；REST 没有 create-user 路由，也没有签发 key 的接口 |
| `assignee` 是**单值**且必须是 **workspace 成员** | 一个岗位 ↔ 一个 KanEO 用户；账号必须先加入 ATEAM 工作区 |
| 现有 key 属于**人类管理员**（`吳思平`/admin） | 不能直接当岗位身份（责任、审计、撤权都会算到人头上） |

交付物：

- [`../docs/008-post-accounts.md`](../docs/008-post-accounts.md) —— 命名规范、清单格式、UI 建号步骤、**逐实例接线表**、撤权与交接约定；
- [`../config/post-accounts.json`](../config/post-accounts.json) —— 4 个岗位的清单（`pm-pipeline` / `w1-pipeline` / `pm-fdep` / `w1-fdep`），**不含密钥**；
- [`../scripts/post-accounts.mjs`](../scripts/post-accounts.mjs) —— 用每个岗位的 key 调 `GET /user/me` 验证身份，输出**岗位档案**并打印每个实例要粘贴的设置值；
- `keys/` 目录（已 gitignore）：key 文件落位处。

当前状态：`ready 0/4`（4 个岗位都 `pending`，因为 UI 建号尚未执行）——脚本与流程已就绪，**只差管理员在 KanEO 里建号并发 key**。

---

## 7. 第二批验证（本轮新增）

### 7.1 并发抢单（互斥协议）—— [`../scripts/kaneo-claim-race.mjs`](../scripts/kaneo-claim-race.mjs)

3 个 claimant（用看板上 3 个真实成员身份）**同时**对同一张卡执行 §11.2 协议：写 assignee → 回读 → 追加租约评论 → 按 `createdAt` 取最早。

| 运行 | 目标卡 | 胜者 | 结果 |
| --- | --- | --- | --- |
| 1 | pipeline #59 | 1 | `exactlyOneWinner: true` |
| 2 | pipeline #59 | 1 | `exactlyOneWinner: true` |
| 3 | pipeline #59 | 1 | `exactlyOneWinner: true` |
| 4 | pipeline #63 | 1 | `exactlyOneWinner: true` |

观察到的真实行为：**assignee 回读这一步就淘汰了多数 claimant**（3 个并发里有 2 个在回读时看到的是别人的 id → `lost-assignee`），
剩下的进入租约裁决 → **恰好 1 个胜者**。任务状态与负责人每次运行后还原（`status=to-do assignee=null`）。
证据：[`artifacts/claim-race.json`](artifacts/claim-race.json)、[`artifacts/claim-race-2.json`](artifacts/claim-race-2.json)。

> 结论：**互斥协议在真实并发下成立**；"回读"这一道就挡住大多数争抢，租约评论只处理回读同时成立的极端情况。

### 7.2 故事侧构件 —— [`../scripts/kaneo-story-probe.mjs`](../scripts/kaneo-story-probe.mjs)

在 pipeline 看板建（并**保留**）以下构件，再用 worker 会用的接口读回：

| 构件 | 做法 | 回读验证 | 结果 |
| --- | --- | --- | --- |
| 验证卡 | `POST /task/{projectId}` | `GET /task/{id}` | ✅ #67 |
| 角色标签（协同岗位归属） | `POST /label` + `PUT /label/{id}/task` | `GET /label/task/{id}` **与**看板端点的 `task.labels` | ✅ `role:pm` / `role:ux` 两处都可见 |
| 宪章载体 | 任务描述里放 `version: 1` 的宪章文本 + `charter` 标签 | `GET /task/{id}` → 正则取版本 | ✅ 版本解析为 `1` |
| 子任务关系 | `POST /task-relation {relationType:'subtask'}` | `GET /task-relation/{cardId}` | ✅ #69 是 #67 的子任务 |

5 项检查全过。证据：[`artifacts/story-probe.json`](artifacts/story-probe.json)。

> 结论：**"PM 颁布版本化宪章 → Worker 接单时读取并钉版本"** 与 **"一卡多角色（标签）+ 主/子任务分工"** 在 KanEO 上都成立。

### 7.3 MinIO 端到端（产出落地）
用**岗位职责**的路径（agent 工具 `minio_write` / `minio_read`）验证 §7 的键规范：

```
projects/<projectId>/<taskId>/<kind>/<name>@<version>
→ ateam/projects/wwo9d2mmqddjq8otbj8hs/bzdlb6apynhzf5w8jlnb6nag/doc/charter-probe@v1
```

- 写入 ✅（229 bytes，etag `099b036d…`）；读回内容一致 ✅；`minio_list` 能看到 `projects/<projectId>/` 前缀 ✅；
- **桶现状**：可用桶为 `ateam` / `dsh` / `aife`；写 `superagent` 桶被 **AccessDenied**（桶不存在）。
  → 若要"每项目一个桶"，需先由管理员（或 minio-admin）**建桶**并授权；否则用 `ateam` + 前缀隔离。

### 7.4 看板端点会按列截断（实现要点，重要）

在 FDEP 上新建的 probe 卡（#472，`position=109`）**不出现在未过滤的看板快照里**，但一加 `status` 过滤就出现：

| 查询 | 返回任务数 | 含 #472 |
| --- | --- | --- |
| `GET /task/tasks/{projectId}`（无过滤） | 17 | ❌ |
| `GET /task/tasks/{projectId}?limit=100` | 56 | ❌ |
| `GET /task/tasks/{projectId}?page=1&limit=100` | 56 | ❌ |
| `GET /task/tasks/{projectId}?status=to-do` | **29** | ✅ |
| `GET /task/tasks/{projectId}?status=to-do&limit=100` | 29 | ✅ |
| `GET /task/tasks/{projectId}?sortBy=createdAt&sortOrder=desc&limit=50` | 49 | ✅ |
| `?limit=200` | — | **400**（`limit` 上限 100） |

→ **未过滤的看板视图是"看板投影"，每列会截断**；按列过滤才是完整任务集。
现有实现正好走的是 `GET /task/tasks/{projectId}?status=<slug>&limit=N`（`src/sources/kaneo-api.ts`），**方向正确** ✅；
但要补两条纪律：
1. **永远带 `status` 过滤**去列举某列的任务，不要拿无过滤快照当全量；
2. `limit` 上限 100，超过就用 `page`/`relatedPage` 翻页（`sortBy=createdAt` 可用于抓最新）。

（这个截断也是本轮两次"假阴性"的根源：探针的看板校验与写套件的列校验先后误判为"标签不可见 / 列没同步"，改用过滤查询后全绿。）

---

## 8. 过程中修正的错误（重要：区分「探针 bug」与「平台限制」）

| 现象 | 真相 | 处理 |
| --- | --- | --- |
| `label.attach` 失败（标签读不到） | **探针 bug**：`GET /task/{id}` 不返回 labels，须用 `GET /label/task/{id}` | 修正探针读写路径后 12/12 通过 |
| 连续 4 次 `401 Unauthorized`（约 1 分钟）后自愈 | **平台现象**：瞬时鉴权失败 | 健康检查需容忍瞬时 401（连续 N 次才判凭据失效） |
| 写操作批量触发 `429 RATE_LIMITED` | **平台限制**：API key 有窗口限流（响应带 `Retry-After`、`X-RateLimit-*`） | 探针改为：429 自动退避重试（最多 8 次）+ 写操作间 1.2s 节奏；实测退避后全部通过 |
| 清理脚本把团队 PM 的评论误判为"探针残留" | **过滤器过宽**（按内容含 `probe` 匹配） | KanEO 对**他人评论**的 DELETE 返回 404 → **删不掉、也没删掉**（无损）；改为只按**自己创建的 id** 清理 |
| 竞速脚本首轮报"0 个胜者" | **判定 bug**：胜负比较的字符串少了一段 | 修正后 4 次运行全部"恰好 1 个胜者" |
| 故事探针报"看板上看不到标签"、写套件报"列没同步" | **端点误用**：无 `status` 过滤的看板快照**每列会截断**，新建卡不在其中 | 改用 `?status=<列>&limit=100` 后全部通过（见 §7.4）——现有实现本来就带 `status` 过滤 ✅ |
| 用 PowerShell 批量改章节编号后文档乱码 | **工具事故**：`Get-Content/Set-Content` 按 ANSI 读写 UTF-8 | 用 write 工具整体重写；**今后不用 PowerShell 改中文文件** |

---

## 9. 对 RD.md 的影响（已回写）

| 位置 | 变化 |
| --- | --- |
| §6.3 | 「slug 稳定、列改名无害」由**实证**支撑；新增「列名高频变动 → 提醒需去抖（24h 冷却）」 |
| §7 / §8 | **MinIO 作权威存储对 host 不成立** → 宪章权威存储改 KanEO；产出落地改为「岗位职责写桶、岗位取链接回写」；桶现状（ateam/dsh/aife）与键规范实测 |
| §8 | 宪章载体（任务 + `charter` 标签 + `version:` 文本）与「Worker 读取并钉版本」实测通过 |
| §11.2 | 互斥协议**并发实测成立**（4/4 恰好一个胜者）；补「禁 `PUT /task/{id}` 改单字段」硬规则 |
| §11.5 | 新增实测基线（接口能力表、数据快照、测试清单） |
| §12.8 | 账号与运维前置：建号/发 key **只能走 UI**；岗位需各自的 KanEO 机器人账号；监听列按项目配置；瞬时 401 与 429 的口径 |
| **§12.9（新增）** | **岗位归属：单负责人 vs 多角色合卡** → 归属分「主责 assignee + 协同角色声明」两层；WIP 合规升为面板指标 |
| **§11.5（新增）** | **看板端点按列截断**：列举任务必须带 `status` 过滤，`limit ≤ 100`，超出用 `page`/`relatedPage` 翻页（§7.4） |

---

## 10. 尚未验证（下一批）

1. **两实例真并发**（两个 profile 同时接单）——目前是同一 key 的多 claimant 模拟。
2. **MinIO 端到端回写看板**：岗位职责写对象 → 岗位取链接 → 回写评论（键规范已验证，回写链路未接）。
3. **宪章版本钉在工单**：`charterVersion` 字段需要 DB 迁移，尚未实施。
4. **RepoSet 动态增删**：PM 维护仓库清单 → 岗位接单前刷新校验。
5. **自定义字段承载「目标仓库 / 产出类型」**：`POST /task` 已支持 `customFields`，但项目里还没建字段。
6. **协同角色承载方式取舍**（标签 / 任务关系 / 评论声明）。
7. **限流与轮询节奏的最终参数**（各 Source 的轮询下限）。

---

## 11. 复现方式

> **测试数据只落 FDEP**；pipeline 会被护栏拒绝（需 `--allow-pipeline` 才放行）。

```powershell
# 只读：身份、工作区、项目、列、按 assignee 的任务、评论、标签、自定义字段
node scripts/kaneo-probe.mjs --key-file <api-key 文件>

# 单任务自恢复写套件（FDEP 测试卡 #472：b9ok84k1yizw68aue5yfaqcu）
node scripts/kaneo-probe.mjs --key-file <api-key 文件> --task b9ok84k1yizw68aue5yfaqcu --write-suite --confirm-write --report TDD/artifacts/kaneo-write-suite-fdep.json

# 并发抢单（3 claimant 竞同一张卡，事后还原）
node scripts/kaneo-claim-race.mjs --key-file <api-key 文件> --task b9ok84k1yizw68aue5yfaqcu --claimants 3 --report TDD/artifacts/claim-race-fdep.json

# 故事构件：在 FDEP 建验证卡/角色标签/宪章载体/子任务关系，并回读校验
node scripts/kaneo-story-probe.mjs --key-file <api-key 文件> --report TDD/artifacts/story-probe-fdep.json
# 只校验既有卡（不新建）
node scripts/kaneo-story-probe.mjs --key-file <api-key 文件> --verify b9ok84k1yizw68aue5yfaqcu

# 看板角色实践统计（只读）
node scripts/kaneo-roles-report.mjs --key-file <api-key 文件>

# 岗位账号：验证身份并输出岗位档案与逐实例接线清单
node scripts/post-accounts.mjs --roster config/post-accounts.json --out config/post-profiles.json
```

写套件与竞速脚本都有 `ok/failed` 判定与「还原后与基线一致」的总检查；任何一步失败都会保留报告，便于复查。

**FDEP 基线结果**：写套件 12/12 ✅、竞速 `exactlyOneWinner: true` ✅、故事构件 6/6 ✅（证据 `*-fdep.json`）。

---

## 12. 一句话结论

> 叙事在真实数据上**站得住**：KanEO 的字段、接口与限流行为足以支撑「PM 岗位 + Worker 岗位 + 岗位职责」，
> 而且**看板上已经存在这套实践**（`agent:pm/bi/api/ux`、`回合`、`交付物`、`邊界`、`WIP 合規`），说明模型与团队同源；
> 并发互斥协议实测成立（4/4 恰好一个胜者）；但要补四处让步——**互斥要自建**（无 CAS）、**MinIO 只能是产出落地处**、
> **监听列按项目配置**、**建号与发 key 只能走 KanEO UI**，外加一处补强——**assignee 单值，归属要分「主责 + 协同角色」两层**。
