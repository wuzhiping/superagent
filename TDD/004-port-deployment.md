# 004 — 移植与部署（实际执行记录）

> **⚠ 2026-11-03 状态更新**：按用户要求，**部署已回滚**（`plugin_manager remove_bundle` + 还原 profile patch；当前 web profile 未安装本插件，`/orchestrator/api/state` 返回 404）。
> 本文记录回滚前的探索性安装过程与实测结果，仅作参考；后续按 [REPORT.md](../REPORT.md) 的分阶段方案重新评审，不默认沿用。

目标：把改造后的 bundle 构建并以 **DSH bundle** 形式安装到 **web profile**（`D:\Refine\Books\ntop\AI\dsh\profiles\web`，DSH_HOME=`D:\Refine\Books\ntop\AI\dsh`），配置 Kanban Source，并端到端验证。

## 1. 前置与版本

| 项 | 值 |
| --- | --- |
| Node | v24.19.0 |
| pnpm | 11.7.0（构建用）；profile 安装时由 DSH 调用 pnpm 12.15.0 |
| DSH | 0.2.1-rc.5（`engines.dsh ^0.2.1-alpha.2` 满足） |
| 目标 profile | `D:\Refine\Books\ntop\AI\dsh\profiles\web` |
| 运行端口 | 3080（现有 GUI 进程） |
| 状态目录 | `D:/Refine/Books/ntop/AI/dsh/state/superagent` |

## 2. 构建

```powershell
cd C:\Users\shawoo\Desktop\feg.cn\dsh-superagent-prototype
pnpm install                      # 4m12s（registry.feg.cn）
pnpm typecheck                    # 通过
pnpm exec vitest run tests/kaneo.spec.ts   # 11/11 通过
pnpm build                        # 产物 lib/index.js、lib/kaneo-watch.js 等
```

构建产物确认包含 `lib/kaneo-watch.js`（21.6 KB）与 `.d.ts`。

## 3. 安装（plugin_manager install_bundle）

先备份 profile：

```powershell
$p="D:\Refine\Books\ntop\AI\dsh\profiles\web"
$bak="$p\.dsh-superagent-backup-<yyyyMMdd-HHmmss>"
Copy-Item "$p\package.json","$p\cordis.patch.yml","$p\pnpm-lock.yaml","$p\pnpm-workspace.yaml","$p\cordis.yml" $bak
```

安装前在 profile 的 `cordis.patch.yml` 末尾加入 **stateDir 配置**（bundle patch 只插入插件行，stateDir 由 profile 提供；否则 Config 校验失败）：

```yaml
- id: dsh-superagent
  config:
    stateDir: D:/Refine/Books/ntop/AI/dsh/state/superagent
```

然后调用 DSH 的 `plugin_manager`：

```
action: install_bundle
target: C:\Users\shawoo\Desktop\feg.cn\dsh-superagent-prototype
```

结果：`application: applied`，`warnings: []`。它自动完成了：

- profile `package.json` 增加 `"dsh-superagent": "link:C:/Users/shawoo/Desktop/feg.cn/dsh-superagent-prototype"`；
- `dsh.profile.bundles` 末尾增加 `dsh-superagent`；
- 在 profile 中执行 pnpm install（2.5 s）。

> 警告（已知、可接受）：pnpm 提示 link 依赖不会从目标 node_modules 解析 peerDependencies；本仓库自带 `node_modules`（含 `@deepseek-ai/*` alpha 版本），运行时实际从仓库路径解析。实测插件可正常加载。

## 4. 配置（管理 API）

管理 API：`http://127.0.0.1:3080/orchestrator/api/`，必须带 `x-orchestrator-request: 1`，Host 为 127.0.0.1:3080。

### 4.1 Kanban Source

```powershell
PUT /orchestrator/api/settings/source:kaneo
{
  "value": { "enabled": true, "config": {
    "baseUrl": "https://pl.feg.cn",
    "apiKey": "<64-char Kanban API key>",
    "projectId": "dgctny8ibgpn72ei2j8qj2hc",
    "workspaceId": "lDarCeUJYbUhFu3xotTtH5Q3QTWTcQ9o",
    "watchColumns": "ready",
    "claimColumn": "in-progress",
    "bootstrap": "skip",
    "requiredLabels": "",
    "pollSeconds": 60,
    "failuresBeforeError": 3,
    "maxTasksPerColumn": 50,
    "actorFallback": "kaneo"
  } },
  "revision": 0
}
→ {"saved":true,"revision":1,"policy_changed":false,"restarting":true,"context_delivery":"pending"}
```

保存时执行 Kanban 账号检查（`GET /task/tasks/{projectId}?limit=1`），随后 `restarting:true` 触发插件重启；重启后 setup 成功、runtime `ready`、Kanban 轮询开始。

### 4.2 Policy（允许发起任务的 Kanban 用户）

```powershell
PUT /orchestrator/api/settings/policy  (revision 0)
value.rules = 默认两条规则（copy / visual）
value.sources.kaneo.allowed = [
  {"id":"bsFdwgQXqZpYKvD5E2emqQ5TQ81eJ3zG","name":"吴志平"},
  {"id":"WbFvOy6jsTJLSboCZ0zkJyEUicvlpf7K","name":"郑琪俊"},
  {"id":"yO6O7gZ2PCnrvwGwvW2PUmEHuTxx7VvE","name":"解雨心"},
  {"id":"7y0EgcTw0zZpFyv55BW1OWNpJWz7ZAV7","name":"王常军"},
  {"id":"7MaRbnd6MeY6wgXAPGF1NfObpcDWTcbZ","name":"高洁"}
]
→ {"saved":true,"revision":1,"policy_changed":true,"restarting":false,"context_delivery":"injected"}
```

> 注意：PowerShell 直接以字符串 POST 会把中文按本地编码写入，导致 allowed 的 `name` 变成 `???`。第二次用 `[System.Text.Encoding]::UTF8.GetBytes($body)` + `-ContentType 'application/json; charset=utf-8'` 重存后正确（revision 2）。**操作时请用 UTF-8 字节体。**

其余 block（`eval`、`executor`）保持默认：`mode=observe`、`maxWorkers=3`、`directory=""`（即 `<stateDir>/work`）、`prepare=""`。

## 5. 验证结果

### 5.1 冷启动 / setup

```json
GET /orchestrator/api/state
setup.problem = null
health.runtime = {"state":"ready","detail":"Orchestrator is ready"}
health.kaneo   = {"state":"ready","detail":"0 new tasks from ready; next poll ≥ 60s"}
setup.accounts = {"repository":"","agent":"","feishu":null}
```

（`repository`/`agent` 为空是预期：Kanban-only 部署没有 GitHub 账号。）

### 5.2 端到端（烟雾任务）

1. 在 FDEP 的 `待辦池` 创建测试卡 **#470**（assignee=吴志平），随后 `PUT /task/status/{id}` 移到 `ready`。
2. 一个轮询周期内：
   - Source `stats.received = 1`；
   - 任务被自动移到 `in-progress`（claimColumn 生效）；
   - Thread `kaneo:fhsw6n9ggq5r3t5al1ccxwjl` 建立，Decision `accept`（`explicitRouted`，strength=explicit）；
   - Ticket `69732805abc10876a80b8570718f6ed2` 创建，Executor Session `worker-69732805...` 启动。
3. Worker 在执行目录 `D:\Refine\Books\ntop\AI\dsh\state\superagent\work\kaneo-smoke-test-69732805abc1` 创建 `smoke.txt`（内容 `kaneo-e2e-ok`），report `ready`，Ticket `ended/completed`。
4. 任务评论收到两条 agent 消息（带 `<!-- dsh-superagent:<id> -->` 幂等标记）：
   - 收到：`收到：在工单执行目录里新建 smoke.txt...`
   - 结果：`已完成：smoke.txt 已在工单执行目录创建...`
5. 验证后删除测试卡 #470（`DELETE /task/{id}`），确认 404。

证据文件（`TDD/artifacts/`）：
- [`ticket-69732805.json`](artifacts/ticket-69732805.json)
- [`state-ready.json`](artifacts/state-ready.json)
- [`decisions-accept.json`](artifacts/decisions-accept.json)
- [`kaneo-task.json`](artifacts/kaneo-task.json)
- [`kaneo-comments.json`](artifacts/kaneo-comments.json)

### 5.3 干净冷重载

删除调试代码并最终构建后，通过 `plugin_manager set_plugin` 先禁用再启用 `include:dsh-superagent`：

```
disable → applied；warning: dsh-superagent-kaneo pending (waiting for service: orchestrator)
enable  → applied；warnings: []
state   → setup.problem=null, runtime=ready, kaneo=ready
```

## 6. 回滚

1. 用备份覆盖 profile 的 `package.json`、`cordis.patch.yml`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`：
   ```powershell
   $p="D:\Refine\Books\ntop\AI\dsh\profiles\web"; $bak="$p\.dsh-superagent-backup-<stamp>"
   Copy-Item "$bak\package.json","$bak\cordis.patch.yml","$bak\pnpm-lock.yaml","$bak\pnpm-workspace.yaml" $p -Force
   ```
2. 在 profile 目录执行 `pnpm install`。
3. 重启 DSH web 进程（或等其重载）——**注意本插件不能热卸载 profile 依赖**；若 GUI 报插件加载错误，重启进程即可恢复备份状态。
4. 可选：删除状态目录 `D:/Refine/Books/ntop/AI/dsh/state/superagent`（含 sqlite、锁、work 目录）。
5. 确认 `/orchestrator/api/state` 不再返回（或 GUI 无 Superagent 入口）。

> 回滚会丢失 dsh-superagent 已记录的 Trigger/Ticket 历史（在 stateDir sqlite 中）。若要保留，先备份 `orchestrator.sqlite`。

## 7. 运维注意

| 主题 | 现状 | 说明 |
| --- | --- | --- |
| 隔离性 | 装进活动 web profile（用户要求） | 上游建议独立 profile。本插件在无 GitHub 时**不修改进程环境**（跳过 worker shim/git 配置），面板/Session/状态目录均独立；主要风险是与 profile 现有插件共享进程与重启。 |
| 首次轮询 | `bootstrap: skip` | 首次轮询把 `ready` 列已有任务记为已见、不产生请求；任务第一次进入监听列才成为请求（一任务一次）。 |
| 认领 | `claimColumn: in-progress` | Trigger 入库后立即把任务移到该列；置空可关闭。若 Eval 后来忽略，任务仍停在认领列，需人工移回。 |
| 评论身份 | API key 的所属用户（吴志平） | 没有独立 bot 身份；如需区分，请为 agent 建专用 Kanban 账号并签发独立 API key。 |
| 完成后的列推进 | 未实现 | 目前只做「认领」，不自动进 qa/done；可作为二期（在 poll 中观察 ticket ended 后移动）。 |
| 任务链接 | 未验证 | 当前用 `…/dashboard/<workspace>/project/<projectId>?task=<taskId>`；Kanban SPA 路由未实测，必要时修正 `kaneoTaskUrl`。 |
| 限流 | 60s/列 | API key 每分钟 100 次；当前 1 列 = 每轮 1 次读 + 认领写。 |
| 日志 | 进程控制台 | DSH web 未写文件日志；排障可通过管理 API 的 `health` 与临时诊断代码定位。本次定位到的重启失败是 `tools.restrict() names unknown global tool "bash"`（Windows），已修。 |
