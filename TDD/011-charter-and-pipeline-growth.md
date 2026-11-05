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

## 4.5 项目从列表里选（2026-11-05 用户校正）✅

「设置中，项目的 id 使用 API 获取列表，人工选择相关项目数据」✅：

- 新增 GET projects（宿主路由）：GET /workspace → 每个工作区 GET /project?workspaceId=…，60 秒缓存；无账号时给出原因而不是空列表 ✅
- 面板两处都不再手打 id：**来源卡 → Kanban 项目**（	ype: pick，选中项目自动填 workspaceId）、**项目与岗位 → 项目**（选中填 id/名称/slug）✅
- 真实结果（本机部署）：

`	ext
GET /orchestrator/api/projects
  workspaces: ATEAM, FEIT
  projects: FDEP/FDE/dgctny8ibgpn72ei2j8qj2hc | pipeline/PIP/wwo9d2mmqddjq8otbj8jh2hs
            | Superagent/RSI/at8xrho45bisco2umjzgl1xp
`

测试：projects（列表/缓存/失败原因）、panel-projects（两处选择器，含「列表读不到时保留当前项目」）✅

## 4.6 交付物存 MinIO，进度与结果回 Kanban ✅

### 做法

- **worker 拿得到对象存储工具**：`WORK_TOOLS` 增加 `minio_list / minio_read / minio_write / minio_bucket`（`src/app/sessions.ts`）✅
- **提示词写明载体规则**（`prompts/team/delivery.md`）：非代码交付物（`kind:doc/plan/memo/log`）写好文件 → `minio_write` 到
  `deliverables/$DSH_SUPERAGENT_KANEO_PROJECT/$DSH_SUPERAGENT_TICKET/<file>` → `minio_read` 读回确认 → 报告里给 `bucket/key`；
  **卡片只留进度与结果，不贴文件本体**；修订覆盖同一 key ✅
- **看板由宿主写**（`prompts/work.md` 新规则 + 实测教训）：worker **不调用看板 API / CLI** 去搬卡、评论；它报告 `ready`，
  宿主把结果写成评论并把卡片推进到交付列 ✅

### 真实闭环（FDEP 看板，2026-11-05）

```text
card td2r7vrup3yvrqv3a3pj9sn3  status=done  comments=2
  --- 04:45:37 收到：…看板由宿主回写。
  --- 04:46:44 交付物已存入对象存储并读回确认：
      `ateam/deliverables/dgctny8ibgpn72ei2j8qj2hc/99541661d0f401b11776cb838e67579f/delivery.md`

ticket 99541661d0f401b11776cb838e67579f  state=ended  assignment=ended

MinIO  store deliverables/*: 2
  deliverables/dgctny8ibgpn72ei2j8qj2hc/99541661d0f401b11776cb838e67579f/delivery.md   (701 bytes, etag 0cddb5e6…)
  deliverables/dgctny8ibgpn72ei2j8qj2hc/9e5e256c6a9d4b6398efa49f2b38e971/delivery.md   (748 bytes)
```

一键复跑：`node scripts/lib/minio-delivery-e2e.mjs 900`（建卡 `kind:doc` → 指派 → ready → 等宿主回写 → 校验对象真的在桶里）。

### 这一轮抓到的两个真问题

| 问题 | 现象 | 修正 |
| --- | --- | --- |
| **worker 自己去搬卡** | 第一轮它把「完成后把卡片推进到交付列」当自己的活，下载 kaneo MCP CLI、派子代理翻 MinIO 找 dsh CLI 文档，70 多步还没停 | 提示词明确「看板由宿主写」，卡描述也改成「报告 ready，别动看板」；第二轮约 70 秒完成 ✅ |
| **看板自动化抢在轮询前** | FDEP 的自动化把进入 `ready` 的卡约 20 秒就搬去 `in-progress`，而来源 60 秒轮询一次 → 漏掉 | 验证脚本先收窄 `pollSeconds=15` 再建卡，跑完还原 ✅（真实使用建议：PM 指派后保持在 `ready` 至少一个轮询周期，或把 `in-progress` 也纳入监听列）|

## 4.7 暂停面板里的权限门禁（2026-11-05 下午）⏸ —— **2026-11-06 已恢复**

用户要求：**暂停 PM 视角、岗位视角的权限控制和验证**。做法是把**面板那一半**停掉，服务端能力保留：

| 停掉的 | 保留的 |
| --- | --- |
| 切换 PM 视角前的「这个账号没有管理流程权限，仍要切换吗？」确认弹窗 | `GET capabilities` 路由与 `src/app/capabilities.ts`（账号、角色、`canManageFlow`，`tests/capabilities.spec.ts` 仍在跑）|
| 编队页 / 设置页顶部的权限横幅（`.dt-permission`） | 宿主启动时的账号自检逻辑（不拦截任何动作，只报告）|
| 客户端 `src/client/capabilities.tsx`（Provider、`permissionLines`、`PermissionBanner`） | RD §4.1 的设计说明（重启用时照此恢复）|

**行为变化**：PM 视角与岗位视角对**任何账号**都直接可进——不询问、不显示横幅；其余一切不变（视角仍是只读视图，真正改看板流程仍要 workspace admin 的账号，Kanban 自己会拒绝 member）。

**2026-11-06 恢复**：用户要求「如果切换到 PM 岗位需要验证权限是否匹配」，门禁按原设计恢复（切到 Team 视角前查 `canManageFlow`、不匹配先弹确认、Team 视角内常驻横幅）；同一轮还加了「没有宪章不可开工」的主机侧闸门与岗位视角的「我的岗位设置」。见 TDD/015。

**怎么恢复**：`git revert <本提交>`（改法脚本 `scripts/patch-pause-permissions.mjs` 记录了每一处改动），再把 `dt-permission` 样式与 `permission*` 文案加回来即可；服务端接口一直在，不用动。

**测试**：`panel-perspective` 改成「两种视角都不询问」；`panel-posts` 改成「两个视角都不显示横幅」；`capabilities`（服务端）保持 ✅。

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
