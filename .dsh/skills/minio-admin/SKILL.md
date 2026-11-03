---
name: minio-admin
description: 用 mc 操作 MinIO 叢集的「管理面」——建／刪桶、建／停用／刪使用者、建立與綁定 IAM policy（自訂或內建）、群組、用真帳號實測權限、排查 AccessDenied。當使用者要「建桶」「開帳號／加使用者」「設權限／授權」「加 policy」「看有哪些使用者／桶」，或出現 AccessDenied／Insufficient permissions 時使用。只涉及物件上下傳、清檔、預簽連結（不碰權限）時，改用 minio-file skill。
whenToUse: 需要在 MinIO 上做帳號、policy、桶層級的變更，或排查存取被拒時。
---

# minio-admin

MinIO 管理面（帳號與權限）的一鍵流程＋指令速查。

## 邊界：什麼用這個、什麼用 minio-file

| 需求 | 用哪個 |
| --- | --- |
| 物件上下傳、列前綴、預簽連結、單桶帳號 | `minio-file` skill（`minio.mjs`） |
| 建桶、建使用者、設 policy、授權、排查拒絕 | **本 skill**（需要 MinIO 管理員權限） |

## 本機環境（皆已實測）

| 項目 | 值 |
| --- | --- |
| mc 執行檔 | `D:\Refine\Books\ntop\AI\mc\mc.exe`（也在 PATH 上） |
| mc 設定檔 | `D:\Refine\Books\ntop\AI\mc\.mc\config.json` |
| alias `admin` | `http://oss.feg.cn`（root 權限，**管理面用這個**） |
| alias `public` | 同一端點、無金鑰（唯讀公開用） |
| 伺服器 | MinIO `2024-11-07T00:52:20Z`，3 節點（10.161.236.101-103:7000）、6 drives、EC 3 |
| 桶 | abc / agi / aife / conf / dbs / dok / dsh / langfuse / listmonk / memos / nas / openviking / pkbs / ateam |
| 既有使用者 | `dsh` → `dsh-rw`；`ateam` → `ateam-rw` |
| 內建 policy | consoleAdmin / readonly / readwrite / writeonly / diagnostics |

管理面指令前綴一律是 `mc admin ...`，且 `mc admin` **只對 MinIO 有效**（AWS S3 走 IAM，`mc admin` 對 `s3` alias 全數失敗）。

## 兩支腳本（本 skill 的主路徑）

兩支都是 **ASCII-only**（訊息英文，說明在此文件）。改動時務必維持純 ASCII，原因見「坑 6」。

### 1. `scripts/grant.ps1` — 一次做完：桶 → policy → 使用者 → 綁定

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '.dsh\skills\minio-admin\scripts\grant.ps1' -User ateam -Secret 'maeta@2026' -Bucket ateam,dsh -ReadOnlyBucket aife"
```

| 參數 | 說明 |
| --- | --- |
| `-Alias` | 目標 alias，預設 `admin` |
| `-Bucket` | 可讀寫的桶（會一併建立） |
| `-ReadOnlyBucket` | 只可讀的桶 |
| `-User` / `-Secret` | 使用者名 / 密碼（**密碼須 8–40 字元**，太短在送出前就擋下） |
| `-PolicyName` | policy 名，預設 `<user>-rw` |
| `-PolicyOut` | policy JSON 落地位置，預設 `.\<policy>.json` |
| `-SkipBucketCreate` / `-SkipUserCreate` | 不建桶 / 不建使用者（只改權限時用） |

依序做：`mc mb` → 產生 policy JSON（唯讀桶只給 `ListBucket`+`GetObject`，可讀寫桶再多給 Put/Delete/multipart）→ `mc admin policy create` → `mc admin user add` → `mc admin policy attach`，最後印出 `mc admin user info` 與下一步驗證指令。

### 2. `scripts/verify.ps1` — 用真帳號實測權限

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '.dsh\skills\minio-admin\scripts\verify.ps1' -User ateam -Secret 'maeta@2026' -Bucket ateam,dsh -ReadOnlyBucket aife -DeniedBucket memos"
```

掛一個暫時 alias，用**該帳號本身**實跑 `ls` / `put` / `get` / `rm`，逐項比對預期並印表格；有任何不符 → 印紅字並 exit 1。暫時 alias 與測試檔會自動清除。

> 用 `-Command "& '…'"` 的形式，不要用 `-File`：`-File` 不會把 `ateam,dsh` 拆成陣列。
> 唯讀桶的 `get` 檢查會挑桶內第一個既有物件（`mc ls --recursive --json` 取 key）；桶是空的就跳過 get。

## 手動指令速查

**桶**

```powershell
mc mb --ignore-existing admin/<bucket>          # 建（已存在不報錯）
mc mb --with-versioning admin/<bucket>          # 開版本控管
mc rb admin/<bucket>                             # 刪（必須空桶）
mc rb --force admin/<bucket>                     # 連物件一起刪
mc ls admin/                                     # 列所有桶
```

**使用者**

```powershell
mc admin user add admin <user> <secret>          # 新增（也可 mc admin user add admin 互動輸入）
mc admin user list admin
mc admin user info admin <user>
mc admin user enable  admin <user>
mc admin user disable admin <user>
mc admin user remove admin <user>
```

**Policy**

```powershell
mc admin policy list admin
mc admin policy create admin <name> <policy.json>
mc admin policy attach admin <name> --user  <user>
mc admin policy attach admin <name> --group <group>
mc admin policy detach admin <name> --user  <user>
mc admin policy entities admin <name>             # 誰綁了這條
mc admin policy info admin <name>                 # 看內容
mc admin policy rm admin <name>
```

**群組**

```powershell
mc admin group add admin <group>
mc admin group set admin <group> <policy>
mc admin group remove admin <group>
mc admin group list admin
```

## 權限模型（三個必知）

1. **MinIO policy 是 allow-only**：沒列到的動作一律拒絕。唯讀桶只要不給 `PutObject`/`DeleteObject` 就自然寫不進去，**不需要額外 Deny**。
2. **剛建立的使用者沒有任何 policy ＝ 完全不能存取任何桶**（連 `mc ls` 都會被擋）。必須 attach 才算數。
3. **bucket 層與 object 層要分開寫**：`s3:ListBucket` 的 Resource 是 `arn:aws:s3:::桶`，`s3:GetObject` 是 `arn:aws:s3:::桶/*`。只寫 object 那條 → 連列出都會被擋。

## 六個實測過的坑

1. **密鑰至少 8 字元**：MinIO 回 `The secret key is invalid. (secret key length should be between 8 and 40)`。`maeta` 只有 5 個 → 直接被拒。
2. **命令列帶密碼會進 shell history**：改用 `mc admin user add admin`（互動式）或 `echo` 管線。
3. **桶名不能有底線**：`_` 只能用在前綴；桶名只允許小寫字母／數字／句點／減號，且須字母或數字開頭結尾。
4. **這個 mc 版本沒有 `mc mv --rename`**：搬移前綴要用 `mc mv --recursive 舊/ 新/`（S3 沒有 rename，本質是 copy+delete）。
5. **`mc admin` 只對 MinIO 有效**：AWS S3 要走 IAM。
6. **PS 5.1 讀「無 BOM」的 .ps1 會用 ANSI 解碼**：中文常值會讓整支腳本解析失敗（`The string is missing the terminator`）。本 skill 腳本因此一律 ASCII-only；用 PS 7（`pwsh`）則不受影響。

## 排查 AccessDenied

| 症狀 | 原因 | 處理 |
| --- | --- | --- |
| `Unable to list folder. Access Denied.` | policy 缺 `ListBucket`，或桶名不在 Resource | `mc admin policy info admin <policy>` 確認有 `arn:aws:s3:::桶` 那條 |
| `Insufficient permissions to access this path`（PUT） | 唯讀桶沒給 `PutObject` | 加 `s3:PutObject` 與 `arn:aws:s3:::桶/*` |
| 全部拒絕 | 使用者沒 attach 任何 policy | `mc admin user info admin <user>` 看 `PolicyName` 是否為空 |
| 用 dsh-minio-s3 面板的單桶帳號操作別的桶 | 該帳號只有單桶權限 | 預期行為，改用 admin alias |

## 已落地（2026-10-26）

- 桶 `ateam`、使用者 `ateam`（密碼 `maeta@2026`）、policy `ateam-rw`：**ateam + dsh 讀寫、aife 唯讀**，已用 `verify.ps1` 實測 12 項全過。
- policy JSON 留檔於工作目錄 `ateam-rw.json`（`grant.ps1` 產出的版本預設也落在當前目錄）。
