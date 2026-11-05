# 011 · 项目宪章、价值流成长与清理中心

> 2026-11-05。这一轮把用户几条校正落到代码：**Kanban 统一命名**、**宪章是项目级共享文档**、**价值流在复盘里长出来**、**清理工作区**、**凭据从存储记录读**、**Gitea 免账号**。

## 1. 用户校正（原话）

| 校正 | 落到哪里 |
| --- | --- |
| 「Kanban 统一叫 Kanban」 | 文档与面板文案统一改名为 **Kanban**（代码标识保留原样）✅ |
| 「宪章是基于项目而不是岗位的，是分布在不同主机的 Superagent 共同的宪章，基于项目 pipeline 和 VSM 价值观，由多个岗位共同遵守的。每个项目应该是只有一份最新的」 | 宪章 = **项目的 `description`**；发布=替换；所有 Host 读同一份 ✅ |
| 「颁布工作宪章频率修正 不高于 次/周」 | **每周至多一版**；面板显示下次可发布时间；PM 可显式覆盖 ✅ |
| 「工作区列表膨胀的厉害，是否可以有个集中的地方，在人工确认审核部署的交付物之后，清理管理」 | 新增**「清理」页**（PM 视角）：列出已结束职责的工作区、大小、session 数、是否有交付物；人确认后清 ✅ |
| 「参考 dsh-minio-s3 使用 Mask Key 获取权限；同理 /BDD/API/AI/dsh/storage/kaneo /ntfy /gitea」 | 新增 `src/sources/bdd-storage.ts`：本机 `refs.*` 遮蔽后 POST 存储端点 → 服务凭据；**Kanban 卡片不填 key 也能跑** ✅ |
| 「gitea 可以工作，只需要服务器地址和仓库名称，不一定需要账号」 | Gitea 匿名可读：无账号不发 Authorization；401 给可读错误 ✅ |
| 「Kanban 项目 RSI (at8xrho…) 是我 init 出来的空项目，flow state 是默认的，使用它来验证完成一个 pipeline 的成长过程」 | `scripts/lib/rsi-pipeline-growth.mjs` 真实验证 ✅ |
| 「Kanban 的管理粒度是 工作区->项目->任务」「职责不是任务，职责需要匹配任务」 | RD §4.1 / §5 表述校准 ✅ |

## 2. 宪章：项目级共享文档

**存储**：宪章正文就是项目的 `description`（`PUT /project/{id}`，服务端要求整份项目字段，所以先读回再只改 description）。

| 动作 | 行为 |
| --- | --- |
| 读 | `GET /project/{id}` → `description`；30 秒缓存；读不到时退回本机档案（离线旁证）✅ |
| 发布 | 读当前宪章的 `version` → +1 → **盖章** `version/publishedBy/publishedAt` 三行 → 写回项目 → 本机档案追加旧版历史 ✅ |
| 频率 | `publishWindow(publishedAt)`：7 天内再次发布会 **400** 并告知下一次可发布时间；`force: true` 显式覆盖 ✅ |
| 分发 | 每台 Host 读同一个项目 → 同一份宪章；开工的工单把 `charterVersion` 钉住 ✅ |

面板：「设置 → 项目与岗位 → 宪章」写草稿 → 「发布宪章」（失败时出现「仍然发布（覆盖每周一次的限制）」）。

## 3. 价值流成长（RSI 项目，真实验证）

`node scripts/lib/rsi-pipeline-growth.mjs --reset`，输出（2026-11-05）：

```
reset: removed "QA 驗收" (qa-驗收) from the board
1. board: to-do "To Do", in-progress "In Progress", in-review "In Review", done "Done"
2. charter v6 published onto the project (452 chars)
3. the board grew: qa-驗收 "QA 驗收"
4. drift before the charter confirms it: added=[qa-驗收] aligned=false
5. second publication inside the week: refused ({"error":"A project's charter changes at most once a week; …")
   charter v7 published with the PM's override
6. board now: to-do, in-progress, in-review, done, qa-驗收
   declared  : to-do, in-progress, in-review, done, qa-驗收
   drift added=[] removed=[] aligned=true
   charter: v7 shared=true nextPublishAt=2026-11-12T02:40:51.582Z
```

这条输出就是用户要的「pipeline 成长过程」：**默认流程 → 复盘发现缺环 → 在 Kanban 里加列 → 面板看见漂移 → 宪章确认 → 重新对齐** ✅。

## 4. 清理中心

`GET maintenance` / `POST maintenance/clean`（PM 视角「清理」页）。

- 只列**已结束**职责；目录、大小（有上限，超限标 `sizeCapped`）、session 数、顶层文件、是否有交付物 ✅
- 默认只勾选「已结束 + 可清 + 无交付物」；**有交付物的行必须人工点** ✅
- 「同时删除工作区文件夹」默认不勾；删除前 `realpath` 校验（必须在执行根下、不是 stateDir/盘根、拒绝符号链接逃逸）✅
- **Session 日志不删**：`sessionPersistence` 没有 delete API；只统计、只解除工作区登记 ✅

线上实测（2026-11-05）：

```
GET /orchestrator/api/maintenance
  workspaces=27  count=27  bytes=27
  row: {ticketId, state:"ended", outcome:"completed", directory, workspaceExists:true,
        sizeBytes:14, sessions:1, files:["kaneo-3src.txt"], deliverable:false, removable:true,
        reasons:["ended","directoryExists","unreferenced","unregistered"]}
```

27 个已结束职责留下了 27 个工作区——正是用户说的「膨胀」；现在集中可清 ✅。

## 5. 凭据：从存储记录读（Masked Key）

`src/sources/bdd-storage.ts`：

```
本机 refs.AIFE_API_KEY → maskKey() = "sk-" + base64(key@ISO8601)
  → POST https://abc.feg.com.tw/BDD/API/AI/dsh/storage/{kaneo|gitea|ntfy|s3}
  → { API_KEY } / { GIT_URL, EMAIL, PASSWD } / { uid, pwd }
```

实测（不打印密钥）：

```
/storage/kaneo  HTTP 200  { mode:"iframe", REDIRECT_URL:"/dashboard", API_KEY:"gIl…(64 chars)" }
/storage/gitea  HTTP 200  { GIT_URL:"https://git.feg.cn", EMAIL:"…", PASSWD:"…(11 chars)" }
/storage/ntfy   HTTP 200  { name:"Shawoo", uid:"jinbe", pwd:"…(10 chars)" }
```

接入点：启动时预热（在 setup 之前）→ Kanban 卡片 `apiKey` 为空时，setup 用存储记录里的 key；看板读取、回写、入库、capabilities 全部有回退 ✅。凭据只在内存，不写设置文件、不进面板、不打日志 ✅。

## 6. Gitea 免账号

无账号 → 不发 `Authorization`；公开仓库可读 issues/PRs/评论；`/notifications` 与写评论仍需账号（实测匿名 401）。真实探测（`scripts/lib/probe-gitea-anon.mjs`）：

```
version: status=200 version=1.27.3
repository: status=200 private=false
issues: status=200 count=0 / pulls: status=200 count=0
[refused without an account] notifications: status=401
```

## 7. 测试

| 套件 | 结果 |
| --- | --- |
| `typecheck` | ✅ |
| `bdd-storage` | 12 ✅ |
| `charter-publish`（盖章 + 每周上限） | 5 ✅ |
| `maintenance` / `panel-maintenance` | 8 + 3 ✅ |
| `gitea` / `kaneo` | 22 + 16 ✅ |
| `narrative` / `panel-posts` / `panel-settings` / `http` | ✅ |
| 用户故事（11 条） | 见 [010](010-user-stories-validation.md) |

## 8. 尚未做

| 项 | 说明 |
| --- | --- |
| ntfy / Gitea 卡片也用存储凭据 | provider 已支持，但 ntfy/gitea 的 source 内部还没接 fallback（Kanban 已接）❓ |
| 交付物自动进 MinIO | 执行会话能用 `minio_*` 工具；「上传 → 取回链接 → 回写卡片」的固定约定还没写进提示词与卡模板 ❓ |
| 宪章历史可视化 | 历史保存在本机档案；面板只列版本号，没有逐版对比 ❓ |
| 多 Host 实机演练 | PM（admin key）与 Worker（member key）各一台还没跑过 ❓ |
