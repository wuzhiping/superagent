# 009 · 叙事化面板改造（编队页 / 项目与岗位）与 SOP 交付

> 时间：2026-11-04　范围：`dsh-superagent` 管理面板（客户端 bundle）+ 使用入门指南（SOP.md / SOP.html）
> 目标：让面板的结构与 [RD.md](../RD.md) 的叙事一致——项目 / 岗位 / 宪章 / 职责 / 异常，而不是"来源 + 触发 + 评估"的技术流水线。
> 前置：[008-real-data-validation.md](008-real-data-validation.md)（真实数据基线）、[RD.md](../RD.md) §4–§8、§11.5、§12.8–§12.9。

---

## 1. 叙事 → 面板的映射

| RD.md 的概念 | 面板落点 | 实现 |
| --- | --- | --- |
| 项目 Project（§4） | 设置 → 项目与岗位 | `src/app/narrative.ts` 的 `ProjectArchive`（`<stateDir>/projects.json`） |
| 岗位 post（§5） | 编队页的岗位卡片 | `ArchivePost`：role / kaneoUser（登录邮箱，宿主映射） / kaneoUserId / giteaUser / ntfySender / wipLimit / instance |
| 岗位职责 duty（§5.3） | 岗位卡片的「在飞职责」 | `Ticket.postId`（新字段） |
| 宪章 charter（§8） | 项目卡片的「宪章 vN」徽标 | 实时读 Kanban 宪章载体任务，解析 `version: N`，>7 天判过期 |
| WIP 合规 | 岗位卡片 `n / limit`，超限红框 | `dutyCount > wipLimit` |
| 异常队列（§8 异常处置） | 编队页底部 | 等人回复 / 阻塞 / 失败 / 六小时无进展 四类 |
| 产出路由（§7） | 工单上的 `deliverableType` | 由 Kanban 标签 `kind:<code\|doc\|plan\|memo\|log>` 推出 |

---

## 2. 改动清单

**宿主侧（host）**

| 文件 | 改动 |
| --- | --- |
| `src/app/narrative.ts`（新） | 项目档案 schema（zod）、读写、版本号并发保护、岗位↔actor 映射、职责行、异常行、宪章解析、工单盖章 `enrichTicket` |
| `src/app/views/narrative.ts`（新） | 组装叙事视图：项目 → 岗位 → 在飞职责 → 宪章（Kanban 实读，失败降级为 stale） |
| `src/app/api.ts` | 新增 `GET narrative`、`GET project-archive`、`PUT project-archive` |
| `src/app/http.ts` | 三条路由；档案写入失败（并发/校验）返回 400 |
| `src/app/runtime.ts` | `prepareTicket` 钩子串上 `enrichTicket`：新工单自动带上 postId / projectId / deliverableType / charterVersion |
| `src/core/model.ts` | `Ticket` 新增 `postId` / `projectId` / `deliverableType` / `charterVersion` |

**客户端侧（panel）**

| 文件 | 改动 |
| --- | --- |
| `src/client/route.ts` | 顶层页签新增 `posts`（编队）；设置分组新增 `project`（项目与岗位，排在最前） |
| `src/client/posts.tsx`（新） | 编队页：项目卡（宪章徽标 / 监听列 / 仓库集 / 主题集）＋岗位卡（身份 / 实例 / WIP / 职责列表）＋异常队列 |
| `src/client/project.tsx`（新） | 项目与岗位设置页：项目与岗位的增删改、仓库集/topic 集拆分、保存（带 revision） |
| `src/client/overview.tsx` | 概览新增「队伍」摘要：岗位数 / 在飞职责 / 异常数 / 宪章新鲜度 |
| `src/client/locales.ts` | 新增中英文案（扁平 key，避免破坏字典类型） |
| `src/client/client.css` | 新增样式；顺带修掉一处历史的多行规则（`styles.spec.ts` 由此转绿） |

### 2.1 第二阶段：两种面板视角（PM / 岗位）

需求：面板提供两种"风格"，对应 PM 与岗位两种角色，可随时切换；**后台逻辑保持统一**。

实现（全部在客户端，后端接口与数据结构不变）：

| 文件 | 改动 |
| --- | --- |
| `src/client/perspective.tsx`（新） | 视角上下文：`pm` / `post`，存在 `localStorage`；岗位视角另存"我是哪个岗位"；`usePerspective()` 供各页使用 |
| `src/client/route.ts` | `TABS_BY_PERSPECTIVE`、`SETTINGS_GROUPS_BY_PERSPECTIVE`、`HOME_BY_PERSPECTIVE`：岗位视角少一个"评估"页签与设置分组，首页落在"我的职责" |
| `src/client/app.tsx` | 右上角视角开关；页签按视角取集合与文案（编队→我的岗位、执行→我的职责）；切到没有的页面时回到该视角首页 |
| `src/client/posts.tsx` | 岗位视角只显示所选岗位的卡片、职责与"我的异常"；未选岗位时先给"我是哪个岗位"选择器 |
| `src/client/overview.tsx` | 岗位视角把"队伍"摘要换成"我的岗位"摘要（在飞职责 n/limit、我的异常、Kanban 身份、宪章） |
| `src/client/project.tsx` | 岗位视角只显示自己的岗位且可编辑；项目字段只读（项目归 PM 管） |

关键约束：**没有新增任何后端接口**——两个视角读的是同一个 `GET narrative` / `GET project-archive`，写的是同一个 `PUT project-archive`。视角是**读法**，不是第二套系统。

测试：`tests/panel-perspective.spec.tsx`（6 项）覆盖默认视角、切换后的页签/分组/落地页、同一宿主、座位选择与只显示自己的岗位、英文文案。

---

## 3. 测试证据

### 3.1 单元与面板测试（新增）

| 用例 | 结果 |
| --- | --- |
| `tests/narrative.spec.ts`（7 项） | ✅ 档案读写与版本号、并发拒绝、岗位↔actor 映射、宪章版本与过期、工单盖章（postId/projectId/deliverableType/charterVersion）、职责与异常行 |
| `tests/panel-posts.spec.tsx`（4 项） | ✅ 编队页渲染（宪章徽标、岗位、WIP、异常队列）、从岗位打开职责、设置页保存档案、概览队伍摘要 |

命令：`pnpm exec vitest run tests/narrative.spec.ts tests/panel-posts.spec.tsx` → `11 passed`。

### 3.2 回归

| 套件 | 结果 |
| --- | --- |
| `tests/panel-overview.spec.tsx` | ✅ 13/13（更新了页签列表、概览统计与章节断言） |
| `tests/panel-settings.spec.tsx` | ✅ 6/6（更新了设置分组断言） |
| `tests/styles.spec.ts` | ✅ 2/2（顺手修掉历史多行规则） |
| `tests/panel-source.spec.tsx` / `panel-deployment.spec.tsx` / `client.spec.tsx` | ⚠️ 5 项**既有失败**（与本次改动无关） |

> 既有失败基线（改动前后一致，已用 `git stash` 逐项比对确认）：
> `tests/runtime.spec.ts` 91 项、`tests/sources.spec.ts` 6 项、`tests/service-script.spec.ts` 15 项、
> `tests/panel-source.spec.tsx` 3 项、`tests/panel-deployment.spec.tsx` 1 项、`tests/client.spec.tsx` 1 项。
> 其中 panel/client 的失败源于**产品名从 `dsh-superagent` 改名为「超级智能体」后测试期望未同步**；
> runtime/sources/service-script 的失败源于本机 dev 环境（"Restriction names a non-inherited tool" 等），与业务逻辑无关。

### 3.3 真实部署验证（web profile，127.0.0.1:3080）

档案已写入真实状态目录 `D:/Refine/Books/ntop/AI/dsh/state/superagent/projects.json`（FDEP 项目 + PM/Worker 两个岗位）。

```
GET /orchestrator/api/narrative
configured=True projects=1 posts=2 duties=0 exceptions=0 overLimit=0
project FDEP (FDE) charter=v1 stale=False detail='The charter is current'
  post pm-fdep  role=pm     duties=0/3 instance=web kaneo=bsFdwgQX…
  post w1-fdep  role=worker duties=0/3 instance=    kaneo=(未建号)
GET /orchestrator/api/project-archive → revision=657656810 projects=1 posts=2
```

> 「宪章 v1 / The charter is current」是**实时从 Kanban 宪章载体任务读到的**（`GET /api/task/{id}` 解析 `version: N`），
> 不是写死的占位值；读取失败会降级为"过期/不可读"而不是报错。

浏览器实测（headless Chrome + CDP）：面板页签为 `总览 | 编队 | 来源 | 触发 | 评估 | 执行 | 设置`，
编队页显示 FDEP 卡片、绿色「宪章 v1」徽标、PM/Worker 两张岗位卡（Kanban 身份、实例、在飞职责 0/3）、异常队列 0。
截图：`_shots/gui-posts.png`、`_shots/sop-*.png`。

---

## 4. 已知边界

1. **在飞职责目前为 0**：本地实例没有产生过真实工单（Kanban 任务 → 工单的映射已在代码与单测覆盖，但线上未跑过一条完整链路）。
2. **岗位身份靠 Kanban assignee id 匹配**：Kanban 不提供"用户 → 岗位"查询，档案里的 `kaneoUserId` 必须与看板 assignee 一致；不一致时职责不会归到任何岗位。
3. **宪章读取走 Kanban 实时请求**（8 秒超时、失败降级），面板每次刷新会读一次；高频刷新时建议沿用 10 秒轮询。
4. **MinIO 仍只有执行会话可写**：文档类产出由执行会话上传、岗位取链接回写，本期未做自动回写。
5. **仓库集 / topic 集目前只是登记**：动态增删（Gitea 仓库上下线、ntfy topic 订阅变更）还没有自动化通路（RD.md §9、§10 的 ❓ 项）。

---

## 5. 交付物

| 交付物 | 说明 |
| --- | --- |
| `SOP.md` | PM 岗位 / 岗位两个角色的使用入门指南（上线准备 → 日/周循环 → 认领与交付 → 异常处置 → 检查清单 → 限制） |
| `SOP.html` | PPT 标准美化版（1280×720 设计画布等比缩放、键盘翻页、进度条、打印为 16:9 每页一张），15 页 |
| `src/client/posts.tsx`、`src/client/project.tsx` | 编队页与项目/岗位设置页 |
| `src/app/narrative.ts`、`src/app/views/narrative.ts` | 项目档案与叙事视图（宿主侧） |
| `scripts/cdp-shot.mjs` | 用 headless Chrome + CDP 截图面板/文档，便于回归取证 |
