import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { getMembership } from "@/lib/access";
import { generateToken, hashToken } from "@/lib/token";

// 心跳新鲜窗口：60s 内有心跳算在线
const ONLINE_WINDOW_MS = 60_000;

const visibilityEnum = z.enum(["private", "workspace"]);
const concurrency = z.number().int().min(1).max(16);
// 触达范围：上架到哪些工作空间（去重，至少含当前；都必须是 owner 加入的）
const workspaceIds = z.array(z.string().uuid()).max(50);

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入运行时名称").max(64),
  kind: z.enum(["local", "cloud"]).optional(),
  visibility: visibilityEnum.optional(),
  maxConcurrency: concurrency.optional(),
  workspaceIds: workspaceIds.optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    visibility: visibilityEnum.optional(),
    maxConcurrency: concurrency.optional(),
    workspaceIds: workspaceIds.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "没有要更新的字段");

function online(lastHeartbeatAt: Date | null): boolean {
  return (
    lastHeartbeatAt != null &&
    Date.now() - new Date(lastHeartbeatAt).getTime() < ONLINE_WINDOW_MS
  );
}

function n(v: unknown): number {
  return v == null ? 0 : Number(v);
}

// 列表/详情用的精简形态（不暴露 token_hash）
function shape(
  r: schema.Runtime,
  extra: { ownerName?: string | null; isOwner: boolean; agentCount?: number },
) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    online: online(r.lastHeartbeatAt),
    visibility: r.visibility,
    maxConcurrency: r.maxConcurrency,
    ownerId: r.ownerId,
    ownerName: extra.ownerName ?? null,
    isOwner: extra.isOwner,
    agentCount: extra.agentCount ?? 0,
    capabilities: r.capabilities ?? null,
    lastHeartbeatAt: r.lastHeartbeatAt,
    createdAt: r.createdAt,
  };
}

// 当前用户在本工作空间「可见」运行时的过滤条件：
// 触达到本空间 且（共享 或 自己是 owner）
function visibleWhere(workspaceId: string, userId: string) {
  const reach = db
    .select({ id: schema.runtimeWorkspace.runtimeId })
    .from(schema.runtimeWorkspace)
    .where(eq(schema.runtimeWorkspace.workspaceId, workspaceId));
  return and(
    inArray(schema.runtime.id, reach),
    or(
      eq(schema.runtime.visibility, "workspace"),
      eq(schema.runtime.ownerId, userId),
    ),
  );
}

// 校验 reach 里的每个工作空间都是 owner 加入的（含当前），返回去重后的有效集合
async function resolveReach(
  ownerId: string,
  currentWs: string,
  requested: string[] | undefined,
): Promise<{ ok: true; ids: string[] } | { ok: false; bad: string }> {
  const set = new Set<string>([currentWs, ...(requested ?? [])]);
  for (const ws of set) {
    if (ws === currentWs) continue; // 当前空间已由中间件确认是成员
    const m = await getMembership(ownerId, ws);
    if (!m) return { ok: false, bad: ws };
  }
  return { ok: true, ids: [...set] };
}

export const runtimeRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 列表（本空间可见的：触达本空间 + 共享或自己的），含在线态/owner/绑定数
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const rows = await db
      .select({
        rt: schema.runtime,
        ownerName: schema.user.name,
        agentCount: sql<number>`(SELECT COUNT(*) FROM ${schema.agent} WHERE ${schema.agent.runtimeId} = ${schema.runtime.id} AND ${schema.agent.workspaceId} = ${workspaceId})`,
      })
      .from(schema.runtime)
      .leftJoin(schema.user, eq(schema.runtime.ownerId, schema.user.id))
      .where(visibleWhere(workspaceId, userId))
      .orderBy(desc(schema.runtime.createdAt));
    return c.json({
      runtimes: rows.map((row) =>
        shape(row.rt, {
          ownerName: row.ownerName,
          isOwner: row.rt.ownerId === userId,
          agentCount: n(row.agentCount),
        }),
      ),
    });
  })
  // 创建 → 归属当前用户；上架到指定工作空间（默认当前）；返回配对令牌（仅此一次）
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const body = c.req.valid("json");

    const reach = await resolveReach(userId, workspaceId, body.workspaceIds);
    if (!reach.ok) {
      return c.json(
        { error: "你不是目标工作空间的成员，无法在此上架运行时" },
        403,
      );
    }

    const id = crypto.randomUUID();
    const token = generateToken();
    await db.insert(schema.runtime).values({
      id,
      workspaceId, // 主工作空间（配对来源）
      ownerId: userId,
      name: body.name,
      kind: body.kind ?? "local",
      visibility: body.visibility ?? "workspace",
      maxConcurrency: body.maxConcurrency ?? 1,
      tokenHash: hashToken(token),
    });
    await db
      .insert(schema.runtimeWorkspace)
      .values(reach.ids.map((ws) => ({ runtimeId: id, workspaceId: ws })));

    const [created] = await db
      .select()
      .from(schema.runtime)
      .where(eq(schema.runtime.id, id))
      .limit(1);
    // token 明文仅此一次返回，用于 daemon 配对
    return c.json(
      {
        runtime: shape(created!, { ownerName: null, isOwner: true }),
        token,
      },
      201,
    );
  })
  // 详情：基本信息 + owner + 触达范围 + 本空间绑定的 agent + 用量/成本汇总
  .get("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const id = c.req.param("id");

    const [row] = await db
      .select({ rt: schema.runtime, ownerName: schema.user.name })
      .from(schema.runtime)
      .leftJoin(schema.user, eq(schema.runtime.ownerId, schema.user.id))
      .where(and(eq(schema.runtime.id, id), visibleWhere(workspaceId, userId)))
      .limit(1);
    if (!row) return c.json({ error: "运行时不存在或无权访问" }, 404);

    // 触达范围（工作空间 id + 名称）
    const reach = await db
      .select({ id: schema.workspace.id, name: schema.workspace.name })
      .from(schema.runtimeWorkspace)
      .innerJoin(
        schema.workspace,
        eq(schema.runtimeWorkspace.workspaceId, schema.workspace.id),
      )
      .where(eq(schema.runtimeWorkspace.runtimeId, id));

    // 本空间绑定该运行时的 agent
    const agents = await db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
        avatarUrl: schema.agent.avatarUrl,
        provider: schema.agent.provider,
      })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.runtimeId, id),
          eq(schema.agent.workspaceId, workspaceId),
        ),
      );

    // 用量汇总（限本工作空间，避免跨空间数据泄露）：近 30 天
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [tot] = await db
      .select({
        runs: sql<number>`COUNT(*)`,
        costUsd: sql<string>`COALESCE(SUM(${schema.taskUsage.costUsd}),0)`,
        inputTokens: sql<number>`COALESCE(SUM(${schema.taskUsage.inputTokens}),0)`,
        outputTokens: sql<number>`COALESCE(SUM(${schema.taskUsage.outputTokens}),0)`,
        cacheReadTokens: sql<number>`COALESCE(SUM(${schema.taskUsage.cacheReadTokens}),0)`,
        cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.taskUsage.cacheWriteTokens}),0)`,
      })
      .from(schema.taskUsage)
      .where(
        and(
          eq(schema.taskUsage.runtimeId, id),
          eq(schema.taskUsage.workspaceId, workspaceId),
          gte(schema.taskUsage.createdAt, since),
        ),
      );

    return c.json({
      runtime: shape(row.rt, {
        ownerName: row.ownerName,
        isOwner: row.rt.ownerId === userId,
        agentCount: agents.length,
      }),
      reach,
      agents,
      usage: {
        days: 30,
        runs: n(tot?.runs),
        costUsd: n(tot?.costUsd),
        inputTokens: n(tot?.inputTokens),
        outputTokens: n(tot?.outputTokens),
        cacheReadTokens: n(tot?.cacheReadTokens),
        cacheWriteTokens: n(tot?.cacheWriteTokens),
      },
    });
  })
  // 用量明细：按天 + 按 agent（限本工作空间）
  .get("/:id/usage", async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const id = c.req.param("id");
    const days = Math.min(
      365,
      Math.max(1, Number(c.req.query("days") ?? 30) || 30),
    );

    const [vis] = await db
      .select({ id: schema.runtime.id })
      .from(schema.runtime)
      .where(and(eq(schema.runtime.id, id), visibleWhere(workspaceId, userId)))
      .limit(1);
    if (!vis) return c.json({ error: "运行时不存在或无权访问" }, 404);

    const since = new Date(Date.now() - days * 86_400_000);
    const base = and(
      eq(schema.taskUsage.runtimeId, id),
      eq(schema.taskUsage.workspaceId, workspaceId),
      gte(schema.taskUsage.createdAt, since),
    );

    const byDay = await db
      .select({
        date: sql<string>`DATE(${schema.taskUsage.createdAt})`,
        runs: sql<number>`COUNT(*)`,
        costUsd: sql<string>`COALESCE(SUM(${schema.taskUsage.costUsd}),0)`,
        inputTokens: sql<number>`COALESCE(SUM(${schema.taskUsage.inputTokens}),0)`,
        outputTokens: sql<number>`COALESCE(SUM(${schema.taskUsage.outputTokens}),0)`,
      })
      .from(schema.taskUsage)
      .where(base)
      .groupBy(sql`DATE(${schema.taskUsage.createdAt})`)
      .orderBy(sql`DATE(${schema.taskUsage.createdAt})`);

    const byAgent = await db
      .select({
        agentId: schema.taskUsage.agentId,
        agentName: schema.agent.name,
        runs: sql<number>`COUNT(*)`,
        costUsd: sql<string>`COALESCE(SUM(${schema.taskUsage.costUsd}),0)`,
        tokens: sql<number>`COALESCE(SUM(${schema.taskUsage.inputTokens} + ${schema.taskUsage.outputTokens}),0)`,
      })
      .from(schema.taskUsage)
      .leftJoin(schema.agent, eq(schema.taskUsage.agentId, schema.agent.id))
      .where(base)
      .groupBy(schema.taskUsage.agentId, schema.agent.name)
      .orderBy(desc(sql`SUM(${schema.taskUsage.costUsd})`));

    return c.json({
      days,
      byDay: byDay.map((d) => ({
        date: d.date,
        runs: n(d.runs),
        costUsd: n(d.costUsd),
        inputTokens: n(d.inputTokens),
        outputTokens: n(d.outputTokens),
      })),
      byAgent: byAgent.map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName ?? null,
        runs: n(a.runs),
        costUsd: n(a.costUsd),
        tokens: n(a.tokens),
      })),
    });
  })
  // 编辑：名称/可见性/并发（owner 或本空间管理员）；触达范围仅 owner 可改
  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const member = c.get("member");
    const id = c.req.param("id");
    const patch = c.req.valid("json");

    const [rt] = await db
      .select()
      .from(schema.runtime)
      .where(and(eq(schema.runtime.id, id), visibleWhere(workspaceId, userId)))
      .limit(1);
    if (!rt) return c.json({ error: "运行时不存在或无权访问" }, 404);

    const isOwner = rt.ownerId === userId;
    const isWsAdmin = member.role === "owner" || member.role === "admin";
    if (!isOwner && !isWsAdmin) {
      return c.json({ error: "只有运行时归属者或工作空间管理员可编辑" }, 403);
    }
    if (patch.workspaceIds !== undefined && !isOwner) {
      return c.json({ error: "只有运行时归属者可调整触达范围" }, 403);
    }

    // 触达范围：仅 owner 可改，校验都是 owner 加入的工作空间
    if (patch.workspaceIds !== undefined && isOwner) {
      const reach = await resolveReach(userId, workspaceId, patch.workspaceIds);
      if (!reach.ok) {
        return c.json({ error: "你不是目标工作空间的成员" }, 403);
      }
      await db
        .delete(schema.runtimeWorkspace)
        .where(eq(schema.runtimeWorkspace.runtimeId, id));
      await db
        .insert(schema.runtimeWorkspace)
        .values(reach.ids.map((ws) => ({ runtimeId: id, workspaceId: ws })));
    }

    const set: Partial<typeof schema.runtime.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.visibility !== undefined) set.visibility = patch.visibility;
    if (patch.maxConcurrency !== undefined)
      set.maxConcurrency = patch.maxConcurrency;
    if (Object.keys(set).length > 0) {
      await db.update(schema.runtime).set(set).where(eq(schema.runtime.id, id));
    }

    const [updated] = await db
      .select({ rt: schema.runtime, ownerName: schema.user.name })
      .from(schema.runtime)
      .leftJoin(schema.user, eq(schema.runtime.ownerId, schema.user.id))
      .where(eq(schema.runtime.id, id))
      .limit(1);
    return c.json({
      runtime: shape(updated!.rt, {
        ownerName: updated!.ownerName,
        isOwner,
      }),
    });
  })
  // 删除：owner → 整体删除（解绑全部 agent）；本空间管理员（非 owner）→ 仅从本空间下架
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const member = c.get("member");
    const id = c.req.param("id");

    const [rt] = await db
      .select()
      .from(schema.runtime)
      .where(and(eq(schema.runtime.id, id), visibleWhere(workspaceId, userId)))
      .limit(1);
    if (!rt) return c.json({ error: "运行时不存在或无权访问" }, 404);

    const isOwner = rt.ownerId === userId;
    const isWsAdmin = member.role === "owner" || member.role === "admin";

    if (isOwner) {
      // 整体删除：解绑全部 agent，再删运行时（级联清 runtime_workspace / task_usage）
      await db
        .update(schema.agent)
        .set({ runtimeId: null })
        .where(eq(schema.agent.runtimeId, id));
      await db.delete(schema.runtime).where(eq(schema.runtime.id, id));
      return c.json({ ok: true, deleted: true });
    }

    if (isWsAdmin) {
      // 非 owner 的管理员：仅从本工作空间下架（解绑本空间 agent + 去掉 reach 行）
      await db
        .update(schema.agent)
        .set({ runtimeId: null })
        .where(
          and(
            eq(schema.agent.runtimeId, id),
            eq(schema.agent.workspaceId, workspaceId),
          ),
        );
      await db
        .delete(schema.runtimeWorkspace)
        .where(
          and(
            eq(schema.runtimeWorkspace.runtimeId, id),
            eq(schema.runtimeWorkspace.workspaceId, workspaceId),
          ),
        );
      return c.json({ ok: true, deleted: false });
    }

    return c.json({ error: "只有运行时归属者或工作空间管理员可删除" }, 403);
  });
