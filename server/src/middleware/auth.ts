import { createMiddleware } from "hono/factory";

import { verifyToken, type JwtPayload } from "@/lib/auth";

export type AuthEnv = {
  Variables: {
    user: JwtPayload;
  };
};

// 校验 Authorization: Bearer <token>，注入 c.get("user")
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return c.json({ error: "未提供认证令牌" }, 401);
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: "认证令牌无效或已过期" }, 401);
  }
  c.set("user", payload);
  await next();
});
