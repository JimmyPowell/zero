import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { getMembership } from "@/lib/access";
import { enqueueTaskForIssue } from "@/lib/dispatch";
import { subscribe, publish } from "@/lib/run-bus";
import { notifyIssueEvent } from "@/lib/notify";
import { signAttachmentPath } from "@/lib/storage";

const statusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
]);
const priorityEnum = z.enum(["urgent", "high", "medium", "low", "none"]);
const assigneeTypeEnum = z.enum(["member", "agent"]);

const createSchema = z.object({
  title: z.string().trim().min(1, "请输入标题").max(200),
  description: z.string().max(20000).optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  assigneeType: assigneeTypeEnum.optional(),
  assigneeId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  // 工作区绑定（仓库 与 工作目录 互斥）
  repoId: z.string().uuid().optional(),
  baseBranch: z.string().trim().max(255).optional(),
  workDir: z.string().trim().max(1000).optional(),
  // 正文里粘贴/拖拽的附件（创建时 link 到新 issue）
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20000).nullable().optional(),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    assigneeType: assigneeTypeEnum.nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(), // null = 取消指派
    projectId: z.string().uuid().nullable().optional(), // null = 移出项目
    repoId: z.string().uuid().nullable().optional(), // null = 解绑仓库
    baseBranch: z.string().trim().max(255).nullable().optional(),
    workDir: z.string().trim().max(1000).nullable().optional(), // 绑工作目录
  })
  .refine((o) => Object.keys(o).length > 0, "没有要更新的字段");

const commentSchema = z
  .object({
    body: z.string().trim().max(20000).optional().default(""),
    attachmentIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .refine(
    (o) => (o.body?.length ?? 0) > 0 || (o.attachmentIds?.length ?? 0) > 0,
    "评论内容或附件至少要有一个",
  );

// 把一批附件元数据映射成带签名 url 的对外形态
function attachmentDTO(a: {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}) {
  return {
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    size: a.sizeBytes,
    url: signAttachmentPath(a.id, 86400),
  };
}

// 统一的 issue 查询列：指派人(member|agent)与绑定仓库都解析出来
const issueColumns = {
  id: schema.issue.id,
  number: schema.issue.number,
  title: schema.issue.title,
  description: schema.issue.description,
  status: schema.issue.status,
  priority: schema.issue.priority,
  assigneeType: schema.issue.assigneeType,
  assigneeId: schema.issue.assigneeId,
  creatorId: schema.issue.creatorId,
  createdAt: schema.issue.createdAt,
  updatedAt: schema.issue.updatedAt,
  deletedAt: schema.issue.deletedAt,
  // 最新活动时间：该 issue 下任意事件（评论/模型回复/状态变更/执行）的最新时间，
  // 无事件时回退到创建时间。用关联子查询实时算，走 idx_issue_event_issue 索引。
  // 已软删的评论不计入活动时间。
  lastActivityAt: sql<string>`COALESCE((SELECT MAX(${schema.issueEvent.createdAt}) FROM ${schema.issueEvent} WHERE ${schema.issueEvent.issueId} = ${schema.issue.id} AND ${schema.issueEvent.deletedAt} IS NULL), ${schema.issue.createdAt})`,
  // 「我（成员）发给 agent 的最新一条评论」正文，列表行展示用。
  // 只取 member 的 comment（排除 agent/system 回复、无正文与已软删的评论），
  // 复用 idx_issue_event_issue(issueId, createdAt) 索引、取单行无额外排序代价。
  lastMessage: sql<
    string | null
  >`(SELECT ${schema.issueEvent.body} FROM ${schema.issueEvent} WHERE ${schema.issueEvent.issueId} = ${schema.issue.id} AND ${schema.issueEvent.kind} = 'comment' AND ${schema.issueEvent.actorType} = 'member' AND ${schema.issueEvent.body} IS NOT NULL AND ${schema.issueEvent.deletedAt} IS NULL ORDER BY ${schema.issueEvent.createdAt} DESC LIMIT 1)`,
  baseBranch: schema.issue.baseBranch,
  workDir: schema.issue.workDir,
  projectId: schema.issue.projectId,
  projectTitle: schema.project.title,
  projectSlug: schema.project.slug,
  repoId: schema.issue.repoId,
  repoName: schema.repo.name,
  repoDefaultBranch: schema.repo.defaultBranch,
  assigneeName: sql<
    string | null
  >`COALESCE(${schema.user.name}, ${schema.agent.name})`,
  assigneeAvatar: sql<
    string | null
  >`COALESCE(${schema.user.avatarUrl}, ${schema.agent.avatarUrl})`,
};

// member / agent / repo 三个 leftJoin 的统一查询基座
function baseIssueQuery() {
  return db
    .select(issueColumns)
    .from(schema.issue)
    .leftJoin(
      schema.user,
      and(
        eq(schema.issue.assigneeType, "member"),
        eq(schema.issue.assigneeId, schema.user.id),
      ),
    )
    .leftJoin(
      schema.agent,
      and(
        eq(schema.issue.assigneeType, "agent"),
        eq(schema.issue.assigneeId, schema.agent.id),
      ),
    )
    .leftJoin(schema.repo, eq(schema.issue.repoId, schema.repo.id))
    .leftJoin(schema.project, eq(schema.issue.projectId, schema.project.id));
}

type IssueRow = Awaited<ReturnType<typeof baseIssueQuery>>[number];

// 把时间值统一规范成带 Z 的 ISO 字符串，让前端 `new Date(iso)` 当成绝对时刻解析。
// Drizzle 直接列经 mysql2 已是 Date（按 UTC 还原 → toISOString 自带 Z）；但 lastActivityAt
// 是原始 SQL 聚合，mysql2 原样返回「无时区裸串」（如 "2026-06-19 09:39:10.446"），前端会按
// 本地时区误读偏移 8 小时。DB 存的是 UTC 墙钟，这里同样当成 UTC 解析（补 Z），与列口径一致。
function isoTime(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).replace(" ", "T");
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  return new Date(hasTz ? s : s + "Z").toISOString();
}

// 列表行的最新消息摘要：折叠空白、限长，避免把整段 markdown 拍进列表载荷
function snippet(v: string | null | undefined, max = 160): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function shape(row: IssueRow) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignee:
      row.assigneeType && row.assigneeId
        ? {
            type: row.assigneeType,
            id: row.assigneeId,
            name: row.assigneeName,
            avatarUrl: row.assigneeAvatar,
          }
        : null,
    project: row.projectId
      ? { id: row.projectId, title: row.projectTitle, slug: row.projectSlug }
      : null,
    creatorId: row.creatorId,
    createdAt: isoTime(row.createdAt),
    updatedAt: isoTime(row.updatedAt),
    lastActivityAt: isoTime(row.lastActivityAt),
    lastMessage: snippet(row.lastMessage),
  };
}

function shapeDetail(row: IssueRow) {
  return {
    ...shape(row),
    baseBranch: row.baseBranch,
    workDir: row.workDir,
    repo: row.repoId
      ? {
          id: row.repoId,
          name: row.repoName,
          defaultBranch: row.repoDefaultBranch,
        }
      : null,
  };
}

// 把指派对象解析成 {type,id,name} 标签快照（写入时间线 meta）
async function memberLabel(userId: string) {
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  const u = rows[0];
  return u ? { type: "member" as const, id: u.id, name: u.name } : null;
}
async function agentLabel(agentId: string) {
  const rows = await db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .limit(1);
  const a = rows[0];
  return a ? { type: "agent" as const, id: a.id, name: a.name } : null;
}
function assigneeLabel(type: string | null, id: string | null) {
  if (!type || !id) return Promise.resolve(null);
  return type === "agent" ? agentLabel(id) : memberLabel(id);
}

// 校验指派目标确属本工作空间（member 或 agent）
async function validateAssignee(
  workspaceId: string,
  type: "member" | "agent",
  id: string,
): Promise<boolean> {
  if (type === "member") {
    return (await getMembership(id, workspaceId)) != null;
  }
  const rows = await db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(
      and(eq(schema.agent.id, id), eq(schema.agent.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows.length > 0;
}

async function validateProject(
  workspaceId: string,
  projectId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(
      and(
        eq(schema.project.id, projectId),
        eq(schema.project.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// 删除/恢复权限：本人（issue creator 或评论作者）或工作空间 admin/owner。
async function canManage(
  workspaceId: string,
  userId: string,
  ownerId: string | null,
): Promise<boolean> {
  if (ownerId && ownerId === userId) return true;
  const m = await getMembership(userId, workspaceId);
  return m?.role === "owner" || m?.role === "admin";
}

export const issueRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 列表
  .get(
    "/",
    zValidator(
      "query",
      z.object({
        status: statusEnum.optional(),
        assignee: z.string().optional(),
        projectId: z.string().optional(),
      }),
    ),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const { sub } = c.get("user");
      const { status, assignee, projectId } = c.req.valid("query");

      const filters = [
        eq(schema.issue.workspaceId, workspaceId),
        isNull(schema.issue.deletedAt), // 排除回收站里的
      ];
      if (status) filters.push(eq(schema.issue.status, status));
      if (projectId) filters.push(eq(schema.issue.projectId, projectId));
      if (assignee === "me") {
        filters.push(eq(schema.issue.assigneeType, "member"));
        filters.push(eq(schema.issue.assigneeId, sub));
      }

      const rows = await baseIssueQuery()
        .where(and(...filters))
        .orderBy(desc(schema.issue.createdAt))
        .limit(200);
      return c.json({ issues: rows.map(shape) });
    },
  )
  // 搜索
  .get(
    "/search",
    zValidator("query", z.object({ q: z.string().trim().min(1) })),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const { q } = c.req.valid("query");
      const kw = `%${q}%`;
      const rows = await baseIssueQuery()
        .where(
          and(
            eq(schema.issue.workspaceId, workspaceId),
            isNull(schema.issue.deletedAt),
            or(like(schema.issue.title, kw), like(schema.issue.description, kw)),
          ),
        )
        .orderBy(desc(schema.issue.createdAt))
        .limit(20);
      return c.json({ issues: rows.map(shape) });
    },
  )
  // 回收站：本工作空间内已软删的需求（admin/owner 看全部，普通成员只看自己创建的）
  .get("/trash", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const m = await getMembership(sub, workspaceId);
    const isAdmin = m?.role === "owner" || m?.role === "admin";
    const filters = [
      eq(schema.issue.workspaceId, workspaceId),
      isNotNull(schema.issue.deletedAt),
    ];
    if (!isAdmin) filters.push(eq(schema.issue.creatorId, sub));
    const rows = await baseIssueQuery()
      .where(and(...filters))
      .orderBy(desc(schema.issue.deletedAt))
      .limit(200);
    return c.json({
      issues: rows.map((r) => ({
        ...shape(r),
        deletedAt: isoTime(r.deletedAt),
      })),
    });
  })
  // 创建
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const body = c.req.valid("json");

    if (body.assigneeType && body.assigneeId) {
      const ok = await validateAssignee(
        workspaceId,
        body.assigneeType,
        body.assigneeId,
      );
      if (!ok) return c.json({ error: "指派对象不在该工作空间" }, 400);
    }

    // 工作区绑定：仓库 与 工作目录 互斥；绑仓库时校验 + 兜底基准分支
    if (body.repoId && body.workDir) {
      return c.json({ error: "仓库与工作目录只能绑其一" }, 400);
    }
    let baseBranch: string | null = null;
    if (body.repoId) {
      const [r] = await db
        .select({ id: schema.repo.id, def: schema.repo.defaultBranch })
        .from(schema.repo)
        .where(
          and(
            eq(schema.repo.id, body.repoId),
            eq(schema.repo.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!r) return c.json({ error: "仓库不存在" }, 400);
      baseBranch = body.baseBranch?.trim() || r.def;
    }

    if (
      body.projectId &&
      !(await validateProject(workspaceId, body.projectId))
    ) {
      return c.json({ error: "项目不在该工作空间" }, 400);
    }

    const id = crypto.randomUUID();
    const createdEventId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${schema.issue.number}), 0)` })
        .from(schema.issue)
        .where(eq(schema.issue.workspaceId, workspaceId));
      const next = Number(row?.max ?? 0) + 1;
      await tx.insert(schema.issue).values({
        id,
        workspaceId,
        number: next,
        title: body.title,
        description: body.description ?? null,
        // 默认「进行中」（前期固定，后续做成工作空间偏好）
        status: body.status ?? "in_progress",
        priority: body.priority ?? "none",
        assigneeType: body.assigneeType ?? null,
        assigneeId: body.assigneeId ?? null,
        projectId: body.projectId ?? null,
        repoId: body.repoId ?? null,
        baseBranch,
        workDir: body.workDir ?? null,
        creatorId: sub,
      });
      await tx.insert(schema.issueEvent).values({
        id: createdEventId,
        issueId: id,
        workspaceId,
        actorType: "member",
        actorId: sub,
        kind: "created",
      });
      // 正文里粘贴/拖拽的附件：认领到本 issue + created 事件。
      // dispatch 按 issueId 取附件 → agent 首轮即可见；仅认领本空间内尚未 link 的孤儿附件。
      if (body.attachmentIds?.length) {
        await tx
          .update(schema.attachment)
          .set({ issueId: id, issueEventId: createdEventId })
          .where(
            and(
              inArray(schema.attachment.id, body.attachmentIds),
              eq(schema.attachment.workspaceId, workspaceId),
              isNull(schema.attachment.issueEventId),
            ),
          );
      }
    });

    // 指派给 agent 且非 backlog → 派发执行
    await enqueueTaskForIssue(id);

    // 通知：issue 创建（fire-and-forget，不阻塞响应）
    void notifyIssueEvent({ kind: "created", issueId: id, eventId: createdEventId });

    const [created] = await baseIssueQuery()
      .where(eq(schema.issue.id, id))
      .limit(1);
    return c.json({ issue: shape(created!) }, 201);
  })
  // 详情
  .get("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [row] = await baseIssueQuery()
      .where(
        and(
          eq(schema.issue.id, id),
          eq(schema.issue.workspaceId, workspaceId),
          isNull(schema.issue.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "需求不存在" }, 404);
    return c.json({ issue: shapeDetail(row) });
  })
  // 更新字段（状态/优先级/指派变更写入时间线）
  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const patch = c.req.valid("json");

    const [current] = await db
      .select()
      .from(schema.issue)
      .where(
        and(eq(schema.issue.id, id), eq(schema.issue.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!current) return c.json({ error: "需求不存在" }, 404);

    // 工作区绑定：仓库 与 工作目录 互斥
    if (patch.repoId && patch.workDir) {
      return c.json({ error: "仓库与工作目录只能绑其一" }, 400);
    }
    let repoDefaultBranch: string | null = null;
    if (patch.repoId) {
      const [r] = await db
        .select({ def: schema.repo.defaultBranch })
        .from(schema.repo)
        .where(
          and(
            eq(schema.repo.id, patch.repoId),
            eq(schema.repo.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!r) return c.json({ error: "仓库不存在" }, 400);
      repoDefaultBranch = r.def;
    }

    const updates: Record<string, unknown> = {};
    const events: (typeof schema.issueEvent.$inferInsert)[] = [];
    const mkEvent = (
      kind: "status_change" | "priority_change" | "assignment",
      meta: unknown,
    ) => ({
      id: crypto.randomUUID(),
      issueId: id,
      workspaceId,
      actorType: "member" as const,
      actorId: sub,
      kind,
      meta,
    });

    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.projectId !== undefined) {
      if (
        patch.projectId &&
        !(await validateProject(workspaceId, patch.projectId))
      ) {
        return c.json({ error: "项目不在该工作空间" }, 400);
      }
      updates.projectId = patch.projectId;
    }

    // 绑定 repoId / workDir 互斥：设一个清另一个
    if (patch.repoId) {
      updates.repoId = patch.repoId;
      updates.baseBranch = patch.baseBranch?.trim() || repoDefaultBranch || "main";
      updates.workDir = null;
    } else if (patch.repoId === null) {
      updates.repoId = null;
      updates.baseBranch = null;
    } else if (patch.baseBranch !== undefined) {
      updates.baseBranch = patch.baseBranch;
    }
    if (patch.workDir) {
      updates.workDir = patch.workDir;
      updates.repoId = null;
      updates.baseBranch = null;
    } else if (patch.workDir === null) {
      updates.workDir = null;
    }

    if (patch.status !== undefined && patch.status !== current.status) {
      updates.status = patch.status;
      events.push(
        mkEvent("status_change", { from: current.status, to: patch.status }),
      );
    }
    if (patch.priority !== undefined && patch.priority !== current.priority) {
      updates.priority = patch.priority;
      events.push(
        mkEvent("priority_change", {
          from: current.priority,
          to: patch.priority,
        }),
      );
    }
    if (patch.assigneeId !== undefined) {
      const newId = patch.assigneeId; // string | null
      const newType = newId ? (patch.assigneeType ?? "member") : null;
      if (newId && newType) {
        const ok = await validateAssignee(workspaceId, newType, newId);
        if (!ok) return c.json({ error: "指派对象不在该工作空间" }, 400);
      }
      const changed =
        (current.assigneeId ?? null) !== (newId ?? null) ||
        (current.assigneeType ?? null) !== (newType ?? null);
      if (changed) {
        updates.assigneeType = newType;
        updates.assigneeId = newId;
        const from = await assigneeLabel(
          current.assigneeType,
          current.assigneeId,
        );
        const to = await assigneeLabel(newType, newId);
        events.push(mkEvent("assignment", { from, to }));
      }
    }

    // 判断是否应派发：指派给 agent 或移出 backlog（且最终是 agent + 非 backlog）
    const finalStatus = (updates.status as string | undefined) ?? current.status;
    const finalAssigneeType =
      updates.assigneeType !== undefined
        ? (updates.assigneeType as string | null)
        : current.assigneeType;
    const finalAssigneeId =
      updates.assigneeId !== undefined
        ? (updates.assigneeId as string | null)
        : current.assigneeId;
    const assignedToAgent =
      patch.assigneeId !== undefined &&
      finalAssigneeType === "agent" &&
      !!finalAssigneeId;
    const movedOutOfBacklog =
      patch.status !== undefined &&
      current.status === "backlog" &&
      finalStatus !== "backlog";
    const shouldEnqueue =
      finalAssigneeType === "agent" &&
      !!finalAssigneeId &&
      finalStatus !== "backlog" &&
      (assignedToAgent || movedOutOfBacklog);

    await db.transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx
          .update(schema.issue)
          .set(updates)
          .where(eq(schema.issue.id, id));
      }
      if (events.length > 0) {
        await tx.insert(schema.issueEvent).values(events);
      }
    });

    if (shouldEnqueue) await enqueueTaskForIssue(id);

    const [row] = await baseIssueQuery()
      .where(eq(schema.issue.id, id))
      .limit(1);
    return c.json({ issue: shapeDetail(row!) });
  })
  // 软删除需求（回收站可恢复）。权限：creator 本人 或 admin/owner。底层会话/历史不动。
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const [iss] = await db
      .select({ creatorId: schema.issue.creatorId, deletedAt: schema.issue.deletedAt })
      .from(schema.issue)
      .where(
        and(eq(schema.issue.id, id), eq(schema.issue.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!iss || iss.deletedAt) return c.json({ error: "需求不存在" }, 404);
    if (!(await canManage(workspaceId, sub, iss.creatorId)))
      return c.json({ error: "无权删除该需求" }, 403);
    await db
      .update(schema.issue)
      .set({ deletedAt: new Date(), deletedBy: sub })
      .where(eq(schema.issue.id, id));
    return c.json({ ok: true });
  })
  // 从回收站恢复需求。权限同删除。
  .post("/:id/restore", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const [iss] = await db
      .select({ creatorId: schema.issue.creatorId, deletedAt: schema.issue.deletedAt })
      .from(schema.issue)
      .where(
        and(eq(schema.issue.id, id), eq(schema.issue.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!iss || !iss.deletedAt) return c.json({ error: "需求不在回收站" }, 404);
    if (!(await canManage(workspaceId, sub, iss.creatorId)))
      return c.json({ error: "无权恢复该需求" }, 403);
    await db
      .update(schema.issue)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(schema.issue.id, id));
    const [row] = await baseIssueQuery()
      .where(eq(schema.issue.id, id))
      .limit(1);
    return c.json({ issue: shapeDetail(row!) });
  })
  // 时间线：事件流（评论 + 变更，按时间正序）
  .get("/:id/events", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [exists] = await db
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .where(
        and(eq(schema.issue.id, id), eq(schema.issue.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!exists) return c.json({ error: "需求不存在" }, 404);

    const rows = await db
      .select({
        id: schema.issueEvent.id,
        kind: schema.issueEvent.kind,
        body: schema.issueEvent.body,
        meta: schema.issueEvent.meta,
        actorType: schema.issueEvent.actorType,
        actorId: schema.issueEvent.actorId,
        createdAt: schema.issueEvent.createdAt,
        deletedAt: schema.issueEvent.deletedAt,
        memberName: schema.user.name,
        memberAvatar: schema.user.avatarUrl,
        agentName: schema.agent.name,
        agentAvatar: schema.agent.avatarUrl,
      })
      .from(schema.issueEvent)
      .leftJoin(
        schema.user,
        and(
          eq(schema.issueEvent.actorType, "member"),
          eq(schema.issueEvent.actorId, schema.user.id),
        ),
      )
      .leftJoin(
        schema.agent,
        and(
          eq(schema.issueEvent.actorType, "agent"),
          eq(schema.issueEvent.actorId, schema.agent.id),
        ),
      )
      .where(eq(schema.issueEvent.issueId, id))
      .orderBy(asc(schema.issueEvent.createdAt));

    // 该 issue 各评论的附件，按 issueEventId 归组
    const atts = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.issueId, id));
    const attByEvent = new Map<string, ReturnType<typeof attachmentDTO>[]>();
    for (const a of atts) {
      if (!a.issueEventId) continue;
      const arr = attByEvent.get(a.issueEventId) ?? [];
      arr.push(attachmentDTO(a));
      attByEvent.set(a.issueEventId, arr);
    }

    return c.json({
      events: rows.map((r) => {
        const deleted = !!r.deletedAt;
        return {
          id: r.id,
          kind: r.kind,
          // 已软删的评论：不回传正文/附件，前端渲染「该评论已删除」占位
          body: deleted ? null : r.body,
          meta: r.meta,
          createdAt: r.createdAt,
          deleted,
          actor:
            r.actorType && r.actorId
              ? {
                  type: r.actorType,
                  id: r.actorId,
                  name: r.agentName ?? r.memberName,
                  avatarUrl: r.agentAvatar ?? r.memberAvatar,
                }
              : null,
          attachments: deleted ? [] : (attByEvent.get(r.id) ?? []),
        };
      }),
    });
  })
  // 发表评论
  .post("/:id/events", zValidator("json", commentSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const { body, attachmentIds } = c.req.valid("json");

    const [exists] = await db
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .where(
        and(eq(schema.issue.id, id), eq(schema.issue.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!exists) return c.json({ error: "需求不存在" }, 404);

    const eventId = crypto.randomUUID();
    await db.insert(schema.issueEvent).values({
      id: eventId,
      issueId: id,
      workspaceId,
      actorType: "member",
      actorId: sub,
      kind: "comment",
      body: body || null,
    });

    // 关联本工作空间内、尚未 link 的附件到该评论（再查回拿到对外 DTO）
    let attachments: ReturnType<typeof attachmentDTO>[] = [];
    if (attachmentIds?.length) {
      await db
        .update(schema.attachment)
        .set({ issueId: id, issueEventId: eventId })
        .where(
          and(
            inArray(schema.attachment.id, attachmentIds),
            eq(schema.attachment.workspaceId, workspaceId),
            isNull(schema.attachment.issueEventId),
          ),
        );
      const linked = await db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.issueEventId, eventId));
      attachments = linked.map(attachmentDTO);
    }

    // 人在 agent-assigned issue 下评论 → 触发该 agent 继续执行（此时附件已 link，上下文能带上）
    await enqueueTaskForIssue(id, eventId);

    const me = await memberLabel(sub);
    return c.json(
      {
        event: {
          id: eventId,
          kind: "comment",
          body: body || null,
          meta: null,
          createdAt: new Date(),
          actor: me ? { ...me, avatarUrl: null } : null,
          attachments,
        },
      },
      201,
    );
  })
  // 软删除评论（仅 kind='comment'）。权限：评论作者本人 或 admin/owner。
  // agent 的 CLI 会话里仍记得该评论（按 A 方案：删除=人的视角抹掉）。
  .delete("/:id/events/:eventId", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const eventId = c.req.param("eventId");
    const [ev] = await db
      .select({
        kind: schema.issueEvent.kind,
        actorId: schema.issueEvent.actorId,
        deletedAt: schema.issueEvent.deletedAt,
      })
      .from(schema.issueEvent)
      .where(
        and(
          eq(schema.issueEvent.id, eventId),
          eq(schema.issueEvent.issueId, id),
          eq(schema.issueEvent.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!ev || ev.deletedAt) return c.json({ error: "评论不存在" }, 404);
    if (ev.kind !== "comment")
      return c.json({ error: "只能删除评论" }, 400);
    if (!(await canManage(workspaceId, sub, ev.actorId)))
      return c.json({ error: "无权删除该评论" }, 403);
    await db
      .update(schema.issueEvent)
      .set({ deletedAt: new Date(), deletedBy: sub })
      .where(eq(schema.issueEvent.id, eventId));
    return c.json({ ok: true });
  })
  // 恢复评论。权限同删除。
  .post("/:id/events/:eventId/restore", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const eventId = c.req.param("eventId");
    const [ev] = await db
      .select({
        kind: schema.issueEvent.kind,
        actorId: schema.issueEvent.actorId,
        deletedAt: schema.issueEvent.deletedAt,
      })
      .from(schema.issueEvent)
      .where(
        and(
          eq(schema.issueEvent.id, eventId),
          eq(schema.issueEvent.issueId, id),
          eq(schema.issueEvent.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!ev || !ev.deletedAt) return c.json({ error: "评论不在回收站" }, 404);
    if (!(await canManage(workspaceId, sub, ev.actorId)))
      return c.json({ error: "无权恢复该评论" }, 403);
    await db
      .update(schema.issueEvent)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(schema.issueEvent.id, eventId));
    return c.json({ ok: true });
  })
  // 某 issue 的所有执行（run/task）摘要 —— 供运行卡片 + 日志浮层头部统计
  .get("/:id/runs", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const runs = await db
      .select({
        taskId: schema.task.id,
        status: schema.task.status,
        createdAt: schema.task.createdAt,
        startedAt: schema.task.startedAt,
        finishedAt: schema.task.finishedAt,
        error: schema.task.error,
        agentId: schema.agent.id,
        agentName: schema.agent.name,
        agentAvatar: schema.agent.avatarUrl,
        provider: schema.agent.provider,
        runtimeName: schema.runtime.name,
        eventCount: sql<number>`(SELECT COUNT(*) FROM ${schema.runEvent} WHERE ${schema.runEvent.taskId} = ${schema.task.id})`,
        toolCallCount: sql<number>`(SELECT COUNT(*) FROM ${schema.runEvent} WHERE ${schema.runEvent.taskId} = ${schema.task.id} AND ${schema.runEvent.type} = 'tool_call')`,
      })
      .from(schema.task)
      .leftJoin(schema.agent, eq(schema.task.agentId, schema.agent.id))
      .leftJoin(schema.runtime, eq(schema.task.runtimeId, schema.runtime.id))
      .where(
        and(
          eq(schema.task.issueId, id),
          eq(schema.task.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(schema.task.createdAt));
    return c.json({
      runs: runs.map((r) => ({
        ...r,
        eventCount: Number(r.eventCount),
        toolCallCount: Number(r.toolCallCount),
      })),
    });
  })
  // 取消一次 run（停止任务）：仅 queued/running 时置 task=cancelled，写 run_cancelled 时间线，
  // 连带取消该 issue 待触发的自唤醒，并通知 SSE 收尾。issue 状态保持不变（既定决策）。
  // 真正杀 agent 子进程由 daemon 轮询 /daemon/tasks/:id/status 看到 cancelled 后硬杀（pull 模型）。
  .post("/:id/runs/:taskId/cancel", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const taskId = c.req.param("taskId");
    const [tk] = await db
      .select({ status: schema.task.status })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.id, taskId),
          eq(schema.task.issueId, id),
          eq(schema.task.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!tk) return c.json({ error: "运行不存在" }, 404);
    if (tk.status !== "queued" && tk.status !== "running")
      return c.json({ ok: true, alreadyTerminal: true, status: tk.status });

    // 条件更新：仅在仍 queued/running 时置 cancelled（避免覆盖刚好完成/失败的）
    const res = await db
      .update(schema.task)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(schema.task.id, taskId),
          inArray(schema.task.status, ["queued", "running"]),
        ),
      );
    const header = Array.isArray(res) ? res[0] : res;
    if ((header as { affectedRows?: number })?.affectedRows !== 1)
      return c.json({ ok: true, alreadyTerminal: true });

    // 时间线：run_cancelled（actor = 发起取消的成员）
    await db.insert(schema.issueEvent).values({
      id: crypto.randomUUID(),
      issueId: id,
      workspaceId,
      actorType: "member",
      actorId: sub,
      kind: "run_cancelled",
      meta: { taskId },
    });
    // 连带取消该 issue 待触发的自唤醒（停就停干净）
    await db
      .update(schema.agentWakeup)
      .set({ status: "cancelled", firedAt: new Date() })
      .where(
        and(
          eq(schema.agentWakeup.issueId, id),
          eq(schema.agentWakeup.status, "pending"),
        ),
      );
    // 通知订阅中的 SSE 立即收尾（执行日志面板即时显示已取消）
    publish(taskId, { __end: true, status: "cancelled" });
    return c.json({ ok: true, status: "cancelled" });
  })
  // 某次 run 的细粒度事件（历史回放）；after 用于增量拉取
  .get("/:id/runs/:taskId/events", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const taskId = c.req.param("taskId");
    const after = Number(c.req.query("after") ?? -1);
    const [tk] = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.id, taskId),
          eq(schema.task.issueId, id),
          eq(schema.task.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!tk) return c.json({ error: "运行不存在" }, 404);

    const events = await db
      .select({
        id: schema.runEvent.id,
        seq: schema.runEvent.seq,
        type: schema.runEvent.type,
        tool: schema.runEvent.tool,
        toolName: schema.runEvent.toolName,
        toolUseId: schema.runEvent.toolUseId,
        parentToolUseId: schema.runEvent.parentToolUseId,
        text: schema.runEvent.text,
        detail: schema.runEvent.detail,
        payload: schema.runEvent.payload,
        createdAt: schema.runEvent.createdAt,
      })
      .from(schema.runEvent)
      .where(
        and(
          eq(schema.runEvent.taskId, taskId),
          Number.isFinite(after) && after >= 0
            ? gt(schema.runEvent.seq, after)
            : undefined,
        ),
      )
      .orderBy(asc(schema.runEvent.seq));
    return c.json({ events });
  })
  // 某次 run 的变更文件 + 逐文件 diff（变更可视化）
  .get("/:id/runs/:taskId/files", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const taskId = c.req.param("taskId");
    const [tk] = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.id, taskId),
          eq(schema.task.issueId, id),
          eq(schema.task.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!tk) return c.json({ error: "运行不存在" }, 404);
    const [summary] = await db
      .select()
      .from(schema.taskChange)
      .where(eq(schema.taskChange.taskId, taskId))
      .limit(1);
    const files = await db
      .select()
      .from(schema.taskFileChange)
      .where(eq(schema.taskFileChange.taskId, taskId))
      .orderBy(asc(schema.taskFileChange.path));
    return c.json({ summary: summary ?? null, files });
  })
  // 实时执行流（SSE）：先按 after / Last-Event-ID 从 DB 补齐，再订阅实时；
  // 心跳保活，task 结束发 end 事件收尾。DB 是真相，断线按 seq 续传不漏不重。
  .get("/:id/runs/:taskId/stream", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const taskId = c.req.param("taskId");
    const TERMINAL = ["succeeded", "failed", "cancelled"];
    const [tk] = await db
      .select({ id: schema.task.id, status: schema.task.status })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.id, taskId),
          eq(schema.task.issueId, id),
          eq(schema.task.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!tk) return c.json({ error: "运行不存在" }, 404);

    return streamSSE(c, async (stream) => {
      const lastId = c.req.header("Last-Event-ID");
      let after = Number(c.req.query("after") ?? lastId ?? -1);
      if (!Number.isFinite(after)) after = -1;
      let lastSeq = after;

      // 实时事件先入队，待 backlog 发完再放，避免乱序 / 重复
      // __end 为终态标记（complete/fail 发布），收到即收尾
      const queue: { seq?: number; __end?: boolean; status?: string }[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const unsub = subscribe(taskId, (ev) => {
        queue.push(ev as { seq: number });
        wake?.();
      });
      c.req.raw.signal.addEventListener("abort", () => {
        closed = true;
        wake?.();
      });

      // 1) 补齐 backlog
      const backlog = await db
        .select({
          id: schema.runEvent.id,
          seq: schema.runEvent.seq,
          type: schema.runEvent.type,
          tool: schema.runEvent.tool,
          toolName: schema.runEvent.toolName,
          toolUseId: schema.runEvent.toolUseId,
          parentToolUseId: schema.runEvent.parentToolUseId,
          text: schema.runEvent.text,
          detail: schema.runEvent.detail,
        })
        .from(schema.runEvent)
        .where(
          and(
            eq(schema.runEvent.taskId, taskId),
            after >= 0 ? gt(schema.runEvent.seq, after) : undefined,
          ),
        )
        .orderBy(asc(schema.runEvent.seq));
      for (const ev of backlog) {
        await stream.writeSSE({
          id: String(ev.seq),
          event: "run",
          data: JSON.stringify(ev),
        });
        lastSeq = ev.seq;
      }

      // 连上时已是终态：排空实时队列后直接收尾，不空挂连接 15s。
      // （complete 在 reporter.flush() 之后才置终态，故终态时事件必已全部到达）
      const [initial] = await db
        .select({ status: schema.task.status })
        .from(schema.task)
        .where(eq(schema.task.id, taskId))
        .limit(1);
      if (initial && TERMINAL.includes(initial.status)) {
        while (queue.length) {
          const ev = queue.shift()!;
          if (ev.seq != null && ev.seq > lastSeq) {
            await stream.writeSSE({
              id: String(ev.seq),
              event: "run",
              data: JSON.stringify(ev as Record<string, unknown>),
            });
            lastSeq = ev.seq;
          }
        }
        await stream.writeSSE({
          event: "end",
          data: JSON.stringify({ status: initial.status, lastSeq }),
        });
        unsub();
        return;
      }

      try {
        while (!closed) {
          // 排空实时队列（跳过 backlog 已发的 seq）
          while (queue.length) {
            const ev = queue.shift()!;
            if (ev.__end) {
              await stream.writeSSE({
                event: "end",
                data: JSON.stringify({ status: ev.status, lastSeq }),
              });
              closed = true;
              break;
            }
            if (ev.seq != null && ev.seq > lastSeq) {
              await stream.writeSSE({
                id: String(ev.seq),
                event: "run",
                data: JSON.stringify(ev),
              });
              lastSeq = ev.seq;
            }
          }
          if (closed) break;
          // 等下一条事件，或 15s 心跳
          await Promise.race([
            new Promise<void>((r) => {
              wake = r;
              if (queue.length || closed) r();
            }),
            stream.sleep(15000),
          ]);
          wake = null;
          if (queue.length === 0 && !closed) {
            await stream.writeSSE({ event: "ping", data: "1" });
            const [s] = await db
              .select({ status: schema.task.status })
              .from(schema.task)
              .where(eq(schema.task.id, taskId))
              .limit(1);
            if (s && TERMINAL.includes(s.status)) {
              await stream.writeSSE({
                event: "end",
                data: JSON.stringify({ status: s.status, lastSeq }),
              });
              break;
            }
          }
        }
      } finally {
        unsub();
      }
    });
  });
