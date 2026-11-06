# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

dsh-superagent（超级智能体）是一个主动式 DSH bundle：从 **Kanban 看板**、**Gitea 仓库**与 **ntfy 主题**读取请求，按 Policy 判定授权，把明确授权的请求变成工单，在独立 Session 中执行，并把结果写回原对话。Web 面板展示哪些工作正在等人处理。

## Install from Gitea（其他设备）

```powershell
npx -y git+https://git.feg.cn/shawoo/superagent install
```

It installs this bundle into a DSH profile (default `web`) through `dsh plugin`, then records `stateDir`. Requirements and troubleshooting: **[INSTALL.md](INSTALL.md)**. 便携目录用：

```powershell
& "$bin\npx.cmd" --prefix (Join-Path $PWD "node\global") --cache (Join-Path $PWD "node\cache") -y git+https://git.feg.cn/shawoo/superagent install
```

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [AIOS](AIOS.md): the AI⁺ organization operating system — the narrative, the four-layer inheritance model, and how this prototype maps to it (implemented / partial / vision)

- [INSTALL](INSTALL.md): install from the Gitea address on another device, and what it requires
- [RD](RD.md): the collaboration narrative (Kanban as the only task source, PM + Worker posts, dynamic repos/topics, charter, deliverables)
- [008 岗位账号](docs/009-post-accounts.md): unified Kanban bot accounts per post and how to wire each one into a SuperAgent instance
- [TDD 008](TDD/008-real-data-validation.md): validation of the narrative against real Kanban / Gitea / ntfy / MinIO data
- [TDD 009](TDD/009-narrative-ui.md): the narrative-shaped panel (编队 page, projects & posts settings) and the SOP delivery
- [TDD 010](TDD/010-user-stories-validation.md): nine user stories run again and again in the test environment — dispatch, claim, delivery, "no claiming for others" — and the bugs they found (B-1 ~ B-11)
- [STORY](STORY.md): a user story of the three-source deployment (Kanban + Gitea + ntfy) and the full lifecycle
- [SOP](SOP.md): the operating guide for the two roles — the PM post and the worker posts (also as [SOP.html](SOP.html), a 16:9 slide deck)
- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source
- [STORY](STORY.md): a user story of this three-source deployment (Kanban + Gitea + ntfy) and the full lifecycle / 三来源部署的用户故事与全生命周期

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)
