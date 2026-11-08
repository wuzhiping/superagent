# 复盘（reviews）

> 复盘的目的是下一轮干得更好，不是写周报。每条结论要能指到数据或一张卡。

## 先跑周复盘（Quick Small Start）

| 频率 | 回答 | 文件 |
| --- | --- | --- |
| 周（30 分钟，必跑） | 这一周哪些做法有效、哪些要改 | `reviews/weekly/YYYY-Www.md` |
| 日（10 分钟，可选） | 今天卡在哪、明天先干什么 | `reviews/daily/YYYY-MM-DD.md` |
| 月（60 分钟，按需） | 能力与路线是否还成立 | `reviews/monthly/YYYY-MM.md` |

**质量门槛**：有数据；≤3 条可执行改进；每条行动项有 Owner 和期限；周复盘后 24 小时内更新 `context/retrospectives.md`。

**数据来源**：看板（触发/决定/卡龄）、执行页（工单状态/时长）、异常队列（受阻/失败原因）、MinIO（交付物）、Gitea（PR/评审）。

## 与其他资产的关系

复盘只产出"结论与候选"；入库要过 KE 的 MAKE 审核（见 `KE/README.md`），动作要沉淀成技能（见 `skills/README.md`）。没人用的资产在月复盘清理。
