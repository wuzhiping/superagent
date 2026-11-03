# Kaneo 官方 OpenAPI 規格索引（中文導讀）

- **原始檔**：`references/openapi.json`（692 KB，OpenAPI **3.1.0**，**170 paths / 221 operations / 132 schemas**）
- **來源**：<https://kaneo.app/docs/openapi.json>，下載於 **2026-10-16**
- **servers**: `https://cloud.kaneo.app/api`（官方雲）；本 skill 用的是 `https://pl.feg.cn/api`

> ⚠️ 這份是**上游**規格，本站台是自架實例、版本可能落後或超前。**以實測為準**：
> 先用 `rest` 打一次再依賴；本檔已標注我們實測過的差異。

---

## 一、規格直接回答的兩個爭議

### 1. 任務列表沒有 `columnId`（終結 bug FDE-147）

任務列表端點 `GET /task/tasks/{projectId}` 的參數只有：

```
projectId*, status, priority, assigneeId, page, relatedPage, limit, sortBy, sortOrder, dueBefore, dueAfter
```

**沒有 `columnId`**。而且掃過全部 221 個操作，`columnId` 只出現在**一個**地方：
`PUT /workflow-rule/{projectId}` 的 request body（自動化規則的目標欄位）。

→ 所以「按欄位查任務」在官方 API 就是走 **`status` = 欄位 slug**；
`columnId` 不是「實作了卻 no-op」，而是**根本不在契約裡**。
（本站台實測：傳 `columnId` 會回全量 118 筆；傳 `status: "blocked"` 正確回 3 筆。）

### 2. `/search` 的 `workspaceId` 是**必填**

```
GET /search?q*&workspaceId*&type&projectId&limit&userEmail
```

官方規格就把 `workspaceId` 標為必填（`*`），這正好解釋本站台的
`Workspace ID could not be determined`——不是 bug，是漏帶必填參數。
另外有 `userEmail` 參數（規格有、MCP 沒暴露）。

---

## 二、MCP 沒暴露、但可用 `rest` 直接打的高價值端點

| 用途 | 端點 | 重點 |
| --- | --- | --- |
| **批次改任務** | `PATCH /task/bulk` | body `{taskIds[], operation, value}`；operation ∈ `updateStatus` / `updatePriority` / `updateAssignee` / `delete` / `addLabel` / `removeLabel` / `updateDueDate`。一次改多筆，繞過 38 個工具逐筆呼叫與速率限制 |
| **我的任務** | `GET /task/assigned?workspaceId=` | 加 `countOnly=true` 只回總數。**實測**回 `{"tasks":[],"total":11}` |
| **描述全文搜尋** | `GET /task/description-matches/{projectId}?query=` | 任務列表出於效能會延後載入描述（`descriptionDeferred`），這支專搜描述。**實測**回 `{"ids":[],"nextCursor":null}`——只回**任務 id**，要再 `get_task` 取內容；cursor 分頁；漏 `query` → 400 |
| **卡片排序／搬移** | `POST /task/reorder` | body `{projectId, expectedTasks, tasks}`；`expectedTasks` 是**樂觀併發檢查**，別人動過就會被拒 |
| **匯出／匯入** | `GET /task/export/{projectId}`、`POST /task/import/{projectId}` | 備份或批次建任務（body `{tasks[]}`） |
| **單欄位更新** | `PUT /task/title/{id}`、`/description/{id}`、`/due-date/{id}`、`/priority/{id}`、`/assignee/{id}`、`/status/{id}` | 只改一個欄位，比 `PUT /task/{id}` 全量更新安全 |
| **專案生命週期** | `PUT /project/{id}/archive`、`/unarchive`、`/move`、`POST /project/reorder` | MCP 的 `update_project` 做不到封存／搬移 |
| **實例資訊** | `GET /instance/status`、`GET /config` | **實測** `/instance/status` 回 `{hasUsers, hasAdmin}`（初始化狀態）、`/config` 回功能開關（`disableRegistration`、`hasSmtp`…）。**兩者都不是版本號** |
| **自訂欄位** | `/custom-field/*`（9 個操作） | 規格完整；本站台 2026-10-16 起已上線 |

呼叫方式（`rest` 子命令）：

```powershell
$S = ".dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
node $S rest GET "/task/assigned?workspaceId=lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o&countOnly=true"
node $S rest GET "/task/description-matches/dgctny8ibgpn72ei2j8qj2hc?query=webhook"
node $S rest PATCH /task/bulk --args-file bulk.json   # {"taskIds":["..."],"operation":"updateStatus","value":"ready"}
```

---

## 三、規格總覽（35 個 tag / 221 個操作）

| 領域 | tag（操作數） |
| --- | --- |
| 任務與專案 | Tasks 25、Projects 16、Columns 5、Task Relations 3、Workflow Rules 3、Labels 8、Comments 4、Time Entries 4、Activity 6 |
| 組織與權限 | Organization Management 35、Admin 8、Workspaces 7、Invitations 2、User 4、Authentication 3 |
| 整合 | GitHub 8、Gitea 7、GitLab 7、Integration sync 5、Slack 4、Discord 4、Telegram 4、Mattermost 4、Generic Webhook 4、Calendar feeds 4 |
| 資料與其他 | Custom Fields 9、Notifications 8、Notification Preferences 4、Import 5、External Links 3、Assets 1、Search 1、Instance 1、Config 1 |
| MCP 本身 | MCP 4（即 `/mcp/register`、`/mcp/authorize`、`/mcp/token` 與 `/mcp`——本 skill 的認證流程就是這四支） |

> **Organization Management / Admin / 各整合** 這些 tag 需要更高權限，本 skill 目前沒用到。

---

## 四、怎麼查這份規格

用 Node 直接翻（不必載入整個檔案進 context）：

```bash
# 列出所有路徑
node -e "const s=require('./references/openapi.json');console.log(Object.keys(s.paths).join('\n'))"

# 看某個端點的完整定義
node -e "const s=require('./references/openapi.json');console.log(JSON.stringify(s.paths['/task/bulk'],null,2))"

# 全檔搜尋某個欄位名
node -e "const s=require('./references/openapi.json');const hits=[];for(const [p,i] of Object.entries(s.paths))for(const m of ['get','post','put','patch','delete'])if(i[m]){const op=i[m];if(JSON.stringify(op).includes('columnId'))hits.push(m.toUpperCase()+' '+p)};console.log(hits.join('\n'))"
```

- `components.schemas` 有 132 個 schema，回應結構都在裡面（例如 `Task`、`Column`、`WorkflowRule`）。
- 本站台的回應可能比規格**多**欄位（例：任務列表回應多了 `subtaskCounts`、`descriptionDeferred`、`relatedPage` 等）——多出來的不代表不能用，但別假設官方文件有寫。
