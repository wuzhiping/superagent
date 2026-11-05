# Kanban MCP 工具清單（38 個，中文說明）

端點：`https://pl.feg.cn/api/mcp`（現代協定 2026-07-28）。帳號：吳志平 / wu.zhiping@feg.cn。
以下「必填」對應工具 schema 的 `required`；未標示者為選填。
**2026-10-16 站台升級後由 36 個增為 38 個**（新增 `get_task_by_ticket_id`、`duplicate_task`）。

## 全域注意事項

- **`status` 不是固定枚舉**：每個專案的欄位 slug 不同（例如 `to-do` / `ready` / `in-progress` / `done`），先呼叫 `list_project_columns` 取得合法值。
- **`priority` 枚舉**：`no-priority` / `low` / `medium` / `high` / `urgent`。
- **日期時間**：ISO 8601 字串，例如 `2026-09-30T16:00:00.000Z`（`startDate` / `dueDate` / `dueBefore` / `dueAfter` / `startTime` / `endTime`）。
- **`userId` 一律先用 `list_workspace_members` 解析**，不要憑名稱猜 ID。
- **ID 都是 CUID 字串**（例如 `dgctny8ibgpn72ei2j8qj2hc`），不是數字。
- **票號另有格式**：`<project slug>-<number>`（如 `FDE-59`），用 `get_task_by_ticket_id` 查。
- 寫入類工具（create/update/delete/move/duplicate）會直接改動正式資料，執行前先確認目標 ID。

---

## 1. 身分與工作區（4）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `whoami` | 回傳目前登入的 session 與使用者（驗證連線用）。**用 API key 認證時會回 `null`**（它讀的是 better-auth session 物件），要拿身分請改看 REST 的 `/api/auth/get-session`，CLI 的 `whoami` 已自動處理 | 無 |
| `list_workspaces` | 列出目前使用者可存取的工作區 | 無 |
| `list_workspace_members` | 列出工作區成員，用來查 `userId` | `workspaceId`（必填） |
| `list_workspace_labels` | 列出工作區已定義的標籤 | `workspaceId`（必填） |

## 2. 專案（5）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `list_projects` | 列出工作區內的專案 | `workspaceId`（必填）、`includeArchived`（含已封存） |
| `get_project` | 依 ID 取得單一專案 | `id`（必填） |
| `create_project` | 在指定工作區建立專案 | `name`、`workspaceId`、`icon`、`slug`（全部必填） |
| `update_project` | 更新專案metadata（PATCH 語意，只改有帶的欄位） | `id`（必填）、`name`、`icon`、`slug`、`description`、`isPublic` |
| `list_project_columns` | 列出專案欄位（看板列）；其 slug 即 `status` 的合法值 | `projectId`（必填） |

## 3. 任務（11）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `list_tasks` | 列出專案任務，可篩選／排序／分頁。**`status` 只吃欄位 slug**（如 `in-progress`），餵顯示名稱會靜默回 0 筆；**沒有 `columnId` 參數**，傳了會被靜默丟棄並回傳全部任務（見 bug FDE-147）。要按名稱查請用 CLI 的 `tasks --column "<名稱>"` | `projectId`（必填）、`status`、`priority`、`assigneeId`、`page`、`limit`、`sortBy`（`createdAt`/`priority`/`dueDate`/`position`/`title`/`number`）、`sortOrder`（`asc`/`desc`）、`dueBefore`、`dueAfter` |
| `get_task` | 依 ID 取得單一任務 | `taskId`（必填） |
| `get_task_by_ticket_id` | **（升級新增）** 用票號取任務，格式 `<project slug>-<number>` | `ticketId`（必填，如 `FDE-59`）、`workspaceId`、`projectId`（票號有歧義時用來限定） |
| `create_task` | 在專案建立任務 | `projectId`、`title`、`description`、`priority`、`status`（全部必填）、`startDate`、`dueDate`、`userId` |
| `duplicate_task` | **（升級新增）** 在同一專案複製任務，含欄位與標籤 | `taskId`（必填）、`title`（改副本名稱） |
| `update_task` | 更新任務（先讀取現值、合併欄位後整體更新） | `taskId`（必填）、`title`、`description`、`status`、`priority`、`projectId`、`position`、`startDate`、`dueDate`、`userId` |
| `update_task_status` | 只改任務狀態（看板列） | `taskId`、`status`（皆必填） |
| `move_task` | 把任務搬到另一個專案（可同時指定欄位狀態） | `taskId`、`destinationProjectId`（必填）、`destinationStatus` |
| `update_task_assignee` | 指派負責人；`userId` 傳 `null` 表示取消指派 | `taskId`、`userId`（皆必填，`userId` 允許 null） |
| `update_task_due_date` | 設定到期日；省略 `dueDate` 表示清除 | `taskId`（必填）、`dueDate` |
| `delete_task` | 刪除任務 | `taskId`（必填） |

## 4. 任務評論（4）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `list_task_comments` | 列出任務的評論 | `taskId`（必填） |
| `create_task_comment` | 新增評論 | `taskId`、`content`（皆必填） |
| `update_task_comment` | 修改**自己**的評論 | `commentId`、`content`（皆必填） |
| `delete_task_comment` | 刪除**自己**的評論 | `commentId`（必填） |

## 5. 標籤（4）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `create_label` | 建立標籤（可同時掛到某任務） | `name`、`color`、`workspaceId`（必填）、`taskId` |
| `attach_label_to_task` | 把既有標籤掛到任務 | `labelId`、`taskId`（皆必填） |
| `detach_label_from_task` | 把標籤從目前任務卸下 | `labelId`（必填） |
| `delete_label` | 依 ID 刪除標籤；**只能刪任務層級標籤**，工作區層級（`taskId` 為 null）會被 API 拒絕 | `id`（必填） |

## 6. 任務關聯（3）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `create_task_relation` | 建立兩個任務的關聯：`subtask`（source 為父、target 為子）、`blocks`（source 阻擋 target）、`related`（雙向） | `sourceTaskId`、`targetTaskId`、`relationType`（皆必填） |
| `get_task_relations` | 列出與某任務相關的所有關聯 | `taskId`（必填） |
| `delete_task_relation` | 依關聯 ID 刪除關聯 | `id`（必填） |

## 7. 工時（4）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `list_task_time_entries` | 列出任務的工時紀錄 | `taskId`（必填） |
| `get_time_entry` | 依 ID 取得單筆工時 | `id`（必填） |
| `create_time_entry` | 為任務登記工時；省略 `endTime` 表示仍在計時中 | `taskId`、`startTime`（必填）、`endTime`、`description` |
| `update_time_entry` | 更新工時；`startTime` 必填，省略 `endTime` 會保留原值，且 `startTime` 不可晚於 `endTime` | `id`、`startTime`（必填）、`endTime`、`description` |

## 8. 動態、通知與搜尋（3）

| 工具 | 用途 | 參數 |
| --- | --- | --- |
| `list_task_activity` | 列出任務的活動歷史 | `taskId`（必填） |
| `list_notifications` | 列出目前使用者的通知 | 無 |
| `search` | 跨任務、專案、工作區、評論、活動搜尋 | `q`（必填）、`type`（`all`/`tasks`/`projects`/`workspaces`/`comments`/`activities`，預設 `all`）、`workspaceId`（**實務上必填**，否則回 `Workspace ID could not be determined`）、`projectId`、`limit`（1–50，預設 20） |

---

## 常用呼叫範例

```powershell
$K = "C:\Users\shawoo\Desktop\feg.cn\.dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
$WS = "lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o"   # ATEAM
$PJ = "dgctny8ibgpn72ei2j8qj2hc"           # FDEP

node $K call list_projects "{\"workspaceId\":\"$WS\"}"
node $K call list_project_columns "{\"projectId\":\"$PJ\"}"
node $K call list_tasks "{\"projectId\":\"$PJ\",\"sortBy\":\"priority\",\"sortOrder\":\"desc\"}"
node $K call search "{\"q\":\"FDEP\",\"type\":\"tasks\",\"limit\":10}"
```

複雜參數建議寫成檔案（避免 PowerShell 吃掉引號）：

```powershell
'{"projectId":"dgctny8ibgpn72ei2j8qj2hc","title":"新任務","description":"","priority":"medium","status":"to-do"}' |
  Set-Content -Encoding utf8 args.json
node $K call create_task --args-file args.json
```
