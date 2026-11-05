# 013 — RSI 值流闭环：从 Gitea 宪章到 MinIO 交付，再到新宪章

日期：2026-11-06。目标（用户原话）：

> 完成新的设计后，完整的 story 测试：从 gitea `shawoo/rsi_superagent` 宪章开始；kaneo 发起任务 在 RSI 项目；
> ntfy 实时沟通，kaneo 记录过程进度；minio 交付；复盘，改进流程和 SOP，发布新的宪章。

## 1. 演练的载体分工（新设计）

| 环节 | 载体 | 事实 |
| --- | --- | --- |
| 宪章 | Gitea `shawoo/rsi_superagent` 的 `README.md` | 部署的 Gitea 卡片指向该仓库，`charterPath=README.md`；`GET narrative` 读回 `carrier=gitea`、`carrierRef=shawoo/rsi_superagent/README.md` |
| 任务 | Kanban RSI 项目（`at8xrho45bisco2umjzgl1xp`） | Kanban 来源卡片：监听列 `to-do`、认领列 `in-progress`、交付列 `done` |
| 实时沟通 | ntfy 主题 `pub_at8xrho45bisco2umjzgl1xp` | 消息先入库成卡（`from:ntfy`）；宿主的进度回复发回同一 topic |
| 交付 | MinIO 桶 `ateam` | key 固定 `deliverables/<projectId>/<ticketId>/<file>`，卡片只留进度与结果 |

## 2. 完整 story 测试（11/11 通过）

`node scripts/user-stories.mjs --project at8xrho45bisco2umjzgl1xp --timeout 600`：

```
[ ok ] US-01 编队页给出项目、岗位与宪章的现状
[ ok ] US-02 派工：建卡、指派给岗位账号、放进监听列
[ ok ] US-03 接单：工单落到正确的岗位上
[ ok ] US-04 交付：状态回写与工作日志回到看板
[ ok ] US-05 宪章：面板的版本与它声明的流程一致
[ ok ] US-10 入库：其它来源的事件先落成卡，再由岗位接手
[ ok ] US-11 权限：这个 Host 的账号身份与管理权限可见
[ ok ] US-06 看板查询：带 status 过滤才不漏任务
[ ok ] US-07 限流：连续读写不会把脚本打死
[ ok ] US-08 一个后台：叙事视图与工单列表说的是同一件事
[ ok ] US-09 不代领：没有指派的卡被忽略，而且不被认领
11 passed, 0 failed — report: TDD/artifacts/user-stories-us-20261105220348.json
（最终代码上复跑一次仍 11/11：TDD/artifacts/user-stories-us-20261105223033.json）
```

为了让 story 跑在 RSI 项目而不是写死 FDEP，harness 改成**板无关**：监听列从 Kanban 来源设置 `watchColumns` 读，
交付列从 `doneColumn` 读（US-02/03/06/09/10），`board.unfiltered-can-miss-tasks` 在小看板上允许不触发。这正是
「新的设计（项目可换）」与旧 harness 的冲突点。

## 3. 值流闭环演练（第一次：完整链路）

`node scripts/lib/value-stream-rehearsal.mjs`，产物 `TDD/artifacts/rehearsal-20261105221436.json`：

| 时刻（UTC） | 事件 |
| --- | --- |
| 22:14:36 | 读宪章 v11，`carrier=gitea shawoo/rsi_superagent/README.md` |
| 22:14:37 | 卡片 #12 `zm7leba3sefekmh9a1djq2fd` 派到 `to-do`，指派 PM 岗位账号 |
| 22:14:37 | ntfy 通知发到 `pub_at8xrho45bisco2umjzgl1xp` |
| 22:14:46 | 通知入库成卡 `pn25afli3jx9tz4n1lxsm5ge`（**9s**） |
| 22:14:56 | 工单 `bf87186ad22e34b3d6ea4d8c554c5323` 创建（**19s**，charter v11 钉住） |
| 22:17:17 | MinIO 交付物出现：`deliverables/at8xrho45bisco2umjzgl1xp/bf87186.../retro.md`（1212 B，回读校验） |
| 22:19:16 | 卡片到 `done`，2 条评论（回执 + 交付报告），载体 `bucket/key` 在评论里（**4m40s** 全链路） |

交付物内容（MinIO 读回，UTF-8 校验 0 个替换字符）是执行摘要 + 3 条改进建议。

## 4. 复盘：发现的问题、修法、验证

1. **岗位读不到 Gitea 原文**（最重要的设计缺口）。worker 的工具面只有 `minio_*` / `orchestrator_*` / `team_*`，
   没有 shell/HTTP，`orchestrator_read` 也没有 gitea 资源；它只能拿 `ateam/pipeline/` 的旧副本替代，并在交付物里标注
   「非 Gitea 原文」。**修法**：给 worker 增加 `orchestrator_read charter` 资源 —— 宿主用它现有的 `readCharter`
   （Gitea README → Kanban 镜像 → archive）返回 `version`/`carrier`/正文，worker 无需凭证即可读到当期宪章。
   **验证**：第二张卡（`verify-charter-read.mjs`，ticket `79ba317b9221864282f6b0239d2cfd82`）里，worker 报出
   「宪章 version 11，carrier 为 gitea（shawoo/rsi_superagent/README.md）；当期流程 to-do → in-progress → in-review → done → qa-驗收」
   ——缺口闭合。单测：`tests/resources-charter.spec.ts`（4 条）。
2. **ntfy 换 topic 时游标可能跳过刚发布的消息**：读游标 `KV.ntfy.since` 跨 topic 保留，换 topic 后第一次轮询可能已把游标
   推到消息之后。**修法**：检测到 topic 变化时把游标回退 600s（入库标记去重，不会重复建卡）；story 的 US-10 也加了
   「等一次轮询再发、最多 3 次重发」的容错。**验证**：最终 story 跑里 US-10 通过。
3. **宿主重启会打断正在跑的工单**：一次 US-10 的 worker 在 21:42 被 `hostRestarted` 打断、自动带「host restarted」输入续跑，
   整张卡多花约 20 分钟。**流程改进（SOP §7）**：跑长任务时不要保存来源设置（保存会重启插件）；story 的 `--timeout` 给足。
4. **交付物 key 的两种写法并存**：卡面 `deliverables/<project>/<ticket>/<file>`，而旧章程写 `projects/<projectId>/<taskId>/<kind>/<name>@<version>`。
   复盘结论：**只保留 `deliverables/` 一种**，修订覆盖同一 key。已写进 SOP §4.2 与新宪章。
5. **旧 story harness 把 FDEP 的 `ready` 列写死**：换成 RSI 项目后 US-02/03/09/10 失败。已改成从设置读监听列/交付列（见 §2）。
6. **验证脚本不要用 PowerShell 发中文**：`Invoke-WebRequest -Body <string>` 会把中文写成 `?`（曾污染 README v10，已从
   archive 历史恢复为 v11）；联调一律 Node `fetch`（UTF-8）。

## 5. 流程与 SOP 改进

- SOP §3.3：发布宪章 = 写进 **Gitea 仓库的 README.md**（提交历史即版本历史），Kanban 项目描述只是无 Gitea/无写权限时的镜像；面板显示载体。
- SOP §4.1：**岗位开工第一步用 `orchestrator_read charter` 读宪章并报出版本与载体**。
- SOP §4.2：交付物 key 唯一写法 `deliverables/<projectId>/<ticketId>/<file>`；实时沟通走项目 topic `pub_<projectId>`。
- SOP 新增 §3.6「值流闭环演练」：六步清单 + 首跑实测数字 + 卡点。
- SOP §7 两条已知限制：宿主重启打断工单；ntfy 换 topic 回退游标 600s。
- 宪章 **v12** 已发布到 `shawoo/rsi_superagent/README.md`（`version: 12`，`pm-rsi`，755 B，UTF-8 干净）；
  `GET narrative` 读回 `carrier=gitea`，内容新增：岗位自读宪章作为开工第一步、交付物 key 唯一写法、实时沟通 topic、复盘与改版节奏。

## 6. 结论

新设计（宪章在 Gitea、任务在 Kanban、沟通在 ntfy、交付在 MinIO）**可执行、可复盘、可改版**：完整 story 11/11、
值流闭环一次跑通（4m40s）、发现的设计缺口已修并二次验证、SOP 与宪章均已按复盘结论更新。
