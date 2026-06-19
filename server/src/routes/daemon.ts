import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createMiddleware } from "hono/factory";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { hashToken } from "@/lib/token";
import { assembleContext } from "@/lib/dispatch";

// daemon 用运行时令牌认证：Authorization: Bearer <token>
type DaemonEnv = {
  Variables: { runtime: schema.Runtime };
};

const requireRuntimeToken = createMiddleware<DaemonEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return c.json({ error: "缺少运行时令牌" }, 401);
  const rows = await db
    .select()
    .from(schema.runtime)
    .where(eq(schema.runtime.tokenHash, hashToken(token)))
    .limit(1);
  const rt = rows[0];
  if (!rt) return c.json({ error: "运行时令牌无效" }, 401);
  c.set("runtime", rt);
  await next();
});

const capabilities = z.record(z.boolean()).optional();

export const daemonRoutes = new Hono<DaemonEnv>()
  .use(requireRuntimeToken)
  // daemon 启动：上报能力 + 刷新心跳
  .post(
    "/hello",
    zValidator("json", z.object({ capabilities }).partial()),
    async (c) => {
      const rt = c.get("runtime");
      const { capabilities: caps } = c.req.valid("json");
      await db
        .update(schema.runtime)
        .set({
          lastHeartbeatAt: new Date(),
          ...(caps ? { capabilities: caps } : {}),
        })
        .where(eq(schema.runtime.id, rt.id));
      return c.json({
        runtimeId: rt.id,
        workspaceId: rt.workspaceId,
        name: rt.name,
      });
    },
  )
  // 周期心跳
  .post(
    "/heartbeat",
    zValidator("json", z.object({ capabilities }).partial()),
    async (c) => {
      const rt = c.get("runtime");
      const { capabilities: caps } = c.req.valid("json");
      await db
        .update(schema.runtime)
        .set({
          lastHeartbeatAt: new Date(),
          ...(caps ? { capabilities: caps } : {}),
        })
        .where(eq(schema.runtime.id, rt.id));
      return c.json({ ok: true });
    },
  )
  // 认领一条排队任务（属于本 runtime），返回装配好的上下文
  .post("/tasks/claim", async (c) => {
    const rt = c.get("runtime");
    const [cand] = await db
      .select()
      .from(schema.task)
      .where(
        and(
          eq(schema.task.runtimeId, rt.id),
          eq(schema.task.status, "queued"),
        ),
      )
      .orderBy(asc(schema.task.createdAt))
      .limit(1);
    if (!cand) return c.json({ task: null });

    await db
      .update(schema.task)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(schema.task.id, cand.id), eq(schema.task.status, "queued")));

    // 时间线：开始执行
    await db.insert(schema.issueEvent).values({
      id: crypto.randomUUID(),
      issueId: cand.issueId,
      workspaceId: cand.workspaceId,
      actorType: "agent",
      actorId: cand.agentId,
      kind: "run_started",
    });

    const [ag] = await db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
        provider: schema.agent.provider,
        model: schema.agent.model,
        instructions: schema.agent.instructions,
      })
      .from(schema.agent)
      .where(eq(schema.agent.id, cand.agentId))
      .limit(1);
    const context = await assembleContext(cand.issueId);

    return c.json({
      task: {
        id: cand.id,
        issueId: cand.issueId,
        sessionId: cand.sessionId,
        triggerEventId: cand.triggerEventId,
      },
      agent: ag,
      context,
    });
  })
  // 完成：写最终评论 + run_finished，issue → 评审中
  .post(
    "/tasks/:id/complete",
    zValidator(
      "json",
      z.object({ summary: z.string().optional(), sessionId: z.string().optional() }),
    ),
    async (c) => {
      const rt = c.get("runtime");
      const id = c.req.param("id");
      const [tk] = await db
        .select()
        .from(schema.task)
        .where(and(eq(schema.task.id, id), eq(schema.task.runtimeId, rt.id)))
        .limit(1);
      if (!tk) return c.json({ error: "任务不存在" }, 404);
      const { summary, sessionId } = c.req.valid("json");

      if (summary && summary.trim()) {
        await db.insert(schema.issueEvent).values({
          id: crypto.randomUUID(),
          issueId: tk.issueId,
          workspaceId: tk.workspaceId,
          actorType: "agent",
          actorId: tk.agentId,
          kind: "comment",
          body: summary.trim(),
        });
      }
      await db.insert(schema.issueEvent).values({
        id: crypto.randomUUID(),
        issueId: tk.issueId,
        workspaceId: tk.workspaceId,
        actorType: "agent",
        actorId: tk.agentId,
        kind: "run_finished",
      });
      await db
        .update(schema.task)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          sessionId: sessionId ?? tk.sessionId,
        })
        .where(eq(schema.task.id, id));
      // issue 仅在仍处于活动态时推进到评审中
      await db
        .update(schema.issue)
        .set({ status: "in_review" })
        .where(
          and(
            eq(schema.issue.id, tk.issueId),
            inArray(schema.issue.status, ["todo", "in_progress"]),
          ),
        );
      return c.json({ ok: true });
    },
  )
  // 失败：写 run_failed
  .post(
    "/tasks/:id/fail",
    zValidator("json", z.object({ error: z.string().optional() })),
    async (c) => {
      const rt = c.get("runtime");
      const id = c.req.param("id");
      const [tk] = await db
        .select()
        .from(schema.task)
        .where(and(eq(schema.task.id, id), eq(schema.task.runtimeId, rt.id)))
        .limit(1);
      if (!tk) return c.json({ error: "任务不存在" }, 404);
      const { error } = c.req.valid("json");

      await db.insert(schema.issueEvent).values({
        id: crypto.randomUUID(),
        issueId: tk.issueId,
        workspaceId: tk.workspaceId,
        actorType: "agent",
        actorId: tk.agentId,
        kind: "run_failed",
        body: error ?? null,
        meta: error ? { error } : null,
      });
      await db
        .update(schema.task)
        .set({ status: "failed", finishedAt: new Date(), error: error ?? null })
        .where(eq(schema.task.id, id));
      return c.json({ ok: true });
    },
  );
