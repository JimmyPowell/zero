import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { hashPassword, verifyPassword, signToken } from "@/lib/auth";
import { requireAuth, type AuthEnv } from "@/middleware/auth";

const registerSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位"),
  name: z.string().trim().min(1).max(64).optional(),
});

const loginSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(1, "请输入密码"),
});

function publicUser(u: schema.User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
  };
}

export const authRoutes = new Hono<AuthEnv>()
  // 注册
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const { email, password, name } = c.req.valid("json");

    const existing = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: "该邮箱已被注册" }, 409);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const displayName = name ?? email.split("@")[0]!;

    await db.insert(schema.user).values({
      id,
      email,
      passwordHash,
      name: displayName,
    });

    const token = await signToken({ sub: id, email });
    return c.json(
      { token, user: { id, email, name: displayName, avatarUrl: null } },
      201,
    );
  })
  // 登录
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");

    const rows = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    const u = rows[0];
    if (!u || !(await verifyPassword(password, u.passwordHash))) {
      return c.json({ error: "邮箱或密码错误" }, 401);
    }

    const token = await signToken({ sub: u.id, email: u.email });
    return c.json({ token, user: publicUser(u) });
  })
  // 当前用户
  .get("/me", requireAuth, async (c) => {
    const { sub } = c.get("user");
    const rows = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, sub))
      .limit(1);
    const u = rows[0];
    if (!u) return c.json({ error: "用户不存在" }, 404);
    return c.json({ user: publicUser(u) });
  });
