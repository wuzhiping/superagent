# 005 — 测试与验收

## 1. 单测矩阵（`tests/kaneo.spec.ts`，11 项，全部通过）

| # | 用例 | 断言 |
| --- | --- | --- |
| 1 | 配置默认值 | projectId=FDEP、watchColumns=ready、claimColumn=in-progress；kind 声明 channel/threadContext/policy |
| 2 | 任务 → 显式 Trigger | id=`key('kaneo', task)`、source=kaneo、human、addressed=direct、actor=assignee、thread=`kaneo:<id>`、text 含票号与标题、channel.address.taskId、url、meta |
| 3 | actor 回退与长描述截断 | assignee 空 → 创建者；都空 → actorFallback；5000 字符描述被截断 |
| 4 | 首次轮询 skip | 不产生 Trigger、写入 seen、`bootstrap=true`、不写 status |
| 5 | 新任务 | 只对未见过的任务产生 1 个 Trigger；一次 PUT 认领到 in-progress；再次轮询不重复 |
| 6 | bootstrap=trigger + requiredLabels | 只触发带 `ai:` 标签的任务 |
| 7 | 列失败隔离 | blocked 列 500 时 ready 列继续读；整轮最终抛错交由 health 统计 |
| 8 | Channel 幂等 | POST 评论含正文与 marker；重试发现 marker 不再 POST |
| 9 | Channel gone | 评论目标 404 → 返回 `gone` |
| 10 | ThreadContext | 描述作为 root、评论作为消息、顺序与作者正确 |
| 11 | REST 客户端 | 429 重试后成功解析；401 不重试直接 `KaneoError(401)` |

运行：

```
pnpm exec vitest run tests/kaneo.spec.ts
Test Files  1 passed (1)
     Tests  11 passed (11)
```

## 2. 受影响既有测试

| 测试文件 | 结果 | 说明 |
| --- | --- | --- |
| `tests/bundle-patch.spec.ts` | 通过（已更新期望） | bundle patch 新增 `dsh-superagent-kaneo` 行；GitHub/Feishu 置 disabled |
| `tests/policy.spec.ts` | 通过（328 项） | `executor.directory` 改为跨平台绝对路径校验 |
| `tests/settings.spec.ts` | 通过（4 项） | 设置分块泛化，未受影响 |
| `tests/locales.spec.ts` | 通过（6 项） | 新增 locale 键成对存在 |
| `tests/model-surface.spec.ts` | 通过（7 项） | — |
| `tests/registry.spec.ts` | 通过（10 项） | SourceKind 注册机制未变 |
| `tests/index.spec.ts` / `tests/health.spec.ts` | 通过 | — |
| `tests/runtime-concurrency.spec.ts` | 通过（56 项） | — |

## 3. 全量测试现状（Windows 基线问题）

`pnpm test`：**1169 passed / 39 failed（10 个文件）**。失败均集中在依赖 POSIX 的测试，与本次改造无关，属 Windows 基线不兼容：

| 类别 | 例子 | 原因 |
| --- | --- | --- |
| 假 CLI 脚本 | `tests/deployment.spec.ts`、`tests/sources.spec.ts` 的 feishu consumer | 测试用 `#!/bin/sh` 写假 `gh`/`lark-cli`，Windows 不能 spawn 无扩展名 shell 脚本 |
| tmux / sleep | `tests/service-script.spec.ts` | `scripts/dsh-superagent` 是 POSIX 脚本，调用 `tmux`、`sleep` |
| git 路径转义 | `tests/runtime.spec.ts` 的 worker-gitconfig 断言 | Windows 反斜杠被 `gitQuote` 双写，与期望字符串不同 |
| 文档表路径 | `tests/docs.spec.ts` | 用 `/` 比较，而 `path.relative` 在 Windows 返回 `\` |
| `tools.restrict` 工具名 | （运行时，不是测试） | Windows 没有 `bash` 工具，主 Session 的 allow 列表硬编码 `bash` → 已修为按平台选择 `pwsh` |

结论：**本次改造相关的测试全部通过**；全量套件的 Windows 失败是上游仓库的既有平台缺口，已在 HANDOFF/TDD 记录，未在本期扩大修复范围（避免改动大量上游测试）。

## 4. 验收矩阵（对照 002 的 DoD）

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| DoD-1 构建/类型 | ✅ `pnpm typecheck` + `pnpm build` 通过 | 构建输出含 `lib/kaneo-watch.js` |
| DoD-2 单测 | ✅ 11/11 | 上文 |
| DoD-3 安装后 setup/health | ✅ `setup.problem=null`、`runtime=ready`、`kaneo=ready` | `TDD/artifacts/state-ready.json` |
| DoD-4 任务 → Ticket | ✅ #470 在 ready 列被提取；Ticket `69732805…`；任务自动进 in-progress | `TDD/artifacts/decisions-accept.json`、`kaneo-task.json` |
| DoD-5 评论回写 | ✅ ack + result 两条评论（含幂等 marker） | `TDD/artifacts/kaneo-comments.json` |
| DoD-6 文档/回滚 | ✅ HANDOFF + TDD/004 回滚步骤 | 本文档与 004 |

## 5. 未覆盖 / 二期建议

1. **任务完成后列推进**：未实现（可观测 ticket `ended` 后把任务移到 `qa`）。
2. **任务链接**（2026-11-13 已解决）：改为 Kanban 实际路由 `…/project/<projectId>/board?taskId=<taskId>`，并补单测；原先「未验证的 `?task=`」候选已废弃。
3. **评论作者身份**：当前是 API key 所属用户；建议专用 agent 账号 + 专用 key。
4. **多项目/多列**：schema 已支持 `watchColumns` 多列与 `projectId` 配置，但未做多实例联调。
5. **Kanban webhook**：当前为轮询；Kanban 若有变更 webhook，可替代轮询降低延迟/请求数。
6. **Windows 全量测试**：若长期在 Windows 开发，建议给上游测试加 `process.platform` 分支与 `cross-spawn`。

## 6. 快速复验命令

```powershell
# 单测
pnpm exec vitest run tests/kaneo.spec.ts

# 运行实例健康
$h=@{ 'x-orchestrator-request'='1' }
(Invoke-WebRequest "http://127.0.0.1:3080/orchestrator/api/state" -Headers $h -UseBasicParsing).Content
(Invoke-WebRequest "http://127.0.0.1:3080/orchestrator/api/sources" -Headers $h -UseBasicParsing).Content

# Kanban 侧确认任务被认领/评论（用 skill 脚本）
node .dsh\skills\kaneo-mcp\scripts\kaneo_mcp.mjs tasks dgctny8ibgpn72ei2j8qj2hc --column in-progress --all
```
