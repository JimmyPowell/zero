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
