# 015 — Team 视角、岗位权限门禁恢复、「我的岗位设置」与「没有宪章不可开工」

日期：2026-11-06。用户三条要求：

> 「PM视角」应该是「Team视角」。
> 岗位视角中，我的岗位设置。
> 如果需要切换到 PM 岗位需要验证权限是否匹配，没有宪章不可开工。

## 1. 「PM 视角」改名「Team 视角」

- `src/client/locales.ts`：`perspective.pm` = `Team 视角` / `Team view`；注释与 SOP/RD/docs 的措辞同步（Team 视角 = 团队/PM 岗位的那把椅子）。
- 内部标识仍为 `pm`（浏览器 localStorage 的旧选择继续有效），改的只是面向人的名字。

## 2. 切到 Team（PM）岗位前验证权限（恢复 2026-11-05 暂停的门禁）

- 恢复 `src/client/capabilities.tsx`（`CapabilitiesProvider`、`useCapabilities`、`permissionLines`、`PermissionBanner`）、`app.tsx` 的 `CapabilitiesProvider` 与切换确认弹窗、`posts.tsx`/`settings.tsx` 的权限横幅、`.dt-permission` 样式与 `permission*` 文案（从 `78e3bd2^` 取回原实现）。
- 行为：点「Team 视角」时先 `GET capabilities`；`canManageFlow` 为 false → 弹窗说明账号、角色、缺的权利，读者可「仍然切换」；Team 视角内常驻横幅。没有账号时按原设计提示去来源卡片配置。
- 测试恢复：`tests/panel-perspective.spec.tsx`（member 账号弹窗 + admin 直接切换）与 `tests/panel-posts.spec.tsx`（横幅），共 14 条。

## 3. 岗位视角里的「我的岗位设置」

- 岗位视角的「设置 → 项目与岗位」改名为 **「我的岗位设置」**（`settingsMyPost`），页面标题与导航一致；页面只显示自己的岗位并只允许改自己的岗位身份（岗位 id、显示名、Kanban 账号、Gitea/ntfy 身份、WIP、监听列），项目、topic、宪章只读（由 PM 在 Team 视角维护）。
- `settings.tsx` 的组名/标题按视角取词；`project.tsx` 的岗位区块标题在 scoped 模式下显示「我的岗位设置」。

## 4. 没有宪章不可开工（主机侧闸门）

- `src/core/reasons.ts` 新理由 `noCharter`；`src/app/charter.ts` 新增 `charterAllows(archive, target, trigger)`：触发器属于本机档案里的项目时，必须有已发布宪章（版本 > 0）；不属于项目/档案不认识的项目不设闸门。
- `src/app/assessment.ts`：评估的 **accept** 先过 `gateOutcome()`（导出、可单测）——没有宪章就变成带 `noCharter` 理由的 **ignore**，不建工单。
- `src/app/tools/main.ts`：主会话 `orchestrator_route` 的 **accept** 同样过闸门（该工具改成逐项 `await`，拒绝时返回 `Ticket was not created: <noCharter>`）。
- 两条路径共用 runtime 里的同一个 `charterAllows` 闭包（档案 + 宪章目标）。
- 面板：团队页在有项目缺宪章时显示红色横幅「没有宪章不可开工」；`reason.noCharter` 有中英文案。
- 岗位提示词（`prompts/work.md`）加了一句：没有宪章的项目不会开工，那是 PM 要修的事，不是岗位绕过的理由。
- 单测：`tests/charter-gate.spec.ts`（6 条：有/无宪章、无项目、`gateOutcome` 的接受/拒绝/旁路）。

## 5. 验证

- `pnpm typecheck` 干净；相关单测 `assessment`、`tools`、`panel-perspective`、`panel-posts`、`styles`、`locales`、`charter-gate` 共 61 条通过。
- 线上（重装 bundle 后，浏览器实测）：
  - 视角开关显示 **`Team 視角` / `崗位視角`**；
  - 岗位视角 设置 → 导航首项为 **`我的崗位設定`**，打开后标题为「我的崗位設定」，提示文案说明只改自己的岗位；
  - 从岗位视角切回 Team 视角：本机账号是 admin（`canManageFlow=true`），**不弹窗直接进入**，`aria-pressed` 正确，页面无权限横幅；
  - 团队页无缺宪章项目（RSI 已发布 v12），「没有宪章不可开工」横幅不出现（缺宪章路径由单测覆盖）。
- 说明：member 账号的弹窗与「没有宪章拒绝开工」的线上实测需要改动账号/项目档案，未在本轮线上制造；分别由面板单测与 `tests/charter-gate.spec.ts` 覆盖，闸门的接线（runtime → 评估 / 主会话工具）由 typecheck 与既有 `assessment`/`tools` 测试保证。

## 6. 文档

RD §4.1（门禁恢复 + 没有宪章不开工）、SOP §2.6/§2.7（Team 视角、权限自检、没有宪章不可开工）、`docs/005`（座位命名）、`docs/007`（新增测试行）、`TDD/011 §4.7`（暂停 → 已恢复）、本文件。
