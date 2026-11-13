# 从 Gitea 安装 SuperAgent（其他设备）

本仓库（`git+https://git.feg.cn/shawoo/superagent`）本身是一个 **DSH bundle**，用 DSH 的插件命令装进目标 profile：

```powershell
# Windows：用 npx.cmd（PowerShell 的执行策略会拦 npx.ps1）
npx.cmd @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"
```

```bash
# macOS / Linux
npx @deepseek-ai/dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent"
```

> 与 DSH「插件」页面安装 bundle 等价：把 `dsh-superagent` 写进 profile 的依赖与 `dsh.profile.bundles`。
> `--profile` 换成目标 profile 名；需要固定版本用 `git+...#<tag 或 commit>`。
> 仓库还带一个**便捷脚本**（会顺带写好 `stateDir`）：`npx -y git+https://git.feg.cn/shawoo/superagent install`，见 §2。

---

## 1. 需要满足什么（其他设备侧）

| 条件 | 说明 |
| --- | --- |
| **DSH 已安装并初始化** | 目标机器上 DSH 能正常启动（至少打开过一次 `dsh web` 或对应 profile）。安装脚本通过 `dsh plugin --profile <名字> add` 写入 profile。 |
| **Node.js** | 包声明 `engines.node = ^22.19.0 || >=24.0.0`；便携包自带的 Node 一般已满足（npm/npx 随 Node 提供）。 |
| **git** | `npx` 的 `git+https` 依赖 git clone；`git --version` 可用，且能访问 `git.feg.cn`。 |
| **npm registry** | 安装器仅需下载运行时依赖 `zod` / `proper-lockfile`（体积很小）；本机使用内网 `registry.feg.cn` 正常。 |
| **pnpm** | DSH 的插件安装内部使用 pnpm；便携包应已带 pnpm（或在 PATH 上）。 |
| **网络** | 能访问 `https://git.feg.cn`。仓库**已设为 public**，匿名可读，无需账号；若改为私有，则目标设备需要配置 git 凭据（Credential Manager / `.netrc` / Gitea token）。 |
| **DSH 版本兼容** | 包声明 `engines.dsh = ^0.2.1-alpha.2`；DSH 启动安装前会做兼容检查，版本不符会拒绝并提示如何豁免。 |
| **仓库内容完整** | 仓库里必须包含 **`lib/`（已构建产物）** 和 **`bin/install.mjs`**。本仓库已按此方式提交，安装时**不需要**在目标机器上编译；构建工具链放在私有 `dev/` 工作区，不会随 npx 下载。 |
| **prefix / cache 可写** | 便携命令里的 `node\global`、`node\cache` 两目录需存在且可写（DSH 便携包通常已创建；缺失时 `npx` 会报 `ENOENT lstat`，先建目录即可）。 |
| **profile 名** | 默认 `web`；其他 profile 用 `--profile <name>`。 |

> 如果目标设备的 DSH_HOME 不是默认值，安装脚本按以下顺序解析：
> `--dsh-home` > `$env:DSH_HOME` > 便携目录（含 `node/global` 或 `profiles/`）> `~/.dsh`。

---

## 2. 便捷脚本的行为（`npx -y … install`）

便捷脚本 `npx -y git+https://git.feg.cn/shawoo/superagent install` 会（不想用它时，直接用 §intro 的插件命令即可）：

1. 从 Gitea 拉取本仓库并安装其 bin（`dsh-superagent`）；只会下载运行时依赖（zod / proper-lockfile），**不会**下载 vitest 等开发工具链；
2. 解析目标 DSH（PATH 上的 `dsh`，或便携目录里的 `node/global/node_modules/@deepseek-ai/dsh/lib/bin.js`）；
3. 执行官方安装路径：
   `dsh plugin --profile web add git+https://git.feg.cn/shawoo/superagent`
   —— 与 DSH「插件」页面安装 bundle 等价，会把 `dsh-superagent` 加入 profile 的依赖与 `dsh.profile.bundles`；
4. 在该 profile 的 `cordis.patch.yml` 中补一行 `stateDir`（默认 `<DSH_HOME>/state/superagent`，可用 `--state-dir` 覆盖）；
5. 打印后续步骤。

> 本机实测：**冷启动约 90–100 秒**（git clone + npm 缓存 + 依赖下载），**缓存后约 50 秒**（其中 DSH 的 `dsh plugin add` 用 pnpm 从 Gitea 安装 bundle 约 35 秒）。

安装后可用的选项：

```text
--profile <name>    目标 profile（默认 web）
--spec <spec>       包 spec（默认 git+https://git.feg.cn/shawoo/superagent）
--state-dir <path>  运行状态目录
--dsh-home <path>   DSH_HOME
--dsh <path>        dsh 可执行文件或 dsh 的 lib/bin.js
--dry-run           只打印将执行的命令与写入位置
```

示例（非默认 profile / 自定义状态目录）：

```powershell
npx -y git+https://git.feg.cn/shawoo/superagent install --profile web --state-dir D:\dsh-data\superagent
```

---

## 3. 安装后配置（必须做）

1. **重启 / 刷新**：重启正在运行的 `dsh web`（或重启对应 profile 进程）；浏览器端刷新页面。
2. 打开「**自主进化**」面板 → **设置 → 来源**，逐个配置并「测试连接」：
   - **Kanban**：服务器 + API key（可留空：本机存储记录里有）+ 项目（从列表选）；
   - **Gitea**：服务器 + 邮箱 + 密码（或 token）+ `owner/name` 仓库（测试通过才可保存）；
   - **ntfy**：服务器 + topic + 认证方式（公开 `pub_` 选 none；私有 topic 选账号 + 密码）。
3. 在 **Policy** 里配置各来源的 allowed 名单（谁能发起任务）；ntfy 公开 topic 按低信任处理。
4. 在 **Executor** 里选择 worker 模型、工作目录、prepare 命令与 blocked commands。
5. 验收：`/orchestrator/api/state` 中 `runtime / kaneo / gitea / ntfy` 全部 `ready`。

---

## 4. 只用 dsh 命令（不经过便捷脚本）

```powershell
dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent#v0.1.1"
```

**v0.1.1 起 `stateDir` 有默认值**（`<DSH_HOME>/state/superagent`），所以直接用 `dsh plugin add`
（或 DSH「插件」页面粘贴 git 地址）也能正常挂载，不需要再手改 profile patch。
如需自定义目录，仍可在 `profiles/web/cordis.patch.yml` 追加：

```yaml
- id: dsh-superagent
  config:
    stateDir: 'D:/your/path/superagent'
```

> 旧版本（≤ v0.1.0）直接用 `dsh plugin add` 会因为缺少必填 `stateDir` 导致 host 插件挂载失败：
> 菜单/UI 能出现，但面板请求报错。升级到 v0.1.1，或补上面的 config 行即可。

### 升级已有安装

```powershell
dsh plugin --profile web remove dsh-superagent
dsh plugin --profile web add "git+https://git.feg.cn/shawoo/superagent#v0.1.1"
```

DSH 运行中的进程需要重启（或通过插件页面 Update 后重启），再刷新 GUI。

---

## 5. 发布 / 更新（维护者）

其他设备安装的是 **git 仓库当前提交**，所以更新流程：

```powershell
pnpm build            # 生成 lib/（仓库已跟踪 lib，不再忽略）
git add -A
git commit -m "release: ..."
git push origin main
```

- 需要 **可复现安装** 时可固定提交：
  `git+https://git.feg.cn/shawoo/superagent#<commit>`
- **`lib/` 必须提交**：本仓库的分发方式是「提交构建产物」，这样其他设备安装时不需要 build script 审批。
- 构建工具链（vitest / tsdown / typescript / jsdom…）在 `dev/package.json` 中；`pnpm install` 会随 workspace 安装，`pnpm build` / `typecheck` / `test` 都已代理到该工作区。**不要**把它们挪回根 `package.json`，否则 `npx` 会下载整套开发依赖。
- 如果仓库改为 **私有**：在目标设备配置 git 凭据，或使用带 token 的 https 地址；`npx` 会使用系统 git 凭据。

---

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| 菜单/UI 有，但面板接口报错（旧版本 raw add） | ≤ v0.1.0 缺少必填 `stateDir`：升级到 v0.1.1（默认 stateDir），或手动补 `- id: dsh-superagent` + `config.stateDir` 行。 |
| 面板显示「部署检查未通过」 | 全新安装还没配置来源，属正常；到 设置 → 来源 配置 Kanban/Gitea/ntfy 并点「测试连接」。 |
| `未找到 dsh` | 用 `--dsh <path>` 指向 DSH 的 `lib/bin.js`，或确认便携目录布局。 |
| `未找到 git` / clone 失败 | 安装 git；确认能 `git ls-remote https://git.feg.cn/shawoo/superagent.git`。 |
| 401 / Authentication failed（仓库私有化后） | 配置 git 凭据或在 Gitea 给目标设备发 token。 |
| `pnpm was not found` | 安装 pnpm 或使用带 pnpm 的 DSH 便携包。 |
| DSH 报版本不兼容 | 升级 DSH，或按提示执行 `dsh plugin --profile web allow-version ... --accept-risk`（有风险）。 |
| 面板没有「自主进化」 | 确认安装进了正在使用的 profile、已重启；检查 `dsh.profile.bundles` 是否含 `dsh-superagent`。 |
| 卸载 | `dsh plugin --profile web remove dsh-superagent`，并从 `cordis.patch.yml` 删除对应 `stateDir` 行。 |

---

## 7. 本机已验证

- 仓库：`shawoo/superagent`（public，`main`），含 `bin/install.mjs`、提交的 `lib/`、`cordis.patch.yml`；构建工具链在 `dev/` 工作区，不随安装下载。
- 在 DSH `0.2.1-rc.5`、Node 24.19 上验证：
  - `npx --yes git+https://git.feg.cn/shawoo/superagent install --profile <temp>` **完整成功**（冷启动约 94s / 缓存后约 53s）；
  - 生成的临时 profile 中：`dependencies` 为 git spec、`dsh.profile.bundles` 含 `dsh-superagent`、node_modules 内含 `bin/` 与 `lib/`、`cordis.patch.yml` 中 `stateDir` 正确；
  - **直接 `dsh plugin --profile <temp> add "git+...#v0.1.1"`（不写 stateDir）** 也能挂载：安装包里的 `Config({})` 解析出默认 `stateDir = <DSH_HOME>/state/superagent`（这是 v0.1.1 修复的「菜单能看但接口报错」问题）；
  - 安装前后本机 `dsh web` profile（`runtime / kaneo / gitea / ntfy`）保持 `ready`，临时 profile 已清理。
