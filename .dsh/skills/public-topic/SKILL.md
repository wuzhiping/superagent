---
name: public-topic
description: 用 ntfy 把「标题 + Markdown 正文 + 标签」推送到 msn.feg.cn 的 public topic。topic 是参数、默认前缀 pub_（-Topic dsh → pub_dsh）。当使用者说「推送／通知／ntfy／发到某个 topic／推到这个频道」时使用。
whenToUse: 需要把一段带标题的 Markdown 消息推送到 ntfy public topic 做通知时，例如每日资讯摘要、任务完成提醒。
---

# public-topic

把标题 + Markdown 正文推送到 ntfy（默认 server `https://msn.feg.cn`）。

**topic 是参数，`pub_` 是默认前缀**：

| 传入 | 实际推送 |
| --- | --- |
| `-Topic dsh`（默认） | `pub_dsh` |
| `-Topic pub_dsh` | `pub_dsh`（已带前缀，原样保留） |
| `-Topic dsh,news` | `pub_dsh,pub_news` |
| `-Prefix dev_ -Topic dsh` | `dev_dsh` |

## 用法

```powershell
# 正文首行写 "## 标题" —— 它作为通知 title，并会被自动从正文里移除
powershell -NoProfile -File scripts\push.ps1 -BodyFile body.md -TagsFile tags.txt -Topic dsh
```

| 参数 | 说明 |
| --- | --- |
| `-BodyFile` | **必填**，UTF-8 Markdown 正文，首行 `## 标题` |
| `-Topic` | 目标 topic，默认 `dsh`；缺前缀自动补 `pub_`，支持逗号分隔多个 |
| `-Prefix` | 默认 `pub_` |
| `-TagsFile` | 标签文件（UTF-8，逗号或换行分隔），**中文标签必须走这里** |
| `-Title` | 可选，省略则取正文首个 `## ` 行 |
| `-Priority` | 默认 `3` |
| `-Server` | 默认 `https://msn.feg.cn`，可用环境变量 `NTFY_SERVER` 覆盖 |
| `-PrintPayload` | 只打印生成的 JSON，不发送（干跑排错用） |

成功输出：`HTTP 200 -> https://msn.feg.cn/pub_dsh  id=<消息id>  (bytes, tags: ...)`

## 查最近已推送的标题（去重用）

```powershell
powershell -NoProfile -File scripts\history.ps1 -Topic dsh -Since 168h
```

输出每行 `<yyyy-MM-dd HH:mm><TAB><标题>`，按时间升序（同 `push.ps1` 一样，`-Topic dsh` 自动补成 `pub_dsh`）。

- **`-Since` 用 Go duration 语法，只有 `s`/`m`/`h`，没有 `d`**：7 天写 `168h`——写 `7d` 会被服务端拒成 HTTP 400。
- 服务端保留 15 天，所以 7 天窗口完全由服务端历史承担，**不需要本地台账**。
- 用途：挑选新闻时排除与最近已推送标题属于**同一事件**的条目。**去重单位 = 同一事件**（2026-10-26 起放宽）：同一主体但事件/主题实质不同的**新事件照推**，例：已推过「OpenAI 代理自行关闭对齐监控」不再挡「OpenAI 完全离线训练」「OpenAI 监控漏洞报告」等同为 OpenAI 的新消息；仍要挡掉同一事件的后续报导与二次转载。

## 正文写法

首行 `## 新闻标题`，之后每个要点独占一段、段间空行；关键数字**加粗**；价格用反引号；来源单独一行；结尾一行斜体。

```markdown
## TypeSafe 估值冲上 75 亿美元

💰 **融资** — 完成 **8.7 亿美元 A 轮**，估值 **75 亿美元**

🔗 **来源**：[36氪](https://www.36kr.com/p/4019333008840320)

*DSH 每日 09:00 自动汇总 · 2026-10-10*
```

## 标签规范

标签文件一行，逗号分隔，**第一个必须是新闻分类（繁体中文）**，后面固定跟装饰标签：

```
<新闻分类>,fire,robot            # 基准
<新闻分类>,fire,robot,newspaper   # 按内容追加 newspaper / chart_with_upwards_trend / warning
```

- **只能有一个中文分类**：不要同时挂两个（如 `算力硬件,AI融資`），下游按第一个标签做分类过滤。
- `fire` 与 `robot` 是固定装饰标签，**每条都要带**，避免同一订阅源里标签形态不一致。
- 分类取值：`模型發佈` / `AI融資` / `行業爭議` / `安全政策` / `AI Agent` / `算力硬件` / `應用落地` / `安全事件` / `安全評測` / `開源安全` / `AI治理` / `資安` / `AI應用落地` / `AI新技術突破`。

## 服务器 API 实测行为（msn.feg.cn，2026-10-28 验证）

| 动作 | 行为 |
| --- | --- |
| `POST /` | 正常发布，返回 `id` |
| `GET /<topic>/json?poll=1&since=<dur>` | 返回 **NDJSON**（一行一个 JSON 对象），含 `message` 事件与 `message_delete` 事件；普通消息也带 `event:"message"` |
| `GET /<topic>/json/<id>` | **一律回 404**（连仍然存在的消息也一样），本服务器不提供单条查询——**不能用它判断消息还在不在**（2026-10-29 复测：随手拿 3 条已发布消息试，全部 404） |
| `PUT /<topic>/<id>` | **不支持更新！** 它会把 JSON 当成新消息发布出去（凭空多出一条正文为原始 JSON 的垃圾消息）。**永远不要用 PUT 改已推消息** |
| `DELETE /<topic>/<id>` | **支持**，返回 `{"event":"message_delete","id":"<墓碑事件自己的新id>","sequence_id":"<被删消息的id>"}` |

因此 `history.ps1` 会跳过非 `message` 事件与无标题的记录，否则删除事件会污染去重基线。

### 数一个 topic 当前还「活着的」有几条消息

poll 串流里 `event:"message"` 是消息，`event:"message_delete"` 是墓碑事件；**被删掉的那条消息的 id 记在墓碑的 `sequence_id`**，而墓碑的 `id` 是它自己新生成的 id（两者不要搞混）。所以：

```
活着的条数 = message 事件数 − message_delete 事件里 sequence_id 命中 message id 的条数
```

删掉一条旧消息再补推一条新的之后，用这个口径复核，才不会把墓碑算成多一条。

## 三个必须遵守的坑（都实际踩过，别重犯）

1. **不要在命令行传 `-Title`**：标题常含智能引号 `“ ”`，而 PowerShell 把它们当字符串分隔符，会打乱整串参数——曾把标题残片塞进 `-Topic`，ntfy 回 `40009 invalid request: topic invalid`。标题一律交给正文首行 `## `。
2. **不要在命令行传中文 `-Tags`**：`powershell.exe` 用 ANSI 代码页解码 argv，`分类` 会变成 `鍒嗙被`。中文标签写进 `-TagsFile`；命令行只留纯 ASCII 参数。
3. **不要用 `ConvertTo-Json` 拼 payload**：PS 5.1 会把 `Get-Content -Raw` 得到的字符串偶发序列化成数 MB 的 provider 转储，ntfy 回 `413 Request Entity Too Large`。脚本内已手写 JSON 转义，并在发送前用 `ConvertFrom-Json` 自校验。

> 本脚本按 Windows PowerShell 5.1（`powershell.exe`）编写；该环境无 `pwsh`。
