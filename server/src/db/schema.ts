import {
  mysqlTable,
  varchar,
  char,
  text,
  int,
  json,
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
    // 绑定的仓库与基准分支（Phase A 占位，Phase B 接执行）
    repoId: char("repo_id", { length: 36 }),
    baseBranch: varchar("base_branch", { length: 255 }),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
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

export type User = typeof user.$inferSelect;
export type Workspace = typeof workspace.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Issue = typeof issue.$inferSelect;
export type Repo = typeof repo.$inferSelect;
export type IssueEvent = typeof issueEvent.$inferSelect;
export type Agent = typeof agent.$inferSelect;
