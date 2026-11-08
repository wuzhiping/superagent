# INDEX · 根目录 PDF（8 份 · 151 页）

> 先看 **A-I.pdf** 第 1–3 页拿到全景，再按目标选一条路；不要从 SOP 细节开始。

## 三条路

| 目标 | 顺序 | 用时 |
| --- | --- | --- |
| 第一次跑通 | A-I → ABC → DEF → GHI | 约 2 小时 |
| 搭宪章 / 能力体系 | EA → ABC → A-I | 约 1.5 小时 |
| 理解设计 / 对外讲 | AIOS → STORY → A-I → EA | 约 2 小时 |
| 日常当手册 | SOP（细节回查 ABC/DEF/GHI） | 随用随查 |

## 8 份 PDF

| # | 文件 | 用途 | 页 |
| --- | --- | --- | --- |
| ① | [A-I.pdf](A-I.pdf) | 九节完整流水线 + 真实演练（先看） | 22 |
| ② | [ABC.pdf](ABC.pdf) | 把运行环境准备好（+ 建卡 4 条） | 16 |
| ③ | [DEF.pdf](DEF.pdf) | 需求怎么变成工单（触发 / 评估 / 闸门） | 16 |
| ④ | [GHI.pdf](GHI.pdf) | 工单怎么执行、反馈、异常与交付 | 21 |
| ⑤ | [EA.pdf](EA.pdf) | 宪章仓库 = 能力供给系统（PM 职责与路线） | 20 |
| ⑥ | [AIOS.pdf](AIOS.pdf) | 为什么这样设计（原则 / 边界 / 现状） | 18 |
| ⑦ | [SOP.pdf](SOP.pdf) | 日常操作手册（PM / Worker） | 22 |
| ⑧ | [STORY.pdf](STORY.pdf) | 用户故事：小吴的一天 | 16 |

**按问题找**：环境→ABC；卡为什么没接→DEF；工单卡住→GHI；复盘/知识/技能→EA；每天怎么干→SOP；讲给别人→STORY→AIOS。

**维护**：PDF 由同名 `.md` / `.html` 生成（`node scripts/build-<name>-deck.mjs`，再 `node scripts/html-to-pdf.mjs <name>.html <name>.pdf`）；新增或删除 PDF 时同步本表。演示版：[INDEX.html](INDEX.html) · [INDEX.pdf](INDEX.pdf)（1 页）。
