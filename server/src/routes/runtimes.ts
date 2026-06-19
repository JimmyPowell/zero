import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { generateToken, hashToken } from "@/lib/token";

// 心跳新鲜窗口：60s 内有心跳算在线
const ONLINE_WINDOW_MS = 60_000;

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入运行时名称").max(64),
  kind: z.enum(["local", "cloud"]).optional(),
});

// 不暴露 token_hash，并派生在线状态
function shape(r: schema.Runtime) {
  const online =
    r.lastHeartbeatAt != null &&
    Date.now() - new Date(r.lastHeartbeatAt).getTime() < ONLINE_WINDOW_MS;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    online,
    capabilities: r.capabilities ?? null,
    lastHeartbeatAt: r.lastHeartbeatAt,
    createdAt: r.createdAt,
  };
}

export const runtimeRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 列表（含派生的在线状态）
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(schema.runtime)
      .where(eq(schema.runtime.workspaceId, workspaceId))
      .orderBy(desc(schema.runtime.createdAt));
    return c.json({ runtimes: rows.map(shape) });
  })
  // 创建 → 生成配对令牌（明文仅此一次返回）
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { name, kind } = c.req.valid("json");
    const id = crypto.randomUUID();
    const token = generateToken();
    await db.insert(schema.runtime).values({
      id,
      workspaceId,
      name,
      kind: kind ?? "local",
      tokenHash: hashToken(token),
    });
    const [created] = await db
      .select()
      .from(schema.runtime)
      .where(eq(schema.runtime.id, id))
      .limit(1);
    // token 明文仅此一次返回，用于 daemon 配对
    return c.json({ runtime: shape(created!), token }, 201);
  })
  // 删除（解除绑定该运行时的 agent）
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [r] = await db
      .select({ id: schema.runtime.id })
      .from(schema.runtime)
      .where(
        and(
          eq(schema.runtime.id, id),
          eq(schema.runtime.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!r) return c.json({ error: "运行时不存在" }, 404);

    await db
      .update(schema.agent)
      .set({ runtimeId: null })
      .where(eq(schema.agent.runtimeId, id));
    await db.delete(schema.runtime).where(eq(schema.runtime.id, id));
    return c.json({ ok: true });
  });
