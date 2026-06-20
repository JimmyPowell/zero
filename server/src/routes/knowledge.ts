import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { listDocs, readDoc, writeDoc, deleteDoc } from "@/lib/kb";

const writeSchema = z.object({
  path: z.string().trim().min(1).max(512),
  content: z.string().max(2_000_000),
  projectId: z.string().trim().length(36).nullable().optional(),
  pinned: z.boolean().optional(),
});

export const knowledgeRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 文档列表（索引）；projectId 给定则只列该项目
  .get(
    "/",
    zValidator("query", z.object({ projectId: z.string().optional() })),
    async (c) => {
      const wsId = c.get("workspaceId");
      const { projectId } = c.req.valid("query");
      const docs = await listDocs(wsId, projectId || null);
      return c.json({ docs });
    },
  )
  // 读一篇（从 git 工作树取正文）
  .get(
    "/doc",
    zValidator("query", z.object({ path: z.string().min(1) })),
    async (c) => {
      const wsId = c.get("workspaceId");
      const { path } = c.req.valid("query");
      try {
        const content = await readDoc(wsId, path);
        if (content == null) return c.json({ error: "文档不存在" }, 404);
        return c.json({ path, content });
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    },
  )
  // 写 / 更新一篇（落盘 + commit + 同步索引）
  .put("/doc", zValidator("json", writeSchema), async (c) => {
    const wsId = c.get("workspaceId");
    const body = c.req.valid("json");
    try {
      const id = await writeDoc({
        workspaceId: wsId,
        path: body.path,
        content: body.content,
        projectId: body.projectId ?? null,
        pinned: body.pinned,
        author: c.get("user").sub,
      });
      return c.json({ id, path: body.path });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  })
  // 删一篇
  .delete(
    "/doc",
    zValidator("query", z.object({ path: z.string().min(1) })),
    async (c) => {
      const wsId = c.get("workspaceId");
      const { path } = c.req.valid("query");
      try {
        await deleteDoc(wsId, path);
        return c.json({ ok: true });
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    },
  );
