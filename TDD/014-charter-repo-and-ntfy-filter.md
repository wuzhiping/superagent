# 014 — 宪章仓库与事件仓库分开；ntfy 入库按 tag 过滤

日期：2026-11-06。用户两条设计修正：

> 「宪章仓库」与「Gitea 事件仓库」必须分开。
> 不是所有的 ntfy 消息都会入库成卡，那就太乱了，可以过滤比如哪些 tag 的消息入卡。

## 1. 宪章仓库独立成字段

- `src/sources/gitea-config.ts`：`GiteaAccountSchema` 新增 **`charterRepository`**（`owner/name`，可空）。
  `repository` 回归为**事件仓库**（Issue/PR/评论的来源）；`charterPath` 是宪章在**宪章仓库**里的文件路径（默认 `README.md`）。
- `src/app/charter.ts` 的 `giteaCharter()` 只读 `charterRepository`：**空 = 没有 Gitea 宪章**，退回 Kanban 项目描述镜像；
  **不再回退到事件仓库**（这正是「必须分开」的语义）。`publishCharter` 也提交到宪章仓库，写不进时同样退回镜像。
- `src/sources/gitea.ts`：卡片上新增「宪章仓库」字段与说明；「测试连接」在填了宪章仓库时额外检查该仓库存在且可读（宪章文件可以尚未发布，所以不要求文件存在）。
- 本部署配置：`repository=shawoo/PDP`（事件）、`charterRepository=shawoo/rsi_superagent`（宪章，README 即宪章 v12）。

## 2. ntfy 入库按 tag 过滤

- `src/sources/ntfy-config.ts`：新增 **`ingestTags`**（逗号分隔，留空 = 全部）。
- `src/sources/ntfy.ts`：`ingestTagsOf()` / `messageWanted()`；轮询时只有带其中一个 tag 的消息才处理（入库成卡，或 `ingestEvents=false` 时成为请求），
  其余跳过并计数；健康详情显示 `tag filter dsh (N skipped)`。
- 卡片上新增「入库过滤 tag」字段。**宿主的回复 tag 是 `dsh-superagent`**，设 `dsh` 过滤后不会被回收成卡（此前回复可能被再入库）。
- 本部署配置：`ingestTags=dsh`。约定：要让消息入库/成为请求，消息带 `dsh` tag；普通聊天留在 topic，不产生卡。

## 3. 验证

- 单测：`tests/ntfy.spec.ts` 新增 3 条（tag 解析、`messageWanted` 语义、只入库带 tag 的消息并报跳过数）；
  `tests/charter-gitea.spec.ts` 新增 3 条（只读 `charterRepository`、空仓不回退事件仓、独立 `charterPath`）。
  `pnpm exec vitest run tests/ntfy.spec.ts tests/charter-gitea.spec.ts` → **21 passed**；`pnpm typecheck` 干净。
- 线上（部署重装后）：
  - `GET settings`：`repository=shawoo/PDP`，`charterRepository=shawoo/rsi_superagent`，`ingestTags=dsh`；
  - Gitea 健康：`0 card(s) filed in Kanban from shawoo/PDP, reading as wu.zhiping@feg.cn`（事件仓已是 PDP）；
  - `GET narrative`：宪章 `v12`，`carrier=gitea`，`carrierRef=shawoo/rsi_superagent/README.md`（宪章仓仍是 rsi_superagent）；
  - ntfy 过滤实测（`scripts/lib/verify-ntfy-filter.mjs`）：发一条不带 tag 的消息 **不**入库；发一条带 `dsh` tag 的消息**入库成卡**；
    健康详情为 `1 card(s) filed in Kanban from pub_at8x…; tag filter dsh (1 skipped); latest: [filter-test …] tagged`。
  - 验证产生的测试卡已从 RSI 看板 `to-do` 列清掉（`scripts/lib/clear-verification-cards.mjs`，7 张）。

## 4. 影响与注意

- 已有部署升级后 `charterRepository` 默认为空 → 宪章会退回 Kanban 镜像，需要在 Gitea 卡片上填一次宪章仓库（本部署已填好）。
- 事件仓库切回 `shawoo/PDP` 是沿用它原本的配置；要换成别的仓库只需在卡片「仓库」里改，不影响宪章。
- ntfy 过滤是**按消息 tag**，不是按发送者；要更细的信任控制仍靠「入库后由 PM 指派」这条闸门。
