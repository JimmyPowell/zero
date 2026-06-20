# 项目（Project）层设计

> 2026-06-20 起草。本期两条分支之一（`feat/projects-knowledge`，与知识库共享 schema）。配套：[knowledge-base.md](./knowledge-base.md)；变更可视化在独立分支 `feat/file-diff-view`。

## 一、为什么要这一层

当前 Zero 是扁平的 **Workspace → Issue**：issue 直接绑 `repoId + baseBranch`，没有"项目"这个中间分组。两个问题：

1. **知识库无处安放**：团队级知识 + 某个具体项目的知识，需要一个"项目"维度来挂载（见 [knowledge-base.md](./knowledge-base.md)）。
2. **多仓库 / 多任务缺组织**：一堆 issue 平铺，无法按"在做哪个项目"聚合、指派负责人、看推进状态。

引入 **Workspace → Project → Issue** 三级。对标 Multica：它有 `project` + `project_resource`（`server/migrations/034_projects`、`065_project_resources`），但**刻意做得轻**——它甚至把 `autopilot.project_id` 删了，理由"从没在 UI 暴露、没用过"。我们照此**收敛**，不过度设计：项目 = 一个有负责人、有状态、挂着若干资源（代码仓库 / 知识库 / 外部文档）的分组。

> 事实核对：Zero 现状 `schema.ts` 中 `project` / `project_id` **0 处**，前端"需求(requirements)"页 `RequirementsView` 其实就是 issue 列表本身。所以这是**全新增**（schema → 后端 → 前端），不是"数据有了前端没显示"。

## 二、数据模型

> schema 迁移当前到 `0017`（含 attachment）；本期项目层从 `0018` 起。

### 新增 `project`（仿 Multica `034_projects`，落到 Drizzle/MySQL）

- `id` char36 PK
- `workspaceId` → workspace（级联删除）—— **项目绑工作空间，不绑人**
- `title`、`slug`（工作空间内唯一）、`description`、`icon`
- `status`：`planned | in_progress | paused | completed | cancelled`，默认 `planned`
- `leadId` → member（**负责人；先只支持 member**；Multica 允许 agent 当 lead，我们 `leadType` 字段预留，本期不接）
- `createdAt / updatedAt`
- 索引 `(workspaceId)`，唯一 `(workspaceId, slug)`

### 新增 `project_resource`（多态指针，**一表三用**）

- `id` char36 PK
- `projectId` → project（级联）、`workspaceId` → workspace（级联）
- `kind`：`repo | knowledge | notion | gdoc | confluence | url | file …`（自由扩展，加类型零迁移）
- `ref` JSON（按 kind 解释：`repo→{repoId|url, baseBranch, primary?}`；`knowledge→{path}`；`notion→{pageId, tokenRef}`；`url→{href}`…）
- `label`、`position`（排序）、`createdBy`、`createdAt`
- 唯一 `(projectId, kind, refHash)`，索引 `(projectId, position)`、`(workspaceId)`

> **一表三用**：同一张表既挂"项目的代码仓库"（kind=repo），又挂"项目的原生知识库目录"（kind=knowledge），又挂"外部 KB 指针"（kind=notion/url…）。这正是 [knowledge-base.md](./knowledge-base.md) 外部接入需要的指针机制——一张表喂饱代码仓库、原生知识库、外部 KB 三件事。

### 改 `issue`

- 加 `projectId`（可空，FK `ON DELETE SET NULL`，加索引）。
- **不加兼容层**（Zero 未上线，遵循仓库既有约定"不加兼容/回填/双写"）：无项目 issue 的 `projectId` 留空；前端把"无项目"归入一个虚拟 **Inbox** 分组展示，不落库。

### 项目 ↔ 仓库 ↔ issue 的关系

- 项目通过 `project_resource(kind=repo)` **拥有**一个或多个代码仓库；其一标记**主仓库**（`ref.primary=true`，或 position=0）。
- issue 归属项目后**默认继承项目主仓库**；保留现有 `issue.repoId / baseBranch / workDir` 作**单条覆盖**（跨仓任务仍可）。
- 派发时 `assembleContext`（`server/src/lib/dispatch.ts`）的 work 来源优先级：**issue 显式覆盖 > 项目主仓库 > 空**。

## 三、接口（Hono，沿用 JWT + `requireWorkspaceMember`）

- `/workspaces/:ws/projects` —— `GET 列表 / POST 创建 / GET :id 详情 / PATCH :id / DELETE :id`
- `/workspaces/:ws/projects/:id/resources` —— `GET / POST / PATCH :rid / DELETE :rid`
- issue 列表/搜索加 `projectId` 过滤；issue 详情/创建加 project 绑定。

## 四、前端

- 新增 **Projects 导航**（`web/src/components/Layout.tsx` 的 `menus` 数组）+ 项目列表/详情视图（`web/src/main.tsx` 加路由）。
- 项目详情：标题/状态/负责人/描述 + **资源区**（代码仓库 / 知识库入口 / 外部文档）+ 该项目的 issue 列表。
- "需求"（`RequirementsView`）加**按项目分组 / 筛选**，保留"全部"入口。
- 设计令牌沿用：纯白卡片 + `#2563eb` 蓝 + 柔和毛玻璃弹层。

## 五、分期

- **P-Proj-1**：schema（`project` + `project_resource` + `issue.projectId`）+ 迁移 + 后端 CRUD。
- **P-Proj-2**：前端 Projects 导航 + 列表/详情 + issue 项目绑定/分组。
- **P-Proj-3**：项目主仓库继承 → 接入 `assembleContext` 的 work 来源。
- 后续：agent-lead、项目时间线、项目级看板。

## 待办 / 取舍

- 不做：复杂工作流编排 / 审批门（Multica 被吐槽缺这个 #815/#1943，但不在本期）。
- 不做：项目模板、跨项目依赖。
- agent 当负责人：`leadType` 预留，先只接 member。
