# CHARTER QUICKSTART · 30 分钟把宪章体系跑起来

> **用途**：一个新项目要开张，或一个老项目的宪章仓库"只有 README、缺复盘/上下文/知识/技能"时，用这份通用模板补齐骨架，先跑通一条闭环，再按 [EA.md](EA.md) 长大。
> **给谁看**：PM、项目负责人、第一次搭宪章仓库的人。
> **原则**：只补缺、不覆盖；先小后大；每一步都有"看什么算 OK"。

## 0. 30 分钟后你会得到

- 一个能用的宪章仓库：`README.md`（规则）+ `CAPABILITY.md`（能力清单）+ `duties/`（职责模板）+ `reviews/`（周复盘）+ `context/`（最新总结、对象模板、本体草案）+ `KE/`（知识库与索引）+ `skills/`（技能模板与登记）。
- DSH 里：项目登记、岗位登记、宪章已发布、至少 1 条职责可派工、设置检查全绿。
- 看板上：第一张卡走完 **触发 → 决定 → 工单 → 交付 → 评论 → 复盘**。

---

## 1. 合并模板（5 分钟）

模板在 `templates/charter/`，合并工具只补缺失文件。

```powershell
# 1) 先演示（不写盘）：确认 added / kept
node scripts/apply-charter-template.mjs --target ..\my-charter --dry-run

# 2) 真正合并
node scripts/apply-charter-template.mjs --target ..\my-charter

# 3) 老仓库已有 README：打印「能力供给」一节，手工合并进去
node scripts/apply-charter-template.mjs --print-section
```

**看什么算 OK**：`added` 是你缺的文件，`kept` 是已有文件（一个都没被改）。

> 手工合并也可以：把 `templates/charter/` 整个复制进仓库，选择"不覆盖已有文件"。

---

## 2. 填 3 处（10 分钟）

| 文件 | 填什么 | 例子 |
| --- | --- | --- |
| `README.md` | 项目名、目标、看板流程列、岗位与职责概述、交付标准（桶/仓库） | `<项目名>`、`to-do → in-progress → in-review → done` |
| `duties/` | 复制 `_TEMPLATE-code.md` 或 `_TEMPLATE-doc.md` 成 `<id>.md`，填 `承接岗位`、完成定义、步骤 | `duties/api.md`，承接 `api-fdep` |
| `CAPABILITY.md` | 把 Owner 与节奏改成你们的（可选，先默认也行） | PM 每周复盘 |

**看什么算 OK**：`duties/` 里至少 1 个不以 `_` 开头的职责文件；它的 `承接岗位` 与项目里登记的岗位 id 完全一致。

---

## 3. 接上 DSH（10 分钟）

| 步骤 | 在哪 | 看什么算 OK |
| --- | --- | --- |
| 1 登记项目 | 设置 → 项目与岗位 | 项目下拉能选到；宪章仓库 owner/name 正确 |
| 2 登记岗位 | 同一页，每台机器登记它演的岗位（可以只登记一个） | 岗位卡显示"已映射为 Kanban 账号：邮箱" |
| 3 发布宪章 | 宪章正文 → 发布 | 版本 ≥ v1；仓库 `README.md` 与面板同文 |
| 4 发布职责 | 职责说明 → 发布 | 职责列表出现；岗位卡「接哪些职责」选中它 |
| 5 来源 | 来源 → 看板/仓库/通知/文件柜 | 四张卡无红错；监听列 = `to-do` |
| 6 就绪检查 | 面板顶部 | 8 项全绿（或只差"还没有工单"这类非阻塞项） |

> 更细的环境步骤见 [ABC.md](ABC.md)；本文件只负责"宪章仓库这一侧"。

---

## 4. 跑第一张卡（5 分钟）

1. 在非监听列建一张**低风险测试卡**：负责人 = Worker 岗位账号，标签 `duty:<你的职责 id>`、`kind:doc`（或 `code`），描述写清"交付到哪、怎么验收"。
2. **先挂标签，再把卡拖进监听列** `to-do`（标签在触发时读取）。
3. 盯三处：触发页 → 评估页（决定=接单）→ 执行页（工单排队/执行）。
4. 完成后看：卡片评论有没有 `bucket/key` 或 PR 链接；卡是否进了 `done`。
5. 跑第一次周复盘：复制 `reviews/weekly/TEMPLATE.md` 成 `reviews/weekly/<年>-W<周>.md`，填数据与 ≤3 条改进，更新 `context/retrospectives.md`。

**看什么算 OK**：卡从 `to-do` 到 `done`，评论里有载体指针，复盘文件里有数字和行动项。

---

## 5. 30 分钟验收清单

- [ ] `README.md` 有项目名、流程列、岗位、交付标准
- [ ] `CAPABILITY.md` 与 `duties/` 存在
- [ ] 至少 1 条职责能解析、能在岗位卡选中
- [ ] `reviews/weekly/TEMPLATE.md` 在，第一次周复盘已写
- [ ] `context/retrospectives.md` 指向本周复盘（≤24h）
- [ ] `KE/index.md` 有索引结构（可先空）
- [ ] `skills/registry.md` 有登记结构（可先空）
- [ ] 看板一张卡走完闭环，评论里有载体
- [ ] 面板设置检查全绿（或已知非阻塞项）
- [ ] 宪章版本 ≥ v1，且仓库与面板同文

---

## 6. 之后怎么长大

| 何时 | 做什么 | 参考 |
| --- | --- | --- |
| 第 1–2 周 | 日复盘 + 每周至少 1 条 KE | `reviews/README.md`、`KE/README.md` |
| 第 3–4 周 | 写 1–3 个领域对象、本体草案对齐职责 | `context/domain/`、`context/ontology/` |
| 第 5 周起 | 把反复用的动作提取成技能（先 draft，再 testing） | `skills/README.md` |
| 每月 | 资产清理、能力清单更新、宪章改版 | [EA.md](EA.md) §11–§13 |

---

## 7. 合并规则与 FAQ

**问：会覆盖我已有的 README/职责吗？**
不会。工具只写缺失文件；`README.md` 已存在时跳过，并提示用 `--print-section` 手工合并。

**问：已有 `ui.md`、`api.md` 这类职责，模板会不会冲突？**
不会。模板只有 `duties/README.md` 和 `_TEMPLATE-*.md`；以 `_` 开头的文件**不会被系统当成职责**，只是可复制的样例。

**问：目录存在但里面是空的？**
工具按文件判断，不按目录：空的 `KE/` 会被补上 `README/index/模板`。

**问：岗位 id 和我模板里写的不一样？**
改 `duties/*.md` 里的 `承接岗位`，与项目登记一致；否则闸门会以"这个职责由别的岗位承接"拒绝。

**问：暂时不想用 MinIO / Gitea？**
把职责的 `载体` 与交付标准先改成 `comment`（卡片评论），等接上对象存储/仓库再升级；不要删掉交付标准。

**问：只想先要 README 和职责？**
可以。先只合并这两个，之后再跑一次工具补复盘/上下文/知识/技能（幂等，不会重复）。

**问：模板会自己更新吗？**
不会。模板在 dsh-superagent 仓库里；升级时重新跑一次合并工具即可（只补新增的缺失文件）。

---

## 8. 模板清单

```text
templates/charter/
├── README.md                     # 宪章骨架（含能力供给一节）
├── CAPABILITY.md                 # 能力清单/门槛/健康检查
├── duties/README.md              # 职责写法 + 快速创建
├── duties/_TEMPLATE-code.md      # 代码交付职责模板（复制改名即用）
├── duties/_TEMPLATE-doc.md       # 文档交付职责模板
├── duties/_TEMPLATE-pm.md        # PM 运营职责模板
├── reviews/README.md             # 日/周/月规则
├── reviews/{daily,weekly,monthly}/TEMPLATE.md
├── context/README.md             # 三块公共上下文
├── context/retrospectives.md     # 最新复盘总结
├── context/domain/README.md + _TEMPLATE.md
├── context/ontology/README.md + team-model.md
├── KE/README.md · index.md · _TEMPLATE.md
└── KE/{projects,areas,references,tasks}/README.md
├── skills/README.md · registry.md · _TEMPLATE/SKILL.md
```

配套工具：`scripts/apply-charter-template.mjs`（合并）、`scripts/lib/charter-template.mjs`（实现）、`tests/charter-template.spec.ts`（不覆盖/幂等/模板可用的测试）。

> 模板是"最小可运转版"，不是[EA.md](EA.md) 的完整六层终态；先跑起来，再按 EA 的路线长大。
