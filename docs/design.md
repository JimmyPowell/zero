# Zero 设计理念与数据模型

## 一、核心理念

**issue = 一个真实开发任务**。把它分派给一个 Agent，就等于让一个 AI 队友「在指定仓库/分支上干这件事」；产出（commit / diff / PR）回到 issue 的**同一条时间线**供人 review；人评论一句即可让 Agent 带着完整上下文继续。目标是贴合真人开发者的真实协作流程，并保持界面**清爽**。

## 二、对标 Multica 的三个关键改进

我们调研了 Multica 的代码与公开 issue，针对其短板做差异化（不照搬）：

| 维度 | Multica 的做法 | Zero 的设计 |
|---|---|---|
| **上下文** | 每轮只发 issue ID + 触发评论，agent 得自己 `multica issue get` 去拉；历史只活在 CLI 的 `--resume` 会话里，从不回灌 | **服务端主动装配结构化上下文**（issue + 验收 + 最近评论 + 上次执行摘要 + 仓库分支）整包下发；时间线即可回放的记忆，换机器/会话丢失也不失忆 |
| **会话/记忆** | 单点押在 CLI session，丢了就失忆 | 记忆落在平台侧（`issue_event` 时间线），`--resume` 只作 token 优化，可从时间线重建 |
| **仓库 / worktree** | 先注册 repo → bare clone → 每任务 `git worktree add` + 一堆 git 规避逻辑；不自动清理，撑满磁盘 | issue 绑 `repo + base_branch` 单一来源；一个 issue 一棵 worktree（分支 `zero/ZERO-N`），**issue 关闭即自动清理** |

另外：**一个 issue 一条统一时间线**（评论 = 人/agent 同一条流），不做 Multica 的评论线程 + `--parent` 定位那套复杂机制。

## 三、当前数据模型（Phase A）

MySQL，Drizzle schema 在 `server/src/db/schema.ts`。

### 已有表

- **user** `id, email, password_hash, name, avatar_url, ...`
- **workspace** `id, name, slug, description, ...`
- **member** `id, workspace_id, user_id, role(owner|admin|member)`（多对多 + 角色）
- **issue**
  - `id, workspace_id, number(工作空间内自增→ZERO-N), title, description`
  - `status(backlog|todo|in_progress|in_review|done|cancelled)`，默认 todo
  - `priority(urgent|high|medium|low|none)`，默认 none
  - `assignee_type(member|agent) + assignee_id`（**多态指派，agent 已预留**）
  - `creator_id, parent_issue_id(预留)`
  - `repo_id, base_branch`（**绑定仓库 + 基准分支**）
  - `due_date, created_at, updated_at`
  - 唯一约束 `(workspace_id, number)`
- **issue_event**（统一时间线，单表扁平）
  - `id, issue_id, workspace_id`
  - `actor_type(member|agent|system) + actor_id`
  - `kind`：`created | comment | status_change | priority_change | assignment`
    - **已预留 Phase B**：`run_started | run_progress | run_finished | run_failed | diff_ready | pr_opened`
  - `body`（评论正文 markdown）、`meta`（JSON，如 `{from,to}` / 指派快照）、`created_at`
- **repo** `id, workspace_id, name, url(git URL 或本地路径), default_branch`（workspace 级仓库登记）

### 关键接口（Hono，全部走 JWT + `requireWorkspaceMember`）

- `/workspaces/:ws/issues` —— `GET 列表 / GET search / POST 创建 / GET :id 详情 / PATCH :id 改字段`
- `/workspaces/:ws/issues/:id/events` —— `GET 时间线 / POST 评论`
- `/workspaces/:ws/repos` —— `GET 列表 / POST 登记`
- `/workspaces/:ws/members` —— 成员列表
- 字段变更（状态/优先级/指派）由 PATCH 自动写入 `issue_event`，带 `from→to` 快照。

## 四、前端结构

- 外壳 `Layout`：左侧栏（工作空间切换 + ⌘K 搜索 + C 新建 + 菜单）。整个外壳高度锁死（`html/body/#root overflow:hidden`），滚动只交给内部面板。
- 概览 `OverviewView`：工作台（issue 列表，铺满宽度）。
- 详情 `IssueDetailView`：左内容（标题/描述/时间线/评论，独立滚动）+ 右属性栏（状态/优先级/指派/仓库绑定/详情，钉在最右）。
- 搜索 `SearchCommand`（cmdk 命令面板）、创建弹窗、仓库绑定 `RepoBinding` 等。
- 设计令牌：纯白卡片 + `#2563eb` 蓝 + 柔和毛玻璃弹层动画（`.zero-overlay`/`.zero-dialog`）。
