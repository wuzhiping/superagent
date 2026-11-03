---
name: web-search
description: 透過 MCP 服務 http://q.feg.cn/mcp 的 web_search 工具進行真實網路搜尋。當使用者說「搜尋／查一下／查找／最新／新聞／即時」，或需要連網查證事實、取得外部資料與連結時使用。
whenToUse: 需要網際網路即時資訊（新聞、價格、版本發布、人物／公司資料），或必須以外部來源支撐結論時。
---

# web-search

使用 MCP 端點 `http://q.feg.cn/mcp` 上的 `web_search` 工具進行真實網路搜尋，回傳結構化結果（標題／連結／摘要／日期）。

> **端點為 HTTP。** 該主機的 HTTPS 由 SearXNG 提供，`https://q.feg.cn/mcp` 會回 404。若日後有 HTTPS 入口，用環境變數 `MCP_WEB_SEARCH_URL` 覆寫即可，不需修改程式。

## 第一步：使用腳本（建議）

腳本位於本 skill 目錄下的 `scripts/web_search.js`（Node.js ≥ 18，使用內建 `fetch`，無第三方相依套件）。
相對路徑請以本 skill 的基礎目錄為準：

```powershell
node scripts/web_search.js "關鍵詞" --limit 5
```

常用形式：

| 指令 | 用途 |
| --- | --- |
| `node web_search.js "關鍵詞1 關鍵詞2"` | 文字結果（預設最多 10 筆） |
| `node web_search.js -q "關鍵詞" --limit 3` | 明確指定查詢字串 |
| `node web_search.js "..." --json` | 輸出正規化 JSON，便於程式化處理 |
| `node web_search.js "..." --raw` | 輸出完整 MCP payload（除錯用） |
| `node web_search.js "..." --quiet` | 每筆只輸出「標題<TAB>連結」 |
| `node web_search.js --help` | 查看用法 |

- 結束碼：`0` 成功，`1` 呼叫失敗（連線／JSON-RPC／服務端錯誤），`2` 參數錯誤。
- 環境變數：`MCP_WEB_SEARCH_URL` 覆寫端點，`MCP_WEB_SEARCH_TIMEOUT` 覆寫逾時秒數（預設 60）。
- 也可在 Node 中直接重用，腳本僅在直接執行時才會跑 CLI：

```js
// 於本 skill 目錄下執行
const { callWebSearch } = require('./scripts/web_search.js');
const data = await callWebSearch('關鍵詞');
console.log(data.organic[0].link);
```

## 第二步：不依賴腳本的裸呼叫

此服務是 Streamable HTTP MCP，**必須三步**；`tools/call` 若缺少 `mcp-session-id` 會失敗：

```powershell
$base = "http://q.feg.cn/mcp"
$h = @{ "Content-Type" = "application/json"; "Accept" = "application/json, text/event-stream" }

# 1) initialize —— 由回應標頭取出 mcp-session-id
$r = Invoke-WebRequest -Uri $base -Method Post -Headers $h -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}'
$h["mcp-session-id"] = $r.Headers["mcp-session-id"]

# 2) initialized 通知（回 202 空內容，屬正常）
Invoke-WebRequest -Uri $base -Method Post -Headers $h -Body '{"jsonrpc":"2.0","method":"notifications/initialized"}' | Out-Null

# 3) 真正呼叫
Invoke-WebRequest -Uri $base -Method Post -Headers $h -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search","arguments":{"query":"關鍵詞"}}}'
```

> PowerShell 直接內嵌 JSON 時，引號很容易被參數解析吃掉而送出壞掉的內容；若遇到 `Parse error`，請改用腳本或以檔案傳遞（`curl --data-binary @payload.json`）。

### 回應解析（三個陷阱）

1. **是 SSE，不是裸 JSON**：回應內容形如 `event: message` 加 `data: {...}`，必須取 `data:` 之後那行再解析。
2. **雙重 JSON 編碼**：結果在 `result.content[0].text`，而它本身是一個 **JSON 字串**，需要第二次 `JSON.parse`：

```
data.result.content[0].text  ->  '{"organic":[...],"related_searches":[...],"base_resp":{...}}'
```

3. **必須以 UTF-8 解碼**：中文結果是 UTF-8；用預設編碼讀取會出現 `è´¢ç»` 這類亂碼。Node 的 `fetch` 搭配 `res.text()` 會自動以 UTF-8 解碼。

### 結果結構

```json
{
  "organic": [
    { "title": "標題", "link": "https://...", "snippet": "摘要", "date": "2026/04/24 20:58:29" }
  ],
  "related_searches": [ { "query": "相關搜尋詞" } ],
  "base_resp": { "status_code": 0, "status_msg": "" }
}
```

`base_resp.status_code != 0` 表示搜尋 API 端失敗；`organic` 為空表示沒有命中。

## 搜尋策略

- **3–5 個關鍵詞**效果最好，不要塞整句話。
- 時效性議題**把日期寫進 query**，例如 `AI 新聞 2026-10`，能明顯提升新鮮度。
- 一次沒結果就**換詞重試**（同義詞、英文、縮小範圍），不要重複同一個 query。
- 需要正文時：先用 `web_search` 取得連結，再對具體 URL 用 `web_fetch` 取全文。
- 引用結論時附上 `link`，並留意 `date` 判斷資訊是否過期。

## 疑難排解

| 現象 | 原因／處理 |
| --- | --- |
| `Parse error`／JSON-RPC 錯誤 | 請求內容被 shell 轉義破壞，改用腳本或 `--data-binary @payload.json` |
| 缺少 `mcp-session-id` 而失敗 | 沒做第 1 步握手，或未把回應標頭回填到後續請求 |
| 回應中找不到 JSON | 忘了剝掉 SSE 的 `data:` 前綴 |
| 中文亂碼 | 以 UTF-8 解碼 |
| 404 且回應是搜尋引擎頁面 | 用到了 HTTPS 入口；本 MCP 只在 `http://q.feg.cn/mcp` 提供 |
| `無法連線至` 端點 | 端點不通，確認 `http://q.feg.cn/mcp` 可達後再重試 |

## 附：同一端點上的其他工具

此 MCP 另提供 `understand_image`（參數 `prompt`、`image_source`，支援 JPEG／PNG／WebP 的 URL 或本機路徑；本機路徑若帶 `@` 前綴需先去除），可用於圖片理解。

## 附：註冊為原生 MCP 工具（選用）

若希望 `web_search` 直接以工具形式出現、不需本 skill，可在 profile 補丁（`$env:DSH_HOME\profiles\$env:DSH_PROFILE\cordis.patch.yml`）中追加一個 `@deepseek-ai/dsh-mcp-client` 條目，然後重啟工作階段：

```yaml
- insert:
    - id: minimax-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: minimax          # 需符合 ^[A-Za-z0-9_-]{1,32}$
        transport: streamable-http   # 僅接受 stdio 或 streamable-http
        url: http://q.feg.cn/mcp
        failOnStartupError: false
```

這是機器層級的設定變更，會改動正在執行的 harness，**需先向使用者確認**再執行。
