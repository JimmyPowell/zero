# Agent 上下文模型：Zero vs Multica（对比 + 演进方向）

> 2026-06-19 整理。本文记录两套"给 coding agent 喂上下文"的模型对比、各自取舍，以及 Zero 的演进方向。
> 结论先行：**这是一道经典的 push(eager) vs pull(lazy) 工程取舍**，不是谁对谁错。Zero 现状赢在"确定性 / 体感 / 可审计"，Multica 赢在"可扩展性"。

## 0. 一句话区分

| | 世界状态（issue / 评论 / repo）怎么到 agent | 推理连续性 |
|---|---|---|
| **Zero** | **厚 push**：服务端把 issue + 最近 20 条评论 + repo + work 模式**预拼进 prompt** | session resume（复用 `session_id`，`--resume`） |
| **Multica** | **瘦 push + agent 自取(pull)**：prompt 只塞 issue 正文 + skills 文件；评论历史**命令 agent 自己调 CLI 拉** | session resume（条件性，易回退新会话） |

**关键修正**：Multica 并非"每次回复都开新会话"——它也做 `--resume`。"上下文缺很多"的真正来源是：
1. 评论是 **pull**：agent 不老实调 `multica issue comment list` 就缺/过时（Multica 自己代码注释承认这是"agents acting on stale or incomplete instructions 的最常见原因"）。
2. resume 条件苛刻（`force_fresh_session`、poisoned 失败、**跨 runtime 不复用**）→ 一回退就"失忆"。

### 证据
- Multica：`server/internal/daemon/execenv/runtime_config.go:258`（强制 agent 自拉评论，"mandatory, not optional"）；`migrations/020_task_session.up.sql`（session_id/work_dir，resume）；`internal/daemon/daemon.go:1503/1523`（resume + 失败回退）。
- Zero：`server/src/lib/dispatch.ts:83`（注释"服务端主动拼，不靠 agent 自取"）、`:100-131`（最近 20 条评论）、`:56-78`（复用上次 session_id）。
- 三方佐证：[mem0.ai 复盘](https://mem0.ai/blog/how-memory-works-in-a-multi-agent-system-inside-multica)（"stale snapshots — agents miss new comments mid-task"）；GitHub Issue [#1579](https://github.com/multica-ai/multica/issues/1579)（执行/报告质量致信任流失）、[#1463](https://github.com/multica-ai/multica/issues/1463)（状态卡 working）。

## 1. push vs pull 取舍对照

| 维度 | Zero：push / 预拼 | Multica：pull / 自取 |
|---|---|---|
| 上下文到达 | 服务端保证塞进，agent 不可能漏看 | 靠 agent 自觉拉，会漏 / 会过时 |
| 确定性 / 可审计 | 高：每次 run 看到什么是确定的、可落库回放 | 低：实际读了多少不确定 |
| 历史规模 | 固定窗口（20 条），长线程会截断 | 可分页拉深、拉关联 issue，更扛大历史 |
| 实时性 | 派发那刻快照，跑动中新评论看不到 | agent 动手前可重拉最新态 |
| 启动开销 | 一次拼好，快、省往返 | 多次 CLI 往返，慢、费 token，还要先"发现"命令 |
| 对模型能力要求 | 低：弱模型也能拿到全量 | 高：依赖 agent 工具调用纪律 |
| Prompt 体积 | 每次都背 20 条，可能冗余 / 膨胀 | 瘦 prompt，按需拉 |

## 2. 整体使用感（分阶段）

- **个人 / 小项目 / 演示 / 评论不长**：Zero 的 push 明显更好用，"它记得我说的"是最高频体感，几乎不翻车；这恰是 Multica 公开吐槽最集中处。
- **大团队 / 超长线程 / 多 repo / 长跑任务**：Multica 的 pull 更能扩展；Zero"固定 20 条 + 每轮全量"会先撞截断 + 膨胀。

"每个 issue 像一个完整任务"——其实两边都是 **issue 为中心 + session-per-(agent,issue)**，任务粒度一致；真正分野只在上下文送达方式。Zero 不需要为此改架构。

## 3. Zero 的演进方向（按性价比）

1. **混合模型（push 保底 + pull 加深）**（✅ 已实现，见 §5）：保留厚 push 当地板，再给 agent 一个 MCP 工具按需回拉更老评论 / 历史运行。拿到扩展性又不丢确定性。
2. **resume 时只推增量**（✅ 已实现，见 §4）：会话已记得旧评论，resume 那轮只塞"上次之后的新评论"，而非 20 条全量 → 省 token、去冗余。
3. **滚动摘要**替代硬截断：超窗口的老评论压成 summary + 最近 N 条原文，避免"第 21 条直接消失"。
4. **跑动中新评论可见**：派发后到来的评论给运行中 agent 一个信号 / 检查点重拉（push/pull 通病）。
5. **push 里带更多工件**：上次 run 摘要 / 最近 diff / 当前分支态，续接不冷启动。
6. **token 预算**：聊得多的 issue 给 token-aware 上限 + 摘要。
7. **会话治理**：学 Multica 的 `force_fresh_session` + poisoned 状态排除，比当前单一兜底更细。
8. **把"可审计"做成卖点**：push 模型天然能把每次 run 的完整输入快照落库 → 直接喂 skills eval / 质量门控方向，这是 pull 模型难做到的差异化。

## 4. §3.2 增量推送 —— 实现说明

**目标**：resume（续接已有会话）那一轮，prompt 只带"上次之后的新评论"，旧评论已在会话记忆里不再重复；但**新会话 / 回退到新会话**时仍带全量，避免失忆。

**约束（关键）**：daemon 在 resume 失败时会用**同一份 prompt** 在新会话里重跑（`daemon/src/index.ts` tick 的回退分支）。所以不能无脑把 prompt 砍成增量——回退那次必须是**全量**。

**做法**：
- 服务端 `assembleContext(issueId, { agentId, resuming })` 照常返回**全量**最近 20 条评论，外加 `resumeFromIndex`：续接会话上一轮已看过的"前缀评论条数"（截止点 = 上一条已结束 task 的 `startedAt`，取不到回退 `createdAt`；用 `<` 比较保证宁可多带不漏带）。非续接时 `resumeFromIndex = 0`。
- daemon `buildPrompt(claim, { full })`：
  - resume 尝试：`full=false` → 只渲染 `comments.slice(resumeFromIndex)`，标题"## New comments since your last turn"，并提示"更早的 N 条已在你的上下文里"。
  - 新会话首跑 / resume 失败回退：`full=true` → 渲染全量"## Conversation so far"。

**安全性**：截止点用 `startedAt` 且 `<` 比较 → 只会多带（冗余安全），绝不漏带 agent 没见过的评论。极端 >20 条历史时，`resumeFromIndex` 基于当前 20 窗口内早于截止点的条数，退化为"窗口内增量"，仍正确。

## 5. §3.1 混合模型 —— 实现说明

**思路**：push 把"地板"（issue + 最近评论 + work）塞进 prompt；再给 agent 一个 **MCP 工具**按需回拉"地板之外"的更深上下文。`--dangerously-skip-permissions` 下 MCP 工具免确认。

**组成**：
- 服务端（`server/src/routes/daemon.ts`，运行时令牌鉴权 + 工作空间隔离）：
  - `GET /daemon/issues/:id/comments?before=&limit=` —— push 窗口之外的更早评论（游标分页，正序返回）。
  - `GET /daemon/issues/:id/runs?limit=` —— 本 issue 历史运行（状态/起止/失败原因/agent）。
- daemon `src/mcp-context.ts` —— 手写 stdio JSON-RPC MCP server，暴露 `zero_older_comments` / `zero_prior_runs`，凭 env（`ZERO_SERVER`/`ZERO_TOKEN`/`ZERO_ISSUE_ID`）调上述端点；`import.meta.main` 守卫（可被单测 import）。
- daemon 接线：`writeMcpConfig` 按 issue 写 `~/.zero/mcp/<issueId>.json`（0600，含令牌），`runClaude` 加 `--mcp-config`；prompt 末尾提示有这两个工具、"够用就别拉"。

**验证**：server/daemon typecheck；MCP server 独连真端点（initialize / tools/list / 两个 tools/call 均正确、ISO-Z、工作空间隔离）；**真机 e2e**：强制 agent 用工具 → init 显示 32 个工具（30+2）、agent 调 `mcp__zero__zero_prior_runs` 拿到真数据并正确作答、tool_call 进了执行流时间线。

**边界 / 后续**：当前 2 个工具（更早评论 / 历史运行）；关联 issue 搜索、上次 run 的 diff（repo 模式其实可直接走 git）可作下一批。令牌走 MCP 配置文件 0600；如需更严可改每任务短令牌。

## 6. 会话模型：runtime / agent / session / 任务的关系

```
账号 User
  │ owns (owner_id)
  ▼
运行时 Runtime  —— 一台装了 claude 的机器 + 配对令牌（贵、可共享的"资源"）
  │  · visibility: private | workspace      谁能用
  │  · max_concurrency: N                    这台机器同时最多并行 N 个任务
  │  · runtime_workspace 表                  上架到哪些工作空间（触达范围）
  │
  │  被绑定（N 个 agent : 1 runtime）
  ▼
工作空间 Workspace
  ├─ 智能体 Agent  = 轻量"人设/配置"（name·model·instructions·provider + runtimeId）
  │      └─ 只属于一个 workspace，绑一台 runtime
  │
  └─ Issue（assignee = 某个 agent）
        └─ 时间线 issue_event[]：comment / status_change / run_*  ← 你的评论、agent 回复都挂这
              │  新评论/指派 → enqueueTaskForIssue
              ▼
          Task（一次执行）  · (agentId, issueId)  · sessionId=该(agent,issue)上次会话 or null
              │  runtime 在并发上限内 claim（pump 填槽）
              ▼
          daemon 跑 claude  ①--resume <sessionId>（续接旧对话）
                            ②--mcp-config（注入 zero_older_comments / zero_prior_runs）
              · session = 按 (agent, issue) 一条，cwd 固定，存在那台机器上
              └→ run_event[]（执行流）+ task_usage（成本）+ 结果 comment + issue→评审中
```

三层一句话：**Runtime=机器（资源/并发/四象限）｜Agent=人设（绑机器）｜Session=按 (agent,issue) 的一条对话线**。

**会话连续性**：同一 (agent, issue) 多轮共用一条 claude session。第 N 次评论 → 新 Task 带上次 `sessionId` → daemon `claude --resume` 把旧对话整段加载 → 把新评论当新一轮 user 输入追加 → 续着做。理想就是"一条会话连到尾"。

### 6.1 两种 push 模式 —— 20 限制只在"无会话记忆"时生效

| 模式 | 何时 | 推什么 | 碰 20 限制？ |
|---|---|---|---|
| **增量** `full=false` | **resume 成功**（顺路径） | 只推"上次之后的新评论"（通常 1–2 条） | ❌ 基本不碰 |
| **全量** `full=true` | **无会话记忆**：① 冷启动首跑 ② resume 失败回退新会话 | 最近 20 条当 bootstrap | ✅ 这里才封顶 |

**关键认知**：resume 成功时旧评论在底层 session 里、没丢，push 只补增量，**20 限制压根不参与**。第 21、第 100 条评论在顺路径下都一样——每次只推那一条新的。

`20` 限制真正咬人只在三种"无记忆"情况：
1. **冷启动**：agent 第一次跑之前人已讨论 >20 条 → 首跑（新会话）全量只塞最近 20，更早的没进 prompt。
2. **resume 失败回退**：会话过期/换机器/被删 → 退新会话（无记忆）→ 同上。
3. **一个间隔猛灌 >20 条**：增量本应是这一大批，但 assembleContext 只捞最近 20 → 最早几条被挤出窗口（session 里也没有，因为是新的）。

这三种都靠 **pull 兜底**找回。所以分工：
- **session（底层会话）** = 装全部历史，顺路径永不丢。
- **push 20** = 仅在无 session 记忆时当冷启动地板（`dispatch.ts` 写死 `.limit(20)`，可调）。
- **pull（MCP）** = 补"地板之外 / 会话丢了 / 灌评论 >20"的兜底。

> 顺路径下 pull 基本用不上（会话已全有），它的价值在**不顺路径**——是保险，不是主力。

### 6.2 同一 issue 下 @ 另一个 agent（多 agent 协作）

session 按 **(agent, issue)** 一条，所以 @ agent B：
- B 查自己 (B, issue) 历史 → 无 → **全新 session**（不继承 A 的记忆）。
- 但 push 会把 issue + 最近评论（**含 A 的发言**，同一条时间线）塞给 B → B 看得到来龙去脉；还能 pull 看 A 的运行/更早评论。
- 即：**一个 issue 下多 agent = 多条平行 session，共享同一条 issue 时间线当上下文。**

⚠️ 现状：评论只触发该 issue 的 **assignee** agent（`enqueueTaskForIssue` 走 `assigneeId`）；@-mention 点名别的 agent **尚未接线**，但数据模型（session per (agent,issue)）天然支持，将来加只是"解析 @ → 给被点 agent 也建 task"。

## 7. 缓存命中与 token 成本（实测）

用 `task_usage`（claude `result` 事件的权威数字）实测「resume 续接 + 增量 push」是否吃到 prompt cache。3+1 轮**秒级连发**（缓存全程热）：

| 轮次 | 类型 | input(新算) | cache_write | cache_read |
|---|---|---|---|---|
| 1 | 冷启动 | 2519 | 2490 | 15626 |
| 2 | resume | **2** | 5574 | 15621 |
| 3 | resume | **2** | 604 | 21195 |
| 4 | resume | **2** | 616 | 21799 |

**结论：续接流程缓存命中极好。** resume 轮 `input≈2`（几乎没有从头算的 token）—— 系统提示+工具+整段历史全走 `cache_read`；`cache_write` 越来越小（604/616，只写新追加的一小轮）。
- 第1轮 `cache_read=15626` 已很高：Claude Code 自身系统提示+内置工具在账号上**全局共享缓存**，冷启动也读得到。
- 为什么缓存友好：`--resume` 把前缀（系统+工具+历史）**逐字节原样重放** → 前缀稳定不打穿；我们没往前缀塞任何会变的东西；**§3.2 增量**让新轮很小 → 每轮 write 才几百。
- **TTL 影响**：上表是热缓存。隔超过 TTL 再评论 → 缓存凉 → 回来那一轮把历史重 `write` 一次（一笔较大开销），之后转回 read，但**不失忆**。Max 20x 默认 **1h TTL**，保温窗口宽。

### 7.1 push（我们） vs pull（Multica）的 token 账，其实不一定谁省

两者**都用 `--resume`**，所以"历史随对话增长、每轮作为 cache_read 重读"这块**成本基本一样**。真正差异只在**每轮新增内容**：
- **我们 push**：把（增量）评论塞进新轮 —— 新轮稍大，但**不需要额外往返**。
- **Multica pull**：新轮很瘦，但 agent 要**多次工具往返**自取评论 —— 每次 pull = 一个 assistant 轮 + 返回数据，都吃 token。

所以谁省取决于工作负载：**需要的上下文越多/越全，push 一次（之后缓存）越划算；只需一小片、历史超长，lean+pull 越划算。** 不存在普适赢家。
- 我们现在是**混合**（push 保底 + 按需 pull），本就两头取优；而且 `task_usage` 已经把 input/cache/cost 落库，**任何时候都能在真实使用上量**，无需先造合成 A/B。
