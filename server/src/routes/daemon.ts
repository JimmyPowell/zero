import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { hashToken } from "@/lib/token";
import { assembleContext } from "@/lib/dispatch";
import { incomingRunEventSchema } from "@/lib/run-events";
import { publish } from "@/lib/run-bus";

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

// daemon 完成时回传的用量/成本（取自 Claude result 事件）
const usageSchema = z
  .object({
    model: z.string().nullable().optional(),
    costUsd: z.number().nullable().optional(),
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    cacheReadTokens: z.number().int().optional(),
    cacheWriteTokens: z.number().int().optional(),
    durationMs: z.number().int().nullable().optional(),
    numTurns: z.number().int().nullable().optional(),
  })
  .nullable()
  .optional();

// 解析一个 agent 挂载的技能（含文本附件），随 claim 下发供 daemon 物化进 worktree。
// 第一版只下发文本附件（is_binary=false）；二进制（对象存储）留到 C5。
async function loadAgentSkills(agentId: string) {
  const rows = await db
    .select({
      id: schema.skill.id,
      slug: schema.skill.slug,
      name: schema.skill.name,
      description: schema.skill.description,
      content: schema.skill.content,
    })
    .from(schema.agentSkill)
    .innerJoin(schema.skill, eq(schema.agentSkill.skillId, schema.skill.id))
    .where(eq(schema.agentSkill.agentId, agentId))
    .orderBy(asc(schema.agentSkill.position));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const files = await db
    .select({
      skillId: schema.skillFile.skillId,
      path: schema.skillFile.path,
      content: schema.skillFile.content,
    })
    .from(schema.skillFile)
    .where(
      and(
        inArray(schema.skillFile.skillId, ids),
        eq(schema.skillFile.isBinary, false),
      ),
    );
  const byId = new Map<string, { path: string; content: string }[]>();
  for (const f of files) {
    if (f.content == null) continue;
    const arr = byId.get(f.skillId) ?? [];
    arr.push({ path: f.path, content: f.content });
    byId.set(f.skillId, arr);
  }
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    content: r.content,
    files: byId.get(r.id) ?? [],
  }));
}

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
        maxConcurrency: rt.maxConcurrency,
      });
    },
  )
  // 周期心跳（响应回带最新并发上限，daemon 据此调整并行度）
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
      return c.json({ ok: true, maxConcurrency: rt.maxConcurrency });
    },
  )
  // 认领一条排队任务（属于本 runtime），返回装配好的上下文
  .post("/tasks/claim", async (c) => {
    const rt = c.get("runtime");

    // 运行时级并发上限：在跑任务数达上限则不再认领（防超额并行）
    const [cnt] = await db
      .select({ running: sql<number>`COUNT(*)` })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.runtimeId, rt.id),
          eq(schema.task.status, "running"),
        ),
      );
    if (Number(cnt?.running ?? 0) >= rt.maxConcurrency) {
      return c.json({ task: null });
    }

    // 取最旧的若干排队任务，逐条用条件 UPDATE 抢占（并行认领下防重复领取）
    const cands = await db
      .select()
      .from(schema.task)
      .where(
        and(eq(schema.task.runtimeId, rt.id), eq(schema.task.status, "queued")),
      )
      .orderBy(asc(schema.task.createdAt))
      .limit(5);

    let cand: (typeof cands)[number] | undefined;
    for (const t of cands) {
      const res = await db
        .update(schema.task)
        .set({ status: "running", startedAt: new Date() })
        .where(
          and(eq(schema.task.id, t.id), eq(schema.task.status, "queued")),
        );
      const header = Array.isArray(res) ? res[0] : res;
      if ((header as { affectedRows?: number })?.affectedRows === 1) {
        cand = t;
        break;
      }
    }
    if (!cand) return c.json({ task: null });

    // 时间线：开始执行（meta 带 taskId，前端据此把运行卡片连到执行日志）
    await db.insert(schema.issueEvent).values({
      id: crypto.randomUUID(),
      issueId: cand.issueId,
      workspaceId: cand.workspaceId,
      actorType: "agent",
      actorId: cand.agentId,
      kind: "run_started",
      meta: { taskId: cand.id },
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
    // resuming：本任务带着上一轮 session_id → 续接；据此让 assembleContext 只标记增量评论
    const context = await assembleContext(cand.issueId, {
      agentId: cand.agentId,
      resuming: !!cand.sessionId,
    });
    // 挂载的技能随 claim 下发，daemon 据此在 worktree 里物化成 SKILL.md（C3）
    const skills = await loadAgentSkills(cand.agentId);

    return c.json({
      task: {
        id: cand.id,
        issueId: cand.issueId,
        sessionId: cand.sessionId,
        triggerEventId: cand.triggerEventId,
      },
      agent: { ...ag, skills },
      context,
    });
  })
  // §3.1 按需拉取：push 地板之外，agent 可经 MCP 工具回拉更深上下文（运行时令牌鉴权 + 工作空间隔离）
  // 更早的评论（push 窗口之外）。before=ISO 时间游标，正序返回（oldest-first）便于阅读。
  .get("/issues/:id/comments", async (c) => {
    const rt = c.get("runtime");
    const id = c.req.param("id");
    const [iss] = await db
      .select({ workspaceId: schema.issue.workspaceId })
      .from(schema.issue)
      .where(eq(schema.issue.id, id))
      .limit(1);
    if (!iss || iss.workspaceId !== rt.workspaceId)
      return c.json({ error: "issue 不存在或越权" }, 404);
    const before = c.req.query("before");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
    const conds = [
      eq(schema.issueEvent.issueId, id),
      eq(schema.issueEvent.kind, "comment"),
    ];
    if (before) {
      const d = new Date(before);
      if (!Number.isNaN(d.getTime())) conds.push(lt(schema.issueEvent.createdAt, d));
    }
    const rows = await db
      .select({
        body: schema.issueEvent.body,
        createdAt: schema.issueEvent.createdAt,
        actorType: schema.issueEvent.actorType,
        memberName: schema.user.name,
        agentName: schema.agent.name,
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
      .where(and(...conds))
      .orderBy(desc(schema.issueEvent.createdAt))
      .limit(limit);
    const comments = rows.reverse().map((r) => ({
      author: r.agentName ?? r.memberName ?? "system",
      authorType: r.actorType,
      body: r.body,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));
    return c.json({ comments });
  })
  // 本 issue 历史运行（状态/起止/失败原因/agent），看过去几轮干了什么、有没有失败
  .get("/issues/:id/runs", async (c) => {
    const rt = c.get("runtime");
    const id = c.req.param("id");
    const [iss] = await db
      .select({ workspaceId: schema.issue.workspaceId })
      .from(schema.issue)
      .where(eq(schema.issue.id, id))
      .limit(1);
    if (!iss || iss.workspaceId !== rt.workspaceId)
      return c.json({ error: "issue 不存在或越权" }, 404);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100);
    const rows = await db
      .select({
        status: schema.task.status,
        error: schema.task.error,
        createdAt: schema.task.createdAt,
        startedAt: schema.task.startedAt,
        finishedAt: schema.task.finishedAt,
        agentName: schema.agent.name,
      })
      .from(schema.task)
      .leftJoin(schema.agent, eq(schema.task.agentId, schema.agent.id))
      .where(eq(schema.task.issueId, id))
      .orderBy(desc(schema.task.createdAt))
      .limit(limit);
    const runs = rows.map((r) => ({
      status: r.status,
      agent: r.agentName,
      error: r.error,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt,
      finishedAt:
        r.finishedAt instanceof Date ? r.finishedAt.toISOString() : r.finishedAt,
    }));
    return c.json({ runs });
  })
  // 上报执行流：daemon adapter 规范化后的细粒度事件，批量写入 + 实时分发
  .post(
    "/tasks/:id/events",
    zValidator(
      "json",
      z.object({ events: z.array(incomingRunEventSchema).min(1).max(200) }),
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
      const { events } = c.req.valid("json");

      const rows = events.map((e) => ({
        id: crypto.randomUUID(),
        taskId: tk.id,
        issueId: tk.issueId,
        workspaceId: tk.workspaceId,
        seq: e.seq,
        type: e.type,
        tool: e.tool ?? null,
        toolName: e.toolName ?? null,
        text: e.text != null ? e.text.slice(0, 8000) : null,
        payload: e.payload ?? null,
      }));

      // 幂等：daemon 重发同 (task, seq) 不报错（保持已存）
      await db
        .insert(schema.runEvent)
        .values(rows)
        .onDuplicateKeyUpdate({ set: { seq: sql`seq` } });

      // 实时分发给订阅中的 SSE 连接（精简负载，原始 payload 走 DB 回放）
      for (const r of rows) {
        publish(tk.id, {
          id: r.id,
          seq: r.seq,
          type: r.type,
          tool: r.tool,
          toolName: r.toolName,
          text: r.text,
        });
      }
      return c.json({ ok: true, count: rows.length });
    },
  )
  // 完成：写最终评论 + run_finished，issue → 评审中
  .post(
    "/tasks/:id/complete",
    zValidator(
      "json",
      z.object({
        summary: z.string().optional(),
        sessionId: z.string().optional(),
        usage: usageSchema,
      }),
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
      const { summary, sessionId, usage } = c.req.valid("json");

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
        meta: { taskId: tk.id },
      });
      await db
        .update(schema.task)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          sessionId: sessionId ?? tk.sessionId,
        })
        .where(eq(schema.task.id, id));

      // 用量/成本落库（一个 task 一行；重发幂等更新）
      if (usage) {
        await db
          .insert(schema.taskUsage)
          .values({
            taskId: tk.id,
            workspaceId: tk.workspaceId,
            runtimeId: tk.runtimeId,
            agentId: tk.agentId,
            model: usage.model ?? null,
            costUsd: usage.costUsd != null ? String(usage.costUsd) : null,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.cacheWriteTokens ?? 0,
            durationMs: usage.durationMs ?? null,
            numTurns: usage.numTurns ?? null,
          })
          .onDuplicateKeyUpdate({
            set: {
              model: usage.model ?? null,
              costUsd: usage.costUsd != null ? String(usage.costUsd) : null,
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
              durationMs: usage.durationMs ?? null,
              numTurns: usage.numTurns ?? null,
            },
          });
      }

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
      // 通知订阅中的 SSE 立即收尾（否则要等心跳轮询才发现终态）
      publish(id, { __end: true, status: "succeeded" });
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
        meta: { taskId: tk.id, ...(error ? { error } : {}) },
      });
      await db
        .update(schema.task)
        .set({ status: "failed", finishedAt: new Date(), error: error ?? null })
        .where(eq(schema.task.id, id));
      publish(id, { __end: true, status: "failed" });
      return c.json({ ok: true });
    },
  );
