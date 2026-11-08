# BLK · Block 全生命周期（看板裁决与取消）

> **一句话**：工单卡住时，**裁决与取消都发生在 Kanban 看板上**；SuperAgent 做的是把看板状态同步过来——
> hold 标签移除后，**同一个 ticket、同一个 `worker-<ticketId>` session** 继续；卡片取消/删除后，对应工单同步停止。
> 相关：[docs/005-panel.md](docs/005-panel.md)（来源配置）、[docs/007-architecture.md](docs/007-architecture.md)（模块）、[PM.md](PM.md)（PM 职责）。

---

## 1. 状态机

```
                  ┌────────────── cancel（card_deleted / card_canceled）──────────────┐
                  │                                                                  ▼
 running ──report blocked/failed──▶ blocked（hold） ──PM 裁决+移除 hold ──▶ running ──ready──▶ completed
     │                                  │                                                      
     └──────────── cancel ──────────────┴──────────────▶ stopped（by human，reason 记录）        
```

| 状态 | 触发 | SuperAgent 侧 | 看板侧 |
| --- | --- | --- | --- |
| running | 工单执行中 | Assignment running；worker session 运行 | 卡在 `in-progress`（认领列） |
| **blocked（hold）** | worker `report state=blocked`（或 failed） | 记录 attention 问题；不自动重试 | 自动打 **`blocked` 标签**；可选移到 `blockedColumn` |
| 裁决中 | PM 在卡上写评论/改描述 | 观察模式**暂停投递**，保留 hold 前基线 | PM 写裁决；标签仍在 |
| **释放（resume）** | PM **移除 `blocked` 标签** | `holdLifted` Trigger → Input → 同一 ticket 起新 Assignment，**同一 session 继续** | 卡仍属于同一工单，不新建 |
| completed | worker `report ready` | ticket ended completed；卡移到 done 列 | `done` |
| **stopped（取消）** | 卡进入 `cancelColumns`（默认 `canceled,cancelled`）或卡被删除（404） | ticket 立即停止：`by: human`、`outcome: stopped`、reason=`card_canceled` / `card_deleted` | 卡在取消列或已删除 |

## 2. 配置（Kanban 来源）

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `observeUpdates` | 开 | 观察运行中工单的卡：评论、标题、描述、列变化 → 作为 Input |
| `holdLabel` | `blocked` | blocked/failed 时自动给卡打此标签；**移除标签 = 恢复同一 session**；留空关闭 |
| `blockedColumn` | 空 | 等待裁决时把卡移到此列；恢复后移回认领列；留空不动卡 |
| `cancelColumns` | `canceled,cancelled` | 卡进入这些列 = 看板取消 → 工单停止；留空关闭 |
| `claimColumn` | `in-progress` | 恢复/认领时卡回到此列 |
| `doneColumn` | 空 | 交付后卡移到此列 |

> 取消与 hold 都**不需要在 SuperAgent 面板点按钮**；面板只显示结果（工单状态、Input、停止原因）。

## 3. Block 生命周期（逐步）

1. **worker 卡住**：调用 `orchestrator_report`，`state=blocked`，在 `human_action` 里写清问题；工单保持 open，记录 `attention`。
2. **看板打标**：下一次轮询，Kanban 来源发现工单在等裁决 → 用 `createLabel`/`attachLabel` 给卡打 `blocked`（标签 id 按工作区缓存，只打一次）；若配置了 `blockedColumn`，把卡移过去。
3. **暂停投递**：观察模式看到 `blocked` 标签 → 不产生 Input，也**不推进基线**；PM 此时写的裁决评论/描述会“攒着”。
4. **PM 裁决（看板）**：在卡上写决定（评论或改描述），然后**移除 `blocked` 标签**。
5. **释放**：下一轮观察发现标签消失 → 对比 hold 前基线，生成一条 `meta.holdLifted=true` 的更新 Trigger，文本包含 hold 期间累积的裁决内容（并注明“看板已解除标记”）。
6. **同一 session 恢复**：intake 把 Trigger 作为 Input 加到工单；`Tickets.addInput` 只对 `holdLifted` 触发 `resume` —— 结束停滞的 Assignment、创建新 Assignment（`endedReason=retried`），仍用 `worker-<ticketId>`；worker 下一轮读到 Input 与裁决，继续原工作。
7. **完成**：`report ready` → ticket completed；`doneColumn` 配置则卡移到交付列。

**关键点**：整条链路**没有新建看板卡、没有新建工单、没有新建 session**；恢复靠的是同一 ticket 的同一个 session id。

## 4. 取消生命周期（看板侧）

| 看板动作 | 来源如何发现 | SuperAgent 结果 |
| --- | --- | --- |
| 卡移到 `canceled` / `cancelled` 列 | 每轮观察 `task.status` | `ctx.cancel(ticket.id, 'card_canceled')` → `Tickets.stop`：工单 `ended.by=human`、`outcome=stopped`、reason 记录；运行中的 Assignment 被结束，worker session 不再被调用 |
| 卡被删除 | `task` 读取返回 404 | 同上，reason=`card_deleted` |
| 其他列（in-review 等） | 只作为更新投递 | 工单不取消 |

边界：403/网络错误**不**取消（避免把临时读失败当取消）；只有 404 或明确取消列才停止。

## 5. 测试与记录

### 5.1 自动化测试（仓库内，可复跑）

```powershell
pnpm exec vitest run tests/kaneo.spec.ts              # 26 项通过
pnpm exec vitest run tests/runtime.spec.ts -t "hold"  # hold 释放恢复 1 项通过
```

覆盖：
- `kaneo card observation`：评论/描述变化 → 更新 Trigger；宿主自己的评论忽略；首次观察建基线。
- `kaneo hold label`：hold 期间**不投递**且保留基线；移除标签后一次 `holdLifted`（含裁决文本）；标签只打一次并复用 label id。
- `kaneo cancellation`：取消列 → `card_canceled`；删除卡（404）→ `card_deleted`；其他列不取消。
- `runtime`: 移除 hold 标签后**同一 ticket**从 `['ended']` 变为 `['ended','running']`，`waitsForPerson=false`（同 session 恢复）。

### 5.2 现场记录（2026-11-08）

| 场景 | 操作 | 结果 |
| --- | --- | --- |
| 观察反馈（此前） | 卡 #48 执行中改描述 | 更新 Trigger 作为 Input 投给同一工单（`deliveredTo`/`readAt`），未新开工单；MinIO 交付物记录了该反馈 |
| block 尝试 | 卡 #49（`tj4stxnup7v0rq9s09ft5u98`）要求先报 blocked 再等 | Worker 报了 blocked 但**没有停留**，随后继续并以 `ready` 结束（工单 `3eb3b0c9…` completed）；hold 标签来不及生效。**未形成有效 live hold**；已记录，不当作成功 |
| 取消（本次） | 见 §5.3 | 结果填在下方 |

### 5.3 取消现场验证（本次记录）

```
准备：建一张会持续一会的卡 → 移入 to-do → 等工单 running
操作：用 Kanban MCP 删除该卡（等价于看板侧取消）
预期：下一轮 poll 读取 task 404 → ctx.cancel(..., 'card_deleted')
      → ticket ended：by=human / outcome=stopped / reason=card_deleted
```

**结果（2026-11-08 23:44 +08，实际跑通）**：

- 看板卡：`ui1suh44hgg8somhhjq35sr1`（#50），移入 `to-do` 后工单进入 `working`，随后用 MCP `delete_task` 删除。
- 工单：`077940b433dc8f2cf0a24d5d577946f0`，删除后下一轮轮询变为停止：
  `ended = { at: "2026-11-08T15:44:19.881Z", by: "human", outcome: "stopped", reason: "card_deleted" }`。
- 结论：看板删除卡片 → 对应 SuperAgent 工单同步停止（`stopped`），没有新工单，worker session 不再被调用。

> 说明：如果看板没有“取消列”，**删卡**就是最直接的取消信号；也可以建 `canceled` 列并移动卡，效果等价（`card_canceled`，已在来源单测中覆盖）。

## 6. 失败与边界

| 情况 | 行为 |
| --- | --- |
| 移除标签前没写裁决 | 工单会恢复，但 worker 只看到“看板已解除标记”的 Input；没有决策内容，可能再次 blocked |
| 写了裁决但忘记移除标签 | 工单一直 hold（这是显式设计：移除标签才是释放动作） |
| hold 期间连续多条评论 | 全部累积，释放时合成一条 Trigger（≤4000 字符） |
| 卡先取消、后又被移动 | 工单已在 `card_canceled` 时停止，之后不再恢复（stopped 不会被普通 Trigger 复活） |
| 删除卡后重新建同标题卡 | 新 task id → 新工单；旧工单已 stopped |
| `worker` 报告 blocked 后没有停住 | 本轮 hold 可能来不及打标；需在职责/提示词里要求“blocked 后结束本轮”（待补硬约束） |

## 7. 复现命令

```powershell
# 看一条工单的 blocked→释放过程
curl "http://127.0.0.1:3080/orchestrator/api/tickets/<ticket-id>" -H "x-orchestrator-request: 1"

# 现场触发取消（删除卡）
node .dsh/skills/kaneo-mcp/scripts/kaneo_mcp.mjs call delete_task --args-file <args.json>  # {"taskId": "..."}
```

看板设置里修改 `holdLabel` / `cancelColumns` / `blockedColumn` 后保存即可，下一轮轮询生效。
