import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { getMembership } from "@/lib/access";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";

const STATUSES = [
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
] as const;

const createSchema = z.object({
  title: z.string().trim().min(1, "请输入项目名").max(512),
  slug: z.string().trim().max(128).optional(),
  description: z.string().trim().max(20000).optional(),
  icon: z.string().trim().max(64).optional(),
  status: z.enum(STATUSES).optional(),
  leadId: z.string().trim().length(36).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(512).optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  leadId: z.string().trim().length(36).nullable().optional(),
});

const resourceSchema = z.object({
  // repo | knowledge | notion | gdoc | confluence | url | file …
  kind: z.string().trim().min(1).max(32),
  ref: z.record(z.any()),
  label: z.string().trim().max(255).optional(),
  position: z.number().int().min(0).optional(),
});

// 标题 → kebab slug（保留中文与字母数字，其余转 -）
function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return base || "project";
}

// 在工作空间内取唯一 slug（撞了就 -2 / -3 …）
async function uniqueSlug(
  workspaceId: string,
  desired: string,
): Promise<string> {
  const rows = await db
    .select({ slug: schema.project.slug })
    .from(schema.project)
    .where(eq(schema.project.workspaceId, workspaceId));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(desired)) return desired;
  for (let i = 2; i < 1000; i++) {
    const cand = `${desired}-${i}`;
    if (!taken.has(cand)) return cand;
  }
  return `${desired}-${crypto.randomUUID().slice(0, 8)}`;
}

// 取一行属于本工作空间的项目（不存在返回 undefined）
async function getProject(workspaceId: string, id: string) {
  const [project] = await db
    .select()
    .from(schema.project)
    .where(
      and(
        eq(schema.project.id, id),
        eq(schema.project.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return project;
}

export const projectRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 项目列表
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const projects = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.workspaceId, workspaceId))
      .orderBy(desc(schema.project.createdAt));
    return c.json({ projects });
  })
  // 创建项目
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    if (body.leadId && !(await getMembership(body.leadId, workspaceId))) {
      return c.json({ error: "负责人不是本工作空间成员" }, 400);
    }
    const slug = await uniqueSlug(
      workspaceId,
      slugify(body.slug || body.title),
    );
    const id = crypto.randomUUID();
    await db.insert(schema.project).values({
      id,
      workspaceId,
      title: body.title,
      slug,
      description: body.description,
      icon: body.icon,
      status: body.status ?? "planned",
      leadType: body.leadId ? "member" : undefined,
      leadId: body.leadId,
    });
    const project = await getProject(workspaceId, id);
    return c.json({ project }, 201);
  })
  // 项目详情（含资源）
  .get("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const project = await getProject(workspaceId, c.req.param("id"));
    if (!project) return c.json({ error: "项目不存在" }, 404);
    const resources = await db
      .select()
      .from(schema.projectResource)
      .where(eq(schema.projectResource.projectId, project.id))
      .orderBy(schema.projectResource.position);
    return c.json({ project, resources });
  })
  // 更新项目字段
  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const project = await getProject(workspaceId, id);
    if (!project) return c.json({ error: "项目不存在" }, 404);
    const body = c.req.valid("json");
    if (body.leadId && !(await getMembership(body.leadId, workspaceId))) {
      return c.json({ error: "负责人不是本工作空间成员" }, 400);
    }
    const patch: Partial<typeof schema.project.$inferInsert> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.status !== undefined) patch.status = body.status;
    if (body.leadId !== undefined) {
      patch.leadId = body.leadId;
      patch.leadType = body.leadId ? "member" : null;
    }
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.project)
        .set(patch)
        .where(eq(schema.project.id, id));
    }
    const updated = await getProject(workspaceId, id);
    return c.json({ project: updated });
  })
  // 删除项目：issue.projectId 松引用 → 应用层置空；project_resource 随 FK 级联删
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const project = await getProject(workspaceId, id);
    if (!project) return c.json({ error: "项目不存在" }, 404);
    await db
      .update(schema.issue)
      .set({ projectId: null })
      .where(
        and(
          eq(schema.issue.workspaceId, workspaceId),
          eq(schema.issue.projectId, id),
        ),
      );
    await db.delete(schema.project).where(eq(schema.project.id, id));
    return c.json({ ok: true });
  })
  // 项目资源列表
  .get("/:id/resources", async (c) => {
    const workspaceId = c.get("workspaceId");
    const project = await getProject(workspaceId, c.req.param("id"));
    if (!project) return c.json({ error: "项目不存在" }, 404);
    const resources = await db
      .select()
      .from(schema.projectResource)
      .where(eq(schema.projectResource.projectId, project.id))
      .orderBy(schema.projectResource.position);
    return c.json({ resources });
  })
  // 挂一个资源（代码仓库 / 知识库 / 外部 KB 指针）
  .post("/:id/resources", zValidator("json", resourceSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const project = await getProject(workspaceId, c.req.param("id"));
    if (!project) return c.json({ error: "项目不存在" }, 404);
    const body = c.req.valid("json");
    const rid = crypto.randomUUID();
    await db.insert(schema.projectResource).values({
      id: rid,
      projectId: project.id,
      workspaceId,
      kind: body.kind,
      ref: body.ref,
      label: body.label,
      position: body.position ?? 0,
      createdBy: c.get("user").sub,
    });
    const [resource] = await db
      .select()
      .from(schema.projectResource)
      .where(eq(schema.projectResource.id, rid))
      .limit(1);
    return c.json({ resource }, 201);
  })
  // 摘掉一个资源
  .delete("/:id/resources/:rid", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const rid = c.req.param("rid");
    const [resource] = await db
      .select({ id: schema.projectResource.id })
      .from(schema.projectResource)
      .where(
        and(
          eq(schema.projectResource.id, rid),
          eq(schema.projectResource.projectId, id),
          eq(schema.projectResource.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!resource) return c.json({ error: "资源不存在" }, 404);
    await db
      .delete(schema.projectResource)
      .where(eq(schema.projectResource.id, rid));
    return c.json({ ok: true });
  });
