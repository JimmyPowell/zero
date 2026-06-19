# 进展日志

> 每完成一块开发 / 有重要进展就在最上面追加一条（倒序）。日期用绝对日期。

## 2026-06-19 · 合并实时执行日志（feat/agent-exec-stream → main）🎉

- **功能**：执行过程**实时流式**进时间线浮层 —— provider 无关的 `RunEvent` 协议；daemon `claude-adapter` 解析 `claude -p --output-format stream-json --verbose`，`reporter` 批量按单调 `seq` 上报；server `run_event` 表（`unique(task,seq)` 幂等）+ `run-bus` + SSE 流端点；前端 `RunLogOverlay`（磨砂浮层）+ 详情页运行卡片 / 活动态 3s 轮询。
- **合并冲突处理**：
  - `daemon/index.ts` tick —— 合 main 的 `prepareWorkdir`(worktree/就地/空) + 会话回退 与分支的流式 `runClaude(reporter)`：两次 `runClaude`（resume + 回退）都传 reporter。
  - **seq 归属上移到 `reporter`**（持有单调 `seq` 跨多次 `runClaude`），避免回退重跑撞号被服务端 `unique(task,seq)` 丢弃。
  - **迁移撞号**：main 与分支都建了 0008（main=issue.work_dir、分支=run_event）。保留 main 的 0008(work_dir)，run_event 重新生成为 **0009**（SQL 与分支逐字节一致）；其 journal `when` 对齐 DB 已应用记录（`1781855231924`）→ `db:migrate` 干净 no-op，不重建已存在的表。
- **校验**：daemon / server / web typecheck + web build 全过；`db:migrate` no-op。

## 2026-06-19 · 修复创建时「绑工作目录」不生效

- **根因**：路径只在点小「确定」/回车时才提交绑定；用户用「浏览」填好后直接点创建 → 绑定仍是"不绑" → `workDir` 没发出（DB 里 work_dir 为 NULL）。后端正常，是前端创建流程 bug。
- **修复**：浏览选完 / 输入框失焦 / 回车 **都立即提交绑定**（去掉"必须点确定"）；回车 `preventDefault` 不误提交创建表单；`CreateRepoDialog` 改 `createPortal` 到 body，解决「`<form>` 不能嵌套 `<form>`」控制台报错。

## 2026-06-19 · 工作目录「浏览」原生选择器

- 浏览器拿不到本地绝对路径（安全限制），改由本机 **daemon 弹原生对话框**：daemon 起本地接口 `127.0.0.1:8799/pick-folder`（CORS *），用 macOS `osascript choose folder` 返回绝对路径。
- `BindingPicker` 绑工作目录的路径输入旁加「浏览」按钮 → 调本机选择器回填路径；daemon 未运行则提示手动输入。
- 目前 macOS；其它平台回退手动输入。

## 2026-06-19 · B3.3c 绑定选择前端 + 清晰展示

- 新 `BindingPicker`：三模式（不绑/仓库/工作目录），下拉选仓库（含添加仓库）或绑工作目录（路径输入），仓库模式带基准分支输入；底部一行**清晰展示当前模式**（隔离 worktree·主副本不动 / 就地·不隔离 / 临时空目录）。
- 接入**创建弹窗**（创建即可选绑定）+ **详情右栏**（替换旧 RepoBinding，已删）。api-client + i18n 补齐。
- 实测 API：create 绑仓库/目录 shape 正确、互斥 400、PATCH 切换清另一边。
- **B3.3 至此完成**（绑定模型后端 + daemon worktree/就地/空目录 + 前端选择展示）。待办：issue 关闭自动清理 worktree。

## 2026-06-19 · B3.3 绑定模型（后端 + daemon）—— worktree 真跑通 🎉

- **设计**：绑定对象决定工作模式 —— ① 仓库(git URL/本地 git 仓库)→隔离 **worktree**(分支 `zero/ZERO-N`)；② 工作目录(任意本地文件夹)→**就地**(不隔离)；③ 不绑→临时空目录。比 Multica"只有隔离 worktree"更灵活。
- **数据**：issue 加 `work_dir`(迁移 0008)，与 `repoId` 互斥。
- **后端**：create/PATCH 支持绑仓库或工作目录(互斥校验，绑仓库兜底基准分支)；`assembleContext` 输出 `work` 模式描述给 daemon。
- **daemon**：`prepareWorkdir` —— URL 仓库 clone 到 `~/.zero/repos` 缓存 / 本地仓库直接用，每 issue 一棵 worktree(`~/.zero/worktrees/<issue>`，分支 `zero/ZERO-N`，复用)；工作目录就地；空目录兜底。`buildPrompt` 按模式给指令。
- **实测**(绑本地仓库)：agent 在 worktree 的 `zero/ZERO-1` 分支建 `hello.txt` + commit `add hello`；**用户主仓库 main 完全未动**（隔离确认）。
- **待办**：前端绑定选择 UI + 清晰展示当前绑定/模式(B3.3c)；issue 关闭自动清理 worktree。

## 2026-06-19 · 修复会话续接（No conversation found）

- **根因**：daemon 每个 task 一个新临时目录 `~/.zero/work/<taskId>`，而 Claude Code 会话**按工作目录**存，跨 task `--resume` 必失败。
- **修复**：① 工作目录改成**按 issue 固定**（`~/.zero/work/<issueId>`），同 issue 多轮共用目录，resume 能续上；② resume 失败（换目录/过期/被删）**自动回退新会话**——上下文已在装配的 prompt 里，不失忆。
- **实测**：round1 用失效 session → 回退新会话成功；round2 用固定目录里的新 session → 真正 resume 续上（无回退）。
- 这是 B3.3「工作目录按 issue 固定」的前置；后续接上**绑定模型**（仓库→worktree / 工作目录→就地 / 不绑→空目录）。

## 2026-06-19 · 合并「最新活动时间」+ 搜索聚焦修复

- 合并分支 `feat/issue-last-activity-time`：issue 列表/搜索结果右侧、详情右栏显示**最新活动时间** —— `lastActivityAt = COALESCE(MAX(issue_event.created_at), issue.created_at)`（任意事件：评论/模型回复/状态变更/执行），**列表仍按创建倒序、不重排**（走现成索引 `idx_issue_event_issue`）。
- 搜索命令面板打开自动聚焦输入框（之前键入不进搜索框）。
- 三方合并（main 的 Markdown/默认进行中/毫秒精度 × 分支的活动时间）自动完成无冲突；server/web `tsc` + build 全过，运行中服务已热重载（实测新建 issue 返回 `status=in_progress` + `lastActivityAt`）。

## 2026-06-19 · 评论 Markdown 渲染 + 默认进行中 + 时间线毫秒排序

- **Markdown 渲染**：引入 `react-markdown` + `remark-gfm` + `@tailwindcss/typography`，时间线评论按 Markdown 渲染（标题/粗体/列表/代码/表格…）。新增 `components/Markdown.tsx`。
- **新建 issue 默认「进行中」**（后端 create 默认 + 创建弹窗默认）。前期固定，后续做成工作空间偏好。
- **时间线顺序修复**：`issue_event.created_at` 改 `timestamp(3)` + `now(3)` 默认（迁移 0006/0007），同一秒多条事件按毫秒真实排序——修「开始执行排到状态变更前面」。实测同秒 3 事件 .424/.495/.524 排序正确。

## 2026-06-19 · 修复 daemon 吞错 + 诊断「模型无效」

- 现象：指派 issue 给 agent 后「执行失败：claude exited 1」。**根因**：agent 的「模型」字段被填成无效值 `111`，daemon 传 `--model 111` 被 claude 拒绝（model 不存在）。
- **daemon bug**：`claude --output-format json` 出错时把真实错误写在 stdout，旧代码只读 stderr → 笼统显示 "claude exited 1"。已修：失败时解析 stdout 末行 JSON 的 `result`/`is_error`，把**真实错误**回传时间线。
- 清掉无效模型后重跑**成功**（agent 正常回复）。模型字段留空即用默认（Opus 4.8）。
- **待办**：任务失败后无「重跑」入口——改 agent 配置不会自动重试，需新触发（如评论）。计划加重跑按钮。

## 2026-06-19 · 修复搜索面板聚焦

- 搜索命令面板（`SearchCommand`）打开时输入框不自动聚焦：面板是自定义 `<div>` 蒙层（非 Radix Dialog），无人把焦点放进 cmdk 的 `<input>`，导致键入不进搜索框、`onValueChange` 不触发。
- 修复：`CommandInput` 透传 `ref`（React 19 ref-as-prop）；`SearchCommand` 在 `open` 后用 `requestAnimationFrame` 聚焦输入框。`tsc --noEmit` 通过。

## 2026-06-19 · B3.2 daemon 执行完成 —— 真实跑通 claude 🎉

- daemon 加**认领循环（5s）+ 串行执行**：claim → `buildPrompt`（agent 指令 + issue 标题/描述 + 最近评论 + 仓库）→ `claude -p --output-format json --dangerously-skip-permissions [--model] [--resume]` → complete/fail 回传。先支持 `claude_code` provider；工作目录 `~/.zero/work/<taskId>`（worktree 留 B3.3）。
- **真实端到端实测**：指派 issue 给 agent → daemon 认领 → 跑 claude → agent 真实中文回复进时间线（~15s）→ issue 变 in_review。
- 下一步 **B3.3**：worktree（在绑定仓库的 `zero/ZERO-N` 分支上干活）+ 流式执行日志 + 会话续接打磨。

## 2026-06-19 · B3.1 派发骨架完成（服务端环路）

**后端**（迁移 0005）
- `task` 表：issue×agent 的派发单元（queued/running/succeeded/failed/cancelled），含 runtime_id / session_id / work_dir / trigger_event_id。
- `lib/dispatch.ts`：`enqueueTaskForIssue`（指派 agent + 非 backlog 才入队；未绑运行时记系统事件；同 issue×agent 去重；**复用上次 session_id**）+ `assembleContext`（issue + 最近 20 评论 + 仓库）。
- 触发点：issue 创建/指派 agent/移出 backlog、人在 agent-assigned issue 下评论。
- daemon 接口：`/daemon/tasks/claim`（取本 runtime 排队任务 → running + run_started + 返回装配好的上下文）、`/complete`（写 agent 评论 + run_finished + issue→in_review + 存 session）、`/fail`（run_failed）。
- **实测**（curl 模拟 daemon）：自动入队 → 认领带完整上下文 → 完成 → issue 变 in_review → 评论再触发新任务且复用 session。

**前端**：时间线渲染 `run_started/run_finished/run_failed`（含「未绑定运行时」提示）。

**下一步 B3.2**：daemon 认领循环 + 真实跑 `claude -p` + worktree 执行 + 流式日志。

## 2026-06-19 · B2b daemon（本地运行时）完成 —— B2 全跑通

- `daemon/`（Bun/TS）：发现本地 `claude`/`codex`/`opencode` → 用配对令牌 `POST /daemon/hello` 连上 → 每 20s 心跳；可 `bun build --compile` 出单文件。
- **后台常驻**：`start`(分离子进程 + 写 `~/.zero/daemon.pid` + 日志 `~/.zero/daemon.log`，忽略 SIGHUP 关终端不退) / `stop` / `status` / `run`(前台调试)。
- **端到端实测**：daemon 连上后本机三个 CLI 全部发现，runtime 在 Web 端变「在线」；start/status/stop 生命周期实测通过。
- 运行：`cd daemon && bun install && bun run src/index.ts start --server <url> --token <令牌>`（见 `daemon/README.md`）。
- B3 将在此基础上认领 task、在 issue 的 worktree 里跑 agent、流式回传时间线。

## 2026-06-19 · B2a 运行时管理（服务端 + UI）完成

**决定**：daemon 用 **Bun/TypeScript** 写（与服务端同栈、共享类型、可编译单二进制）。

**后端**（迁移 0004）
- `runtime` 表 + 配对令牌（sha256 存储，明文仅创建时返回一次）。
- 工作空间接口：`GET/POST/DELETE /workspaces/:ws/runtimes`（派生在线状态：60s 内有心跳算在线；删 runtime 自动解绑 agent）。
- daemon 接口（运行时令牌认证）：`POST /daemon/hello`（上报能力 + 心跳）、`POST /daemon/heartbeat`。
- agent 增删改支持 `runtimeId` 绑定（校验属本工作空间）。

**前端**
- 「Runtime 运行时管理」页：列表（在线点 / CLI 能力 / 心跳时间）+ 添加（配对弹窗给命令+令牌+一键复制）+ 删除；15s 轮询刷新在线态。
- agent 编辑弹窗加「运行时」选择器；agent 列表显示绑定的运行时名。

**说明**：daemon 本体是 **B2b**（Bun/TS 实现：发现本地 Claude Code/Codex/OpenCode → 用令牌 hello/heartbeat 连上来）。这里已把它要用的配对/心跳接口备好。

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
