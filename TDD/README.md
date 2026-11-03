# TDD — dsh-superagent → Kaneo FDEP 看板改造

本目录保存改造的**技术设计文档（Technical Design Document）与过程记录**。
总览与时间线见根目录 [`../HANDOFF.md`](../HANDOFF.md)。

## 文档索引

| 编号 | 文档 | 内容 |
| --- | --- | --- |
| 001 | [bundle 解剖](001-bundle-anatomy.md) | 上游 `dsh-superagent` 的模块、接口、调用链、与 DSH 的集成（解读/学习） |
| 002 | [需求、假设与决策](002-requirements-assumptions.md) | 需求拆解、验收口径、开放问题、ADR 决策 |
| 003 | [Kaneo Source 设计](003-kaneo-source-design.md) | 映射、REST 契约、轮询/触发/Channel/Policy/上下文、失败处理 |
| 004 | [移植与部署](004-port-deployment.md) | 构建、安装到 web profile、配置、验证、回滚 |
| 005 | [测试与验收](005-test-verification.md) | 单测矩阵、集成/端到端验收、风险回归 |
| 006 | [过程日志](006-process-log.md) | 逐次操作记录（命令、结果、失败与修复） |
| 007 | [三来源实现、测试与部署记录](007-p2-readonly-skeleton.md) | Gitea/ntfy 完整 Source、信任设计、单测与真实实测、web profile 部署与 E2E 证据 |

## 方法论

1. **先读后改**：解读上游领域模型与接口，再决定改动面；不改与目标无关的核心规则。
2. **最小侵入**：新增 Source kind 走既有扩展点（`SourceKind`/`SourceRegistry`），仅对「必须有 GitHub」的部署耦合做克制适配。
3. **可验证**：每个改动有单测或可执行的验收命令；端到端验证记录真实输出。
4. **可回滚**：安装前备份 profile；文档固化回滚步骤。
5. **外部数据不可信**：Kaneo 任务描述/评论是外部输入，不改变授权；API key 不进入 prompt 文本。

## 读者

- 想继续做这个改造的工程师：先读 `../HANDOFF.md` §2–§4，再读本目录 001/003。
- 想复现安装：`../HANDOFF.md` §5 与 `004-port-deployment.md`。
- 想审计决策：`002-requirements-assumptions.md` 的决策表。
