# 016 — 职责规格：宪章仓库里的 `duties.md`、`duty:` 标签与岗位简报

日期：2026-11-06。用户需求：讨论岗位职责设置（PM 一个职责就够；Worker 可能有多个，如需求分析 RML、PRD、UI、API、PDP 授权、部署、Doc），
再提出「**不要职责类型目录**」（通用系统，职责从宪章得到基本定义 + 可个性化，不可写死），以及「**尽可能避免本地 Host 过多的设置动作**」。

## 1. 定案

- **没有职责目录、没有每台 Host 的职责设置**：职责说明是项目治理内容，放在**宪章仓库里与宪章并列的 `duties.md`**（路径由宪章文件推导：`README.md` → `duties.md`，`docs/charter.md` → `docs/duties.md`；不加新配置字段）。
- 卡片用 `duty:<id>` 标签声明「这张卡是哪类职责」；`duty:` 不属于任何项目的卡不设闸门（向后兼容）。
- 岗位通过 `duties.md` 里的「承接岗位：<岗位 id>」声明自己承接哪些职责——**全项目一份、按仓库提交历史演进**，本地岗位设置不增加任何字段。
- 宿主在**接受**时校验并解析：职责未定义 → `dutyUndefined`；职责由别的岗位承接 → `dutyUnsupported`；两条接受路径（评估接受与主会话显式派工）共用同一闸门。拒绝时变成带理由的忽略，**不建工单**。
- 通过闸门后，宿主把该职责的**简报（brief）**写进派工说明（`ticket.execution.assignment`），随工单快照固定；简报含目标、完成定义、交付载体、宪章关注点、先读什么、接单检查、步骤、常见坑、工具与技能，最后一句要求开工先 `orchestrator_read charter` 并报版本。
- 新增 `orchestrator_read duty` 资源：岗位可读自己这张卡职责的完整规格与简报（不依赖 shell/HTTP，也不需要 Gitea 凭据）。
- 面板：设置 → 项目与岗位 里新增「职责说明」区块——从 Gitea 读取、解析预览、编辑并**发布（一次 commit）**；岗位卡片只读显示「职责：…」。**没有新增任何 Host 配置项**。

## 2. 数据结构（`src/app/duties.ts`）

```ts
interface DutySpec {
  id: string; name: string                       // 卡片 duty:<id> 与标题
  goal: string; done: string[]; carrier: string  // 目标 / 完成定义 / 默认交付载体
  charterFocus: string[]                         // 该职责要重点看的宪章条款
  knowledge: string[]; resources: string[]       // 知识、资源分配
  tools: string[]; skills: string[]              // 工具、技能分配（只收紧，不放大权限）
  intake: string[]; steps: string[]; pitfalls: string[]  // 接单检查、步骤、常见坑
  posts: string[]                                // 承接岗位（空 = 任意岗位）
}
```

`duties.md` 的格式宽松（`### <id> · <名称>` + `- 字段：值`），解析器忽略未知字段与散文；中英文字段名都认（`承接岗位`/`posts`、`目标`/`goal`、`完成`/`done`、`载体`/`carrier`、`宪章关注`/`charterFocus`、`知识`/`knowledge`、`资源`/`resources`、`工具`/`tools`、`技能`/`skills`、`接单`/`intake`、`步骤`/`steps`、`常见坑`/`pitfalls`）。

## 3. 代码落点

| 文件 | 变化 |
| --- | --- |
| `src/app/duties.ts`（新） | 解析、Gitea 读取（30s 缓存）、发布（commit 带 sha，409/422 重试）、`dutyGate`、`dutyBrief`、`dutiesPathOf` |
| `src/core/ports.ts` | accept outcome 增加 `brief?: string` |
| `src/core/model.ts` | `Ticket.duty?: string` |
| `src/executor/dsh.ts` | `ticketExecution` 把 brief 追加到派工说明 |
| `src/app/narrative.ts` | 从 `duty:` 标签取职责；`DutyRow.duty` |
| `src/app/assessment.ts` | `AssessorHost.duty?`，`dutyOutcome`（accept → 带理由的 ignore / 带 brief 的 accept） |
| `src/app/tools/main.ts` | `MainToolsHost.duty?`，`orchestrator_route` 的 accept 过闸门并携带 brief |
| `src/app/runtime.ts` | `dutyGate` 闭包（档案 + 宪章目标）、职责资源读取 |
| `src/app/resources.ts` | `orchestrator_read duty`（worker） |
| `src/app/http.ts` + `src/app/api.ts` | `GET duties`（解析结果 + 原文 + 载体）、`POST duties`（发布提交） |
| `src/client/project.tsx` + locales + css | 「职责说明」区块：预览、编辑、发布；岗位卡片显示承接的职责 |
| `src/core/reasons.ts` | `dutyUndefined`、`dutyUnsupported` + 面板文案 |
| `prompts/work.md` | 派工里的 Duty brief 是这次职责，按它做并报职责 id |

## 4. 验证

- 单测 `tests/duties.spec.ts`（9）：解析、路径推导、有/无职责、未定义、岗位不承接、无卡标签旁路、`dutyOutcome`、简报长度。
- 相关既有测试：`assessment`、`tools`、`resources-charter`、`panel-projects`、`panel-perspective`、`panel-posts`、`styles`、`locales` 共 62 条通过；typecheck 干净。
- 线上闭环试运行（脚本 `scripts/lib/trial-duty-flow.mjs` + `scripts/lib/trial-duty-gate.mjs`，产物 `TDD/artifacts/duty-gate-20261106010704.json`）：
  1. `POST duties` 把职责说明提交到 `shawoo/rsi_superagent/duties.md`（sha `207eacca`），`GET duties` 解析出 2 个职责（`doc`、`req-analysis`，各自承接岗位 `pm-rsi`）；
  2. 创建 `duty:doc` 卡（#19，指派 PM 岗位、进 `to-do`）→ 接受为工单 `0272751b01f60ddae0cca01c1b7c9adb`；
  3. 岗位报告确认收到 **Duty brief**：「职责：duty id `doc` · 名称「文档交付」，carrier `doc`；卡片带 `duty:doc`，与派工说明中的 Duty brief 一致」，宪章版本 v12、载体 `shawoo/rsi_superagent/README.md`；交付到 MinIO `deliverables/at8xrho45bisco2umjzgl1xp/0272751b01f60ddae0cca01c1b7c9adb/duty-trial.md`（3443 字节，回读校验），卡片到 `done`；
  4. 再创建 `duty:no-such-duty` 卡（#21）→ 宿主在同一触发上记录 `dutyUndefined` 的 **ignore**（`/decisions` 可见，01:08:20），**没有建工单**（open tickets 前后都是 0），随后删除该卡。
- 结论（首版）：职责说明无需任何 Host 设置即可被所有 Host 读同一份；卡片声明职责后，宿主能拒绝错配、把职责简报送进岗位并完成一次真实交付。

## 5. 后续（未在本版）

- 职责的**工具/技能收紧**目前是简报里的分配说明（提示），尚未与执行环境的工具白名单联动强制；下一步接 `policies/executor` 的工具面。
- 「职责 × 岗位」矩阵、按职责的 WIP/列映射、`depends:` 链、一键下一步建卡。
- 宪章与 `duties.md` 的一致性提示（职责 id 在宪章提要里缺失时提示补齐）。
