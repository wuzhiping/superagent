# 012 — 宪章归 Gitea、任务归 Kanban、消息归 ntfy、资产归 MinIO

日期：2026-11-06。用户设计调整（逐条对照）：

| 用户要求 | 落地 |
| --- | --- |
| 1. 设置里的 Gitea 地址是**宪章的来源**，暂定 README.md 是宪章入口和主体 | Gitea 来源卡片新增「宪章文件（仓库内路径）」字段（默认 `README.md`）。`src/app/charter.ts` 的 `readGiteaCharter()` 从仓库 contents API 读该文件，要求文档自带 `version:` 行（否则视为没有宪章）；`publishCharter()` 用 PUT contents 提交带版本戳的正文，提交信息 `charter vN: <发布者>`。Kanban 项目描述降级为**镜像**：Gitea 未配置或写被拒时写入，返回值带 `carrier` / `carrierRef` 让面板说明落点。 |
| 2. Kaneo/Kanban 是任务来源 | 不变：Kanban 卡片仍是唯一的派工来源，`prompts/work.md` 的「看板由宿主写」规则不变。 |
| 3. ntfy 是实时消息渠道 | 不变：ntfy 消息入库为卡片，回复发回 topic。 |
| 4. MinIO S3 是数据资产的补充，也要一个类似设置 | 新增来源类型 `s3`（`src/sources/s3.ts`、`s3-config.ts`、`s3-api.ts`；bundle 行 `dsh-superagent-s3` → `s3-watch`）：字段为 endpoint / bucket / accessKey / secretKey / region / prefix / 巡检间隔。**不产生任务**，只做配置与 `list-type=2` 自检；卡片留空即用存储记录，密钥不落设置文件。 |
| 5. 默认使用 Masked Key 与 `BDD/API/AI/dsh/storage/xxxx` 获取设置，允许修改 | `src/sources/bdd-storage.ts` 增加 `storedGiteaAccount` / `storedNtfyAccount` / `storedS3Account`；`setup.ts` 为 Gitea / ntfy 在卡片凭据为空时用记录值建账号；S3 在每次探测前 `storedConnections.warm(['s3'])`（插件自己的 bundle 有自己的 provider 实例，不能依赖 runtime 的预热）。卡片随时可逐字段覆盖。 |

## 过程中暴露并修掉的问题

1. `s3-watch` 与 `index` 是两个 bundle，`bdd-storage` 的模块级缓存**不共享**：S3 卡片一开始永远 paused。修法：S3 自己 warm，并让探测结果决定状态（not configured → paused，其余 → error）。
2. 本机 MinIO 集群要求 region `us-west-rack-2`：客户端第一次 400 时从 `AuthorizationHeaderMalformed ... expecting ...` 里取 region 并重试，卡片无需填 region。
3. 宪章发布不带 blob sha 时 Gitea 拒绝替换已存在文件（发布落到 Kanban 镜像）。修法：`putFile` 返回新 sha；发布前始终读取当前 sha，409 / 422 时重读重试一次；成功发布把 sha 写回缓存。
4. PowerShell 的 `Invoke-WebRequest -Body <string>` 会把中文写成 `?`，一次验证发布污染了 README（v10）；从 archive 历史恢复干净 v9 后用 Node fetch（UTF-8）重发为 v11。**验证脚本一律用 Node 发请求。**

## 验证

- `tests/charter-gitea.spec.ts`（5 条）与 `tests/s3.spec.ts`（7 条）全绿；typecheck 干净。
- 线上：S3 卡片 `ready — ateam: 5 object(s) readable …`，`POST sources/s3/test` 返回 `{"ok":true}`。
- 线上：发布 RSI 宪章 → `carrier=gitea`，`shawoo/rsi_superagent/README.md` 提交 `charter v11: pm-rsi`，FFFD=0；`GET narrative` 读回 `carrier=gitea`、`ref=shawoo/rsi_superagent/README.md`。
- Gitea 卡片仍 ready（`shawoo/rsi_superagent`）；Kanban、ntfy 不变。

## 仍待用户决定

- 宪章仓库就是「Gitea 来源卡片上的仓库」，改它会同时影响 Gitea 的事件来源；若希望「宪章仓库」与「事件仓库」分开，可加一个字段而不是拆卡片。
