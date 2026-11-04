# 从 Gitea 安装 SuperAgent（其他设备）

本仓库（`git+https://git.feg.cn/shawoo/superagent`）本身是一个 **DSH bundle**。其他设备可以用**一条 npx 命令**把它装进自己的 DeepSeek Harness：

```powershell
& "$bin\npx.cmd" --prefix (Join-Path $PWD "node\global") --cache (Join-Path $PWD "node\cache") -y git+https://git.feg.cn/shawoo/superagent install
```

> `$bin` / `$PWD` 按你的便携目录替换；核心是 `npx -y git+https://git.feg.cn/shawoo/superagent install`。

---

## 1. 需要满足什么（其他设备侧）

| 条件 | 说明 |
| --- | --- |
| **DSH 已安装并初始化** | 目标机器上 DSH 能正常启动（至少打开过一次 `dsh web` 或对应 profile）。安装脚本通过 `dsh plugin --profile <名字> add` 写入 profile。 |
| **Node.js** | 包声明 `engines.node = ^22.19.0 || >=24.0.0`；便携包自带的 Node 一般已满足。 |
| **git** | `npx` 的 `git+https` 依赖 git clone；`git --version` 可用，且能访问 `git.feg.cn`。 |
| **pnpm** | DSH 的插件安装内部使用 pnpm；便携包应已带 pnpm（或在 PATH 上）。 |
| **网络** | 能访问 `https://git.feg.cn`。仓库**已设为 public**，匿名可读，无需账号；若改为私有，则目标设备需要配置 git 凭据（Credential Manager / `.netrc` / Gitea token）。 |
| **DSH 版本兼容** | 包声明 `engines.dsh = ^0.2.1-alpha.2`；DSH 启动安装前会做兼容检查，版本不符会拒绝并提示如何豁免。 |
| **仓库内容完整** | 仓库里必须包含 **`lib/`（已构建产物）** 和 **`bin/install.mjs`**。本仓库已按此方式提交，安装时**不需要**在目标机器上编译。 |
| **profile 名** | 默认 `web`；其他 profile 用 `--profile <name>`。 |

> 如果目标设备的 DSH_HOME 不是默认值，安装脚本按以下顺序解析：
> `--dsh-home` > `$env:DSH_HOME` > 便携目录（含 `node/global` 或 `profiles/`）> `~/.dsh`。

---

## 2. 安装命令的行为

`npx -y git+https://git.feg.cn/shawoo/superagent install` 会：

1. 从 Gitea 拉取本仓库并安装其 bin（`dsh-superagent`）；
2. 解析目标 DSH（PATH 上的 `dsh`，或便携目录里的 `node/global/node_modules/@deepseek-ai/dsh/lib/bin.js`）；
3. 执行官方安装路径：
   `dsh plugin --profile web add git+https://git.feg.cn/shawoo/superagent`
   —— 与 DSH「插件」页面安装 bundle 等价，会把 `dsh-superagent` 加入 profile 的依赖与 `dsh.profile.bundles`；
4. 在该 profile 的 `cordis.patch.yml` 中补一行 `stateDir`（默认 `<DSH_HOME>/state/superagent`，可用 `--state-dir` 覆盖）；
5. 打印后续步骤。

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
2. 打开「**超级智能体**」面板 → **设置 → 来源**，逐个配置并「测试连接」：
   - **Kaneo**：服务器 + API key + 项目 id；
   - **Gitea**：服务器 + 邮箱 + 密码（或 token）+ `owner/name` 仓库（测试通过才可保存）；
   - **ntfy**：服务器 + topic + 认证方式（公开 `pub_` 选 none；私有 topic 选账号 + 密码）。
3. 在 **Policy** 里配置各来源的 allowed 名单（谁能发起任务）；ntfy 公开 topic 按低信任处理。
4. 在 **Executor** 里选择 worker 模型、工作目录、prepare 命令与 blocked commands。
5. 验收：`/orchestrator/api/state` 中 `runtime / kaneo / gitea / ntfy` 全部 `ready`。

---

## 4. 手动等价方式（不用 npx）

```powershell
dsh plugin --profile web add git+https://git.feg.cn/shawoo/superagent
# 然后手动在 profiles/web/cordis.patch.yml 追加：
# - id: dsh-superagent
#   config:
#     stateDir: 'D:/.../state/superagent'
```

或通过 DSH「插件」页面粘贴 `git+https://git.feg.cn/shawoo/superagent` 安装。

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
- 如果仓库改为 **私有**：在目标设备配置 git 凭据，或使用带 token 的 https 地址；`npx` 会使用系统 git 凭据。

---

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| `未找到 dsh` | 用 `--dsh <path>` 指向 DSH 的 `lib/bin.js`，或确认便携目录布局。 |
| `未找到 git` / clone 失败 | 安装 git；确认能 `git ls-remote https://git.feg.cn/shawoo/superagent.git`。 |
| 401 / Authentication failed（仓库私有化后） | 配置 git 凭据或在 Gitea 给目标设备发 token。 |
| `pnpm was not found` | 安装 pnpm 或使用带 pnpm 的 DSH 便携包。 |
| DSH 报版本不兼容 | 升级 DSH，或按提示执行 `dsh plugin --profile web allow-version ... --accept-risk`（有风险）。 |
| 面板没有「超级智能体」 | 确认安装进了正在使用的 profile、已重启；检查 `dsh.profile.bundles` 是否含 `dsh-superagent`。 |
| 卸载 | `dsh plugin --profile web remove dsh-superagent`，并从 `cordis.patch.yml` 删除对应 `stateDir` 行。 |

---

## 7. 本机已验证

- 仓库：`shawoo/superagent`（public，`main`），含 `bin/install.mjs`、提交的 `lib/`、`cordis.patch.yml`。
- 在 DSH `0.2.1-rc.5`、Node 24.19 上验证：`dsh plugin --profile <temp> add <本仓库>` 成功、bundle 自动加入 `dsh.profile.bundles`、`stateDir` 正确写入 profile patch。
