# CAPABILITY · 能力供给总纲（最小版）

> 先用它回答三个问题：资产放哪、谁负责、什么算合格。长版本见产品仓库 `EA.md`。

## 资产清单

| 层 | 路径 | Owner | 节奏 | 完成定义 |
| --- | --- | --- | --- | --- |
| 契约 | `README.md`、本文件 | PM | 每周最多一版 | 版本 +1、面板同文 |
| 职责 | `duties/` | PM + 岗位 | 随宪章 | 解析通过、岗位卡可选中 |
| 复盘 | `reviews/` | PM | 周（日/月按需） | 有数据、有 ≤3 条行动项（Owner+期限） |
| 上下文 | `context/retrospectives.md`、`context/domain/` | PM | 复盘后 24h / 每周 | 指针最新；对象有来源与有效期 |
| 知识 | `KE/` | PM | 每周 | 过 MAKE 并登记 `KE/index.md` |
| 技能 | `skills/` | PM + 岗位 | 有真实使用再发布 | 有测试证据、版本、Owner |

## 质量门槛

- **复盘**：有数据、有改进、有 Owner 与期限；24 小时内更新最新总结。
- **知识**：Minimal / Actionable / Knowledge / Experience 至少满足 3 项，缺 Actionable 或 Experience 退回。
- **技能**：先 draft，真实工单用过再 testing，有测试证据才 published。
- **职责**：有目标、完成定义、载体、步骤、常见坑；否则不能派工。

## 每周健康检查（5 分钟）

- [ ] 本周 `reviews/` 有文件且行动项在跟踪
- [ ] `context/retrospectives.md` 指向最新复盘（≤7 天）
- [ ] `KE/index.md` 有条目且状态与文件一致
- [ ] `skills/registry.md` 状态与目录一致（没有"无测试的 published"）
- [ ] `duties/` 解析通过，岗位卡能选中
