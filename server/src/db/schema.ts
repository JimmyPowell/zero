import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  char,
  text,
  int,
  json,
  decimal,
  timestamp,
  mysqlEnum,
  unique,
  index,
} from "drizzle-orm/mysql-core";

// 用户：邮箱 + 密码登录
export const user = mysqlTable("user", {
  id: char("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// 工作空间
export const workspace = mysqlTable("workspace", {
  id: char("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// 成员：用户 ↔ 工作空间（多对多），带角色
export const member = mysqlTable(
  "member",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: char("user_id", { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["owner", "admin", "member"]).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uniq_member_workspace_user").on(t.workspaceId, t.userId),
    index("idx_member_workspace").on(t.workspaceId),
    index("idx_member_user").on(t.userId),
  ],
);

// 需求（issue）：一个真实开发任务，可指派给成员或（后续）智能体
export const issue = mysqlTable(
  "issue",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // 工作空间内自增的人类可读编号（展示为 ZERO-<number>）
    number: int("number").notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", [
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "cancelled",
    ])
      .notNull()
      .default("todo"),
    priority: mysqlEnum("priority", ["urgent", "high", "medium", "low", "none"])
      .notNull()
      .default("none"),
    // 指派对象：member 或 agent（多态，agent 模块后续接入）
    assigneeType: mysqlEnum("assignee_type", ["member", "agent"]),
    assigneeId: char("assignee_id", { length: 36 }),
    creatorId: char("creator_id", { length: 36 })
      .notNull()
      .references(() => user.id),
    // 父需求（子任务层级，弹窗暂不暴露，预留扩展位）
    parentIssueId: char("parent_issue_id", { length: 36 }),
    // 工作区绑定（三选一）：
    //  - repoId(+baseBranch)：绑仓库 → 隔离 worktree（分支 zero/ZERO-N）
    //  - workDir：绑本地工作目录 → 就地执行（不隔离）
    //  - 都为空：临时空目录
    repoId: char("repo_id", { length: 36 }),
    baseBranch: varchar("base_branch", { length: 255 }),
    workDir: text("work_dir"),
    dueDate: timestamp("due_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_issue_workspace_number").on(t.workspaceId, t.number),
    index("idx_issue_workspace").on(t.workspaceId),
    index("idx_issue_status").on(t.workspaceId, t.status),
    index("idx_issue_assignee").on(t.assigneeType, t.assigneeId),
  ],
);

// 仓库：workspace 级登记，issue 显式绑定其一（单一来源，替代 Multica 双轨）
export const repo = mysqlTable(
  "repo",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    url: text("url").notNull(), // git URL 或本地路径
    defaultBranch: varchar("default_branch", { length: 255 })
      .notNull()
      .default("main"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_repo_workspace").on(t.workspaceId)],
);

// issue 事件：统一时间线（评论 + 状态/指派/优先级变更 + 后续 agent 执行事件）
export const issueEvent = mysqlTable(
  "issue_event",
  {
    id: char("id", { length: 36 }).primaryKey(),
    issueId: char("issue_id", { length: 36 })
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    actorType: mysqlEnum("actor_type", ["member", "agent", "system"]),
    actorId: char("actor_id", { length: 36 }),
    kind: mysqlEnum("kind", [
      "created",
      "comment",
      "status_change",
      "priority_change",
      "assignment",
      // 以下为 Phase B 的 agent 执行事件，先纳入枚举免后续迁移
      "run_started",
      "run_progress",
      "run_finished",
      "run_failed",
      "diff_ready",
      "pr_opened",
    ]).notNull(),
    body: text("body"), // 评论正文（markdown）
    meta: json("meta"), // 结构化负载，如 {from,to}
    // 毫秒精度，保证同一秒内多条事件按真实顺序排
    createdAt: timestamp("created_at", { fsp: 3 })
      .notNull()
      .default(sql`(now(3))`),
  },
  (t) => [index("idx_issue_event_issue").on(t.issueId, t.createdAt)],
);

// 智能体（AI 队友）：一份配置，可指派给 issue、（B2）绑定到运行时执行
export const agent = mysqlTable(
  "agent",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    avatarUrl: text("avatar_url"),
    // 底层编码 Agent CLI
    provider: mysqlEnum("provider", ["claude_code", "codex", "opencode"])
      .notNull()
      .default("claude_code"),
    model: varchar("model", { length: 128 }),
    instructions: text("instructions"), // 系统指令 / 自定义提示
    runtimeId: char("runtime_id", { length: 36 }), // B2 预留：绑定的运行时
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_agent_workspace_name").on(t.workspaceId, t.name),
    index("idx_agent_workspace").on(t.workspaceId),
  ],
);

// 运行时：执行 agent 的地方（本地 daemon / 云端）。daemon 用 token 配对上来。
// 归属一个账号(ownerId)；workspaceId = 配对时所在的「主」工作空间（来源记录）。
// 实际「在哪些工作空间可用」由 runtime_workspace 决定（触达范围）；
// 「谁能用」由 visibility 决定（private=仅 owner / workspace=触达空间内全员）。
export const runtime = mysqlTable(
  "runtime",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // 添加者（账号级归属）。可空：兼容历史行 / 旧版服务端创建（迁移回填）
    ownerId: char("owner_id", { length: 36 }).references(() => user.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    kind: mysqlEnum("kind", ["local", "cloud"]).notNull().default("local"),
    // 可见性：private=仅 owner 可见/可用；workspace=触达到的工作空间内全员可用
    visibility: mysqlEnum("visibility", ["private", "workspace"])
      .notNull()
      .default("workspace"),
    // 运行时级并发上限：daemon 同时最多并行的任务数（1=串行）
    maxConcurrency: int("max_concurrency").notNull().default(1),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(), // sha256(token)
    // 发现到的 CLI 能力，如 {claude_code:true, codex:false, opencode:false}
    capabilities: json("capabilities"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_runtime_workspace").on(t.workspaceId),
    index("idx_runtime_owner").on(t.ownerId),
    index("idx_runtime_token").on(t.tokenHash),
  ],
);

// 运行时触达范围：运行时「上架」到哪些工作空间（多对多）。
// owner 可把同一台运行时上架到自己加入的多个工作空间（跨工作空间共享）。
export const runtimeWorkspace = mysqlTable(
  "runtime_workspace",
  {
    runtimeId: char("runtime_id", { length: 36 })
      .notNull()
      .references(() => runtime.id, { onDelete: "cascade" }),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uniq_runtime_workspace").on(t.runtimeId, t.workspaceId),
    index("idx_runtime_workspace_ws").on(t.workspaceId),
  ],
);

// 任务：一次 agent 执行的派发单元（issue × agent）
export const task = mysqlTable(
  "task",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    issueId: char("issue_id", { length: 36 })
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    agentId: char("agent_id", { length: 36 })
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    runtimeId: char("runtime_id", { length: 36 }), // 入队时取自 agent.runtimeId
    status: mysqlEnum("status", [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ])
      .notNull()
      .default("queued"),
    triggerEventId: char("trigger_event_id", { length: 36 }), // 触发的评论事件
    sessionId: text("session_id"), // agent CLI 会话（按 agent×issue 复用）
    workDir: text("work_dir"), // worktree 路径（B3.2）
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("idx_task_claim").on(t.runtimeId, t.status),
    index("idx_task_issue").on(t.issueId),
  ],
);

// 执行细粒度日志：一次 task 执行流中每一步规范化后的事件（可回放）。
// 与 provider 无关 —— daemon 里各 provider 的 adapter 把原生流（stream-json 等）
// 翻译成这套统一 schema 后写入；server / web 只认这套，不碰 provider 细节。
export const runEvent = mysqlTable(
  "run_event",
  {
    id: char("id", { length: 36 }).primaryKey(),
    taskId: char("task_id", { length: 36 })
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    issueId: char("issue_id", { length: 36 })
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // 每个 task 内单调递增，排序 + SSE 断点续传（Last-Event-ID）的锚
    seq: int("seq").notNull(),
    // 规范化事件类型（与 provider 无关）
    type: mysqlEnum("type", [
      "run_status", // 生命周期/元信息：init、result
      "assistant_text", // 模型可见文本
      "thinking", // 模型思考 / 推理（若 provider 提供）
      "tool_call", // 发起一次工具调用
      "tool_result", // 工具返回
      "usage", // token / 费用
      "error", // 错误
    ]).notNull(),
    // 规范化工具类目（read|edit|write|exec|search|task|other），仅工具类事件有
    tool: varchar("tool", { length: 32 }),
    // 原始工具名（如 Bash / exec_command），保真用
    toolName: varchar("tool_name", { length: 128 }),
    text: text("text"), // 折叠态摘要（一行）
    // 展开态完整内容（与 provider 无关）：工具完整命令/参数、完整输出、完整思考、完整文本
    detail: text("detail"),
    payload: json("payload"), // 原始 provider 事件（全保真）
    createdAt: timestamp("created_at", { fsp: 3 })
      .notNull()
      .default(sql`(now(3))`),
  },
  (t) => [
    unique("uniq_run_event_task_seq").on(t.taskId, t.seq),
    index("idx_run_event_task").on(t.taskId, t.seq),
  ],
);

// 任务用量/成本：一次 task 执行的 token / 成本（取自 Claude result 事件的权威值）。
// 一个 task 一行（daemon 完成时上报，含会话重跑累计）。用于运行时 / agent / 按天聚合。
// 反范式带上 workspaceId / runtimeId / agentId，便于无 join 聚合。
export const taskUsage = mysqlTable(
  "task_usage",
  {
    taskId: char("task_id", { length: 36 })
      .primaryKey()
      .references(() => task.id, { onDelete: "cascade" }),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    runtimeId: char("runtime_id", { length: 36 }),
    agentId: char("agent_id", { length: 36 }),
    model: varchar("model", { length: 128 }),
    // Claude 给的权威成本（total_cost_usd）——比维护硬编码定价表更准
    costUsd: decimal("cost_usd", { precision: 12, scale: 6 }),
    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    cacheReadTokens: int("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: int("cache_write_tokens").notNull().default(0),
    durationMs: int("duration_ms"),
    numTurns: int("num_turns"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_task_usage_runtime").on(t.runtimeId, t.createdAt),
    index("idx_task_usage_agent").on(t.agentId),
    index("idx_task_usage_workspace").on(t.workspaceId, t.createdAt),
  ],
);

// 渠道绑定：某用户在某工作空间「在哪收通知」。kind 决定渠道，config 存渠道参数。
// N1 仅启用 email；枚举先铺全，后续渠道免迁移。
export const channelBinding = mysqlTable(
  "channel_binding",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // 群机器人类渠道（wecom/feishu）可不绑定具体用户 → 预留可空
    userId: char("user_id", { length: 36 }).references(() => user.id, {
      onDelete: "cascade",
    }),
    kind: mysqlEnum("kind", [
      "email",
      "telegram",
      "wecom",
      "feishu",
      "webpush",
    ]).notNull(),
    // 渠道参数：email {address} / telegram {chatId} / wecom|feishu {webhookUrl} / webpush {endpoint,keys}
    config: json("config").notNull(),
    enabled: int("enabled").notNull().default(1), // 1=启用 0=停用
    // 验证时间：email N1 免验证（创建即视为已验证）；Telegram 走 /start 回填
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_channel_ws_user_kind").on(t.workspaceId, t.userId, t.kind),
    index("idx_channel_workspace").on(t.workspaceId),
  ],
);

// 通知发件箱：每条「要投递到某渠道」的通知先落这里（DB 是真相），
// worker 周期 flush + 退避重试。绝不「发出去就算」。
export const notificationOutbox = mysqlTable(
  "notification_outbox",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // 来源 issue_event（可空：未来非 issue 来源的通知）
    eventId: char("event_id", { length: 36 }),
    issueId: char("issue_id", { length: 36 }),
    bindingId: char("binding_id", { length: 36 })
      .notNull()
      .references(() => channelBinding.id, { onDelete: "cascade" }),
    // 冗余渠道类型，便于 worker 分流 / 查询
    channel: mysqlEnum("channel", [
      "email",
      "telegram",
      "wecom",
      "feishu",
      "webpush",
    ]).notNull(),
    subject: text("subject"),
    body: text("body"),
    payload: json("payload"), // 渠道特定结构（卡片等）
    status: mysqlEnum("status", ["pending", "sent", "dead"])
      .notNull()
      .default("pending"),
    attempts: int("attempts").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(5),
    // 下次投递时间（退避锚点）。worker 取 status=pending AND next_attempt_at<=now。
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    // 回控用：外部消息 id ↔ issue 的关联（Telegram 档启用），N1 预留
    ref: json("ref"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
  },
  (t) => [
    index("idx_outbox_pending").on(t.status, t.nextAttemptAt),
    index("idx_outbox_issue").on(t.issueId),
  ],
);

export type User = typeof user.$inferSelect;
export type Workspace = typeof workspace.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Issue = typeof issue.$inferSelect;
export type Repo = typeof repo.$inferSelect;
export type IssueEvent = typeof issueEvent.$inferSelect;
export type Agent = typeof agent.$inferSelect;
export type Runtime = typeof runtime.$inferSelect;
export type RuntimeWorkspace = typeof runtimeWorkspace.$inferSelect;
export type Task = typeof task.$inferSelect;
export type RunEvent = typeof runEvent.$inferSelect;
export type TaskUsage = typeof taskUsage.$inferSelect;
export type ChannelBinding = typeof channelBinding.$inferSelect;
export type NotificationOutbox = typeof notificationOutbox.$inferSelect;
