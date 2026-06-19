import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { hashToken } from "@/lib/token";

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
  );
