# Agent 续跑 & 子代理结构化

> 2026-06-20 记。解决两个被实测暴露的问题:**(A) 自触发续跑（"回调"）** 与 **(B) 子代理（sub-agent）结构化**。
> 调查见 [progress.md](./progress.md) 同日条目;数据库实锤:issue「检查系统磁盘占用」5 个 task 共用同一 session、**每一轮都靠人发评论才动**,agent 说"1 分钟后回来报"却从不自己回来。

## 背景:为什么会缺

Zero 跑 agent 是 `claude -p` **无头单发**:一个 task = 拉起一次 CLI 进程,agent 的整个 agentic loop(含 `Bash run_in_background` + `BashOutput` 轮询)全在这一个进程生命周期内。CLI 一退出,这次 run 就结束。

- **会话连续性已经有**:daemon 抓 `session_id` 存 `task.session_id`,下一个 task 用 `--resume` + 增量上下文续上(`daemon/src/index.ts`、`assembleContext` 的 `resumeFromIndex`)。
- **缺的是「非人触发」**:唯一能产生续跑 task 的入口是人发评论(`server/src/routes/issues.ts` 评论 → `enqueueTaskForIssue`)。agent 没有任何手段"让背景任务跑完时把自己叫醒",也没法"定个闹钟过会儿继续"。

结论:难的一半(resume)是现成的,**只需补上「非人触发器」**,让它去走同一条 `enqueueTaskForIssue`。

---

## A. 自触发续跑

### 核心机制:触发器 → 系统评论 → enqueue(复用 resume)

不发明新的派发路径。一个唤醒被"点燃"时,做三件事:

1. 往时间线插一条**系统评论**(`issue_event` kind=`comment`、actorType=`system`、`meta.wake`=触发类型),正文写清唤醒原因("你设定的 60s 延时已到,继续"/"你监视的后台进程 PID 16500 已结束")。
2. 调 `enqueueTaskForIssue(issueId, 该评论 eventId)` —— 它**自动复用上次 session_id**(resume)、自动去重(已有 queued/running 任务则跳过)。
3. 把唤醒标记为 `fired`。

系统评论既是**给人看的时间线痕迹**(为什么 agent 又跑了),又会被 `assembleContext`(只取 kind=`comment`)自然带进 agent 的增量上下文 —— agent 一 resume 就看到"哦,我的闹钟响了 / 后台任务好了",接着干。**零新派发逻辑、零新上下文通道。**

### 两类触发源

| 类型 | 注册方 | 点燃方 | 适用 |
|---|---|---|---|
| `timer` 延时唤醒 | MCP `zero_wake_me(after_sec, note)` | **服务端**定时 sweeper | "稍等,我 N 秒后回来报进度" |
| `process` 进程看护 | MCP `zero_watch_pid(pid, note)` | **daemon** 轮询本机 pid 存活 | "我起了个脱离会话的长任务,它跑完叫我" |

- **定时器放服务端**:持久(扛 daemon 重启)、与执行机无关。`startWakeupWorker()` 每数秒扫 `kind=timer AND status=pending AND fire_at<=now`,逐条点燃。挂在 `server/src/index.ts`(与 `startOutboxWorker` 并列)。
- **进程看护放 daemon**:pid 在执行机上,只有 daemon 能 `process.kill(pid,0)` 探活。daemon 在 claim 循环旁加一个 `watcher`,定期 `POST /daemon/watches/sync {dead:[id...]}` —— 上报本轮探到已死的 watch,服务端点燃它们并回传该 runtime 仍 pending 的看护列表(含 pid)。
  - 进程是脱离会话的(setsid/nohup),daemon 非其父,**拿不到退出码**,只能判"还在不在"。v1 接受:唤醒时只说"进程已结束",让 agent 自己去查结果(它知道自己在干嘛)。退出码/日志尾巴留 Phase 2。

### Agent 怎么知道有这套(关键)

光有工具不够 —— 截图里 agent 说"稍等我 1 分钟后报"却根本没工具意识。所以 **`buildPrompt` 要显式告诉它执行模型**:

> 这是非交互单发 run,你结束这一轮 run 就结束、不会自动续。若要等长任务或过会儿再来,**必须**调 `zero_wake_me(after_sec)` 或 `zero_watch_pid(pid)` 安排回调,否则不会被重新唤起。

### 数据模型:`agent_wakeup`

```
id, workspace_id, issue_id, agent_id, runtime_id,
kind        enum(timer, process)
fire_at     timestamp   -- timer 用
pid         int         -- process 用
note        text
status      enum(pending, fired, expired, cancelled)
source_task_id          -- 注册它的 task(审计/溯源)
created_at, fired_at
索引: (status, fire_at) 给定时扫；(runtime_id, status, kind) 给 daemon 拉看护
```

### 护栏(防自唤醒烧钱 / 死循环)—— 必做

1. **链深上限**:点燃前数"距上一条 member 评论以来、已有几条系统 wake 评论"。≥ `MAX_AUTO_CHAIN`(默认 12)就**不再点燃**,改插一条系统评论"已连续自动续跑 N 次仍未完成,暂停,等待人工",唤醒标 `expired`。一条人评论即可清零、重新开始。
2. **注册上限**:单 issue 同时 pending 的唤醒数封顶(默认 5),`zero_wake_me`/`zero_watch_pid` 超限直接拒(返回提示给 agent)。
3. **延时区间**:`after_sec` ∈ [5, 3600]。
4. **状态闸**:仅当 issue 处于 `todo/in_progress/in_review` 才点燃;`done/cancelled/backlog/blocked` 一律静默 `expired`(任务结束/废弃/需人工,不该自唤醒)。
5. **去重兜底**:`enqueueTaskForIssue` 本就对已有活动任务去重 —— agent 还在跑时点燃不会叠跑。
6. 全局 kill-switch(后续:运行时/工作空间级开关)。

### 端到端流(以"1 分钟后报进度"为例)

```
agent 调 zero_wake_me(60) ──MCP→ POST /daemon/issues/:id/wake
   → insert agent_wakeup(timer, fire_at=now+60, source_task)         [本轮 run 随后正常结束]
（60s 后）startWakeupWorker 扫到 → fireWakeup:
   护栏过 → insert 系统评论"你设定的 60s 已到,继续"
          → enqueueTaskForIssue(复用 session 92504e29) → 新 queued task
          → 标 wakeup=fired
daemon claim → --resume 92504e29 + 增量上下文(那条系统评论) → agent 接着报进度
```

---

## B. 子代理(sub-agent)结构化

### 现状

`claude-adapter.ts` 把 `Task` 工具识别成 `tool:"task"`,记了"`Task <描述>`"这次调用 + 它最终的 `tool_result`。但 `RunEvent` **无 parent 字段**,子代理内部步骤无法分层 —— Claude Code 无头流里子代理消息带 `parent_tool_use_id`,我们当前会把它们**摊平**进主时间线(分不清谁干的)。

### 方案

给事件加**父子链接**,前端按链接折叠嵌套:

1. **协议**(`daemon/src/run-events.ts` + `server/src/lib/run-events.ts` 两份保持一致 + zod):`RunEvent` 加 `toolUseId?`(该 tool_use 自身 id)、`parentToolUseId?`(该事件所属子代理的父 Task id)。
2. **adapter**:`tool_use` 块取 `b.id` → `toolUseId`;每条事件透传 `o.parent_tool_use_id` → `parentToolUseId`。Task 调用的 `toolUseId` 即子代理事件的 `parentToolUseId`,据此成组。
3. **存储**(`run_event` 表 + 迁移):加 `tool_use_id`、`parent_tool_use_id` 列;`daemon.ts` events 端点持久化 + SSE publish 带上。
4. **前端**(`RunLogOverlay`):`parentToolUseId` 命中某 Task 调用的 `toolUseId` → 折叠嵌在该 Task 行下;顶部活动条带把子代理段并入父 Task 段。

> 先在真机抓一段带 Task 的 `stream-json` 确认 Claude Code 到底吐什么(是否吐子代理过程 + 字段名),再定"嵌套"还是"只留调用+结果两条"的粒度。优先级低于 A(是显示保真,不是功能缺口)。

---

## 涉及文件

- **A**:`server/src/db/schema.ts`(agent_wakeup)、迁移 0018、`server/src/lib/continuation.ts`(新,fireWakeup)、`server/src/routes/daemon.ts`(wake/watch/sync 端点)、`server/src/index.ts`(startWakeupWorker)、`daemon/src/mcp-context.ts`(两个工具)、`daemon/src/index.ts`(writeMcpConfig 加 ZERO_TASK_ID、watcher 循环、buildPrompt 续跑说明)。
- **B**:`run-events.ts`(daemon+server)、`claude-adapter.ts`、`run_event` 表 + 迁移 0019、`daemon.ts`(events 持久/分发)、`web/.../RunLogOverlay.tsx`。

## Phase 2(暂不做)

进程退出码/日志尾巴回传、轮询式兜底续跑、运行时级 kill-switch/配额、子代理事件的更细粒度回放、非 Claude provider 的续跑工具(codex/opencode 经各自 MCP;kimi 无原生 MCP 需降级)。
