# 导航重构 + 需求看板

> 分支 `feat/nav-board`。对标 Multica 的侧边栏分区与看板，**借鉴不照抄**。

## 一、问题（为什么旧版「怪异」）

旧侧边栏是一条平铺列表：`概览 / 需求管理 / Runtime 运行时管理 / 智能体管理 / 技能库 / 设置`。三个毛病：

1. **「概览」名不副实，且和「需求管理」撞车**：`/overview` 渲染的就是需求列表（标题"我的需求"），而「需求管理」`/requirements` 是一个空占位页 —— 两个入口都指向需求，一个有内容一个是空壳。
2. **无分组**：个人日常工作（需求）和平台基建（智能体/运行时/技能）混在一条 flat list，没有分区，显得散。
3. **标签啰嗦**：「Runtime 运行时管理」三重冗余、到处「管理」二字。

## 二、决策

- **合并**：删掉「概览」和空的「需求管理」，统一为落地页 **我的需求**（`/requirements`）。
- **分区**：个人区（我的需求）+ **平台区**（智能体 → 运行时 → 技能库）。平台区这条顺序即 Zero 主线 `需求 → 智能体 → 运行时`。
- **看板**：需求页支持 **列表 ⟷ 看板** 两种视图（参考 Multica 的状态分列看板）。

## 三、最终侧边栏

```
[Z] jimmy              ▾
🔍 搜索…             ⌘K
✎  新建需求           C
                           ← 个人区（无标题）
◉  我的需求               /requirements   ← 落地页（issue 详情页也保持高亮）

平台                       ← 分组小标题（折叠态用细分隔线替代）
🤖 智能体                 /agents
🖥 运行时                 /runtime
📖 技能库                 /skills

⚙  设置        （底部固定） /settings
‹  收起                    折叠开关
```

标签清理：`Runtime 运行时管理 → 运行时`、`智能体管理 → 智能体`、`新建 issue → 新建需求`。
保留（用户认可、刻意不学 Multica）：磨砂底色、设置钉底部、折叠开关；不引入 Multica 的 项目 / 小队 / Autopilot / 底部 Help。

## 四、需求页：列表 / 看板

页面顶部右上角切换，选择持久化在 `ui-store`（`localStorage: zero-view-mode`，默认 `list`）。

- **列表**：原有 `IssueRow` 列表，保留。
- **看板**：按 `STATUS_ORDER` 分 7 列（待规划 / 待办 / 进行中 / 评审中 / 阻塞 / 已完成 / 已取消）；列头与卡片**复用现成的 `statusMeta` / `priorityMeta`**（图标+配色），卡片信息=ZERO-N + 标题 + 优先级 + 负责人头像。
- **拖拽（dnd-kit）**：跨列拖 = 改状态，走现成 `PATCH /workspaces/:ws/issues/:id`（会自动写 `status_change` 时间线事件）；乐观更新 + 失败回滚。只有列是 droppable，卡片是 draggable，碰撞用 `pointerWithin`，简单稳。

## 五、改动文件

- `web/src/components/Layout.tsx` — 分组（personalNav/platformNav）+ 抽出 `NavLinkItem`/`NavGroupLabel`。
- `web/src/lib/ui-store.ts` — 标签清理 + 持久化 `viewMode`。
- `web/src/main.tsx` — `/`、`/overview` → `/requirements`；删 `PlaceholderView`。
- `web/src/views/OverviewView.tsx → RequirementsView.tsx` — 加视图切换 + 条件渲染。
- `web/src/components/issue/RequirementsBoard.tsx` — 新增看板。
- 依赖：`@dnd-kit/core`。

## 六、待办（Phase 3）

- **列内拖拽排序**：需给 `issue` 表加 `position` 字段（目前只有 `agent_skill` 有）+ 迁移 + 落序接口；当前列内按后端返回顺序。
- 顶部 `全部 / 成员 / 智能体` 过滤 tab、排序、隐藏列（对标 Multica 截图）。
