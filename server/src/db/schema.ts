import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  char,
  text,
  int,
  json,
  decimal,
  boolean,
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
      "blocked",
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
    // 所属项目（Workspace→Project→Issue）。可空 = 未归类（前端归入虚拟 Inbox）。
    // 松引用（同 repoId，不设 FK）；删项目时由应用层把相关 issue 的 projectId 置空。
    projectId: char("project_id", { length: 36 }),
    // 工作区绑定（三选一）：
    //  - repoId(+baseBranch)：绑仓库 → 隔离 worktree（分支 zero/ZERO-N）
    //  - workDir：绑本地工作目录 → 就地执行（不隔离）
    //  - 都为空：临时空目录
    repoId: char("repo_id", { length: 36 }),
    baseBranch: varchar("base_branch", { length: 255 }),
    workDir: text("work_dir"),
    dueDate: timestamp("due_date"),
    // 软删除：非空=已删（回收站可恢复）。底层 CLI 会话/历史一律不动。
    deletedAt: timestamp("deleted_at"),
    deletedBy: char("deleted_by", { length: 36 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_issue_workspace_number").on(t.workspaceId, t.number),
    index("idx_issue_workspace").on(t.workspaceId),
    index("idx_issue_status").on(t.workspaceId, t.status),
    index("idx_issue_assignee").on(t.assigneeType, t.assigneeId),
    index("idx_issue_project").on(t.projectId),
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

// 项目：Workspace → Project → Issue 的中间分组。绑工作空间、有负责人、有状态生命周期，
// 挂着若干资源（代码仓库 / 知识库 / 外部文档，见 project_resource）。对标 Multica 但收敛。
export const project = mysqlTable(
  "project",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 512 }).notNull(),
    // 工作空间内唯一的 kebab 标识，= 知识库仓库里 projects/<slug>/ 的目录名
    slug: varchar("slug", { length: 128 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 64 }), // emoji / 图标名
    status: mysqlEnum("status", [
      "planned",
      "in_progress",
      "paused",
      "completed",
      "cancelled",
    ])
      .notNull()
      .default("planned"),
    // 负责人：先只支持 member；leadType 预留 agent（Multica 允许 agent 当 lead）
    leadType: mysqlEnum("lead_type", ["member", "agent"]),
    leadId: char("lead_id", { length: 36 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_project_workspace_slug").on(t.workspaceId, t.slug),
    index("idx_project_workspace").on(t.workspaceId),
  ],
);

// 项目资源：多态指针，一表三用 —— 代码仓库(repo) / 原生知识库目录(knowledge) /
// 外部 KB 指针(notion/gdoc/url/file…)。kind 自由扩展、ref 是 JSON，加类型零迁移。
// 仿 Multica project_resource；去重在应用层（MySQL 对 JSON 列做唯一约束不便）。
export const projectResource = mysqlTable(
  "project_resource",
  {
    id: char("id", { length: 36 }).primaryKey(),
    projectId: char("project_id", { length: 36 })
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // repo | knowledge | notion | gdoc | confluence | url | file …（自由扩展，加类型零迁移）
    kind: varchar("kind", { length: 32 }).notNull(),
    // 按 kind 解释：repo→{repoId|url,baseBranch,primary?} / knowledge→{path} /
    // notion→{pageId,tokenRef} / url→{href} …
    ref: json("ref").notNull(),
    label: varchar("label", { length: 255 }),
    position: int("position").notNull().default(0),
    createdBy: char("created_by", { length: 36 }).references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_project_resource_project").on(t.projectId, t.position),
    index("idx_project_resource_workspace").on(t.workspaceId),
  ],
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
      "run_queued",
      "run_started",
      "run_progress",
      "run_finished",
      "run_failed",
      "diff_ready",
      "pr_opened",
      // 末尾追加（取消任务）—— 放最后让 MySQL 走 INSTANT、不锁表重建
      "run_cancelled",
    ]).notNull(),
    body: text("body"), // 评论正文（markdown）
    meta: json("meta"), // 结构化负载，如 {from,to}
    // 毫秒精度，保证同一秒内多条事件按真实顺序排
    createdAt: timestamp("created_at", { fsp: 3 })
      .notNull()
      .default(sql`(now(3))`),
    // 软删除：仅对 kind='comment' 开放。删除=人的视角抹掉；agent CLI 会话里仍记得。
    deletedAt: timestamp("deleted_at", { fsp: 3 }),
    deletedBy: char("deleted_by", { length: 36 }),
  },
  (t) => [index("idx_issue_event_issue").on(t.issueId, t.createdAt)],
);

// 评论附件：先上传（issueEventId 空），发评论时按 attachmentIds 关联到该评论。
// 随 issue/评论级联删除；存储 storageKey 指向 ATTACHMENTS_DIR 下的相对路径。
export const attachment = mysqlTable(
  "attachment",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    issueId: char("issue_id", { length: 36 }).references(() => issue.id, {
      onDelete: "cascade",
    }),
    issueEventId: char("issue_event_id", { length: 36 }).references(
      () => issueEvent.id,
      { onDelete: "cascade" },
    ),
    uploaderType: mysqlEnum("uploader_type", ["member", "agent"]).notNull(),
    uploaderId: char("uploader_id", { length: 36 }),
    filename: varchar("filename", { length: 512 }).notNull(),
    mime: varchar("mime", { length: 128 }).notNull(),
    sizeBytes: int("size_bytes").notNull(),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_attachment_issue").on(t.issueId),
    index("idx_attachment_event").on(t.issueEventId),
  ],
);
export type Attachment = typeof attachment.$inferSelect;

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
    description: text("description"), // 详情页用：这个 agent 是干嘛的
    // 底层编码 Agent CLI
    provider: mysqlEnum("provider", [
      "claude_code",
      "codex",
      "opencode",
      "codebuddy",
      "kimi",
    ])
      .notNull()
      .default("claude_code"),
    model: varchar("model", { length: 128 }),
    // 推理强度（仅 Claude 系 provider 注入：claude_code/codebuddy → `--effort`）。
    // 可空 = 不注入，跟随 CLI 自身默认。取值 low/medium/high/xhigh/max（codebuddy 另支持 minimal）。
    effort: varchar("effort", { length: 16 }),
    instructions: text("instructions"), // 系统指令 / 自定义提示（人格，常驻）
    runtimeId: char("runtime_id", { length: 36 }), // B2 预留：绑定的运行时
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_agent_workspace_name").on(t.workspaceId, t.name),
    index("idx_agent_workspace").on(t.workspaceId),
  ],
);

// 技能（Skill）：工作空间级、可移植的能力包（SKILL.md 主体 + 附属文件）。
// 遵循 SKILL.md 开放标准 → 跨 provider 可移植。content = SKILL.md 正文（不含
// frontmatter）；物化进 worktree 时由 name/description 合成 frontmatter（见 daemon）。
export const skill = mysqlTable(
  "skill",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // 工作空间内唯一的 kebab 标识，= 物化后的目录名 / SKILL.md frontmatter 的 name
    slug: varchar("slug", { length: 128 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(), // 人类可读名
    // 渐进披露的关键：平时只有 name+description 进上下文，命中才加载正文
    description: varchar("description", { length: 1024 }).notNull(),
    content: text("content"), // SKILL.md 正文（不含 frontmatter）
    // 来源：手动新建 / 从 GitHub 导入
    source: mysqlEnum("source", ["manual", "github"]).notNull().default("manual"),
    sourceRef: text("source_ref"), // 导入来源（repo URL / 子路径），manual 为空
    // 正文 + 附件指纹：派发即快照、跑中锁版本（审计 / C5 版本锁定用）
    contentHash: char("content_hash", { length: 64 }),
    createdBy: char("created_by", { length: 36 }).references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_skill_workspace_slug").on(t.workspaceId, t.slug),
    index("idx_skill_workspace").on(t.workspaceId),
  ],
);

// 技能附属文件：与 SKILL.md 同级物化进工作目录的文件（脚本 / 模板 / 参考）。
// 第一版只存文本；is_binary / storage_key 预留二进制（对象存储）到 C5，
// 从结构上避免 Multica「二进制存 UTF-8 文本列会炸」的坑。
export const skillFile = mysqlTable(
  "skill_file",
  {
    id: char("id", { length: 36 }).primaryKey(),
    skillId: char("skill_id", { length: 36 })
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    path: varchar("path", { length: 512 }).notNull(), // skill 内相对路径（防穿越）
    isBinary: boolean("is_binary").notNull().default(false),
    content: text("content"), // 文本内容（二进制留空，走 storageKey）
    storageKey: text("storage_key"), // 二进制对象存储键（C5）
    size: int("size").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uniq_skill_file_path").on(t.skillId, t.path),
    index("idx_skill_file_skill").on(t.skillId),
  ],
);

// 智能体 ↔ 技能：多对多显式挂载（库里有哪些 / 这个 agent 用哪几个）。
export const agentSkill = mysqlTable(
  "agent_skill",
  {
    agentId: char("agent_id", { length: 36 })
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    skillId: char("skill_id", { length: 36 })
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    position: int("position").notNull().default(0), // 展示 / 加载顺序
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uniq_agent_skill").on(t.agentId, t.skillId),
    index("idx_agent_skill_agent").on(t.agentId),
    index("idx_agent_skill_skill").on(t.skillId),
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
    // 子代理结构化：tool_use 自身 id / 所属子代理的父调用 id（web 据此折叠嵌套）
    toolUseId: varchar("tool_use_id", { length: 64 }),
    parentToolUseId: varchar("parent_tool_use_id", { length: 64 }),
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

// 一次 task 执行的代码变更摘要（daemon 完成时 git diff：run 起拍快照基线 → 结束 numstat+patch）。
// 一个 task 一行（仿 task_usage 反范式带 workspaceId/issueId，便于无 join 查询）。
export const taskChange = mysqlTable(
  "task_change",
  {
    taskId: char("task_id", { length: 36 })
      .primaryKey()
      .references(() => task.id, { onDelete: "cascade" }),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    issueId: char("issue_id", { length: 36 }).notNull(),
    filesChanged: int("files_changed").notNull().default(0),
    additions: int("additions").notNull().default(0),
    deletions: int("deletions").notNull().default(0),
    baselineSha: char("baseline_sha", { length: 40 }), // run 起的快照基线 commit
    headSha: char("head_sha", { length: 40 }), // run 结束时的 HEAD
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_task_change_issue").on(t.issueId)],
);

// 单文件变更（隶属 task_change）。patch = 该文件的 unified diff（二进制/超大留空，前端懒取）。
export const taskFileChange = mysqlTable(
  "task_file_change",
  {
    id: char("id", { length: 36 }).primaryKey(),
    taskId: char("task_id", { length: 36 })
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    path: varchar("path", { length: 1024 }).notNull(),
    oldPath: varchar("old_path", { length: 1024 }), // 改名时的原路径
    status: mysqlEnum("status", [
      "added",
      "modified",
      "deleted",
      "renamed",
    ]).notNull(),
    additions: int("additions").notNull().default(0),
    deletions: int("deletions").notNull().default(0),
    isBinary: boolean("is_binary").notNull().default(false),
    patch: text("patch"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_task_file_change_task").on(t.taskId)],
);

// Agent 自触发续跑：agent 经 MCP 登记「过会儿叫我」(timer) / 「这个后台进程跑完叫我」(process)。
// 点燃时 → 插一条系统评论(why) + enqueueTaskForIssue(复用 session_id resume)。
// timer 由服务端 sweeper 扫 fire_at 点燃；process 由 daemon 探 pid 存活上报点燃。
// 护栏见 docs/agent-continuation.md（链深上限 / 注册上限 / 状态闸）。
export const agentWakeup = mysqlTable(
  "agent_wakeup",
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
    // 点燃后入队走它；不强外键(runtime 可被删，唤醒仍可由 server timer 点燃)
    runtimeId: char("runtime_id", { length: 36 }),
    kind: mysqlEnum("kind", ["timer", "process"]).notNull(),
    fireAt: timestamp("fire_at"), // timer：到点时刻；process：空
    pid: int("pid"), // process：要看护的进程号
    note: text("note"), // agent 自述的唤醒原因（带进续跑上下文）
    status: mysqlEnum("status", ["pending", "fired", "expired", "cancelled"])
      .notNull()
      .default("pending"),
    sourceTaskId: char("source_task_id", { length: 36 }), // 注册它的 task（审计）
    createdAt: timestamp("created_at").notNull().defaultNow(),
    firedAt: timestamp("fired_at"),
  },
  (t) => [
    index("idx_wakeup_due").on(t.status, t.fireAt), // server timer sweep
    index("idx_wakeup_runtime").on(t.runtimeId, t.status, t.kind), // daemon 拉看护
    index("idx_wakeup_issue").on(t.issueId),
  ],
);
export type AgentWakeup = typeof agentWakeup.$inferSelect;

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

// 渠道「服务端配置」（A 层）：某工作空间用哪套发信凭据。与 channel_binding（B 层收件人）对称。
// email → SMTP host/port/secure/user/from/fromName 存 config(JSON)，password 单独加密存 secret_enc。
// 仅 owner/admin 可改；DB 命中优先于 env(config.smtp)，env 作兜底。
export const channelProvider = mysqlTable(
  "channel_provider",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", ["email", "wecom", "telegram", "feishu"]).notNull(),
    // 非敏感字段：email = {host,port,secure,user,from,fromName}
    config: json("config").notNull(),
    // 敏感字段：AES-256-GCM 密文 base64(iv|tag|cipher)，绝不进 config、绝不回前端
    secretEnc: text("secret_enc"),
    enabled: int("enabled").notNull().default(1), // 1=启用 0=停用
    updatedBy: char("updated_by", { length: 36 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [unique("uniq_provider_ws_kind").on(t.workspaceId, t.kind)],
);

// 知识库文档索引：真相是 git 仓库里的 markdown，这里只存索引/元数据，供列表 + 检索(M3 全文/向量)。
export const kbDoc = mysqlTable(
  "kb_doc",
  {
    id: char("id", { length: 36 }).primaryKey(),
    workspaceId: char("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // null = 工作空间级；非空 = 项目级（松引用，同 issue.projectId）
    projectId: char("project_id", { length: 36 }),
    scope: mysqlEnum("scope", ["workspace", "project"])
      .notNull()
      .default("workspace"),
    // 知识库仓库内相对路径：conventions.md / projects/<slug>/db.md
    path: varchar("path", { length: 512 }).notNull(),
    title: varchar("title", { length: 512 }),
    pinned: boolean("pinned").notNull().default(false), // 常驻注入(Tier-0 → AGENTS.md)
    contentHash: char("content_hash", { length: 64 }),
    updatedBy: char("updated_by", { length: 36 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("uniq_kb_doc_ws_path").on(t.workspaceId, t.path),
    index("idx_kb_doc_workspace").on(t.workspaceId, t.scope),
    index("idx_kb_doc_project").on(t.projectId),
  ],
);

export type User = typeof user.$inferSelect;
export type Workspace = typeof workspace.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Issue = typeof issue.$inferSelect;
export type Repo = typeof repo.$inferSelect;
export type Project = typeof project.$inferSelect;
export type ProjectResource = typeof projectResource.$inferSelect;
export type KbDoc = typeof kbDoc.$inferSelect;
export type IssueEvent = typeof issueEvent.$inferSelect;
export type Agent = typeof agent.$inferSelect;
export type Skill = typeof skill.$inferSelect;
export type SkillFile = typeof skillFile.$inferSelect;
export type AgentSkill = typeof agentSkill.$inferSelect;
export type Runtime = typeof runtime.$inferSelect;
export type RuntimeWorkspace = typeof runtimeWorkspace.$inferSelect;
export type Task = typeof task.$inferSelect;
export type RunEvent = typeof runEvent.$inferSelect;
export type TaskUsage = typeof taskUsage.$inferSelect;
export type TaskChange = typeof taskChange.$inferSelect;
export type TaskFileChange = typeof taskFileChange.$inferSelect;
export type ChannelBinding = typeof channelBinding.$inferSelect;
export type NotificationOutbox = typeof notificationOutbox.$inferSelect;
export type ChannelProvider = typeof channelProvider.$inferSelect;
