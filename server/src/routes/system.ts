import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { requireAuth, type AuthEnv } from "@/middleware/auth";
import {
  isRegistrationOpen,
  isSystemAdmin,
  setRegistrationOpen,
} from "@/lib/system-settings";

// 全站级设置（/system/settings）：仅系统管理员（user.is_admin）可读写。
// 与工作空间 owner/admin 无关——这些开关影响整个站点。

const updateSchema = z
  .object({
    registrationOpen: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "没有要更新的字段");

async function settings() {
  return { registrationOpen: await isRegistrationOpen() };
}

export const systemRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .use(async (c, next) => {
    if (!(await isSystemAdmin(c.get("user").sub))) {
      return c.json({ error: "仅系统管理员可操作" }, 403);
    }
    await next();
  })
  .get("/settings", async (c) => c.json({ settings: await settings() }))
  .patch("/settings", zValidator("json", updateSchema), async (c) => {
    const body = c.req.valid("json");
    if (body.registrationOpen !== undefined) {
      await setRegistrationOpen(body.registrationOpen, c.get("user").sub);
    }
    return c.json({ settings: await settings() });
  });
