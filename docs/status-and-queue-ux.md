# 状态图标重设计 + 「排队中」反馈 方案 ⏳待办（出方案，先不实现）

> 2026-06-20。两个 UX 问题：① 状态图标区分度低（进行中 vs 评审中几乎一样）+ 缺「阻塞」；② 改状态/新建后任务进队列，但派发要等 daemon 下一次轮询，期间前端无任何反馈。

## 一、状态图标 + 流转

### 现状（`web/src/lib/issue-meta.ts`）
| 状态 | 图标 | 色 | 问题 |
|---|---|---|---|
| backlog 待规划 | `CircleDashed` | 灰 | ok |
| todo 待办 | `Circle` | 灰 | ok |
| in_progress 进行中 | `CircleDot` | amber | **和评审中太像**（都是"圈里一个点"系） |
| in_review 评审中 | `CircleDotDashed` | violet | 同上 |
| done 已完成 | `CircleCheck` | green | ok |
| cancelled 已取消 | `CircleX` | 灰 | ok |
| — | — | — | **缺 blocked 阻塞** |

### Multica 调研
- 状态：backlog / todo / in_progress / in_review / done / **blocked** / cancelled（7 个，比我们多 `blocked`）。
- **不强制工作流**：任意状态可跳任意状态（backlog 直接→done 也行）。agent 自动把 backlog/todo→in_progress→done/in_review。
- 我们现在也是 any→any（StatusPicker 随便选），**这点已对齐，不用改流转规则**。

### 方案：每个状态用"形状明显不同"的图标 + 强色码
- **核心改动**：评审中从 `CircleDotDashed`（又一个点系）换成形状截然不同的：
  - in_progress 进行中：`CircleDot`（实心点=正在做）· **amber** —— 保持
  - in_review 评审中：**`CirclePause`**（圈内两竖=暂停待审）· **violet** —— 一眼区别于"点"
- **新增 blocked 阻塞**：`CircleSlash`（或 `Ban`）· **red** —— 含义=卡住/不能推进。
- 其余保持（backlog `CircleDashed` 灰、todo `Circle` 灰、done `CircleCheck` 绿、cancelled `CircleX` 灰）。
- 备选（更激进、最直观）：in_review 用 `Eye`（在审=在看），但会跳出"圆圈家族"风格——看你取舍，推荐 `CirclePause` 保持一致。

### blocked 的语义（顺带打通之前的事故）
- 手动：人觉得卡住了置 blocked。
- **自动**：run **失败**时（如上次"克隆卡死"），把 issue 自动置 **blocked** + 失败原因写进时间线，而不是停在 in_progress 让人以为还在跑。这条把"失败可见性"和状态打通，很值。

### 改动量（小）
- `issue-meta.ts` 加 `blocked` 项 + 改 in_review 图标；`STATUS_ORDER`、`IssueStatus` 类型、server `statusEnum`、schema `issue.status` enum、i18n `status.blocked` 各加一项（迁移：ALTER status enum，加性）。

## 二、「排队中 / 等待拣选」反馈

### 现状与根因
- 改状态→进行中（或新建+指派 agent）→ `enqueueTaskForIssue` 建一条 **`queued`** task → **立即返回**。
- daemon **每 5s 轮询一次**（`CLAIM_MS=5000`）才认领 → 期间 task 是 queued。
- **问题**：enqueue 时**不写任何时间线事件**（`run_started` 要等 daemon 认领才写）。所以改完状态到 daemon 认领之间（≤5s，daemon 忙/离线则更久）**前端啥也不显示**，用户以为没生效。
- Multica 这个状态叫 **「排队中」**。

### 方案（推荐组合，省事→完整）
1. **enqueue 即写一条时间线事件**（如 `run_queued`，或复用 run_started 加 `queued` 子态）："已加入队列，等待 <agent> 拣选"——改完状态**立刻**能看到，最直观。
2. **把 queued task 渲染成「排队中」运行卡片**：`listRuns` 本就返回 queued task（`status:"queued"`），前端在详情页**立即显示一张"排队中"卡片**（带脉冲/spinner），认领后变"执行中"。`IssueDetailView` 已经在 `hasActiveRun(queued||running)` 时轮询，补一下 queued 的卡片展示即可。
3. **乐观提示**：状态改成进行中的接口可在响应里回 `{queued:true}`，前端马上在状态旁挂个小字"排队中…"，再由轮询确认。
4. **离线兜底**：若该 runtime 离线（心跳过期）→ 显示"排队中（运行时离线，暂不执行）"，而不是无限转圈。
5. （可选）把 `CLAIM_MS` 从 5s 调到 2–3s，或加 server→daemon 推送做到秒级；但**有了"排队中"显示后，5s 也不难受**，优先做显示而非压轮询。

### 改动量（小–中）
- server：`enqueueTaskForIssue` 加写 `run_queued` 事件（或 dispatch 返回 queued 标记）；可选 runtime 离线判定。
- web：详情页渲染 queued 运行卡片 + 状态旁"排队中"小字；时间线渲染 `run_queued`。
- 不动数据模型（task 已有 `queued` 状态）。

## 三、优先级
- **状态图标区分度 + blocked**：纯前端 + 一个加性迁移，低风险、体验立竿见影。
- **排队中反馈**：最该做的是"enqueue 即给可见反馈"（方案 1+2），解决"改完没反应"的核心困惑。
- **失败→blocked 自动化**：把状态、失败可见性、上次克隆事故一起收口，推荐一并做。

## 四、状态
⏳ 待办（用户要求先出方案）。两块都可独立、低风险落地，待确认后实现。
