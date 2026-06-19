import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { getMembership } from "@/lib/access";

const statusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
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
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20000).nullable().optional(),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    assigneeType: assigneeTypeEnum.nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(), // null = 取消指派
    repoId: z.string().uuid().nullable().optional(), // null = 解绑仓库
    baseBranch: z.string().trim().max(255).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "没有要更新的字段");

const commentSchema = z.object({
  body: z.string().trim().min(1, "评论不能为空").max(20000),
});

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
  createdAt: schema.issue.createdAt,
  updatedAt: schema.issue.updatedAt,
  baseBranch: schema.issue.baseBranch,
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
    .leftJoin(schema.repo, eq(schema.issue.repoId, schema.repo.id));
}

type IssueRow = Awaited<ReturnType<typeof baseIssueQuery>>[number];

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function shapeDetail(row: IssueRow) {
  return {
    ...shape(row),
    baseBranch: row.baseBranch,
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
      }),
    ),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const { sub } = c.get("user");
      const { status, assignee } = c.req.valid("query");

      const filters = [eq(schema.issue.workspaceId, workspaceId)];
      if (status) filters.push(eq(schema.issue.status, status));
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
            or(like(schema.issue.title, kw), like(schema.issue.description, kw)),
          ),
        )
        .orderBy(desc(schema.issue.createdAt))
        .limit(20);
      return c.json({ issues: rows.map(shape) });
    },
  )
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

    const id = crypto.randomUUID();
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
        status: body.status ?? "todo",
        priority: body.priority ?? "none",
        assigneeType: body.assigneeType ?? null,
        assigneeId: body.assigneeId ?? null,
        creatorId: sub,
      });
      await tx.insert(schema.issueEvent).values({
        id: crypto.randomUUID(),
        issueId: id,
        workspaceId,
        actorType: "member",
        actorId: sub,
        kind: "created",
      });
    });

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
        and(eq(schema.issue.id, id), eq(schema.issue.workspaceId, workspaceId)),
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

    if (patch.repoId) {
      const [r] = await db
        .select({ id: schema.repo.id })
        .from(schema.repo)
        .where(
          and(
            eq(schema.repo.id, patch.repoId),
            eq(schema.repo.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!r) return c.json({ error: "仓库不存在" }, 400);
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
    if (patch.baseBranch !== undefined) updates.baseBranch = patch.baseBranch;
    if (patch.repoId !== undefined) updates.repoId = patch.repoId;

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

    return c.json({
      events: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        meta: r.meta,
        createdAt: r.createdAt,
        actor:
          r.actorType && r.actorId
            ? {
                type: r.actorType,
                id: r.actorId,
                name: r.agentName ?? r.memberName,
                avatarUrl: r.agentAvatar ?? r.memberAvatar,
              }
            : null,
      })),
    });
  })
  // 发表评论
  .post("/:id/events", zValidator("json", commentSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const { body } = c.req.valid("json");

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
      body,
    });

    const me = await memberLabel(sub);
    return c.json(
      {
        event: {
          id: eventId,
          kind: "comment",
          body,
          meta: null,
          createdAt: new Date(),
          actor: me ? { ...me, avatarUrl: null } : null,
        },
      },
      201,
    );
  });
