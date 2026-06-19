# 进展日志

> 每完成一块开发 / 有重要进展就在最上面追加一条（倒序）。日期用绝对日期。

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
