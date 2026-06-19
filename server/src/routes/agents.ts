import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";

const providerEnum = z.enum([
  "claude_code",
  "codex",
  "opencode",
  "codebuddy",
]);

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入智能体名称").max(64),
  provider: providerEnum.optional(),
  model: z.string().trim().max(128).optional(),
  instructions: z.string().max(20000).optional(),
  avatarUrl: z.string().trim().max(2000).optional(),
  runtimeId: z.string().uuid().nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    provider: providerEnum.optional(),
    model: z.string().trim().max(128).nullable().optional(),
    instructions: z.string().max(20000).nullable().optional(),
    avatarUrl: z.string().trim().max(2000).nullable().optional(),
    runtimeId: z.string().uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "没有要更新的字段");

// 校验运行时在本工作空间「可用」：触达到本空间 且（共享 或 绑定者就是 owner）
async function runtimeUsableInWorkspace(
  workspaceId: string,
  userId: string,
  runtimeId: string,
) {
  const reach = db
    .select({ id: schema.runtimeWorkspace.runtimeId })
    .from(schema.runtimeWorkspace)
    .where(eq(schema.runtimeWorkspace.workspaceId, workspaceId));
  const rows = await db
    .select({ id: schema.runtime.id })
    .from(schema.runtime)
    .where(
      and(
        eq(schema.runtime.id, runtimeId),
        inArray(schema.runtime.id, reach),
        or(
          eq(schema.runtime.visibility, "workspace"),
          eq(schema.runtime.ownerId, userId),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// 同工作空间内名称是否已被别的 agent 占用
async function nameTaken(workspaceId: string, name: string, exceptId?: string) {
  const conds = [
    eq(schema.agent.workspaceId, workspaceId),
    eq(schema.agent.name, name),
  ];
  if (exceptId) conds.push(ne(schema.agent.id, exceptId));
  const rows = await db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(and(...conds))
    .limit(1);
  return rows.length > 0;
}

export const agentRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 列表
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const agents = await db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.workspaceId, workspaceId))
      .orderBy(desc(schema.agent.createdAt));
    return c.json({ agents });
  })
  // 创建
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");

    if (await nameTaken(workspaceId, body.name)) {
      return c.json({ error: "该名称已被占用" }, 409);
    }
    if (
      body.runtimeId &&
      !(await runtimeUsableInWorkspace(
        workspaceId,
        c.get("user").sub,
        body.runtimeId,
      ))
    ) {
      return c.json({ error: "运行时不存在或在此工作空间不可用" }, 400);
    }

    const id = crypto.randomUUID();
    await db.insert(schema.agent).values({
      id,
      workspaceId,
      name: body.name,
      provider: body.provider ?? "claude_code",
      model: body.model ?? null,
      instructions: body.instructions ?? null,
      avatarUrl: body.avatarUrl ?? null,
      runtimeId: body.runtimeId ?? null,
    });
    const [created] = await db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, id))
      .limit(1);
    return c.json({ agent: created }, 201);
  })
  // 更新
  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const patch = c.req.valid("json");

    const [current] = await db
      .select()
      .from(schema.agent)
      .where(
        and(eq(schema.agent.id, id), eq(schema.agent.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!current) return c.json({ error: "智能体不存在" }, 404);

    if (patch.name && (await nameTaken(workspaceId, patch.name, id))) {
      return c.json({ error: "该名称已被占用" }, 409);
    }
    if (
      patch.runtimeId &&
      !(await runtimeUsableInWorkspace(
        workspaceId,
        c.get("user").sub,
        patch.runtimeId,
      ))
    ) {
      return c.json({ error: "运行时不存在或在此工作空间不可用" }, 400);
    }

    await db
      .update(schema.agent)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.instructions !== undefined
          ? { instructions: patch.instructions }
          : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
        ...(patch.runtimeId !== undefined ? { runtimeId: patch.runtimeId } : {}),
      })
      .where(eq(schema.agent.id, id));

    const [updated] = await db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, id))
      .limit(1);
    return c.json({ agent: updated });
  })
  // 删除
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [current] = await db
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(
        and(eq(schema.agent.id, id), eq(schema.agent.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!current) return c.json({ error: "智能体不存在" }, 404);

    // 解除该 agent 在 issue 上的指派，避免悬挂
    await db
      .update(schema.issue)
      .set({ assigneeType: null, assigneeId: null })
      .where(
        and(
          eq(schema.issue.assigneeType, "agent"),
          eq(schema.issue.assigneeId, id),
        ),
      );
    await db.delete(schema.agent).where(eq(schema.agent.id, id));
    return c.json({ ok: true });
  });
