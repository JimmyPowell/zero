# 进展日志

> 每完成一块开发 / 有重要进展就在最上面追加一条（倒序）。日期用绝对日期。

## 2026-06-19 · B1 智能体管理 完成

**后端**
- `agent` 表（迁移 0003）：`name / avatar_url / provider(claude_code|codex|opencode) / model / instructions / runtime_id(B2 预留)`，`(workspace_id,name)` 唯一。
- 接口：`GET/POST/PATCH/DELETE /workspaces/:ws/agents`（重名 409；删 agent 自动解除其在 issue 上的指派）。
- `issues.ts` 重构：统一查询基座同时 leftJoin member/agent/repo，**issue 能正确解析 agent 类型指派**（名字+头像）；create/PATCH 支持指派给 agent，指派变更事件带 agent 标签快照。

**前端**
- 「智能体管理」菜单页（`AgentsView`）：列表 + 新建/编辑弹窗(`CreateAgentDialog`) + 删除（含确认）。
- 指派选择器(`AssigneePicker`)支持「成员 / 智能体」分组，改为 `{type,id}` 形态；创建弹窗 + 详情页右栏都能指派给 agent。
- 新增 `ActorAvatar`（agent 用紫色机器人图标区分），用于列表/时间线/指派。

**说明**：B1 只做"定义 agent + 指派"，不碰执行；agent 列表显示「未绑定运行时」，为 B2 铺路。

**已知小问题**：`issue_event.created_at` 秒级精度，同一秒多条事件排序可能不稳——待用毫秒精度修。

## 2026-06-19 · Phase B 执行体系方案细化（设计）

- 确认：评论触发 = **真实无头调用 Claude Code** 在绑定仓库的 worktree 里干活（非模拟）。
- **worktree**：一个 issue 一棵、跨对话复用、issue 关闭自动清理。源 clone 在 `~/.zero/repos/`，worktree 在 `~/.zero/worktrees/`。
- **仓库源**：本地路径 + git URL **两种都支持**（本地优先）。
- **session**：按 `(agent, issue)` 隔离，同一 agent 复用 `--resume`；持久记忆放时间线，session 丢失/换 agent 都能从时间线重装配（不失忆）。
- **多智能体**：同一 issue 可 @不同 agent；代码**共享一棵 worktree 一分支**（串行接力、一个 PR），session 按 agent 隔离，skill 跟 agent 走。
- **实时执行日志**：`stream-json` → WebSocket → 详情页日志面板（粗粒度进时间线、细粒度存 run log）。
- 详见 [phase-b-execution.md](./phase-b-execution.md)。下一步从 **B1 智能体管理** 开始。

## 2026-06-19 · Phase A 完成（需求 + 协作底座）

**认证 / 工作空间**
- 注册/登录/me（argon2id 哈希 + 7 天 JWT），工作空间 + 成员（owner/admin/member）。

**Issue 模块**
- `issue` 表：工作空间内自增 `number`（展示 `ZERO-N`）、状态/优先级/多态指派（member|agent 已预留）。
- 接口：列表 / 搜索（CJK 友好）/ 创建；概览改为工作台（issue 列表）。
- 搜索（⌘K 命令面板）+ 新建（C）移到左侧栏，全局可用。

**Issue 详情页 + 统一时间线**
- 路由 `/issues/:id`，两栏布局：左内容（可改标题/描述 + 时间线 + 评论）独立滚动，右属性栏（状态/优先级/指派/仓库/详情）钉最右。
- **单表 `issue_event` 扁平时间线**：created/comment/status_change/priority_change/assignment，预留 `run_*`。
- PATCH 改字段自动写时间线（带 from→to 快照）；发评论。
- 顶部面包屑显示 `← 返回　ZERO-N　标题`。

**仓库绑定（占位）**
- `repo` 表（workspace 级登记）+ issue 绑 `repo_id/base_branch`；右栏可选仓库/加仓库/设分支（仅元数据，未接执行）。

**体验打磨**
- 文档级滚动锁死（`html/body/#root overflow:hidden`），外壳定死、只内部面板滚动。
- 弹层柔和毛玻璃 + 淡入动画（`.zero-overlay`/`.zero-dialog`）。

**数据库迁移**：`0000` 初始 → `0001` issue → `0002` issue_event + repo + issue 绑定字段，均已应用到本地容器。

---

## 下一步

- Phase B（Agent 执行体系），见 [phase-b-execution.md](./phase-b-execution.md)，从 **B1 智能体管理** 开始。
