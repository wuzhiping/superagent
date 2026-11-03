---
name: kaneo-mcp
description: 透過 Kaneo（https://pl.feg.cn，MCP 38 個工具 + 底層 REST）查詢與操作工作區、專案、任務、評論、標籤、關聯、時間紀錄與通知，並設定專案工作流：看板欄位（新增／改名／排序／刪除）、自動化規則與自訂欄位。當使用者提到 Kaneo、pl.feg.cn、專案管理、任務看板、pipeline、工作流、欄位、自動化、待辦、指派、工時時使用。
---

# kaneo-mcp

以 `scripts/kaneo_mcp.mjs` 呼叫 Kaneo：MCP 端點 `https://pl.feg.cn/api/mcp`（38 個工具），
以及 MCP 沒暴露的底層 REST API `https://pl.feg.cn/api`（工作流設定）。
相對路徑以本 skill 的基礎目錄為準。

> 38 個工具的中文逐項說明見 `references/tools.zh.md`；工作流 REST 端點見 `references/workflow-rest.zh.md`；
> **Kaneo 官方 OpenAPI 規格**（170 paths / 221 ops）見 `references/openapi.json`，中文導讀見 `references/openapi.zh.md`。

## 使用前：放入你自己的 Kaneo API key

本 skill **不含任何憑證**：分享包裡沒有 `.key`，也沒有 `.cache/`（token 快取）。憑證一律自備
（Kaneo 後台 → Settings → API keys 建立，到期日留空即永不過期）：

```powershell
node .dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs key <你的-kaneo-api-key>
```

這會寫入本 skill 的 `.key`，然後**立刻驗證**（MCP 打一次 `list_workspaces`、REST 打一次身分）：

```
key written to …\.dsh\skills\kaneo-mcp\.key
MCP  : ok — workspaces: [{"name":"ATEAM",…}]
REST : ok — 吳志平 / wu.zhiping@feg.cn
```

不帶參數執行 `key` 只會顯示目前 key 的來源與末四碼（不會印出完整 key）：

```powershell
node … kaneo_mcp.mjs key
# source : C:\…\.dsh\skills\kaneo-mcp\.key
# key    : …WuQw (64 chars)
```

也可以用環境變數：`KANEO_MCP_KEY`（**優先於 `.key`**）或 `KANEO_MCP_KEY_FILE` 指到別的檔案。

## 認證機制（2026-10-16 重新部署後：直接用 API key，不需要登入）

| 路徑 | 認證方式 | 狀態 |
| --- | --- | --- |
| `/api/mcp`（MCP 38 個工具） | `Authorization: Bearer <Kaneo API key>` | ✅ 2026-10-16 重新部署後支援 |
| `/api/*`（REST，工作流設定） | `x-api-key: <Kaneo API key>` | ✅ |

**不需要瀏覽器、不需要 OAuth、token 不會過期。** 腳本自動處理兩條路，優先用 API key。

實測（2026-10-16）：

- API key 當 Bearer 打 MCP：`tools` 38 個、`list_workspaces`、`list_projects`、`list_tasks`、
  `get_task_by_ticket_id`、`search`、`list_notifications`… 等 11 個讀取工具與 OAuth session **結果完全一致**。
- **把 `.cache/token.json` 整個移走後**，`whoami`／`tools`／`workspaces`／`projects` 全部照常，且腳本沒有去換任何 token。
- 唯一差異：`whoami` 工具讀的是 better-auth **session 物件**，用 API key 會回 `null`。
  CLI 的 `whoami` 已自動改用 REST 取得身分（實測回 `吳志平 / wu.zhiping@feg.cn`）。
- `x-api-key` 直接送到 `/api/mcp` 仍是 `401`（只有 `Authorization: Bearer` 這條路生效）；
  舊式 `initialize` 握手也仍是 `401`，一律走 2026-07-28 現代協定。

API key 讀取順序：`$KANEO_MCP_KEY` → `$KANEO_MCP_KEY_FILE` → 本 skill 的 `.key`（每分鐘 100 次上限）。
整個 skill 自包含在工作目錄內：

```
.dsh/skills/kaneo-mcp/              # 分享包只含下面 6 個「無憑證」項目
├── SKILL.md
├── references/tools.zh.md          # 38 個 MCP 工具中文說明
├── references/workflow-rest.zh.md  # 工作流 REST 端點（欄位／自動化／自訂欄位）
├── references/openapi.json         # 官方 OpenAPI 3.1.0 規格（692 KB，170 paths / 221 ops）
├── references/openapi.zh.md        # 官方規格中文導讀 + MCP 沒暴露的高價值端點
└── scripts/kaneo_mcp.mjs           # CLI：MCP 工具 + REST
    .key                            # 使用者自備（不隨包附上）
    .cache/token.json               # 只有走 OAuth 備援時才會自動產生（不隨包附上）
```

## 官方 OpenAPI 規格（`references/openapi.json`）

上游規格直接回答了兩個我們實測過的疑問，並列出 MCP 沒暴露的端點：

- **任務列表沒有 `columnId`**：`GET /task/tasks/{projectId}` 的參數只有
  `projectId, status, priority, assigneeId, page, relatedPage, limit, sortBy, sortOrder, dueBefore, dueAfter`；
  全規格 221 個操作裡 `columnId` 只出現在 `PUT /workflow-rule/{projectId}`。
  → 這正是 bug `FDE-147` 的權威答案：不是「實作了卻 no-op」，而是**契約裡根本沒有**。
- **`GET /search` 的 `workspaceId` 是必填**（規格標 `*`）→ 本站台那個
  `Workspace ID could not be determined` 是漏帶必填參數，不是 bug。
- **值得用 `rest` 直接打、MCP 沒有的**：`PATCH /task/bulk`（批次改狀態／負責人／標籤／刪除）、
  `GET /task/assigned`（我的任務，可 `countOnly=true`）、`GET /task/description-matches/{projectId}`（搜描述）、
  `POST /task/reorder`（卡片排序，`expectedTasks` 樂觀併發）、`/task/export|import`、
  `PUT /project/{id}/archive|unarchive|move`、`GET /instance/status`。

```powershell
$S = ".dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
node $S rest GET "/task/assigned?workspaceId=lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o&countOnly=true"
node $S rest GET "/task/description-matches/dgctny8ibgpn72ei2j8qj2hc?query=webhook"
node $S rest PATCH /task/bulk --args-file bulk.json   # {"taskIds":["..."],"operation":"updateStatus","value":"ready"}
```

> 這是**上游**規格（servers = `cloud.kaneo.app`），本站台是自架實例、版本可能不同——細節仍以實測為準。
> 詳細導讀（tag 總覽、查規格的方法）見 `references/openapi.zh.md`。

## 備援：OAuth 2.1 session（API key 被撤銷、或退回舊部署時）

優先序是 API key → 已存的 OAuth session → 重新登入。只有前兩者都被拒（401）時才需要人工：

```powershell
node .dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs login
```

1. 在 `127.0.0.1` 隨機埠起回呼伺服器，自動開瀏覽器到 Kaneo 授權頁
2. 你在頁面上按「核准」（未登入會先要你登入 Kaneo）
3. 瀏覽器導回本機回呼，程式自己接住 `code` → 換 30 天 token → 存進 `.cache/token.json`

實測：監聽 `127.0.0.1:11993` → 核准 → 回呼 → token 到期 2026-11-15。此後 30 天內每次呼叫都會自動續期。

無法開瀏覽器時的 fallback：`login --redirect <自己的回呼網址>` 印出同意網址，核准後把瀏覽器
網址列那條 URL 交給 `login --complete "<url>"`。

> 歷史脈絡：2026-10-16 中午前的版本不接受 API key，同意步驟也從 `x-api-key` 改成只認 session，
> 當時只能靠自我續期；重新部署後 API key 直接可用，這段 OAuth 流程降為備援。

## 用法

```powershell
node scripts/kaneo_mcp.mjs tools                 # 列出全部工具與參數
node scripts/kaneo_mcp.mjs tools --json          # JSON 格式
node scripts/kaneo_mcp.mjs whoami                # 目前登入者
node scripts/kaneo_mcp.mjs workspaces            # 工作區清單
node scripts/kaneo_mcp.mjs token                 # 目前快取的 MCP token 到期時間
node scripts/kaneo_mcp.mjs token --refresh       # 立即續期（自我續期，不需瀏覽器）
node scripts/kaneo_mcp.mjs call list_projects '{"workspaceId":"lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o"}'
node scripts/kaneo_mcp.mjs call get_task_by_ticket_id '{"ticketId":"FDE-59"}'
node scripts/kaneo_mcp.mjs call duplicate_task --args-file dup.json
node scripts/kaneo_mcp.mjs call list_tasks '{"projectId":"..."}' --raw
node scripts/kaneo_mcp.mjs board <projectId>                              # 看板總覽：各欄任務數 + 合計
node scripts/kaneo_mcp.mjs tasks <projectId> --column "進行中" --all      # 按欄位查任務（名稱或 slug 都可，--all 翻完所有分頁）
```

### Kanban 常用查詢

```powershell
$S = ".dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
$pj = "dgctny8ibgpn72ei2j8qj2hc"

node $S board $pj                                  # 8 欄 + total（實測合計 = 未篩選總數）
node $S board $pj --json                           # 給程式用：[{name,slug,isFinal,count}]
node $S tasks $pj --column "Blocked" --all         # 卡住的任務
node $S tasks $pj --column "測試驗證" --all --json  # QA 佇列，JSON
node $S tasks $pj --all --limit 50                 # 全專案（自動翻頁、去重）
```

- `board` 每欄一次請求（`status`+`limit=1` 只讀 `pagination.total`），8 欄 = 9 次請求。
- `tasks` 預設只給第一頁並在標頭寫明 `page 1/N`；**看到 `showing 20 of 28` 就要加 `--all`**，
  否則會誤以為該欄只有 20 筆。`--all` 會翻完 `totalPages` 並按 task id 去重。
- 分頁語意（實測）：`pageSize = limit`、`totalPages = ceil(total/limit)`；`status` 篩選後仍可分頁
  （進行中 28 筆 = 20 + 8，無重複）。

- 參數一律是**單一 JSON 物件**。
- 在 PowerShell 裡內嵌 JSON 的引號會被吃掉：請用 `--args-file`（建議），或把內部雙引號寫成 `\"`。
- `--raw` 印出完整 MCP 結果；預設只印第一個 text block 並嘗試解析為 JSON。
- 結束碼：`0` 成功、`1` 呼叫或認證失敗（錯誤以 JSON-RPC error 印出）、`2` 參數錯誤。

## 工具速查（共 38 個）

| 類別 | 工具 |
| --- | --- |
| 身分／工作區 | `whoami`, `list_workspaces`, `list_workspace_members`, `list_workspace_labels` |
| 專案 | `list_projects`, `get_project`, `create_project`, `update_project`, `list_project_columns` |
| 任務 | `list_tasks`, `get_task`, `get_task_by_ticket_id`, `create_task`, `duplicate_task`, `update_task`, `move_task`, `update_task_status`, `delete_task`, `update_task_assignee`, `update_task_due_date` |
| 評論 | `list_task_comments`, `create_task_comment`, `update_task_comment`, `delete_task_comment` |
| 標籤 | `create_label`, `attach_label_to_task`, `detach_label_from_task`, `delete_label` |
| 關聯 | `create_task_relation`, `get_task_relations`, `delete_task_relation` |
| 工時 | `list_task_time_entries`, `get_time_entry`, `create_time_entry`, `update_time_entry` |
| 其他 | `list_task_activity`, `list_notifications`, `search` |

2026-10-16 升級新增兩個工具：

- `get_task_by_ticket_id` — 用票號取任務，格式是 **`<project slug>-<number>`**，實測 `FDE-59` 可查到。
  票號在多個可存取專案間可能重複，有歧義時再帶 `workspaceId` 或 `projectId`。
- `duplicate_task` — 在同一專案複製任務（含欄位與標籤），`title` 可改副本名稱。**尚未實測寫入**，
  只驗證過錯誤路徑（給錯 `taskId` 會回 `Task not found`）。

其他要點：

- `status` 的合法值來自 `list_project_columns`（欄位 slug），不是固定枚舉；`userId` 先以
  `list_workspace_members` 解析。`create_project` 的 `icon` 與 `slug` 為必填。
- **按欄位查任務（2026-10-16 實測）**：`list_tasks` 的 `status` **只吃 slug**（`in-progress`）；
  餵顯示名稱（`進行中`）會**靜默回 `total: 0`，不報錯**；值前後的空白會被 trim，但大小寫敏感
  （`Blocked`/`BLOCKED` → 0，`blocked` → 3）。
  要嘛先查 slug，要嘛用 `tasks <projectId> --column "<名稱或slug>"`（自動對照，找不到會列可用欄位）。
  8 欄實測合計 18+26+28+3+9+7+4+23 = 118 = 未篩選總數，證明 slug 篩選正確。
- **`list_tasks` 沒有 `columnId` 參數**（工具 schema 只有 `projectId/status/priority/assigneeId/page/limit/sortBy/sortOrder/dueBefore/dueAfter`）。
  傳 `columnId`／`columnSlug`／`column` 都會被**靜默丟棄並回傳全部 118 筆**，不會報錯——這就是專案 bug
  `FDE-147` 的現象。**欄位篩選一律走 `status=<slug>`**，不要用 `columnId`。
- 錯誤處理不一致（同一張單的延伸發現）：無效的 `priority` 會**報錯**，無效的 `status` 卻**靜默回 0**，
  未知參數名則**靜默忽略**。用 `status` 篩選後務必檢查 `pagination.total`。
- `search` 是**全文檢索**（命中標題／描述／評論文字），**不是欄位篩選**：
  搜 `Blocked` 只會撈到文字裡有這詞的 2 筆，而不是該欄位的 3 筆——別拿 search 當欄位篩選的 workaround。
- `search` 沒有帶 `workspaceId` 時上游會回 `Workspace ID could not be determined`（session 的
  `activeOrganizationId` 為 null），所以查詢一律要明確帶上 `workspaceId`。
- **欄位 id 有兩種形狀**：`list_project_columns` 與 `/api/column/*` 回的是 CUID（`ww6uh8h…`），
  但 `list_tasks`／`get_project` 回應裡內嵌的 `columns[].id` 是**欄位 slug**（`to-do`）。
  要拿去做 `columns update`／`workflow set`／`create_task` 的 `status` 時，別把兩者混用。

## 工作流設定（走 REST，MCP 做不到）

Kaneo 的「Workflow」設定頁有三塊：**Columns**、**Custom fields**、**Automations**。
MCP 只提供 `list_project_columns`（唯讀），其餘要走底層 REST —— 腳本已內建並用 `.key` 直接認證
（同一支 key 在 `/api/mcp` 會被拒，在 `/api/*` 可用，這是兩條不同的認證路徑）。

| 動作 | 指令 |
| --- | --- |
| 讀欄位 | `columns list <projectId>` |
| 新增欄位 | `columns create <projectId> <json>` — `{name, icon?, color?, isFinal?}`（slug 由 name 自動產生，附加在最後） |
| 改欄位 | `columns update <columnId> <json>` — `{name?, icon?, color?, isFinal?}`（icon/color 傳 `null` 可清空） |
| 排序 | `columns reorder <projectId> <json>` — `{columns:[{id,position}]}`，要列出**全部**欄位 |
| 刪欄位 | `columns delete <columnId> --yes`（欄位內還有任務會 409，先把任務移走） |
| 讀自動化 | `workflow list <projectId>` |
| 設／改自動化 | `workflow set <projectId> <json>` — `{integrationType, eventType, columnId}`；同 integration+event 是 upsert（更新既有規則） |
| 刪自動化 | `workflow delete <ruleId> --yes` |
| 任意端點 | `rest <METHOD> <path> [json]`，例如 `rest GET /custom-field/project/<projectId>` |

```powershell
$S = ".dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
node $S columns list dgctny8ibgpn72ei2j8qj2hc
node $S workflow list dgctny8ibgpn72ei2j8qj2hc
node $S columns create <projectId> --args-file column.json      # {"name":"Blocked","color":"#ef4444"}
node $S columns reorder <projectId> --args-file order.json      # {"columns":[{"id":"...","position":0},...]}
```

- 「完成」的判定是 `isFinal: true`，欄位叫 Done 並不算。
- automations 只是**已連接整合**（GitHub／Gitea／GitLab）事件 → 目標欄位的對應，沒連整合時規則不會觸發。
- 所有刪除都要 `--yes`；未確認的破壞性操作會被腳本擋下（結束碼 2）。
- **Custom fields 於 2026-10-16 升級後已可用**（`GET /api/custom-field/project/<projectId>` 實測 200，
  之前是 404）。這個 CLI 沒有專屬子命令，用 `rest` 操作即可，端點清單見 `references/workflow-rest.zh.md`。
- 寫入需要 `project:update`；`wu.zhiping@feg.cn` 是 workspace owner，已實測可寫。

## 疑難排解

| 現象 | 處理 |
| --- | --- |
| `401 invalid_token`（MCP 呼叫） | 先確認 API key 是否還有效（Kaneo 後台 API keys）；腳本依序試 API key → 已存 OAuth session → 重新登入，全被拒才會要你 `login` |
| `consent failed (… 401 {"error":"unauthorized"})` | 只在走 OAuth 備援時出現；session 已失效 → 再 `login` 一次 |
| `whoami` 回 `null` | 正常：API key 沒有 better-auth session，改用 `node … whoami`（CLI 會轉用 REST）或看 `list_workspaces` |
| `未取得授權碼（timeout）` | 瀏覽器那一步沒完成；state 已保留，可續用 `login --complete "<URL>"` |
| `--complete needs the redirect URL…` | `login --complete` 沒帶值（PowerShell 變數為空時很常見），補上瀏覽器網址列的完整 URL |
| `invalid_origin` | 同意步驟的 `Origin` 必須是 `https://pl.feg.cn`（腳本已固定） |
| `Mcp-Method`／`Mcp-Name` 缺失錯誤 | 端點使用 2026-07-28 現代協定，請求必須帶這些標頭；不要改成舊式 `initialize` 握手（舊式在此端點是無狀態的，會回 `Server not initialized`） |
| `Workspace ID could not be determined` | 這個 session 沒有 active workspace；REST 呼叫要帶 `projectId`，MCP 的 `search` 要帶 `workspaceId` |
| 409 `Column still contains tasks` | 欄位內還有任務，先搬走再刪 |
| 404 且回應是純文字 `404 Not Found` | 該站台沒有這條路由，不是參數錯（換版本升級後某些路由才會出現） |
| 429 `Rate limit exceeded` | API key 每分鐘 100 次。CLI 會自動退避重試（最多 3 次，優先讀 `Retry-After`），仍失敗才報錯；跑批次時請放慢節奏 |
