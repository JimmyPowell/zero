import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, like } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth, type AuthEnv } from "@/middleware/auth";
import { slugify, uniqueSlug } from "@/lib/slug";
import { getMembership } from "@/lib/access";

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入工作空间名称").max(64),
  description: z.string().trim().max(280).optional(),
});

export const workspaceRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  // 我加入的工作空间列表
  .get("/", async (c) => {
    const { sub } = c.get("user");
    const rows = await db
      .select({
        id: schema.workspace.id,
        name: schema.workspace.name,
        slug: schema.workspace.slug,
        description: schema.workspace.description,
        role: schema.member.role,
        createdAt: schema.workspace.createdAt,
      })
      .from(schema.member)
      .innerJoin(
        schema.workspace,
        eq(schema.member.workspaceId, schema.workspace.id),
      )
      .where(eq(schema.member.userId, sub));
    return c.json({ workspaces: rows });
  })
  // 某工作空间的成员列表（用于指派选择器；需为该工作空间成员）
  .get("/:wsId/members", async (c) => {
    const { sub } = c.get("user");
    const wsId = c.req.param("wsId");
    const self = await getMembership(sub, wsId);
    if (!self) return c.json({ error: "无权访问该工作空间" }, 403);

    const rows = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        avatarUrl: schema.user.avatarUrl,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.workspaceId, wsId));
    return c.json({ members: rows });
  })
  // 创建工作空间（创建者自动成为 owner）
  .post("/", zValidator("json", createSchema), async (c) => {
    const { sub } = c.get("user");
    const { name, description } = c.req.valid("json");

    // 生成不冲突的 slug
    const base = slugify(name);
    const similar = await db
      .select({ slug: schema.workspace.slug })
      .from(schema.workspace)
      .where(like(schema.workspace.slug, `${base}%`));
    const slug = uniqueSlug(base, new Set(similar.map((r) => r.slug)));

    const workspaceId = crypto.randomUUID();
    await db.insert(schema.workspace).values({
      id: workspaceId,
      name,
      slug,
      description: description ?? null,
    });
    await db.insert(schema.member).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId: sub,
      role: "owner",
    });

    return c.json(
      {
        workspace: {
          id: workspaceId,
          name,
          slug,
          description: description ?? null,
          role: "owner",
        },
      },
      201,
    );
  });
