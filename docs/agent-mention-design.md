# Agent @提及与跨运行时协作（ZERO-74：调查 + 落地方案）

> 2026-07-08 整理。回答三个问题：① 我们（push）与 Multica（pull）在消息上下文传递上的区别；② Multica 的「会话内 @ 其他 agent（可跨运行时）」是怎么实现的、跨运行时时消息上下文怎么传；③ Zero 如何贴合已有架构落地同等能力。
> 上下文模型对比的完整版见 [agent-context-model.md](./agent-context-model.md)（本文只重述结论）；续跑/唤醒机制见 [agent-continuation.md](./agent-continuation.md)。
> 结论先行：**Zero 落地 @mention 成本很低**——runtimeId 路由、(agent,issue) 会话、共享时间线、去重/链深护栏样板全都已存在，缺的只是「解析 @ → 给被点名 agent 也建 task」这一段接线，跨运行时能力随现有 claim 机制**自动获得**。

## 1. push vs pull：结论重述

两边架构惊人地同构：**都是 issue 为中心、session 按 (agent, issue) 一条、`--resume` 续接、共享 issue 评论区当 agent 间唯一通信介质**。真正分野只在「世界状态怎么到 agent」：

| | Zero | Multica |
|---|---|---|
| 上下文送达 | **厚 push**：claim 响应里预拼 issue + 最近 20 条评论 + repo + 知识库（`server/src/lib/dispatch.ts:98` `assembleContext`）；resume 只推增量 | **瘦 push + 自拉**：prompt 只给 issueID + 触发评论那一条正文 + 新评论计数（`server/internal/daemon/prompt.go:17`、`handler/daemon.go:1390`）；历史评论**强制** agent 自己跑 `multica issue comment list` 拉（`execenv/runtime_config.go:683` 标 mandatory） |
| 拉取通道 | MCP（`daemon/src/mcp-context.ts` 6 个 zero_* 工具） | **CLI**（`multica` 二进制注入 PATH + 任务级 token，明令禁 curl；平台数据不走 MCP，`agent.mcp_config` 只是用户自配的外部工具） |
| 弱模型/工具纪律 | 不依赖：全量保底塞进 | 强依赖：agent 不老实拉就缺/过时上下文 |
| 超长历史 | 20 条窗口 + MCP 回拉兜底 | 分页拉深（cap 2000），天然扛长线程 |

我们已是「厚 push 保底 + MCP pull 加深」的混合模型（agent-context-model.md §5），这个底盘**不需要为 @mention 改动**。

## 2. Multica 的 @mention 实现（代码实锤）

### 2.1 解析在服务端，前端只管序列化

- 前端（Tiptap）把 @ 序列化为 markdown 链接 `[@Name](mention://<type>/<id>)`，type ∈ member/agent/squad/issue/all（`packages/views/editor/extensions/mention-extension.ts:67`）。
- **服务端 CreateComment 时正则解析**（`server/internal/util/mention.go:16` `MentionRe`、`:24` `ParseMentions`），前端不参与触发决策。

### 2.2 触发链：@ 谁 → 任务入到谁的 runtime 队列

`CreateComment`（`handler/comment.go:915`）→ `triggerTasksForComment`（`:1067`）→ `computeCommentAgentTriggers`（`:1157`）汇总**三类触发源**：`issue_assignee`（被指派者，同我们现状）、`mention_agent`（被 @ 的 agent）、`mention_squad_leader`（@ 小队 → 触发 leader）。每个触发 → `EnqueueTaskForMention`（`service/task.go:499`）→ 插 `agent_task_queue` 行，**`runtime_id` = 被 @ agent 自己绑定的 runtime**（`task.go:530`），带 `trigger_comment_id`。

### 2.3 被 @ agent 拿到的上下文 & 会话管理

- claim 响应只内联**触发评论正文 + 作者类型/名字 + 新评论计数**（`handler/daemon.go:1390-1450`）；issue 正文、历史评论 agent 自己拉 → 它能看到**完整 issue 评论区**（含其他 agent 和人的全部发言），不是只有一条。
- **session 严格按 (agent_id, issue_id) 各自独立**（`daemon.go:1461` `GetLastTaskSession(AgentID, IssueID)`），且要求 `prior.RuntimeID == task.RuntimeID` 才 resume（`:1472`）。A、B 在同一 issue 交替对话时各 resume 各的 provider 会话，**互不共享推理上下文，全部「对话」都经 issue 评论区**（一方 comment add，另一方被触发后 comment list 读到）。

### 2.4 防环护栏（他们踩过的坑，全要抄）

- brief 明文教育「回复别人时默认**不要 @ 回去**，否则互相触发死循环烧钱」（`runtime_config.go:755`）；agent 作者触发时 prompt 再追加防环提示（`prompt.go:154`）。
- claim 带 `TriggerAuthorType`（agent/member）供判断；`HasPendingTaskForIssueAndAgent` 去重（`comment.go:1458`）；一堆抑制规则（非触发线程不触发、`commentMentionsOthersButNotAssignee` 等）。

### 2.5 跨运行时：路由键就是 runtime_id，上下文经 DB 不经机器

- **server 不 push 任务**：WS 只发「有任务了，醒来去 claim」信号（`pkg/protocol/messages.go:19` 注释明说 daemon 仍走 HTTP claim），daemon 3s 轮询 + WS 即时唤醒（`daemon.go:2474`）。
- **消息上下文的跨机传递 = 共享 DB**：评论区在 server DB 里，claim 响应把触发评论带过去，其余被 @ agent 用 CLI 回拉。**provider session 永远是机器本地的**，不迁移；跨机连续性靠「评论区全量可拉 + 各自 session」。
- 本地/云端 runtime 完全同构（云端只是 Fleet 托管的 VM 上跑同一 daemon 二进制，任务分发不走云代理通道）。
- 安全：claim 时铸**任务级 token**（`mat_`，绑定 agent×task×workspace，migration 108）注入 `MULTICA_TOKEN`，不用 runtime owner 凭证。
- Squad = 语法糖：leader 被触发时 Instructions 里拼进 Operating Protocol + 成员 roster（可直接粘贴的 mention markdown，`handler/squad_briefing.go:19/121`），**分发就是 leader 发一条 @ 成员的评论**，复用同一条 mention 触发链。

## 3. Zero 现状：已具备 vs 缺失

| 能力 | 状态 | 落点 |
|---|---|---|
| 按 runtimeId 路由任务、多机 claim 分片 | ✅ 已有 | task.runtimeId + 条件 UPDATE 抢占（`server/src/routes/daemon.ts:267-351`）；注册/心跳/并发上限齐全 |
| N agent : 1 runtime，claim 按 task.agentId 取人设 | ✅ 已有 | `daemon.ts:321-339` |
| session per (agent, issue) + resume + 失败全量回退 | ✅ 已有 | `dispatch.ts:58-81`、`daemon/src/index.ts:1868-1876` |
| 共享时间线厚 push（含其他 agent 发言） | ✅ 已有 | `assembleContext` 不分作者全带（`dispatch.ts:122-154`） |
| (issue, agent) 去重、链深护栏样板 | ✅ 已有 | `dispatch.ts:44-56`；`continuation.ts:10` MAX_AUTO_CHAIN=12 |
| **@ 解析（前端/服务端）** | ❌ 零实现 | 评论就是纯 textarea 存原文（`issues.ts:848-895`） |
| **fan-out 到非 assignee agent** | ❌ | `enqueueTaskForIssue` 写死走 `iss.assigneeId`（`dispatch.ts:20`） |
| **agent 评论触发别的 agent** | ❌ | `/complete` 只写评论不 enqueue（`daemon.ts:710-816`） |
| **同 issue 多 agent 并发治理** | ❌ 有坑 | worktree **每 issue 一棵**（`daemon/src/index.ts:752`）→ 同 runtime 两 agent 并发互踩；跨 runtime 同名分支冲突 |
| 前端 autocomplete / 高亮 | ❌ | Composer 是纯 textarea；正文已是 Markdown 渲染（`Timeline.tsx:342`），高亮有挂点 |

## 4. 落地方案

**总原则**：@mention 不是新派发路径，只是给「评论 → `enqueueTaskForIssue` → claim → 厚 push」这条唯一通路**加一个新触发源**——与 continuation 的 timer/process 唤醒完全同构（那边是"系统评论 → enqueue 自己"，这边是"成员/agent 评论 → enqueue 被点名者"）。**跨运行时零新增开发**：task.runtimeId = 被 @ agent 绑定的 runtime，对方 daemon 5s 轮询自然认领，上下文照旧由 claim 响应厚 push 过去（这正是 §2.5 multica 的做法，且我们连"评论要不要拉得动"都不用操心——push 直接给全）。

### 4.1 P1：mention 解析 + 派发 fan-out（后端核心，纯文本即可用）

1. **解析**：新建 `server/src/lib/mentions.ts`：`parseMentions(body, agents) -> agentId[]`。
   - 语法用**纯文本 `@名字`**（agent 名多为中文无空格，精确全名匹配 workspace agent 列表，长名优先；命中多个重名全触发）。不引入 multica 的 `mention://` 结构化格式——textarea + Markdown 场景纯文本对人和 agent 都最好写；将来要防重名/改名再升级。
   - 剔除 fenced/inline code 中的 @（防 `@Injectable` 之类误伤）。
   - 解析结果（agentId 快照）落 `issue_event.meta.mentions`，供渲染/审计/触发判定，**不加新表**（multica 也没建表）。
2. **派发重构**：把 `enqueueTaskForIssue`（`dispatch.ts:9-93`）的主体抽成 `enqueueTaskForAgent(issueId, agentId, triggerEventId, { trigger })`——agent 校验、无 runtime 提示、(issue,agent) 去重、session 复用、插 task + run_queued 全部原样；`enqueueTaskForIssue` 变成「解析 assignee 后调它」的薄壳。`run_queued.meta` 加 `trigger: "assignee" | "mention" | "wake"` 供前端展示触发原因。
3. **接线（人评论）**：`issues.ts` 评论 handler 在现有 `enqueueTaskForIssue(id, eventId)` 之后，对 `meta.mentions` 里每个 ≠assignee 的 agent 调 `enqueueTaskForAgent`（assignee 被 @ 时由去重自然合并）。
4. **护栏**（照抄 continuation.ts 的成熟样板）：
   - **链深**：复用「距上一条 member 评论以来 actorType∈{agent,system} 的连续评论数 ≥ MAX_AUTO_CHAIN(12) → 不再触发，插系统评论说明暂停」的现有逻辑（`continuation.ts:50-76`），把 mention 触发也纳入计数。一条人评论清零。
   - **不触发自己**：评论作者 agent 被自己 @ 时忽略。
   - 状态闸沿用（backlog 不触发）；(issue,agent) 去重已有；单条评论 @ 的 agent 数量封顶（如 5）。
5. **同 issue 互斥（关键，repo 模式）**：worktree 每 issue 一棵 + 分支名按 issue 生成 → **v1 直接做 per-issue 串行**：claim 选任务时（`daemon.ts:284-308`）跳过「同 issue 已有 running task」的候选（queued 的等着）。副作用是好的：B 总是在 A 跑完、结果评论已入时间线之后才启动，协作语义更顺（B 的厚 push 里带着 A 的结论）。真并行写作（per-agent worktree/分支 + 合并治理）留 P3+。

P1 完成后：人在评论里写 `@数据库专家 帮忙看下这个慢查询`，即使该 agent 绑在另一台机器的 runtime 上，也会被入队、被那台 daemon 认领、带着完整 issue 时间线冷启动（`full=true` 厚 push 最近 20 条，含此前所有人和 assignee agent 的发言）。**不需要前端改动即可用。**

### 4.2 P2：agent→agent 对话闭环 + 上下文增强

1. **agent 评论也 fan-out**：`daemon.ts` `/tasks/:id/complete` 写 summary 评论处（`:732-741`）跑同一套 `parseMentions` + `enqueueTaskForAgent`（作者=该 agent，防自触发；链深护栏在这里真正起作用）。这一步之后 A 干完活可以在总结里 `@测试工程师 请验证`，B 被唤醒、回复 `@全栈开发工程师 有两个 case 失败`，A 再被唤醒——受链深 12 封顶。
2. **prompt 协作段**：`assembleContext` 增加 `collaborators`（本 workspace 其他**已绑 runtime** 的 agent：名字 + 一句人设摘要）和 `mentionedBy`（当 task.triggerEventId 那条评论 meta.mentions 含本 agent 时，给出点名者）。`buildPrompt`（`daemon/src/index.ts:1078`）渲染 `## Collaboration` 段：
   - 「同事名单：可在评论/总结里写 @名字 请求其参与，对方会带完整 issue 时间线被唤醒（可能在另一台机器，透明）」；
   - 被点名时开头明示「你被 @X 点名协作，诉求见最新评论」；
   - **防环教育**（multica 原话级别）：「回复点名请求时默认不要 @ 回去；只有确需对方再行动才 @」。
3. **session/runtime 一致性加固**（学 `daemon.go:1472`）：`enqueueTaskForAgent` 复用 session 时校验上次 task 的 runtimeId === agent 当前 runtimeId，不一致就不带 sessionId——省掉一次注定失败的 resume 尝试（agent 换绑机器后 session 在旧机器上）。顺手修的既有小坑，非 mention 专属。

### 4.3 P3：前端体验

1. **autocomplete**：`CommentComposer.tsx` 输入 `@` 弹 workspace agent 下拉（数据源 `GET /workspaces/:ws/agents` 已有），选中插入 `@名字 `。
2. **高亮**：Timeline 渲染时按 DTO 带回的 `meta.mentions` 高亮 @ 片段（正文已走 Markdown 组件，加个前处理即可）。
3. **触发原因**：run_queued 时间线行显示「由 @ 提及触发」（读 meta.trigger）。
4. 后置可选：@成员 → 走已有 notifications 基建发通知；新建 issue 正文里的 @；squad/leader 分发（有了 mention 链路后，squad 只是「leader 人设 + roster 进 prompt + @成员评论」的语法糖，multica 已验证此路径）。

### 4.4 明确不做（v1）

- **WS 唤醒**：multica 是 WS 信号 + 3s 轮询兜底；我们 5s 轮询延迟已可接受，不为省 5 秒加一条长连接通道。
- **任务级 token**：multica 的 `mat_` token 解决"agent 借 runtime owner 凭证提权"；我们 MCP token 走 runtime token + workspace 隔离校验（`daemon.ts:109-122`），mention 不改变信任边界（被 @ agent 仍只能摸到本 workspace），多租户共享 runtime 成为现实需求时再上。
- **并行写作冲突治理**：v1 用 per-issue 串行回避；真并行留到有实际场景再设计（per-agent worktree + 分支 + PR 合并）。

## 5. 工作量与验证

| 阶段 | 内容 | 预估 |
|---|---|---|
| P1 | mentions.ts + dispatch 重构 + issues.ts 接线 + 护栏 + per-issue 互斥（无 DB 迁移，meta 是 JSON） | ~1 天 |
| P2 | complete fan-out + collaborators/mentionedBy + buildPrompt + session runtime 校验 | ~1 天 |
| P3 | autocomplete + 高亮 + 触发原因展示 | ~0.5–1 天 |

**e2e 验证场景**（真机双 runtime）：① 人 @ 非 assignee agent（绑另一 runtime）→ 对方机器认领、冷启动厚 push 含全部历史；② A 总结 @ B → B 唤醒 → B 回复 @ A → A resume 增量收到 B 的话；③ 链深护栏：构造 A↔B 互 @，第 12 次后停并落系统评论；④ 同 issue 串行：B 在 A running 期间不被 claim；⑤ 代码块里的 @ 不触发。

## 6. 一句话总结

Multica 用「服务端解析 @ → 入队到被 @ agent 的 runtime → WS 唤醒 + HTTP claim → agent 自拉评论区」实现跨运行时协作，agent 间不共享 provider session、全靠共享评论区对话；Zero 的等价物**只差"解析 @ 并给被点名者建 task"一段**——路由（runtimeId claim）、会话（per agent×issue）、上下文（厚 push 整条时间线）、护栏（链深/去重）都是现成的，且厚 push 让被 @ agent 的冷启动比 multica 更不依赖工具纪律。P1 一天可用，P2 打通 agent↔agent 对话，P3 补前端体验。
