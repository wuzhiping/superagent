# 001 — 上游 bundle 解剖（解读 / 学习）

对象：`dsh-superagent` v0.1.0（git 提交 `6337fc8`）。
目的：在改造前给出**代码级地图**，说明哪些是「可复用的领域核心」，哪些是「需要替换的来源适配」，以及插件如何挂进 DSH。

## 1. 交付形态

- npm 包（`private: true`），`type: module`，构建产物 `lib/`（tsdown）。
- `package.json` 中 `dsh` 字段声明 bundle：`bundle.patch = ./cordis.patch.yml`、`client.platform = web`、`client.inject = [6 个 client-ui 服务]`。
- 三个 Host 入口 + 一个 Client 入口（`tsdown.config.ts`）：

| 入口 | 源文件 | 运行时身份 |
| --- | --- | --- |
| `index` | `src/index.ts` | 主插件 `dsh-superagent`，暴露 `orchestrator` service |
| `github-watch` | `src/sources/github.ts` | `dsh-superagent/github-watch`（Source 插件） |
| `feishu-watch` | `src/sources/feishu.ts` | `dsh-superagent/feishu-watch`（Source 插件，默认 disabled） |
| `client` | `src/client/index.tsx` | Web 面板（`window.__ModuleLoader__` 工厂） |

- `cordis.patch.yml` 的 `insert` 行：3 个插件 + 2 个 agent preset（worker/router）。

## 2. 插件生命周期

### 2.1 主插件 `src/index.ts`

```ts
export const inject = ['agents','sessionController','sessionPersistence','workspaceRegistry','permissionPresets',
  'tools','systemPrompt','skills','webServer','llm','subprocess']
export async function apply(ctx, config) {
  const machine = machineOf(config)              // 只接受 stateDir + 三个 volatile 限制
  ctx.inject(['settings'], child => child.settings.configure({ auto: false }))
  const restart = () => ctx.fiber.restart().then(() => ctx.get('settings')?.describe())
  const runtime = new Runtime(ctx, machine, restart)
  ctx.effect(() => async () => { await runtime.stop() })
  await runtime.ready
}
```

- `Runtime` 继承 `Service`，名字 `orchestrator`。`declare module '@deepseek-ai/cordis' { interface Context { orchestrator: SourceHost } }`。
- Source 插件通过 `inject: ['orchestrator']` 拿到受限的 `SourceHost`（`sources` + `context(kind)`），**不能**直接碰 Store/Engine。

### 2.2 Source 插件模板（以 GitHub 为例）

```ts
export const name = 'dsh-superagent-github'
export const inject = ['orchestrator']
export function apply(ctx) {
  ctx.effect(() => ctx.orchestrator.sources.register(githubKind), 'github: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, githubKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch(e => source.report('github', { state:'error', detail:String(e) }))
    return async () => { controller.abort(); await running }
  })
}
```

要点：
- **注册 kind** 与 **启动轮询** 分开两个 effect，卸载时注册被撤销、轮询被 abort。
- 未捕获的 rejection 会终止 DSH 进程，因此轮询循环的最外层必须 catch 并写 health。
- `ctx.ready` 之后才动作；`ctx.configured()` 为 false 时（setup 未完成）报 `paused` 并返回。

## 3. 领域核心（可复用，尽量不改）

### 3.1 写路径

```
Source.receive(Trigger)
  → Passes.receive → Engine.receive (Intake)
      ├─ 存 Trigger + disposition
      ├─ 扇出到订阅 Ticket（Subscriptions）
      └─ 进入 Thread 的 pending，等待 evaluateDue
Engine.evaluateDue (每 2s / 命令触发)
  → Evals：Gate（policy.gate）→ 若 explicit：候选交给主 Session；若 inferred：按 mode 研判
  → MasterAssessor 通过 Effects `assessment` 把候选卡片 steers 进主 Session
  → 主 Session 调 orchestrator_route/orchestrator_eval_decide → Engine.decide
      → accept：创建 Ticket + Mandate + Assignment + Subscription + acknowledgement（原子）
Effects:
  launch    → DshExecutor：prepare（可选）→ 建/复用 Executor Session → 发 assignment
  delivery  → 把 Inputs 交给运行中的 worker
  reply     → Outbox → SourceRegistry.send → kind.channel.send
  relay/notice → 主 Session 消息
  assessment → MasterAssessor
```

### 3.2 角色接口（Pick）

`EngineForSources`（receive/bindThread/threadClosed）、`EngineForMainSession`（candidate/candidateDecided/decide/attach/requestStatus/note/reply）、`EngineForPeople`（stopTicket/retryTicket/reevaluate/unsubscribe/dismiss）、`EngineForSettings`（policyChanged）、`EngineForExecutor`（assignmentStarted/inputsDelivered/inputsRead/turnEnded/deliveryFailed/report/markUnrelated/followForContext/handback/assignmentInterrupted）。改造只新增 Source，所以只有 `EngineForSources` 与 `SourceContext` 相关。

### 3.3 关键持久化

- `Store`（`node:sqlite` `DatabaseSync`）：`atomic`、`triggers/threads/tickets/decisions` repositories、`read` 查询、`settings`/`blockRevision`/`settingsHistory`、KV。
- `Effects`：每种 kind+key 一行，事务内 enqueue、提交后执行；失败指数退避；`Later` 不算失败。
- `Versions`：settings/prompts 的版本化快照。
- 数据库 schema 11（`migration.ts`）。

## 4. Source 扩展点（改造入口）

### 4.1 `SourceKind`（`src/sources/kind.ts`）

必需：`kind`、`title/description`(zh/en)、`schema`(zod)、`fields`(表单)、`health: string[]`。
可选：
- `scope({meta}, config): ScopeResult` — 这个 kind 听什么（`listened`、`observed`、`row`）。
- `channel: { send(host,message), link(address,links), allowed? }`。
- `threadContext: { messageId(trigger), read(commands,trigger,part,cursor,config), images?, image? }`。
- `find(query)`、`repliesTo(trigger)`。
- `policy: { schema, fields, explicit, rows?, sync?, unnamed? }`。
- `environment: { variables, values({deployment,config,trigger}) }`（只进 prompt 文本，不进真实 env）。
- `refreshLabels(host, signal)`、`facts(deployment)`。

### 4.2 `SourceContext`（`src/sources/host.ts`）

只读能力：`deployment`、`commands`、`ready`、`configured()`、`config<C>(kind)`、`state`(KV)、`threads.get/subscribed/describe/patch`、`tickets.get/open`、`triggers.get/latest`。
写能力：`receive(trigger)`、`atomic(work)`、`tickets.bindThread/threadClosed`、`notify(message)`、`report(entry, health)`。
→ Kanban Source 可以完全通过这个面完成：轮询 + Trigger + KV 游标 + Thread 描述 + 评论 notify。**不需要** Store/Engine 直连。

### 4.3 `SourceRegistry`（`src/sources/registry.ts`）

- `register(kind)`：重复 kind / 重复 health 名字会抛错；返回注销函数。
- `instances()`：已注册 kind 的默认实例（`settings.sources[id]` 或 schema 默认）+ 未安装的遗留实例。
- `scope()`：`listened/observed` 由 kind 的 `scope()` 决定；未安装或 disabled 则不监听。
- `send()`：按 `message.channel.source` 找 kind 的 channel；没有 kind 返回 `waiting`；没有 channel 返回 `gone`。
- `link()`：kind.channel.link，缺省回退 `{url:'', label:{zh:source,en:source}}`。

## 5. 部署与配置（改造的耦合点）

### 5.1 `Deployment` / `Setup`（`src/deployment.ts`、`src/app/setup.ts`）

- `Config`：`stateDir`（`^\/` 绝对路径）+ 3 个 volatile 限制。
- `machineOf` 拒绝未知 key（含历史 key 的「搬到哪里」提示）。
- `resolveDeployment(machine, githubConfig, probe)`：必须 `repository` + `cli`，探测 `gh api user`、`repos/<remote>` 并检查 push 权限；返回 `{repository, github:{cli,login,noreply}}`。
- `resolveFeishuBot(...)`：可选，失败只禁用 Feishu（`feishuProblem`）。
- `Setup.run(settings)`：`resolveDeployment` 失败 → `problem`，`configured()` 为 false；成功后 `writeEnvironment`（worker-bin shims + worker-gitconfig）+ `applyEnvironment` + `verifyEnvironment`。
- `Runtime.paused()`：`!configured() || settings.paused`。**未配置时 Passes 不评估、Effects 不派发。**

→ **Kanban-only 的阻断点就是 `resolveDeployment` 与 `writeEnvironment`**。改造见 003/004。

### 5.2 `SETUP_FIELDS`

`{ github: ['repository','cli'], feishu: ['cli'] }`：只有这些字段变化才重启重跑 setup。Kanban 的配置不走 setup（无 CLI），保存时不应触发账号检查。

### 5.3 Settings 泛化程度

`SettingsSchema.sources` 是 `Record<id, {enabled, config}>`；实例的 config 由对应 kind 的 zod schema 校验（`SourceRegistry.validate`）。**新增 Kanban Source 不需要改 SettingsSchema**；面板的 source 卡片从 `kind.fields` 渲染，`Settings.view()` 通过 `sources.instances()` 枚举。

### 5.4 与 GitHub 硬绑定的代码点（本次要绕开的）

`grep github|feishu src` 命中的关键点：
- `src/infra/commands.ts`：`gh()`/`api()`/`pages()` 绑定 `deployment.repository` 与 `deployment.github.cli`。
- `src/infra/environment.ts`：写 `gh`/`lark-cli` shim、github credential helper、`verifyEnvironment`。
- `src/app/runtime.ts`：`links()` 传 `repository`；`pullEndNotices`；`toolHost.github`。
- `src/app/resources.ts`：`feishu/…`、`github/…` 资源。
- `src/app/prompts.ts` / `sessions.ts` / `skill-files.ts`：内置 skill 只注册 `github`/`feishu`。
- `src/executor/dsh.ts` / `executor.ts`：PR 绑定工具用 GitHub context。
- `src/app/migration.ts` / `kv.ts`：旧 GitHub/Feishu KV。
- `src/app/outbox.ts`：Feishu IM 长度限制。

**取舍**：Kanban Source 不依赖以上任何 GitHub 逻辑（不同于「把 GitHub payload 换掉」，而是新增一种 Source）。运行时仍需容忍 `deployment.repository === ''`：`links()`、`pullEndNotices`、环境变量渲染都要能处理空值（它们本身多数已经能用空串处理，只需确认不抛错）。

## 6. Client 面板

- `src/client/index.tsx`：侧边栏入口 + 主面板 + Plugin Manager 页面。
- `src/client/api.ts` 用 `src/app/api.ts` 的类型调 `/orchestrator/api/*`。
- `Settings` 的 Sources 页按 `GET settings.sources[]` 渲染；每个 kind 的卡片用 `kind.fields` + `kind.title/description`。
- `locales.ts` 有 `source.github`/`source.feishu` 之类文案键；未知 kind 的显示会回退到 kind 的 title（需实现时确认）。

## 7. 测试基线

- `pnpm check` = `tsc --noEmit` + `vitest run` + `tsdown`。
- 单测覆盖：`core-engine`、`stage`、`policy`、`registry`、`sources`、`commands`、`effects`、`passes`、`bundle-patch`、`panel-*` 等。
- 对新增 Source，最合适的参照测试是 `tests/sources.spec.ts`（Feishu/GitHub 的翻译、轮询、读取位置、health）与 `tests/registry.spec.ts`。

## 8. 结论（改造策略）

1. **保留**：`src/core/*`、`src/app/*`（除 Setup/Deployment 小改）、`src/executor/*`、`src/client/*`、agent presets、管理 API。
2. **新增**：`src/sources/kaneo*.ts`，作为第三个 Source kind（独立 loader 行）。
3. **适配**：`deployment.ts`/`setup.ts`/`environment.ts` 容忍「无 GitHub」；Windows 路径正则。
4. **开关**：bundle patch 默认只启用 Kanban，GitHub/Feishu 置 `disabled: true`；原能力保留可再开。
