import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { config } from "@/config";
import { db, schema } from "@/db";
import { requireAuth, type AuthEnv } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  requireWorkspaceAdmin,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { generateToken, hashToken } from "@/lib/token";

// 邀请有效性判定：未撤销 + 未过期 + 未用满。返回 reason 供前端提示。
type InviteReason = "revoked" | "expired" | "used_up";
function inviteState(inv: schema.WorkspaceInvite): {
  valid: boolean;
  reason?: InviteReason;
} {
  if (inv.revokedAt) return { valid: false, reason: "revoked" };
  if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now())
    return { valid: false, reason: "expired" };
  if (inv.maxUses != null && inv.useCount >= inv.maxUses)
    return { valid: false, reason: "used_up" };
  return { valid: true };
}

// 邀请列表项：绝不回传 token（只在创建时给一次）。status 便于前端标注。
function shapeInvite(
  inv: schema.WorkspaceInvite,
  createdByName: string | null,
) {
  const { valid, reason } = inviteState(inv);
  return {
    id: inv.id,
    role: inv.role,
    email: inv.email,
    expiresAt: inv.expiresAt,
    maxUses: inv.maxUses,
    useCount: inv.useCount,
    revokedAt: inv.revokedAt,
    createdAt: inv.createdAt,
    createdByName,
    status: valid ? "active" : (reason as string),
  };
}

const createSchema = z.object({
  role: z.enum(["admin", "member"]).default("member"),
  // 有效期天数：0/未传 = 永不过期
  expiresInDays: z.number().int().min(0).max(365).optional(),
  // 最大使用次数：未传 = 不限
  maxUses: z.number().int().min(1).max(1000).optional(),
});

// ── 管理端：/workspaces/:wsId/invites（owner/admin）─────────────────────────
export const workspaceInviteRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  .use(requireWorkspaceAdmin)
  // 活跃邀请列表（含已失效的，前端据 status 标注；已删除的除外）
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const rows = await db
      .select({
        inv: schema.workspaceInvite,
        createdByName: schema.user.name,
      })
      .from(schema.workspaceInvite)
      .leftJoin(
        schema.user,
        eq(schema.workspaceInvite.createdBy, schema.user.id),
      )
      .where(eq(schema.workspaceInvite.workspaceId, workspaceId))
      .orderBy(desc(schema.workspaceInvite.createdAt));
    return c.json({
      invites: rows.map((r) => shapeInvite(r.inv, r.createdByName)),
    });
  })
  // 生成邀请 → 返回明文 token + 完整链接（仅此一次）
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const member = c.get("member");
    const { role, expiresInDays, maxUses } = c.req.valid("json");

    // 只有 owner 能邀请 admin；admin 只能邀请 member
    if (role === "admin" && member.role !== "owner") {
      return c.json({ error: "仅所有者可邀请管理员" }, 403);
    }

    const token = generateToken();
    const id = crypto.randomUUID();
    const expiresAt =
      expiresInDays && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 86_400_000)
        : null;

    await db.insert(schema.workspaceInvite).values({
      id,
      workspaceId,
      role,
      tokenHash: hashToken(token),
      createdBy: sub,
      expiresAt,
      maxUses: maxUses ?? null,
    });

    const [row] = await db
      .select()
      .from(schema.workspaceInvite)
      .where(eq(schema.workspaceInvite.id, id))
      .limit(1);

    // 邀请链接基址优先级：显式 APP_URL（生产规范域名）> 发起请求的 web Origin
    //（自动带上当前访问域名，漏配也不至于写成 localhost）> 本地兜底。
    const base =
      process.env.APP_URL?.trim() ||
      c.req.header("origin") ||
      config.appUrl;

    return c.json(
      {
        invite: shapeInvite(row!, null),
        token,
        url: `${base}/invite/${token}`,
      },
      201,
    );
  })
  // 撤销邀请
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [row] = await db
      .select({ id: schema.workspaceInvite.id })
      .from(schema.workspaceInvite)
      .where(
        and(
          eq(schema.workspaceInvite.id, id),
          eq(schema.workspaceInvite.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "邀请不存在" }, 404);
    await db
      .update(schema.workspaceInvite)
      .set({ revokedAt: new Date() })
      .where(eq(schema.workspaceInvite.id, id));
    return c.json({ ok: true });
  });

// ── 接受端：/invites/:token（任意已登录用户）──────────────────────────────
export const inviteAcceptRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  // 预览：让接受页展示「XX 邀请你以<角色>加入<工作空间>」
  .get("/:token", async (c) => {
    const { sub } = c.get("user");
    const token = c.req.param("token");
    const [inv] = await db
      .select()
      .from(schema.workspaceInvite)
      .where(eq(schema.workspaceInvite.tokenHash, hashToken(token)))
      .limit(1);
    if (!inv)
      return c.json({
        valid: false,
        reason: "not_found",
        role: null,
        workspace: null,
        inviterName: null,
        alreadyMember: false,
      });

    const [ws] = await db
      .select({
        id: schema.workspace.id,
        name: schema.workspace.name,
        slug: schema.workspace.slug,
      })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, inv.workspaceId))
      .limit(1);

    const [inviter] = inv.createdBy
      ? await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, inv.createdBy))
          .limit(1)
      : [undefined];

    const [existing] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.workspaceId, inv.workspaceId),
          eq(schema.member.userId, sub),
        ),
      )
      .limit(1);

    const { valid, reason } = inviteState(inv);
    return c.json({
      valid,
      reason,
      role: inv.role,
      workspace: ws ?? null,
      inviterName: inviter?.name ?? null,
      alreadyMember: !!existing,
    });
  })
  // 接受：当前用户加入工作空间（幂等，已是成员则不改角色、不计数）
  .post("/:token/accept", async (c) => {
    const { sub } = c.get("user");
    const token = c.req.param("token");
    const [inv] = await db
      .select()
      .from(schema.workspaceInvite)
      .where(eq(schema.workspaceInvite.tokenHash, hashToken(token)))
      .limit(1);
    if (!inv) return c.json({ error: "邀请不存在" }, 404);

    const [ws] = await db
      .select({
        id: schema.workspace.id,
        name: schema.workspace.name,
        slug: schema.workspace.slug,
      })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, inv.workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: "工作空间不存在" }, 404);

    // 已是成员：幂等返回，不动角色/计数
    const [existing] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.workspaceId, inv.workspaceId),
          eq(schema.member.userId, sub),
        ),
      )
      .limit(1);
    if (existing) {
      return c.json({
        joined: false,
        workspace: { ...ws, role: existing.role },
      });
    }

    const { valid, reason } = inviteState(inv);
    if (!valid) return c.json({ error: "邀请已失效", reason }, 400);

    // 事务：写成员 + 计数原子化（防并发用满）
    await db.transaction(async (tx) => {
      await tx.insert(schema.member).values({
        id: crypto.randomUUID(),
        workspaceId: inv.workspaceId,
        userId: sub,
        role: inv.role,
      });
      await tx
        .update(schema.workspaceInvite)
        .set({ useCount: inv.useCount + 1 })
        .where(eq(schema.workspaceInvite.id, inv.id));
    });

    return c.json({ joined: true, workspace: { ...ws, role: inv.role } });
  });
