---
name: compact-now
description: 對本機 dsh web 主機執行 /compact（壓縮對話歷史）。當任務做完後需要清掉 session 上下文、或使用者說「/compact」「壓縮對話」時使用。
---

# compact-now

對目前這個 session 執行 DSH 的 `/compact`，把較早的對話歷史壓成一則摘要，之後每輪的 token 成本會明顯下降。

## 為什麼需要這個 skill

`/compact` 是**給人用的斜線指令**：它由 web client 發起，agent 自己在進行中的回合裡呼叫會被拒絕
（host 回 `Compaction is unavailable because this process has an active compaction, or the agent is not idle.`）。
本 skill 用**和 web client 完全相同的 wire protocol** 直接呼叫 host，因此可以在「回合結束、session 閒置」的時候
（例如用背景工作排在自己這一輪結束後）觸發真正的壓縮。

## 用法

```powershell
# 立刻嘗試一次
node .dsh/skills/compact-now/scripts/compact_now.mjs --retries 0

# 回合結束後再壓縮：等 45 秒，之後每 10 秒重試，最多 30 次（約 5 分鐘）
node .dsh/skills/compact-now/scripts/compact_now.mjs --wait 45 --retries 30 --interval 10
```

參數：

| 參數 | 預設 | 說明 |
|:---|:---|:---|
| `--url` | `$DSH_WEB_URL`（`http://127.0.0.1:3080`） | dsh web 主機位置 |
| `--session` | `$DSH_SESSION_ID` | 要壓縮的 session id |
| `--wait` | `0` | 執行前先等幾秒（讓本回合先結束、session 變閒置） |
| `--retries` | `1` | busy／失敗時最多重試幾次 |
| `--interval` | `10` | 重試間隔秒數 |

成功輸出：`[compact-now] Compacted 137 history items (~42110 tokens).`

## 注意事項

- **只能在 session 閒置時壓縮**：agent 正在跑回合 → busy。腳本會自動重試，所以背景工作請設 `--wait`。
- 壓縮會**替換掉較早的對話歷史**，對方（總是摘要）保留關鍵事實但會遺失細節。重要輸出請先落地成檔案。
- 金鑰：`DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session` 記錄。腳本只在記憶體中讀取並簽 cookie，
  **絕對不要把 secret 印出來或貼進對話**。
- 這個 host 是 localhost、owner 權限的 session；不要把這支腳本指向別人的主機。
