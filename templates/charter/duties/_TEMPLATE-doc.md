# <duty-id> · 文档交付（<post-id>）

- 承接岗位：<post-id>
- 目标：按卡片要求产出一份可回读的文档，沉淀结论与证据
- 完成：MinIO 上有对象（`bucket/key`）；卡片评论报 key 与一句摘要；回读确认可读
- 载体：doc
- 宪章关注：当期流程、交付标准（非代码交付与 MinIO key 规范）
- 知识：项目宪章；卡片与线程；相关领域背景
- 资源：MinIO 桶 `<bucket>` 的 `deliverables/<projectId>/<ticketId>/`；卡片线程
- 工具：minio_write, minio_read, orchestrator_read, orchestrator_report
- 技能：文档写作与回读校验
- 接单：确认卡片带 `duty:<duty-id>` 且指派给 `<post-id>`；不匹配就不领，报告 dropped
- 步骤：读宪章 → 读卡 → 写文档 → 写入 MinIO → 回读 → 报告 bucket/key
- 常见坑：把正文贴进评论而不是对象存储；没回读就报完成；同一 key 覆盖前没确认是在修订
