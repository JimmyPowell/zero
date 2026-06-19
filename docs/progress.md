# 进展日志

> 每完成一块开发 / 有重要进展就在最上面追加一条（倒序）。日期用绝对日期。

## 2026-06-19 · 合并智能体技能（feat/agent-skills → main）🎉

- 合入 Phase C：技能库（CRUD + GitHub 导入）、智能体详情页（属性/技能/系统指令/活动）、agent 加 `description`、daemon 把挂载技能**物化进 worktree `.claude/skills/<slug>/SKILL.md`**（Claude Code 自动发现）。
- **迁移撞号**：分支 `0011_agent_skills`（3 表 skill/skill_file/agent_skill + `agent.description`，**纯加性、dev 库未应用**）与 main `0011`/`0012` 同号 → 取 main 迁移目录、删分支 0011、`db:generate` 重生成为 **0013** 并 `db:migrate` 真建表。
- **冲突**：除迁移产物外全是"双方各自新增、保留两边"（schema/index/daemon/api-client/ui-store/main/Layout/progress auto-merge 或并列）；`daemon/index.ts` executeClaim 取 main 的 `model`+provider 门控 mcpConfig，插入分支的 `materializeSkills` 调用，丢掉分支冗余的 prompt/mcpConfig。
- **限制（C5 待办）**：物化只写 `.claude/skills`（Claude Code）；Codex 实际要 `.agents/skills` → 给 Codex 用技能需补。
- **校验**：typecheck/build + `db:migrate` 建表；技能端到端实测（见提交说明）。

## 2026-06-19 · 立项记录：Agent 凭据注入（BYOK）⏳待办

- **调研**：Zero 现状 = daemon `env: process.env` **复用机器登录态**（claude OAuth / codex ChatGPT / opencode 存盘），控制层无凭据字段。Multica 已做 per-agent `custom_env`（BYOK，注入 `ANTHROPIC_API_KEY`/`*_BASE_URL`/Bedrock 等），但**值明文存 DB**。
- **需求度**：个人自己 Mac 够用（低）；一旦**云端无头 runtime / 多账号 / 代理路由 / 企业 Bedrock** 就是刚需。
- **方案已写入 [`docs/agent-credentials.md`](agent-credentials.md)**：per-agent（可选 per-runtime）custom_env，spawn 时 merge env；**差异化 = 加密存（AES-GCM）+ 审计读端点 + 系统键黑名单**（不学 Multica 明文）。改动小（迁移 + 端点 + daemon 一行 merge + 表单）。
- **状态**：先不做，等要上云端/多账号/代理时再启。

## 2026-06-19 · 合并外部通知 + 设置页 + Telegram 回控（feat/notifications → main）🎉

- 把 `feat/notifications`（邮件/企微/Telegram 三渠道出站 + 设置页自助绑定 + 事件→`notification_outbox`→渠道 adapter 可靠投递 + Telegram 双向回控 C1/C2）合入 main。分支基于很早的 `8a0ab40`，跨度大。
- **迁移撞号（双 0010）**：分支 `0010_ambitious_vermin`(通知表 `channel_binding`/`notification_outbox`) 与 main `0010`(runtime)+`0011`(detail) 同号不同物。保留 main 的 0010/0011，通知表重生成为 **0012**（dev 库已应用过，journal `when` 对齐 `1781864555187` → `db:migrate` no-op，不重建表）。
- **冲突处理**：`schema.ts`(taskUsage 与通知表并存)、`api-client.ts`(留 main 的 `deleteRuntime{deleted}` + 并入渠道方法)、`ui-store.ts`(runtime/成本 i18n 与通知 i18n 并存，保住 `noCostHint`)、`main.tsx`(RuntimeDetailView + SettingsView 路由并存)；`issues.ts`/`daemon.ts` 的 `notifyIssueEvent` hook 已干净 auto-merge。
- **凭据**：渠道密钥只在分支 worktree `.env`（不入库）；合并后 main 的 `.env` 无凭据 → 通知发送需自配后才生效（`.env.example` 已带样例键）。
- **校验**：server/web typecheck + web build；`db:migrate` no-op。

## 2026-06-19 · 成本来源说明 + codex「无金额」标注 + 单价表待办

- **三家成本来源**：claude=`total_cost_usd`（权威）、opencode=`step_finish.part.cost`（权威，逐 step 累加）—— 都是 provider 自报的真实金额；**codex 走 ChatGPT 订阅，CLI 只给 token、不给单价/金额** → `cost_usd` 留 `null`（不是 0，是"金额未知"）。
- **opencode token 修正**：把 `reasoning` token 并入 output（`input+output+cache==total`，之前漏了 reasoning）。
- **codex 无金额标注**：运行时用量汇总加 `noCostRuns`（`cost_usd IS NULL` 计数）；详情页成本下方提示"其中 N 次为订阅计费·无金额数据（已排除在成本外）"，避免把空/0 误读成免费。
- **⏳ 待办（单价表，先不做）**：codex 这类"只有 token、无金额"的，将来可**自维护一张单价表**（按 model 的 input/output 单价）来估算成本，价表**可能从 [LiteLLM](https://github.com/BerriAI/litellm) 的 `model_prices` 或同类平台拉取**（避免手填易过期）。现在先不做，标记待办。

## 2026-06-19 · 合并执行日志详情化 + Codex/OpenCode 接入（feat/run-log-detail → main）🎉

- 把 `feat/run-log-detail`（Phase 1 日志详情化 + Phase 2 Codex/OpenCode 接入）合入 main。分支基于 `ec75ff0`（已含我方 §3.1 MCP / §3.2 增量 / 运行时管理），在其上做 provider 分发 + 详情化，**完整保留** `mcpConfig`/`buildPrompt(full)`/`usage`（且 MCP 按 provider 门控：`spec.mcp ? writeMcpConfig : undefined`，只 claude 注入）。
- **迁移 0011 加性**（`run_event` 加 `detail` text 列），dev 库已应用 → `db:migrate` no-op。
- **冲突仅 `docs/progress.md`**：main 自基点起只改了 `dispatch.ts`+docs，分支没碰 `dispatch.ts`，所以 `daemon/index.ts` 等全部干净 auto-merge；我方 `bb1617d` newest-20 修复（在 `dispatch.ts`）被 auto-merge 保留。
- **校验**：server/daemon/web typecheck + web build 全过；`db:migrate` no-op；端到端复跑（claude + MCP + 增量；opencode 真实链路）。

## 2026-06-19 · 上下文流程全面 e2e + 修复 push 窗口取最老 20 的 bug

- **bug（测试揪出来的）**：`assembleContext` 注释写"最近 20 条"，实现却用 `asc + limit 20`（=**最老** 20 条）。issue ≤20 条无感，>20 条就错：冷启动/回退拿到最老评论而非最新；resume 增量基于最老窗口 → 新评论可能不在窗口里被漏掉。修复：`desc + limit 20` 取最新 20，再 `reverse()` 回时间正序供前缀计数/展示。
- **全面 e2e（真打后端 + 真跑 claude，13/13 通过）**：
  - **A happy 增量**：同一 (agent,issue) 三轮续接，turn3 凭记忆答出跨轮的 暗号A(描述里)+暗号B(turn2 评论里)，`resumeFromIndex` 走增量。
  - **B >20 评论**：push 封顶 20、最老的第1条被挤出窗口 → agent 自动调 `mcp__zero__zero_older_comments` 回拉、答出 BANANA42（pull 兜底闭环）。
  - **C 会话丢失**：篡改 session_id → daemon 检测失效、回退**全量** push、仍答出暗号B、写入新会话 id（不失忆）。
- **文档**：`agent-context-model.md` 补 §6 会话模型（runtime/agent/session/任务关系图、两种 push 模式、20 限制何时生效、@-mention 多 agent）。
## 2026-06-19 · Phase 2：接入 Codex / OpenCode（feat/run-log-detail 开发记录）

接着 Phase 1 在同分支做（已由本次合并并入 main）。让 daemon 能像跑 Claude 一样直接调用 Codex / OpenCode 完成任务，并把它们的执行日志按同一套归一化回写。

- **本机实测确认接入方式**：Codex `codex-cli 0.135.0`（ChatGPT 登录）= `codex exec --json`（点号事件 `thread.started`/`turn.*`/`item.*`，**stdin 必须关**否则卡读 stdin，走代理）；OpenCode `1.15.13`（DeepSeek/opencode-go）= `opencode run --format json`（`step_start`/`text`/`tool_use`/`step_finish`，`step_finish` 带 tokens **和真实 cost**）。
- **daemon 多 provider 分发**：按 `agent.provider` 选 `runClaude`/`runCodex`/`runOpenCode`，去掉「只接 Claude」限制；各自处理 stdin / 模型形态 / 会话续接（claude `--resume`、codex `exec resume <id>`、opencode `-s <id>`）+ 续接失败回退全量新会话。
- **新增 3 个文件**：`codex-adapter` / `opencode-adapter` / `adapter-util`，把各家原生 JSON 事件→统一 `RunEvent`（Phase 1 的 `text` 摘要 + `detail` 完整内容：完整命令/参数/输出/退出码/思考/文本）。server/web **零改动**，详情/可展开 UI/成本表自动覆盖三家。
- **成本**：claude 用权威 `total_cost_usd`；opencode 用它给的真实 `cost`+tokens；codex 用 `turn.completed` tokens（无单价，cost 留空）。全部落 `task_usage`。
- **实测**：adapter 单测 14/14；**OpenCode 全链路端到端 8/8**（真实 daemon 跑真实 `opencode`：`echo` 命令与输出进 detail、tokens 入 task_usage、run 成功）；daemon `tsc` 通过。
- **Codex 端到端待办**：本机 codex 走 `wss://chatgpt.com/backend-api/codex/responses`，当前代理对该 WebSocket 仍 reset（HTTP 通、wss 不通）；adapter 已按 Multica 字段名+多兜底写好并单测，等代理放行后抓一次真实成功流最终校验。codex 运行时需「带代理 env 启动 daemon」。
- **Phase 3（后话）**：某次执行改了哪些文件 / ±行数 / 每文件 diff / 文件预览。

## 2026-06-19 · 执行日志详情化 Phase 1（feat/run-log-detail 开发记录）

独立 worktree/分支，基于含运行时管理的 main（已由本次合并并入）。把执行日志从「只有一行摘要」做成可逐步深入查看：

- **现状盘点**：我们日志架构其实早已对齐 Multica —— `run_event`（provider 无关、seq 有序）≈ Multica 的 `task_message`；daemon 里 adapter 把原生流→统一事件；已有 SSE 实时 + 历史回放 + 彩色条。差距只在：详情藏在 payload 里没露出、实时流没带详情、截断太狠、UI 行不可展开。
- **采集更全（迁移 0011，加 `run_event.detail`，向后兼容）**：claude-adapter 每条事件产出 `text`=一行摘要 + `detail`=完整内容 —— 工具完整命令(Bash)/格式化参数(JSON)、完整工具输出、完整思考、完整文本、用量 token 明细；放宽原 2000/4000 截断（detail 上限 16000）。
- **实时也带详情**：daemon events 接口落 `detail`，SSE publish + backlog 都带上，跑动中即可展开看完整内容（不必等刷新）。
- **可展开 UI（RunLogOverlay）**：每行加展开箭头 —— 折叠两行摘要、展开 `<pre>` 看完整命令/参数/输出/思考；顶部活动条由「一事件一格」升级为「连续同类合并成按占比分段 + 可点击跳转 + 跑动中末段脉冲」；复制全部改用完整内容。
- **多 provider 统一**：`detail` 是 provider 无关字段，Codex/OpenCode 接入时各自 adapter 填同一字段即可（Phase 2）。
- **实测**：adapter 单测 18/18（各事件 text 摘要 + detail 完整）、API 往返 6/6（daemon 发带 detail 事件 → 落库 → 历史接口返回 detail）；server/web/daemon tsc + build 全过。
- **下一批**：Phase 2 = Codex + OpenCode 真正执行 + 各自 adapter（去掉「只接 Claude」）；Phase 3（后话）= 某次执行改了哪些文件/±行数/每文件 diff/文件预览。
## 2026-06-19 · Phase C：Skill 全链路 C1–C3 实现（feat/agent-skills）✅

> 确认方案后开发：先做 Skill 全链路，工作空间级 skill + 第一版含 GitHub 导入。3 个分阶段 commit，均过 typecheck/build。**未对共享 dev 库执行 migrate**（别人也在用），待用户环境自行 `db:migrate`。

- **C1 数据模型 + 服务端 API** `feat(c1)`：
  - schema 新增 `skill`（slug/name/description/content/source/source_ref/content_hash）、`skill_file`（path/is_binary/content/storage_key，二进制留 C5）、`agent_skill`（多对多 + position）；`agent` 加 `description`。迁移 `0011_agent_skills`（drizzle-kit 生成，纯加性）。
  - `routes/skills.ts`：工作空间级 CRUD + `POST /import`（解析 GitHub 链接 → contents API 找 SKILL.md → frontmatter 解析 + 同级文本附件，有界 20 个/256KB）。
  - `routes/agents.ts`：详情 `GET /:id`（绑定运行时 + 挂载技能 + 30 天用量 + 最近运行）+ `PUT /:id/skills`（整体替换挂载，校验同工作空间）。
- **C2 前端** `feat(c2)`：
  - 技能库 `/skills`：列表 + `CreateSkillDialog`（建/编辑，编辑按 id 拉详情载正文）+ `ImportSkillDialog`（GitHub）+ 删除。
  - 智能体详情页 `/agents/:id`（仿 `RuntimeDetailView`）：头部 + 属性（provider/model/runtime）+ 三 tab（技能挂载·卸载 via `SkillAttachDialog` / 系统指令 / 活动=用量+最近运行）。
  - `AgentsView` 行可点进详情；`CreateAgentDialog` 加 description；api-client / ui-store(zh+en) / 路由 / 侧栏「技能库」接线。
- **C3 运行时注入** `feat(c3)`：
  - claim 用 `loadAgentSkills` 把挂载技能（+文本附件）随 claim 下发。
  - daemon `materializeSkills`：物化进 `<worktree>/.claude/skills/<slug>/SKILL.md`（frontmatter 由 name/description 合成，库里只存正文）；**manifest 只清自管 slug**（保留用户自带 skill，卸载即消失）；防穿越附件路径；`git rev-parse --git-path info/exclude` 把 `.claude/` 加 exclude 不污染 PR；best-effort 失败不阻断。按 issue 隔离、随 worktree 清理。
- **校验**：server / web / daemon typecheck 全过；web `vite build` 过。**未跑完整后端/daemon**（共享环境）。详见 `docs/agent-extensibility.md` §9/§10。
- **下一步**：用户环境 `db:migrate` 应用 0011 + 真机 e2e；之后排 C4（每 agent MCP）/ C5（适配层 + 版本快照 + 二进制 + 插件位）。

## 2026-06-19 · Phase C 可扩展性：调研 + 方案设计（待确认）📝

- **隔离**：开分支 `feat/agent-skills` / 工作树 `~/code/zero-agent-skills`，调研与设计在树内进行。
- **调研**（4 路并行）：① 四个底层 CLI（Claude Code/Codex/OpenCode/Gemini）能力矩阵 —— **`SKILL.md` 是跨工具开放标准**（四家通吃，OpenCode/Codex 直读 `.claude/skills`、`.agents/skills`）；② Multica 的 skill（DB+物化）/agent 数据模型/MCP(按 provider 分流)/无插件；③ Multica 短板（版本粗糙、二进制炸、provider 写死 #257、安全裸奔、#1579 可信度）；④ MCP 争议（token 膨胀/投毒/工具混淆 vs 渐进披露/code-execution）。
- **产出**：`docs/agent-extensibility.md` —— Skill 作能力原语（instructions=人格 / skills=按需能力）、控制层存 + 运行时物化进 worktree（随 issue 清理、git exclude 不污染 PR、派发即快照版本）、库+挂载双层、MCP 带教训接（限域+白名单+成本上台面）、ProviderAdapter 留插件位、智能体详情页+技能库 UI、分阶段 C1–C5。
- **下一步**：等用户确认方案（§10 开放问题），再按 §9 阶段开发。**本条之前未改任何代码。**

## 2026-06-19 · 合并运行时管理升级（feat/runtime-management → main）🎉

- 把 `feat/runtime-management`（作用域/可见性 · 成本落库 · 运行时级并发 · 运行时 CRUD+详情）合入 main。迁移 **0010 加性**（新列可空/默认、纯新增表 `runtime_workspace`/`task_usage`），已应用到 dev 库 → `db:migrate` no-op。
- **冲突处理**（都在 daemon 执行链与 daemon 路由）：
  - `daemon/index.ts` 会话回退分支：合并「我方 §3.2 增量 prompt + §3.1 `mcpConfig`」与「分支用量累计」。**关键修正**：分支回退里复用了 `prompt`，但 §3.2 后 `prompt` 已是增量版 → 回退改用 `buildPrompt(claim,{full:true})` 全量重建，再 `mergeUsage` 累计成本。
  - `runClaude` 同时带 `mcpConfig`（我）+ `usage` 返回（分支）；`pump/executeClaim`（分支并发池）与 `import.meta.main` 守卫（我）共存。
  - `routes/daemon.ts` claim 处理：分支并发守卫 + 条件抢占 与 我方 `assembleContext({agentId,resuming})` 共存；我方 §3.1 `GET /issues/:id/{comments,runs}` 与分支 usage/并发接口并列。
- **校验**：server/daemon/web typecheck + web build 全过；`db:migrate` no-op；端到端复跑（见下）。

## 2026-06-19 · §3.1 混合上下文：push 保底 + MCP 按需拉深

- **目标**：push 把地板（issue+最近评论+work）塞进 prompt，再给 agent 一个 MCP 工具按需回拉"地板之外"的更深上下文 —— 拿到 Multica 那样的扩展性，又不丢 Zero 的确定性。
- **服务端**（`routes/daemon.ts`，运行时令牌 + 工作空间隔离）：`GET /daemon/issues/:id/comments?before=&limit=`（更早评论，游标分页）、`GET /daemon/issues/:id/runs`（历史运行状态/失败原因）。
- **daemon**：新增手写 stdio MCP server `src/mcp-context.ts`（`zero_older_comments` / `zero_prior_runs`，凭 env 调上述端点，`import.meta.main` 守卫）；`writeMcpConfig` 按 issue 写 `~/.zero/mcp/<id>.json`(0600)，`runClaude` 加 `--mcp-config`；prompt 提示工具存在、"够用别拉"。
- **验证**：typecheck 全过；MCP server 独连真端点（initialize/tools/list/两 tools/call 正确、ISO-Z、隔离）；**真机 e2e**：强制用工具 → init 32 个工具(30+2)、agent 调 `mcp__zero__zero_prior_runs` 拿真数据正确作答、tool_call 进时间线。详见 `docs/agent-context-model.md` §5。

## 2026-06-19 · 上下文增量推送（resume 只推新增评论）+ 模型对比文档

- **文档**：新增 `docs/agent-context-model.md` —— Zero(厚 push) vs Multica(瘦 push + agent 自取) 的上下文模型对比、push/pull 取舍、使用感分析、8 条演进方向（含证据与三方来源）。
- **优化 #2 增量推送**（演进方向 §3.2）：续接会话那轮只把"上次之后的新增评论"塞进 prompt，旧评论已在会话记忆里不再重复 → 省 token、去冗余。
  - 服务端 `assembleContext(issueId,{agentId,resuming})` 返回全量 20 条 + `resumeFromIndex`（截止点 = 上一条已结束 task 的 `startedAt`，`<` 比较 → 宁多带不漏带）；`daemon.ts` claim 传 `resuming=!!sessionId`。
  - daemon `buildPrompt(claim,{full})`：resume 尝试 `full=false` 只渲染 `comments.slice(resumeFromIndex)`（标题"New comments since your last turn"+"N earlier…"提示）；**新会话首跑 / resume 失败回退** `full=true` 渲染全量（避免新会话失忆）。
  - `buildPrompt` 导出 + 入口加 `import.meta.main` 守卫（可被单测 import 而不启动 daemon）。
- **验证**：server/daemon typecheck 全过；`buildPrompt` 单测（增量/全量/首跑三态断言通过）；`resumeFromIndex` 对真实 #11 数据正确（fresh=0、resume=2）；**真机 resume 端到端**：让 agent 复述上一条回复，返回 `merge-stream-ok`（上一轮产物）—— 证明只推增量也不丢连续性（记忆在会话里）。
## 2026-06-19 · 通知阶段收尾（暂告一段落）

- 现状：外部通知三渠道（邮件 / 企业微信智能机器人 / Telegram）真机验证通过 + 设置页自助绑定；Telegram 双向回控 C1+C2 完成（聊天里建/选/评论/改状态/优先级/指派/搜索/切空间）。**满足当前需求，通知阶段暂停**。
- **暂缓（按需再启）**：C3 富交互（按钮选择器 / 原地更新卡片 / 危险操作确认 / 回复绑定持久化）；企微接同一 router 做回控；N4 飞书；N5 移动端（RN/Expo）。C3/C2 的方案与能力清单已存 [notifications.md §十]。
- 全部在分支 `feat/notifications`（worktree `~/code/zero-notifications`），main 未动；凭据仅在该 worktree `.env`（不入库）。**待定**：是否合并回 main。

## 2026-06-19 · C2 Telegram 命令全集

- **共享动作层补全** `issue-actions.ts`：`createIssue`（建+created 事件+派发+通知）、`searchIssues`、`setIssuePriority`、`assignIssue`（member/agent，agent 非 backlog 则派发）、`listAgents`/`findAgentByName`、`listWorkspacesForUser`/`isWorkspaceMember`、`getUserName`；优先级常量/标签。
- **聊天核心** `chat/core.ts`：新命令 `/new`（一行式 + **引导式** 标题→描述，`/cancel` 取消，会话 `flow` 状态）、`/comment`、`/status`、`/priority`、`/assign`、`/search`、`/ws`（按钮切空间，校验成员）；状态/优先级支持中英别名（完成/评审/高/中…）；`pickIssue` 解析「[ZERO-N] 其余」——带号用号、不带用活动 issue。
- **Telegram**：命令菜单补全 11 项。
- **验证**：server typecheck 通过；脚本驱动 12 项全过 —— /new(一行式+DB)、/status 评审、/priority 高、/comment、/assign me、/search 命中、引导式 /new(标题→描述跳过→建)、/cancel、/ws；用独立 chatId 测试避免触发真机推送，含建后清理。
- 下一步 C3 富交互（按钮选择器/原地更新卡片/确认）+ 企微接同一 router。

## 2026-06-19 · C1 Telegram 双向回控（基础闭环）

- **方案定稿**：双向回控（聊天指挥）完整方案 + 能力清单 + 分期 C1/C2/C3 写入 [notifications.md §十]。Telegram 先行。
- **共享动作层** `lib/issue-actions.ts`（findIssueByNumber/listIssuesFor/getIssueBrief/addIssueComment/setIssueStatus）—— HTTP 与聊天共用一份逻辑。
- **聊天核心** `lib/chat/core.ts`（平台无关）：每 chat 会话状态（当前 ws/活动 issue，内存）+ 从绑定恢复用户 + 命令/回复/活动态打字/按钮 → 统一 `ChatReply{text,buttons}`。
- **Telegram 适配**：`telegram-bot.ts` 长轮询接 message + callback_query；命令 `/issues`（按钮列表）`/use`（选中+状态按钮）`/show` `/help` + `setMyCommands` 菜单；活动态打字即评论；**回复通知即评论**（内存 `msgId↔issueId`）；通知卡片附「✅完成/🔍评审」状态按钮（outbox 传 issueId）。
- **验证**：server typecheck 通过；脚本驱动逐项实测——/issues 出 8 行按钮、/use 选中、活动态打字→评论入库、回复绑定→评论、按钮改状态 in_review→in_progress（含 DB 副作用 + 清理还原）全过。
- 范围：C1 不含 /new、/comment、/status 文本命令、富交互（C2/C3）。下一步 C2 命令全集。

## 2026-06-19 · N3 Telegram 渠道（真机验证通过）

- **网络现实**：本机直连 `api.telegram.org` 不可达（探测 HTTP 000，国内常态）。故代码全程预留 `TELEGRAM_PROXY`（Bun fetch `proxy` 选项）；本地真测需走代理，或在可出网节点跑。
- **后端**：`lib/channels/telegram-bot.ts`（长轮询 `getUpdates` 收消息 + 绑定码兑换写 `config={chatId}` + `sendTelegramMessage` 出站 HTML，全部 proxy-aware）；`outbox` 加 telegram 分支；`notify` `SUPPORTED_CHANNELS` 加 telegram；`index` `startTelegramBot()`；config 加 `TELEGRAM_BOT_TOKEN/PROXY`；channels 加 `POST /channels/telegram/link-code`。**schema 无变更**（kind 枚举早含 telegram，免迁移）。
- **前端**：把 `WecomCard` 泛化为通用 `LinkCodeCard`（企微/Telegram 共用：生成码 + 复制 + 轮询自动显示已绑定 + 解绑），设置页加 Telegram 卡片；api-client + i18n 同步。
- **验证**：server typecheck + web `vite build` 通过；启动实测 telegram 无 token 正确跳过、不影响 wecom/outbox。
- **真机验证通过**（bot `@zerosdhdjdbot`，本机走代理 `http://127.0.0.1:7890`）：① Bun fetch 经代理 `getMe` 成功、token 有效；② 长轮询启动无报错；③ 绑定码 `ZERO-ISUQGQ` 发给 bot → 收到回复、写入 `config={chatId:7529520645}`；④ `run_finished → outbox → 服务端 worker 经代理 sendMessage → status sent`，真实到达 Telegram。凭据存 worktree `.env`（不入库）。
- 绑定方式同企微——一次性绑定码（也支持 `/start <码>` 深链）。范围同企微：先只做主动推送，双向回控后续。

## 2026-06-19 · N2 重做：企业微信「智能机器人」（SDK 长连接，双向+主动推送）

- **关键修正**：用户的机器人是企业微信**新版「智能机器人」**（Bot ID + Secret，长连接/URL回调），**不是**旧版群机器人 webhook。智能机器人**本身双向**、且支持**主动推送**（`aibot_send_msg`），长连接出站、**免公网回调**。之前「企业微信只能单向」的判断仅适用于旧群机器人。
- **实测验证（用户真机器人）**：官方 `@wecom/aibot-node-sdk` 在 Bun 跑通 —— ① 连接认证成功；② 双向：用户发「1122」→ 机器人回复，抓到 userid `T60110050A`；③ 主动推送 errcode 0；④ 接入 Zero 管线后，`run_finished → outbox → 服务端 worker 经 live bot sendMessage → status sent` 真实到达。
- **重做内容**：删旧 `wecom.ts`(webhook)；新 `lib/channels/wecom-bot.ts`（`WSClient` 常驻：开机连、心跳/重连、`sendWecomMessage` 主动推送、收消息回调做**绑定码兑换**）；`outbox` wecom 分支改调 `sendWecomMessage(target)`；`index` 开机 `startWecomBot()`；config 加 `WECOM_BOT_ID/SECRET`（.env，不入库）。
- **绑定方式**（按用户定）：**一次性绑定码** —— 设置页 `POST /channels/wecom/link-code` 拿码（实测返回 `ZERO-XXXX`），用户在企微把码发给机器人 → 回调里核对 → 写 `channel_binding(kind=wecom, config={target})`。前端 `SettingsView` 加 `WecomCard`（生成码 + 复制 + 轮询自动显示已绑定 + 解绑）。
- **范围**（按用户定）：本档**只做主动推送**；双向回控（按钮卡片/命令）下一步。
- 依赖：`@wecom/aibot-node-sdk@1.0.7`。

## 2026-06-19 · N2 企业微信群机器人渠道

- **后端**：`lib/channels/wecom.ts`（群机器人 incoming webhook，POST markdown，解析 `errcode`）；outbox `deliver` 加 `wecom` 分支；`notify` 收件人渠道查询从「仅 email」泛化为「所有已实现 adapter 的渠道」（`SUPPORTED_CHANNELS=[email,wecom]`，一绑定一 outbox 行、内容渠道无关）；`channels` 路由 upsert 改判别联合（email 要 address / wecom 要 webhookUrl）。
- **前端**：`SettingsView` 抽出通用 `ChannelCard`（邮件 / 企业微信共用），通知 section 下两张卡片；api-client `UpsertChannelPayload` 改联合 + 类型；i18n 补 `settings.wecom*`。
- **验证**：server typecheck + web `tsc -b`/`vite build` 通过；本地 mock 企业微信端点实测 `created → 入队 wecom 行 → 投递 sent → mock 收到正确 markdown`；渠道 CRUD 联合校验仍 OK。
- **待真实验证**：需用户在企业微信群加「群机器人」拿到 webhook 地址（填到设置页或我配），即可真实推送。
- 下一步：N3 Telegram（出站 + 入站双向回控）。

## 2026-06-19 · 通知设置前端页（自助开关邮件通知）

- 新增**「设置」**入口（左侧栏底部，齿轮图标，独立于主菜单）+ `SettingsView`：通知 section 下「邮件」渠道卡片 —— 开关 + 邮箱输入（默认填账号邮箱）+ 保存 + 移除，状态「已开启 · 将发往 xxx」；底部留「更多渠道即将上线」。
- `api-client` 加 `listChannels/upsertChannel/deleteChannel` + 类型；i18n（zh/en）补 settings.* / menu.settings；路由 `/settings`。
- **验证**：web `tsc -b` + `vite build` 通过；起服务实测 `/channels` 路由 CRUD（建/同 kind 覆盖改址停用/非法邮箱 400/删/列空）全部正确——即设置页所用路径。
- 下一步：N2 企业微信群机器人。

## 2026-06-19 · 通知系统调研 + N1 启动（feat/notifications，worktree）

- **调研定稿**：对标 Multica 通知能力——它只有站内收件箱 + WebSocket，**对外推送一片空白**（无邮件事件通知 / Telegram / 企业微信 / 飞书 / 移动推送 / 对外 webhook）。Zero 的差异化 = 出墙 + 回控。设计写入 [notifications.md](./notifications.md)。
- **澄清移动端**：PWA ≠ 客户端（仍是网页引擎渲染网页）；现有 React 不能直接变 RN（逻辑可复用、UI 全重写）；要做原生客户端推荐 **RN + Expo**（同 TS 栈、三端共享类型）。移动端排到最后一档、本阶段不定死。
- **方向决定**：渠道顺序 **邮件 → 企业微信 → Telegram → 飞书 →（最后）RN App**；先点亮两个通知点 **`created`** + **`run_finished`**；全程预留双向（回控从 Telegram 档起）。
- **N1 完成并实测**（独立分支 `feat/notifications` + sibling worktree `~/code/zero-notifications`，不碰 main）：通知骨架（`notifyIssueEvent` + `notification_outbox` + worker 退避重试）+ 邮件 adapter（SMTP/nodemailer，未配凭据时 dev 回退打印）+ 渠道绑定 API。迁移 0010 加 `channel_binding` / `notification_outbox` 两表。
- **真实发信已验证**：配 QQ 邮箱 SMTP（`smtp.qq.com:465`，凭据只在 worktree `server/.env`、gitignore 不入库）→ 触发 `created` + `run_finished` 两个通知点 → 经 outbox 真实发出两封邮件、状态 `sent`，收件箱确认到达。

## 2026-06-19 · DB 连接钉死 UTC（`timezone=Z`，部署无关）

- **背景**：前一条修复后发现「能正确」其实依赖一个隐含巧合——server 进程恰好跑在 UTC。`mysql2` 读写 DATETIME 默认按**运行进程所在时区**翻译；进程在 UTC 则存量存成 UTC 墙钟、读写自洽，但**换到 CST 环境重启/部署**会开始把本地墙钟（如 `17:55`）写盘，与老数据（`09:55` UTC）混淆 → 8 小时错乱。
- **修复**：`db/index.ts` 连接串加 `?timezone=Z`，强制按 UTC 存取，**不再依赖进程时区**。模型 = 存 UTC、前端按浏览器本地时区显示。
- **验证**（CST 探针进程，写入已知 `09:55Z`）：钉死后磁盘墙钟 = `09:55`（真 UTC）、读回 `09:55Z`；默认连接磁盘墙钟 = `17:55`（CST，即隐患）。存量数据本就是 UTC 墙钟，钉死**不平移老数据**，零迁移。读写两端均通过。

## 2026-06-19 · 修复「最新活动时间」偏移 8 小时（UTC/时区）

- **现象**：盖览列表 / 搜索面板 / 详情右栏的「最新活动时间」普遍比真实早 ~8 小时（如刚评论却显示「8 小时前」），且详情页「最新活动」比时间线事件还早。
- **根因**：`createdAt/updatedAt/事件 createdAt` 是 Drizzle 直接列，mysql2 按 UTC 还原成 `Date` → `toISOString()` **自带 Z**，前端解析正确；但 `lastActivityAt` 是原始 `sql<string>` 聚合（`COALESCE(MAX(...))`），mysql2 **原样返回无时区裸串**（`"2026-06-19 09:39:10.446"`）。前端 `new Date(裸串)` 按**本地时区**(UTC+8)解读 → 偏移 8 小时。
- **修复**：`issues.ts` 加 `isoTime()`，把 `shape()` 输出的 `createdAt/updatedAt/lastActivityAt` 统一规范成带 `Z` 的 ISO（裸串当 UTC 补 `Z`，与列口径一致）。一处改动覆盖 list/search/detail（`shapeDetail` spread `shape`）。前端无需改。
- **实测**：`lastActivityAt` 现与最新事件 `createdAt` **逐字节一致**（`09:39:10.446Z`），相对时间正确（12 分钟前）。
- **附记**：OrbStack 的 MySQL 容器时钟比宿主慢 8h（`UTC_TIMESTAMP()` 偏移），但写入都走宿主 `new Date()`，不污染存量数据；属环境瑕疵，未处理。

## 2026-06-19 · 运行时管理升级（feat/runtime-management 开发记录）

独立 worktree/分支开发，已由本次合并并入 main。把原先「只能增删」的运行时管理补成完整能力：

- **数据模型（迁移 0010，向后兼容、含回填）**：`runtime` 加 `owner_id`(账号级归属)、`visibility`(private|workspace)、`max_concurrency`(默认1)；新表 `runtime_workspace`(触达范围，支持跨工作空间上架)；新表 `task_usage`(每任务 token + **Claude 权威 `total_cost_usd`**)。回填：现有运行时补 reach 行 + owner，避免改用 reach 查询后从列表消失。
- **作用域 / 可见性（两个正交轴）**：① 谁能用 = 私有(仅 owner) / 共享(工作空间全员)；② 在哪些工作空间 = 当前 / 选定多个 / 全部（`runtime_workspace`）。覆盖 4 种场景（自己用 / 工作空间共享 / 跨工作空间共享 / 多空间但仅自己）。列表过滤 = reach∩(共享|自己)；绑 agent、删除、改 reach 都按归属/角色鉴权（owner 整体删，工作空间管理员仅本空间下架）。比 Multica「每个工作空间各注册一份」更省（账号归属，一处上架多处用）。
- **运行时级并发**：daemon 由 `busy` 串行 → 并发池 `pump`（填槽至 `maxConcurrency`）；服务端 hello/heartbeat 下发上限（Web 改完即时生效），claim 加上限守卫 + 条件 UPDATE 抢占（防并行重复领取）。
- **成本管理**：daemon 从 claude `result` 事件采集 model/cost/token（重跑累计）→ `complete` 落 `task_usage` → 运行时详情页按总览 / 按天 / 按 agent 展示。**直接用 Claude 的权威成本**，不维护易过期的硬编码定价表（差异化于 Multica）。
- **前端**：运行时 CRUD 补齐 —— 列表行可点进**详情页**（基本信息 / 触达范围 / 绑定 agent / 用量成本）+ **编辑弹窗**（私有·共享分段 + 并发步进 + 触达范围多选）；列表加可见性/并发/绑定数徽标。i18n zh/en 补齐。
- **实测**：server+daemon+web `tsc`/build 全过；独立端口跑后端 + 模拟 daemon 全链路 e2e **28/28 通过**（创建带跨工作空间 reach、私有可见性、并发上限 claim 守卫、usage 落库与按天/按 agent 聚合、改 reach 下架、owner 删除）。
- **下一批（本轮未做）**：模型发现下拉（daemon 上报各 CLI 可用模型，根治填错模型）、daemon 上报增强（设备名/版本）、健康态细化（online/recently_lost/offline）。

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
