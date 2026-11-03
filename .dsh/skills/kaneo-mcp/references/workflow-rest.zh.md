# 專案工作流 REST API（中文說明）

MCP 只把 Kaneo REST 的一部分註冊成工具，**工作流設定完全不在裡面**，所以這一層直接打 REST：
`https://pl.feg.cn/api` + 標頭 `x-api-key: <本 skill 的 .key>`。
（同一支 key 送到 `/api/mcp` 會是 `401 invalid_token`；那是 OAuth 保護的另一條入口。）

CLI 已封裝：`columns …` / `workflow …` / `rest …`。以下為對應的原始端點與實測結果。

## 1. 看板欄位（Columns）

| 動作 | 端點 | Body |
| --- | --- | --- |
| 讀 | `GET /api/column/{projectId}` | — |
| 新增 | `POST /api/column/{projectId}` | `{name, icon?, color?, isFinal?}` |
| 修改 | `PUT /api/column/{id}` | `{name?, icon?, color?, isFinal?}`（`icon`／`color` 傳 `null` 清空） |
| 排序 | `PUT /api/column/reorder/{projectId}` | `{columns:[{id,position}]}`，需含該專案**全部**欄位 |
| 刪除 | `DELETE /api/column/{id}` | — |

- `slug` 由 `name` 自動產生（`In Review` → `in-review`），**不可指定**；新增一律附加在最後。
- `isFinal: true` 才是「完成」判定，名稱叫 Done 不算。
- 刪除非空欄位 → `409`；先把任務移到別的欄位。
- 建立欄位範例（實測）：`{"name":"__dsh_probe__","color":"#94a3b8"}` →
  `{"id":"pgpelba8uqiwbehfi8c40hbq","name":"__dsh_probe__","slug":"dsh-probe","position":4,"color":"#94a3b8","isFinal":false}`

## 2. 自動化（Automations / workflow rules）

| 動作 | 端點 | Body |
| --- | --- | --- |
| 讀 | `GET /api/workflow-rule/{projectId}` | — |
| 設／改 | `PUT /api/workflow-rule/{projectId}` | `{integrationType, eventType, columnId}` |
| 刪除 | `DELETE /api/workflow-rule/{id}` | — |

- 語意是 upsert：同一組 `integrationType + eventType` 只會有一條規則，再送一次是**更新**目標欄位（實測回同一個 id）。
- 規則的意義是「已連接的 GitHub／Gitea／GitLab 整合事件 → 移到某欄位」，例如 `pull_request.merged` → `Done`。
  沒有連接整合時，規則存在但不會被觸發。
- 回應形狀（實測 2026-10-16）：`workflow list` 會附 `columnName` / `columnSlug` 方便核對；
  **`workflow set` 與 `workflow delete` 的回應只有 `columnId`，沒有 `columnName`**——要核對目標欄位請再查 `workflow list`。
- 建立規則範例（實測）：`{"integrationType":"github","eventType":"pull_request.merged","columnId":"<done column id>"}` →
  `{"id":"joazvk622uxf1mdh27iacbge","integrationType":"github","eventType":"pull_request.merged","columnName":"Done","columnSlug":"done",…}`

## 3. 自訂欄位（Custom fields）— 2026-10-16 升級後已可用

`GET /api/custom-field/project/{projectId}` 實測回 `200 []`（升級前是 `404`）。用 `rest` 直接打：

| 動作 | 端點 | Body |
| --- | --- | --- |
| 列出定義 | `GET /api/custom-field/project/{projectId}` | — |
| 專案所有值 | `GET /api/custom-field/project/{projectId}/values` | — |
| 篩選用值 | `GET /api/custom-field/project/{projectId}/filter-values` | — |
| 任務的值 | `GET /api/custom-field/task/{taskId}` | — |
| 新增 | `POST /api/custom-field/` | `{projectId, name, type, required?, defaultValue?, options?}` |
| 修改 | `PUT /api/custom-field/{id}` | 名稱／必填／預設／選項（**型別不可改**，dropdown ↔ multiselect 例外） |
| 排序 | `PUT /api/custom-field/reorder/{projectId}` | `{fields:[…]}` |
| 設定任務值 | `PUT /api/custom-field/value` | `{taskId, fieldId, value}` |
| 刪除 | `DELETE /api/custom-field/{id}` | — |

```powershell
$S = ".dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
node $S rest GET "/custom-field/project/dgctny8ibgpn72ei2j8qj2hc"
node $S rest POST /custom-field --args-file field.json
```

## 4. 欄位物件與 id 的兩種形狀（升級後要特別注意）

`GET /api/column/{projectId}` 與 MCP 的 `list_project_columns` 都回 **CUID** 當 `id`，並附
`icon`、`color`：

```json
{"id":"ww6uh8hceu284hkq16fzjt46","name":"待辦池","slug":"to-do","position":0,
 "icon":"Layers","color":"#64748b","isFinal":false}
```

但 `list_tasks` / `get_project` 回應裡**內嵌**的 `columns[].id` 是**欄位 slug**（`"to-do"`）。
`columns update`、`columns delete`、`workflow set` 的 `columnId` 要的是 CUID；
`create_task` / `update_task` 的 `status` 要的是 slug。兩者別混用。

## 5. 這個專案的狀態（2026-10-16 實測）

專案 `FDEP`（`dgctny8ibgpn72ei2j8qj2hc`，workspace `ATEAM`）已被大幅擴充：**107 個任務、8 個欄位**。

```
待辦池(to-do,0)  待開工(ready,1)  進行中(in-progress,2)  Blocked(blocked,3)
程式碼審查(in-review,4)  測試驗證(qa,5)  預發布(staging,6)  已交付(done,7,isFinal=true)
自動化規則：0 條        自訂欄位：0 個（功能已上線）
```

票號格式實測：`FDE-59` → 「AI 客服助手 v2（多模態：圖片+文字）」，`FDE-58`、`FDE-166` 亦可查到。

## 6. 權限與安全

- 讀需要 `project:read`，寫需要 `project:update`；`wu.zhiping@feg.cn` 在 workspace `ATEAM` 是 **owner**，實測可寫。
- 刪除指令在本 CLI 需要 `--yes` 才會執行（未帶 → 結束碼 2，不做任何事）。
- REST 走 `x-api-key`（本 skill `.key`，每分鐘 100 次上限、`expiresAt: null`）；
  **2026-10-16 重新部署後，同一把 key 也能當 `Authorization: Bearer` 打 `/api/mcp`**，
  所以 MCP 與 REST 現在共用同一把憑證，不需要 OAuth 登入。

## 7. 驗證方式（改完工作流後怎麼確認）

```powershell
$S = ".dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs"
$pj = "dgctny8ibgpn72ei2j8qj2hc"
node $S columns list $pj        # 欄位順序與 isFinal
node $S workflow list $pj       # 自動化規則
node $S call list_project_columns "{\"projectId\":\"$pj\"}"   # 從 MCP 側交叉確認
```
