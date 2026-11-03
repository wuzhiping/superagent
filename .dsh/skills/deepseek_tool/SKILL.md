---
name: deepseek_tool
description: 透過 MCP 端點 http://q.feg.cn/sse 上的 DeepSeek Scout 服務進行真實網路搜尋與單頁抓取。當使用者說「搜尋／查找／抓這個網頁」、需要即時新聞（含陸系媒體）、或需對單一 URL 取 Markdown 全文時使用。fess 引擎封頂時可作為備援。
whenToUse: 需要網際網路即時資訊（新聞、價格、發布、人物／公司資料）、需要抓取指定 URL 的 Markdown 內容、或 fess bing news 當下不可用且需要替代搜尋來源時。
---

# deepseek_tool

呼叫 MCP 端點 `http://q.feg.cn/sse` 上的 **DeepSeek Scout v4.x** 服務，支援兩個工具：

| 工具 | 用途 | 必填 | 選填 |
| --- | --- | --- | --- |
| `deepseek_search` | 真實網路搜尋，回結構化結果 | `query` (1–128 字元) | `count` (1–50, 預設 10)、`ori_question`、`localization` (IP)、`need_content` |
| `deepseek_fetch` | 抓單一網頁，以 Markdown 格式回傳 | `url` (含 host, ≤8192 字元) | — |

> **端點固定為 HTTP。** 該主機的 HTTPS 上並無相同入口；若日後有 HTTPS 變體可用環境變數 `MCP_DEEPSEEK_URL` 覆寫。

## 第一步：使用腳本（建議）

腳本位於本 skill 目錄下的 `scripts/deepseek_tool.js`（Node.js ≥ 18，使用內建 `fetch`，無第三方相依套件）。

### 搜尋

```powershell
node scripts/deepseek_tool.js search "OpenAI Anthropic 2026-10"
node scripts/deepseek_tool.js search "DeepSeek V4" --count 5
node scripts/deepseek_tool.js search "華為 AI" --count 3 --localization "CN"
node scripts/deepseek_tool.js search "OpenAI news" --json
node scripts/deepseek_tool.js search "Anthropic Claude" --raw
node scripts/deepseek_tool.js search "Anthropic Claude" --quiet
```

| 指令 | 用途 |
| --- | --- |
| `node ... search "查詢詞"` | 文字結果（預設最多 10 筆） |
| `--count <n>` | 結果筆數 1–50（預設 10） |
| `--localization <ip>` | 偏好的本地化 IP，例如 `CN`、`US` |
| `--need-content` | 在 `content` 欄位回傳完整正文 |
| `--json` | 輸出正規化 JSON |
| `--raw` | 輸出完整 MCP payload（除錯用） |
| `--quiet` | 每筆只輸出「標題<TAB>連結」 |

### 抓取單一網頁

```powershell
node scripts/deepseek_tool.js fetch "https://example.com/article"
node scripts/deepseek_tool.js fetch "https://example.com/article" --json
node scripts/deepseek_tool.js fetch "https://example.com/article" --raw
```

| 指令 | 用途 |
| --- | --- |
| `node ... fetch <url>` | 回 Markdown 純文字 |
| `--json` | 輸出 `{ url, markdown }` 結構化 JSON |
| `--raw` | 輸出完整 MCP payload |

結束碼：`0` 成功，`1` 呼叫失敗（連線／JSON-RPC／服務端錯誤），`2` 參數錯誤。

## 第二步：不依賴腳本的裸呼叫

此 MCP 為 Streamable HTTP（session-based），**必須三步**：

```powershell
$base = "http://q.feg.cn/sse"
$h = @{ "Content-Type" = "application/json"; "Accept" = "application/json, text/event-stream" }

# 1) initialize —— 從回應標頭取 mcp-session-id
$r = Invoke-WebRequest -Uri $base -Method Post -Headers $h -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}'
$h["mcp-session-id"] = $r.Headers["mcp-session-id"]

# 2) initialized 通知（回 202 空內容，正常）
Invoke-WebRequest -Uri $base -Method Post -Headers $h -Body '{"jsonrpc":"2.0","method":"notifications/initialized"}' | Out-Null

# 3) 真正呼叫
Invoke-WebRequest -Uri $base -Method Post -Headers $h -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"deepseek_search","arguments":{"query":"OpenAI news today","count":3}}}'
```

> PowerShell 直接內嵌 JSON 時，引號容易被參數解析吃掉而送出壞掉的內容；若遇 `Parse error`，請改用腳本或以檔案傳遞（`curl --data-binary @payload.json`）。

### 回應解析（三個陷阱）

1. **是 SSE，不是裸 JSON**：回應內容形如 `event: message` 加 `data: {...}`，必須取 `data:` 之後那行再解析。
2. **雙重 JSON 編碼**（search 結果）：真正的結果是 `result.content[0].text` 內的 JSON 字串，需第二次 `JSON.parse`：

```
data.result.content[0].text  ->  '{"results":[{ "title", "url", "summary", "snippet", "date", "authority", "rerank_score" }], ...}'
```

3. **必須以 UTF-8 解碼**：中文結果是 UTF-8；用預設編碼讀取會出現 `è´¢ç»` 這類亂碼。Node 的 `fetch` 搭配 `res.text()` 會自動以 UTF-8 解碼。

### 結果結構（`deepseek_search`）

```json
{
  "results": [
    {
      "title": "標題",
      "site_name": "The Next Web",
      "site_icon": "https://cdn.deepseek.com/site-icons/...",
      "authority": 3,
      "rerank_score": 2.10,
      "date": "2026-10-16T16:00:00+00:00",
      "url": "https://...",
      "summary": "# Markdown 摘要\n...",
      "snippet": "純文字摘要",
      "content": "（需 --need-content 才會回傳完整正文）"
    }
  ]
}
```

`authority` 為 0–5 的網站權威度分數；`rerank_score` 為模型重排分數。`date` 可能為 `null`（部分陸系媒體未提供結構化時間）。

### 結果結構（`deepseek_fetch`）

回傳 Markdown 純文字；可直接寫到 `.md` 檔或送入後續 LLM 處理。

## 搜尋策略

- **3–5 個關鍵詞**效果最好，不要塞整句話。
- 時效性議題**把日期寫進 query**，例如 `AI 新聞 2026-10`，能明顯提升新鮮度。
- 一次沒結果就**換詞重試**（同義詞、英文、縮小範圍），不要重複同一個 query。
- 陸系／中文新聞搜尋：用中文關鍵詞 + 必要時加 `--localization CN`。
- 引用結論時附上 `url`，並留意 `date` 判斷資訊是否過期。

## 與 fess / web_search 的分工

- **fess**：原本主力的 bing news 搜尋（`engines=bing%20news`）；優勢是新聞橫切面廣，但 2026-10 起多次遇到引擎封頂（brave/duckduckgo/google suspended）。
- **web-search**：另一個 MCP 端點 `http://q.feg.cn/mcp` 的 `web_search` 工具；通用搜尋。
- **deepseek_tool（本 skill）**：當 fess 封頂時的備援；陸系媒體命中較佳（測試回傳含 `yicai.com`、`tkww.hk` 等）。

建議優先順序：fess（最即時）→ deepseek_tool（fess 失敗時）→ web-search（通用）。

## 疑難排解

| 現象 | 原因／處理 |
| --- | --- |
| `Parse error`／JSON-RPC 錯誤 | 請求內容被 shell 轉義破壞，改用腳本或 `--data-binary @payload.json` |
| 缺少 `mcp-session-id` 而失敗 | 沒做第 1 步握手，或未把回應標頭回填到後續請求 |
| 回應中找不到 JSON | 忘了剝掉 SSE 的 `data:` 前綴 |
| 中文亂碼 | 以 UTF-8 解碼 |
| `無法連線至` 端點 | 端點不通，確認 `http://q.feg.cn/sse` 可達後再重試 |
| `tools/call` 回 401/403 | 認證問題；此端點目前為 open，若日後加認證需透過 `Authorization: Bearer <key>` header |

## 附：註冊為原生 MCP 工具（選用）

若希望 `deepseek_search` 直接以工具形式出現，可在 profile 補丁（`$env:DSH_HOME\profiles\$env:DSH_PROFILE\cordis.patch.yml`）中追加條目：

```yaml
- insert:
    - id: deepseek-scout
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: deepseek-scout
        transport: streamable-http
        url: http://q.feg.cn/sse
        failOnStartupError: false
```

這是機器層級的設定變更，會改動正在執行的 harness，**需先向使用者確認**再執行。
