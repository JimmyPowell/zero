# Phase B：Agent 执行体系

> 状态：方案设计中（已细化 worktree / session / 执行日志）。Phase A 已铺好底座（统一时间线 + 预留 `run_*` 事件 + 仓库/分支绑定）。

## 一、目标

让「**评论触发 → 真实调用编码 Agent → 在绑定仓库的 worktree 里改代码 → 结果回时间线**」这条闭环真正跑起来。**是真的去调一个真实的编码 Agent CLI**（首选 Claude Code `claude -p` 无头模式，后续可扩 Codex 等），不是模拟。

## 二、三个核心概念

- **Agent（智能体）**：一个 AI 队友的配置 —— 用哪个 CLI/provider（Claude Code/Codex…）、哪个 model、system 指令(instructions)、跑在哪个 runtime。存 `agent` 表（workspace 级）。issue 的 `assignee_type='agent'` 已预留。
- **Runtime（运行时）**：真正干活的地方 —— 用户机器上跑的一个**本地 daemon 进程**（我们提供）。它与服务端配对、认领 task、在 worktree 里 shell 出 agent CLI、把执行流回传。存 `runtime` 表 + 心跳/在线状态。
- **Worktree / 仓库**：issue 绑 `repo + base_branch`；runtime 为每个 issue 建/复用一棵 worktree（分支 `zero/ZERO-N`），跑完留分支/PR，**issue 关闭自动清理**。

## 三、派发执行闭环

```
①触发                ②入队 + 装配上下文          ③本地 Runtime 认领
issue 指派给 agent /  服务端建 task(queued)；      daemon 轮询/被通知 →
在 issue 下评论        【关键】服务端把 issue标题+    原子 claim（带 lease 防重复）
（含语音转写）          描述+验收+最近评论+上次执行     │
   │                  摘要+仓库分支「整包」塞进 task  ▼
   ▼                                              ④执行（真实调 Agent）
                                                  git worktree（复用 zero/ZERO-N）
                                                  写 CLAUDE.md(装配好的上下文)
                                                  claude -p "<指令>" [--resume <session>]
                                                   │ 流式回传工具调用/进度
                                                   ▼
⑥继续循环             ⑤结果回时间线               run_started / run_progress /
review → 再评论 →      agent 发一条 comment 总结     run_finished / diff_ready /
触发新 task → 带会话    + run_* 事件进同一条时间线；   pr_opened → 写入 issue_event
恢复继续               issue 状态自动 → in_review
```

### 状态机分离（修 Multica 的坑）

- **issue.status**（人看的工作流状态）与 **task/run 状态**（queued/running/succeeded/failed）**彻底分开**。agent 卡死只影响 run，绝不让 issue 状态错乱。
- run 成功产出 → issue 自动 `in_review`；失败 → issue 保持原状，只在时间线记一条失败事件。

### 上下文装配（核心改进）

每次创建 task 时，**服务端**拼好结构化上下文随 task 下发：
`issue 标题 + 描述 + 验收点 + 最近 N 条时间线（评论 + 上次 run 摘要）+ 绑定仓库/分支`。
agent 总能看到完整上下文，不靠自觉去 fetch；会话丢失也能从时间线重建（时间线即记忆）。

## 四、实时执行日志

- daemon 用 **`claude -p --output-format stream-json`** 跑，Claude Code 流式吐出每一步（读文件 / 改文件 / 跑命令 / 模型文本 / 结果）。
- daemon 实时转给服务端 → 服务端经 **WebSocket 推到浏览器** → 详情页**实时执行日志面板**滚动显示「正在读 `auth.ts` → 编辑 → 跑测试 …」。
- 两个粒度：
  - **粗粒度里程碑**进主时间线（`run_started/finished/diff_ready/pr_opened`）。
  - **细粒度逐步日志**存成可回放的 run log（类似 Multica 可展开的「执行日志 / 历史运行」）。

## 五、仓库 & worktree 的本地形态

daemon 管理的本地目录（路径可配）：

```
~/.zero/
├── repos/        ← 每个仓库一份「源 clone」（绑定时克隆一次，之后只 fetch）
│   └── <workspace>/<repo>/      (普通 clone，非 bare)
└── worktrees/    ← 每个 issue 一棵 worktree，从源 clone 派生
    └── <workspace>/ZERO-N/      (分支 zero/ZERO-N，基于 base_branch)
```

规则：
1. **仓库源两种都支持**（已确认）：绑定时可填**本地已有路径**（直接用你现有 clone，worktree 从它派生）或 **git URL**（daemon clone 到 `~/.zero/repos`）。本地优先，URL 为云端/多人留路。
2. **一个 issue 一棵 worktree，且复用** —— 不是每条评论新开。该 issue 的所有对话都在 `worktrees/.../ZERO-N/`（分支 `zero/ZERO-N`）这一棵树上**累积修改**。
3. **issue 关闭 → 自动 `git worktree remove` + 收分支**（有 PR 则保留分支）。结构上避免「worktree 撑满磁盘」。
4. worktree 是独立目录，**用户主工作副本不受影响**。

## 六、会话复用、缓存与多智能体

两层，分开看 —— **注意 key 不同**：

- **worktree（代码）按 `issue` 共享**：一个 issue 一棵树一分支 `zero/ZERO-N`，多个 agent **轮流接力、每轮提交**，最后一条分支一个 PR。
- **session（对话上下文）按 `(agent, issue)` 隔离**：每个 agent 在该 issue 上有自己的会话线 —— 跑完存下 Claude Code 返回的 `session_id`，同一 agent 下次默认 `claude -p --resume <session_id>`（它读过的文件、推理、prompt cache 都还在，更快更省）。

**关键兜底（比 Multica 强的地方）**：session 复用只是**优化**，不是命根子。Multica 记忆只押在 CLI session 上，换机器/过期/重开/换 agent 就失忆；Zero 把**持久记忆放在时间线（`issue_event`）**，任何 run（含换 agent）都带「全量时间线 + 上次 run 摘要」装配的上下文，session 没了也能重建，**不失忆**。

**何时新开 session**：用户手动「全新重跑」、上次跑崩（撞迭代上限/吐垃圾）、session 丢失、或**换了一个 agent**（它开自己的会话线）。

### 多智能体（同一 issue @不同 agent）

- `@A` → 开 `session_A`；`@B` → 开 `session_B`（B 全新会话，但带全量时间线上下文，知道 A 干了啥）；再 `@A` → resume `session_A`。每个 agent 一条独立记忆线，互不串。
- **代码共享**：A、B 都在同一棵 worktree、同一分支 `zero/ZERO-N` 上接力（**串行**，同一 issue 同时只跑一个），B 接着 A 提交后的代码继续。
- **skill 跟 agent 走**：A 有 A 的 skill、B 有 B 的，谁跑加载谁的。
- 数据层：`task` 的 `session_id` 按 `(agent_id, issue_id)` 取最近一次；worktree/分支只按 `issue_id`。

> 一句话：**代码按 issue 共享一棵树一分支、session 按 (agent,issue) 隔离**；issue 关闭一起清理；吃 Claude Code 原生 `--resume` 缓存，但真正的记忆在时间线上。

## 七、计划新增的数据 / 接口（待实现）

- 表 `agent`：`id, workspace_id, name, avatar_url, provider(claude_code|codex|…), model, instructions, runtime_id, status, ...`
- 表 `runtime`：`id, workspace_id, name, kind(local|cloud), last_heartbeat_at, capabilities(JSON), status, ...`
- 表 `repo`（已存在）补充：源类型（本地路径 / URL）。
- 表 `task`（≈ agent run 队列）：`id, issue_id, agent_id, runtime_id, status(queued|claimed|running|succeeded|failed|cancelled), trigger_event_id, context(JSON 快照), session_id, work_dir, attempt, lease/heartbeat, ...`
- 复用 `issue_event.kind` 的 `run_*` 把执行流写进时间线；细粒度 run log 单独存。
- daemon 侧接口：claim / start / heartbeat / report-events(stream) / complete-fail。

## 八、子阶段拆分（每步可独立验收）

- **B1 智能体管理**：`agent` 表 + CRUD 页（「智能体管理」菜单）；能建 agent、指派给 issue。
- **B2 本地 Runtime / daemon**：能配对、认领 task、跑命令的本地进程（先只接 Claude Code）；「Runtime 运行时管理」菜单显示在线/心跳。
- **B3 派发 + 上下文装配 + worktree 执行 + 实时日志**：跑通「指派 → 执行 → 出结果」，`run_*` 与流式日志进时间线/日志面板。
- **B4 继续循环**：评论触发再派发 + 会话恢复，实现「评论 → agent 改代码 → 回复」。

## 九、对这个场景的落地说明

用户本就在用 Claude Code，所以 MVP 极其落地：**本地 daemon 无头调用 `claude` 在绑定仓库的 worktree 里干活**，实时日志走 stream-json。worktree 简化 + 自动清理，从结构上避免 Multica「worktree 撑满磁盘」。
