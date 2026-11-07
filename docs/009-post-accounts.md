# 008 — 岗位机器人账号：统一创建规范与接线

> 目标：每个**岗位**（PM / Worker）有一个**专属的 Kanban 用户**，作为它在看板上的身份；账号在 Kanban 里**统一创建**，
> 再逐个设置到对应的 SuperAgent 实例。依据见 [`../RD.md`](../RD.md) §12.8、§12.9 与 [`../TDD/008-real-data-validation.md`](../TDD/008-real-data-validation.md) 的实测结论。

> 面板「项目与岗位设置」里不再要求填 Kanban 使用者 id：填**登录邮箱**即可，宿主保存档案时用工作区成员列表映射成 `kaneoUserId`（`kaneoUser` 字段）。本节的账户文件仍按 id 描述，两种写法并存。

---

## 1. 为什么必须有专属账号（实测依据）

| 实测 | 结论 |
| --- | --- |
| Kanban 的 `assignee` 是**单值**（`PUT /task/assignee` 只接受一个 `userId`） | 一个岗位 ↔ 一个 Kanban 用户，才能让"按负责人拉单"成立 |
| `assignee` 必须是 **workspace 成员**（否则 404） | 账号必须先加入 ATEAM 工作区 |
| 现有 API key 属于**人类管理员**（`吳思平` / role=admin） | 不能直接当岗位身份：责任归属、日志审计、撤权都会算到人头上 |
| REST `/admin/users`、成员管理对 API key 返回 **403**；无发 key 接口 | **建号与发 key 必须在 Kanban UI 里由管理员完成**，工具侧只能"验证 + 接线" |
| pipeline 看板 0/8 有 assignee、靠 `agent:pm/bi/api/ux` 角色标签合流 | 岗位归属需两层：**主责 assignee + 协同角色标签** |

---

## 2. 命名与清单规范

**命名**：`<团队>-<角色>-<序号>`，全小写、连字符，例如 `sa-pm-1`、`sa-w1`、`sa-w2`。

| 岗位 | 建议数量 | Kanban 用户名 | 邮箱 | 角色（Kanban role） | SuperAgent 实例 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| PM 岗位 | 每项目 1（可 +副） | `sa-pm-<project>` | `sa-pm-<project>@feg.cn` | member（仅看 + 派工 + 改列） | 实例 A | 流程治理、派工、异常处理、颁布宪章 |
| Worker 岗位 | 每项目 1..N | `sa-w<n>-<project>` | 同上 | member（最小权限） | 实例 B、C… | 按 assignee 拉单、开岗位职责、回写日志与产出 |
| 观察者 | 0..1 | `sa-observer-<project>` | 同上 | viewer | 不部署 | 只读看板，用于审计与复盘 |

**清单文件**：`config/post-accounts.json`（仓库内，**不含密钥**；密钥放在仓库外，如 `keys/*.key`）。

```json
{
  "workspaceId": "lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o",
  "baseUrl": "https://pl.feg.cn",
  "posts": [
    {
      "postId": "pm-pipeline",
      "role": "pm",
      "projectId": "wwo9d2mmqddjq8otbj8jh2hs",
      "name": "SuperAgent PM (pipeline)",
      "email": "sa-pm-pipeline@feg.cn",
      "kaneoUserId": "",
      "apiKeyFile": "keys/sa-pm-pipeline.key",
      "giteaUser": "sa-pm-pipeline",
      "ntfySender": "#sa-pm-pipeline",
      "ntfyTopic": "pub_pipeline_pm",
      "watchColumns": "to-do,in-progress,blocked",
      "claimColumn": "in-progress"
    },
    { "postId": "w1-pipeline", "role": "worker", "projectId": "wwo9d2mmqddjq8otbj8jh2hs", "...": "同上" }
  ]
}
```

---

## 3. 管理员建号步骤（Kanban UI）

1. 用管理员账号登录 Kanban → **设置 → 用户** → 新建用户：用户名、邮箱、密码（**一次性随机强密码**）、先不分配 API key；
2. 进入 **工作区 ATEAM → 成员** → 把新用户加入，角色按 §2 表（PM/Worker 用 `member`）；
3. 为每个用户 **设置 → API keys** 生成独立 key，**每个 key 只给一个岗位**；
4. 把 key 存到仓库外的 `keys/<postId>.key`（一行、无空格），并把用户 id 填回 `config/post-accounts.json` 的 `kaneoUserId`；
5. 若该岗位要读写**私有** Gitea 仓库、读 agent 通知或回写评论，把该用户的邮箱/密码（或 API token）同步到对应 SuperAgent 实例的 **设置 → 来源 → Gitea**；只读公开仓库可以留空，匿名即可。

> ⚠ **不要**把 key 提交进仓库，也不要把 key 写进任务描述、评论或 Session 文本。

---

## 4. 接线到各个 SuperAgent 实例（逐实例）

每个 SuperAgent 实例 = 一个 DSH profile（自己的 `stateDir`、自己的凭证）。接线在**实例自己的面板**里做：

| 设置页字段 | 取值 |
| --- | --- |
| 来源 → Kanban → 服务器 | `https://pl.feg.cn` |
| 来源 → Kanban → API key | 该岗位的 key（`keys/<postId>.key` 内容） |
| 来源 → Kanban → 项目 id | 该岗位负责的 `projectId`（**按项目**，pipeline 与 FDEP 不同） |
| 来源 → Kanban → 监听列 | 该项目实际存在的列（pipeline **没有 `ready`**，用 `to-do,in-progress,blocked`） |
| 来源 → Kanban → 认领列 | `in-progress` |
| 来源 → Gitea | 公开仓库只填服务器地址 + 仓库名（账号留空 = 匿名只读）；私有仓库、notifications 模式或要回写评论才填邮箱 + 密码 / API token |
| 来源 → ntfy | 该岗位的 topic（私有 topic 用账号 + 密码；公开 `pub_` 为低信任） |

改完点「**测试连接**」，通过才保存；随后重启该 profile 进程（或刷新 + 重新加载插件）。

### Gitea：公开仓库免账号（匿名只读）

Gitea 来源按仓库可见性选两种用法，**公开仓库不需要账号**：

| 场景 | 服务器地址 | 仓库 | 邮箱 / 密码 / token |
| --- | --- | --- | --- |
| 公开仓库（如 `shawoo/PDP`） | `https://git.feg.cn` | `owner/name` | **全部留空**：匿名读 Issue / PR / 评论 |
| 私有仓库，或要读 agent 通知 | `https://git.feg.cn` | `owner/name` | 必填：邮箱 + 密码（HTTP Basic），或 API token |
| 公开仓库但要回写评论 | `https://git.feg.cn` | `owner/name` | 必填：匿名只能读，发评论需要账号或 token |

- **连接测试**：无账号时读该仓库 1 条 Issue + 1 条 PR 判断可达（仓库关闭 PR 时按 404 容忍）；有账号时先 `GET /user` 验证登录。
- **拒绝不静默**：匿名请求被 401/403 拒绝时报「该仓库可能需要账号：填写 Gitea 邮箱和密码（或 API token）」，不会当成 0 条事件。
- **健康信息**：来源状态写明 `reading … anonymously` / `reading as <登录名>` / `reading with an API token`。
- **notifications 模式必须带账号**；默认的仓库增量模式匿名即可。
- 实测（2026-11-05）：`https://git.feg.cn` + `shawoo/PDP` 匿名读 issues / pulls / comments 均 `200`；匿名调 `/notifications` 返回 `401`；可复跑 `scripts/lib/probe-gitea-anon.mjs`。

**批量验证**（无需人工逐个点）：

```powershell
node scripts/post-accounts.mjs --roster config/post-accounts.json --out config/post-profiles.json
```

它会用每个岗位的 key 调 `GET /user/me`，输出**岗位档案**（岗位 ↔ Kanban 用户 ↔ Gitea 账号 ↔ ntfy sender ↔ 监听列），
并打印每个实例要粘贴的设置值；缺 key 或 key 失效的岗位标记为 `pending` / `failed`。

---

## 5. 身份与权限约定

| 约定 | 规则 |
| --- | --- |
| 一岗一账号 | 一个 Kanban 用户 ↔ 一个岗位；一台 SuperAgent 宿主可承担一个或多个岗位（组合自由，默认一个） |
| assignee = 主责 | 主责唯一，决定谁推进状态；协同角色用标签 `role:<name>` |
| 评论署名 | 岗位在评论里带 `【agent:<postId>】`，与看板既有 `agent:pm/ux/bi` 惯例一致 |
| 最小权限 | Worker 用 `member`；只读岗位用 `viewer`；PM 才需要改列/改负责人 |
| 撤权 | 岗位停用时：先清空其 `assignee` 与 `role:` 标签，再撤 key；历史工单保留岗位署名 |
| 交接 | PM 换人：新账号 + 更新 `config/post-accounts.json` + 在旧岗位评论里留「移交」记录（宪章里保留作者历史） |

---

## 6. 与实施的关系

- 岗位档案（`config/post-profiles.json`）是**跨实例共享**的真相，因此**不能**放在某个实例的本地配置里；
- 现有实现里 Kanban Source 是**全局单例配置**（一个 `apiKey` + 一个 `projectId`），
  多岗位多项目需要升级为「**按项目档案**」，这是 RD.md §11.3 差距表里"项目维度：大"的具体落点；
- 在改造完成前，单实例部署可以**先**用某一个岗位的 key 跑通（等价于"一个实例扮演一个岗位"），符合 §12.1-4 的默认设定。
