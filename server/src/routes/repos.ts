import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入仓库名").max(255),
  url: z.string().trim().min(1, "请输入仓库地址或本地路径").max(2000),
  defaultBranch: z.string().trim().max(255).optional(),
});

export const repoRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 工作空间的仓库列表
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const repos = await db
      .select()
      .from(schema.repo)
      .where(eq(schema.repo.workspaceId, workspaceId))
      .orderBy(desc(schema.repo.createdAt));
    return c.json({ repos });
  })
  // 登记一个仓库（git URL 或本地路径）
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { name, url, defaultBranch } = c.req.valid("json");
    const id = crypto.randomUUID();
    await db.insert(schema.repo).values({
      id,
      workspaceId,
      name,
      url,
      defaultBranch: defaultBranch || "main",
    });
    const [repo] = await db
      .select()
      .from(schema.repo)
      .where(eq(schema.repo.id, id))
      .limit(1);
    return c.json({ repo }, 201);
  });
