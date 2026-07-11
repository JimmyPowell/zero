import { createMiddleware } from "hono/factory";

import { getMembership } from "@/lib/access";
import { type AuthEnv } from "@/middleware/auth";
import type { Member } from "@/db/schema";

// 在 AuthEnv 之上补充：当前工作空间 id + 当前用户的成员行
export type WorkspaceEnv = AuthEnv & {
  Variables: AuthEnv["Variables"] & {
    workspaceId: string;
    member: Member;
  };
};

// 校验「当前用户是 :wsId 的成员」，注入 c.get("workspaceId") / c.get("member")
export const requireWorkspaceMember = createMiddleware<WorkspaceEnv>(
  async (c, next) => {
    const { sub } = c.get("user");
    const workspaceId = c.req.param("wsId");
    if (!workspaceId) return c.json({ error: "缺少工作空间 ID" }, 400);
    const membership = await getMembership(sub, workspaceId);
    if (!membership) {
      return c.json({ error: "无权访问该工作空间" }, 403);
    }
    c.set("workspaceId", workspaceId);
    c.set("member", membership);
    await next();
  },
);

// 需 owner/admin：叠在 requireWorkspaceMember 之后（读 c.get("member")）
export const requireWorkspaceAdmin = createMiddleware<WorkspaceEnv>(
  async (c, next) => {
    const member = c.get("member");
    if (!member || (member.role !== "owner" && member.role !== "admin")) {
      return c.json({ error: "需要管理员权限" }, 403);
    }
    await next();
  },
);

// 需 owner：叠在 requireWorkspaceMember 之后（角色变更等仅所有者可为）
export const requireWorkspaceOwner = createMiddleware<WorkspaceEnv>(
  async (c, next) => {
    const member = c.get("member");
    if (!member || member.role !== "owner") {
      return c.json({ error: "仅工作空间所有者可执行此操作" }, 403);
    }
    await next();
  },
);
