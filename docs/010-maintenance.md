# 010 工作区清理

本文说明为什么职责会留下越来越多工作区，清理页在什么口径下可以清理，以及哪些东西**永远不由它删除**。执行目录与 Session 的产生见 [003 Execution](003-execution.md)；面板与模块索引见 [007 Architecture](007-architecture.md)。

## 为什么会变多

每个被接受的工单（职责）都由执行器创建两样东西：

- 一个**工作区目录**：`ticket.execution.directory`，在配置的执行根目录下（默认 `<stateDir>/work`），名字是工单短名加 id 后缀。worker 在其中读写代码、文档和构建产物。
- 一份**持久 Session**：`worker-<ticketId>`，由 `sessionPersistence` 落盘。DSH 还会为这个目录写一条 `workspaceRegistry` 登记，让工作区出现在 DSH 的工作区列表里。

工单结束（`ticket.ended`）后，二者都不会自动消失：目录仍在磁盘上，Session 日志仍可回放，工作区登记也仍在注册表里。于是工作区列表随历史职责线性增长，而绝大多数已结束职责的目录只剩一个可回滚的现场。清理页就是为「人工确认交付物之后清掉这些残留」而存在的。

## 清理口径

只处理**已结束**的职责，并且按下面的顺序判断：

1. 工单必须有 `ended`（状态为 `ended`），未结束的职责永远不会进入可清理计划，它只出现在 skipped 里并给出原因。
2. 工作区目录必须仍然存在（`workspaceExists`）。目录已经不在的职责只提示，不计划清理。
3. 没有其他职责引用同一个目录：任何未结束职责引用它（`referenced`），或另一个已结束职责也记录它（`shared`），都不进入计划。
4. Session 数量从 `sessionPersistence.list()` 按 `header.cwd` 与目录比对得出，**只做统计与展示**。

满足以上条件的行默认勾选；**带交付物的行默认不勾选**并在表格里标出「有交付物」。交付物信号来自工单的 `deliverableType`、`repos`，以及它自己打开的线程（例如 PR）。清理动作必须由人点击确认，程序不会自动清理。

面板上：

- 「同时删除工作区文件夹」是**单独的勾选框，默认不勾**：不勾时只解除 DSH 的工作区登记，目录留在磁盘上；勾选后才会递归删除目录内容。
- 二次确认对话框列出将解除多少个工作区登记、选中项合计多少字节，并写明 Session 只解除登记、不删日志。

## 会删除什么

`POST maintenance/clean` 只处理 `GET maintenance` 计划里 `removable` 的行：

- `workspaceRegistry.delete(workspaceId)`：删除工作区**登记**，让工作区从 DSH 列表消失。注册表本身不删目录、不删 Session 日志。
- 仅当请求带 `removeFiles: true` 时，`rm(directory, { recursive: true })` 删除目录内容。

返回 `{ cleaned, skipped }`；不在计划里的 id、未结束职责、缺失目录、越界路径都进入 `skipped` 并带原因码，不会发生任何删除。

## 不会删除什么

- **Session 日志**：`sessionPersistence` 没有 delete API，清理页不碰 `.jsonl`、不改 SQLite、不删 Session。它只解除工作区登记；日志仍在，仍可回放。
- **未结束的职责**：它们的 worker Session 可能仍在运行，目录是正在写的现场。
- **运行状态目录**（`stateDir`，含数据库、项目档案、锁）以及任何包含它的路径。
- **执行根目录本身、盘根**，以及执行根目录之外的任何路径。

## 安全边界

删除目录前，`src/app/maintenance.ts` 的 `checkRemovable` 用 `fs.realpath` 解析目标，并同时要求：

- 目标是存在的**目录**（不是文件、不是悬空链接）；
- 目标严格位于执行器的执行根目录之下（符号链接按解析后的真实路径判断，指向外面的链接会被拒绝）；
- 目标不是执行根目录本身、不是文件系统根、不等于也不包含 `stateDir`。

路径校验失败只会进入 `skipped`，不会「尽力删除」。目录删除按 512 MiB 或 20000 个文件的扫描上限做审计：超过上限即停止统计并标记 `sizeCapped`，面板显示 `≥` 前缀，避免一个巨大的目录把页面卡死。

## 工作区是授权边界的一部分

工作区不只是临时目录：它是 worker 的写入范围、DSH 打开 Session 时的默认目录，也是「这个职责做过的现场」。清理只改变**登记**与磁盘占用，不改变任何授权数据（Policy、工单、Mandate 都在 `stateDir` 的数据库里，不随工作区移动）。因此：

- **不要**把工作区目录当作可随手删除的缓存：勾选「删除文件夹」前先确认交付物已经验收、分支或 PR 已经合入、需要的产物已经取走。
- **不要**让清理越过执行根目录，也不要清理 `stateDir`：数据库、项目档案与锁都在那里。
- 未结束职责的目录即使看起来「已经很久没动」，也不能清理：它的 Session 仍可能在里面写。

## 模块与接口

| 位置 | 作用 |
| --- | --- |
| `src/app/maintenance.ts` | `audit` 汇总已结束职责的行与安全计划；`clean` 执行计划；`scanWorkspace` 做有上限的目录统计；`checkRemovable` 做删除路径校验 |
| `src/app/http.ts` | `GET maintenance` 与 `POST maintenance/clean` 路由，从 `workspaceRegistry` 与 `sessionPersistence` 惰性读取 |
| `src/client/maintenance.tsx` | 清理页：按大小降序的表格、默认勾选、单独的文件删除选项与二次确认 |

清理页在 PM 视角可见，岗位视角不显示：工作区是部署级的资源，由管理整个项目的人决定去留。
