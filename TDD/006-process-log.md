# 006 — 过程日志

按实际执行顺序记录关键操作、命令与结果（时间 Asia/Shanghai，2026-11-03）。敏感信息（API key）不在此记录。

## 阶段 A：解读与环境勘察

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 12:47 | 确认工作目录、git 历史 | 单提交 `6337fc8 feat: add the dsh-superagent research prototype`；无 `node_modules`/`lib` |
| 12:48 | 读 `README.md`、`SETUP.md`、`package.json`、`cordis.patch.yml` | 确认是 DSH bundle：三 Host 插件 + client 面板 + 两个 agent preset |
| 12:50 | 定位 DSH home/profile | `DSH_HOME=D:\Refine\Books\ntop\AI\dsh`；活动 profile=`profiles\web`（3080，含 kaneo-web 等本地 bundle） |
| 12:52 | 读 `docs/001`、`002`、`006`、`007` 关键源码（runtime/setup/deployment/source kind/registry/settings/engine） | 建立领域模型与改造面：新增 Source kind + 放松「必须有 GitHub」的部署耦合 |
| 12:56 | 用 `kaneo-mcp` skill 查询 | whoami=吴志平；workspace=ATEAM；projects=FDEP(`dgctny…`)/pipeline(`wwo9d…`)；FDEP 8 列、285 任务 |
| 13:00 | 验证 Kaneo REST 形状 | `GET /task/tasks/{projectId}?status=ready&limit=N` 返回 `{data:{columns:[{slug,tasks[]}]},pagination}`；评论/状态/创建任务端点确认 |

## 阶段 B：文档骨架

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 13:05 | 写 `HANDOFF.md` | 记录解读/学习/改造/移植、假设、风险、验收 |
| 13:08 | 写 `TDD/README.md`、`TDD/001`、`TDD/002`、`TDD/003` | TDD 索引 + bundle 解剖 + 需求/决策 + Kaneo Source 设计 |

## 阶段 C：实现

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 13:10 | 新增 `src/sources/kaneo-config.ts` / `kaneo-api.ts` / `kaneo-trigger.ts` / `kaneo-channel.ts` / `kaneo-read.ts` / `kaneo.ts` | Kaneo Source kind、REST 客户端、Trigger/Channel/ThreadContext、轮询 |
| 13:12 | 修改 `src/kv.ts`、`src/deployment.ts`、`src/app/setup.ts`、`src/infra/environment.ts`、`src/policy.ts` | kaneo KV；空 GitHub 容忍；Kaneo 账号检查；Windows 路径；blockCommands 守卫 |
| 13:14 | 修改 `tsdown.config.ts`、`package.json`、`cordis.patch.yml` | 新增 `kaneo-watch` 入口/导出；插入 kaneo 行、GitHub/Feishu 默认 disabled |
| 13:15 | 修改 `src/client/locales.ts`、`src/setup.ts` | 新增 setup 问题码与中英文案、`health.kaneo`、`problemSetupFix.kaneo` |
| 13:16 | 新增 `tests/kaneo.spec.ts`（11 项） | 翻译/轮询/claim/channel/context/API 重试 |

## 阶段 D：构建与测试

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 13:08–13:13 | `pnpm install` | 4m12s，安装 234 包（registry.feg.cn） |
| 13:11 | `pnpm typecheck` | 首轮 2 个错误（zod default 形状、test 返回字面量），修复后通过 |
| 13:13 | `pnpm exec vitest run tests/kaneo.spec.ts` | 1 个断言（label 含票号）修正后 **11/11 通过** |
| 13:13–13:20 | `pnpm test` 全量 | 1169 passed / 39 failed（10 文件）；失败均为 POSIX/Windows 基线问题 |
| 13:21 | 定向回归 | bundle-patch（更新期望后通过）、policy 328 项、settings 4 项、locales 6 项、model-surface 7 项、registry 10 项、index/health 通过 |
| 13:22 | 修 `tests/bundle-patch.spec.ts` 期望 | 增加 `dsh-superagent-kaneo` 行 |
| 13:32 | 补 `docs/007` 模块表/测试表 | 使 docs 的结构性检查对齐（Windows 路径检查仍为基线失败） |
| 13:34 | `pnpm build` | 产出 `lib/kaneo-watch.js` 等 |

## 阶段 E：安装到 web profile

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 13:37:26 | 备份 profile 配置到 `.dsh-superagent-backup-20261103-133726` | package.json/cordis.patch.yml/pnpm-lock/pnpm-workspace/cordis.yml |
| 13:37:33 | profile `cordis.patch.yml` 增加 `dsh-superagent.config.stateDir` | 提供插件必需的 stateDir |
| 13:37:51 | `plugin_manager install_bundle` | `application: applied`；profile 添加 link 依赖与 bundle 行；pnpm install 2.5s |
| 13:38:04 | `GET /orchestrator/api/state` | 200；`setup.problem=sourceUnset`（预期：尚未配置 Source）；`health.kaneo=paused` |
| 13:38:xx | `PUT settings/source:kaneo`（含 API key 等） | `restarting:true` |

### 故障 1：重启后插件 fiber failed（404）

- 现象：保存 source:kaneo 后 `/orchestrator/api/state` 持续 404；`plugin_manager list_plugins` 显示 `include:dsh-superagent` 的 `fiberPhase=failed`。
- 排查手段：
  1. `cordis_inspect_query`（Service/Config）确认 `orchestrator` service 不存在、Config entry 仍为 schema；
  2. `plugin_manager set_plugin` 重新启用该行，返回诊断；
  3. 同时临时在 `src/index.ts` 的 apply/restart 外层写异常到 `.dsh-apply-error.log`（诊断后已移除）。
- 根因（来自 set_plugin 诊断 + 临时日志）：

  ```
  resume failed for session "orchestrator-…":
  Error: tools.restrict() names unknown global tool "bash";
  known global tools: … pwsh, read, read_image, skill, working_directory
  ```

  Windows profile 只有 `pwsh` 工具（`tool-bash` 在 win32 disabled），而 `src/app/sessions.ts` 给主 Session 的 `tools.restrict({allow:[…,'bash',…]})` 硬编码了 `bash`。
- 修复：`src/app/sessions.ts` 按平台选择 shell 工具（win32→`pwsh`，其他→`bash`），并把 `noWait` guard 同时识别 `pwsh`。重新 build 后 `set_plugin` 重启用 → `application: applied`。
- 附带结果：会话 `orchestrator-…` 已在上一次失败中创建过，重启走 `resolveAgent` 复用并成功 decorate。

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 13:52 | 修复 `sessions.ts` 后 rebuild + 重新启用 | `setup.problem=null`、`runtime=ready`、`kaneo=ready`（"0 new tasks from ready"） |
| 13:53 | `PUT settings/policy`（allowed=5 位团队成员） | 首次因 PowerShell 编码把中文名写成 `???`；用 UTF-8 字节体重存（revision 2）修复 |

## 阶段 F：端到端验证

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 13:54:34 | `POST /task/{FDEP}` 创建 `[smoke]` 卡 #470（assignee=吴志平，status=to-do） | id `fhsw6n9ggq5r3t5al1ccxwjl` |
| 13:54:5x | `PUT /task/status/{id}` → `ready` | 成功 |
| 13:55:4x | 轮询观察 | `stats.received=1`；任务自动 → `in-progress`；Decision `accept`（explicitRouted）；Ticket `69732805…` 创建 |
| 13:55:07 | Worker report | `ready`：已在执行目录创建 `smoke.txt`（内容 `kaneo-e2e-ok`） |
| 13:55:09 | Kaneo 评论 | ack + result 两条评论，含幂等 marker；Ticket `ended/completed` |
| 13:56 | 证据落盘 | `TDD/artifacts/*.json`；`smoke.txt` 实测存在 |
| 13:57 | 删除测试卡 #470 | 404 确认 |
| 13:58 | 移除诊断代码、删除临时文件、最终 build | 通过 |
| 14:00 | 禁用/启用 `include:dsh-superagent` 冷重载 | `applied`，`setup.problem=null`、`runtime=ready`、`kaneo=ready` |

## 阶段 G：文档回填

| 时间 | 操作 |
| --- | --- |
| 14:0x | 写 `TDD/004-port-deployment.md`、`TDD/005-test-verification.md`、本文；回填 `HANDOFF.md` 与 `TDD/002`/`003` 的实现差异 |

## 经验与教训

1. **先跑通再优化**：Source kind 的接口设计一次成型，但「部署必须配置成功才能走到 sessions.ensure」这条路径在首轮安装时被 `sourceUnset` 掩盖，导致 Windows 工具名问题在重启时才暴露。安装验证应包含「配置完成后的重启」。
2. **诊断要能看到 fiber 错误**：DSH web 不写文件日志，`plugin_manager set_plugin` 的 `error.diagnostic` 是唯一直接可得的失败原因；临时文件诊断是有效补充（已移除）。
3. **PowerShell 发中文 JSON 必须显式 UTF-8 字节**，否则 `name` 变 `???`（id 不受影响）。
4. **bootstrap 语义**：`skip` 会永久记住当前在监听列的任务，避免首次抓爆整列；测试/演练要新建卡再移列，而不是直接改已有卡。
5. **跨平台**：上游多处 POSIX 假设（shell 工具名、worker shim、测试脚本）在 Windows 需要显式处理；本次只修了阻塞运行的一处（主 Session 工具 allow），其余记录为基线问题。
