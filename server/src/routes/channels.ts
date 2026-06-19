import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { createWecomLinkCode } from "@/lib/channels/wecom-bot";

// 渠道绑定：管理「我」在本工作空间的通知渠道。
// - email：直接填邮箱（upsert）。
// - wecom（企业微信智能机器人）：走「绑定码」——这里只发码，绑定在收消息回调里完成。

// email 直接 upsert（wecom 不走这里，走绑定码）
const upsertSchema = z.object({
  kind: z.literal("email"),
  address: z.string().trim().email("邮箱格式不正确"),
  enabled: z.boolean().optional(),
});

function shape(b: schema.ChannelBinding) {
  return {
    id: b.id,
    kind: b.kind,
    config: b.config,
    enabled: b.enabled === 1,
    verifiedAt: b.verifiedAt,
    createdAt: b.createdAt,
  };
}

export const channelRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 列出我的渠道绑定
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const rows = await db
      .select()
      .from(schema.channelBinding)
      .where(
        and(
          eq(schema.channelBinding.workspaceId, workspaceId),
          eq(schema.channelBinding.userId, sub),
        ),
      )
      .orderBy(desc(schema.channelBinding.createdAt));
    return c.json({ channels: rows.map(shape) });
  })
  // 新增 / 更新我的某类渠道绑定（同 kind 覆盖）
  .post("/", zValidator("json", upsertSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const { address, enabled } = c.req.valid("json");
    const kind = "email" as const;
    const config = { address };

    const [existing] = await db
      .select({ id: schema.channelBinding.id })
      .from(schema.channelBinding)
      .where(
        and(
          eq(schema.channelBinding.workspaceId, workspaceId),
          eq(schema.channelBinding.userId, sub),
          eq(schema.channelBinding.kind, kind),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.channelBinding)
        .set({
          config,
          enabled: enabled === false ? 0 : 1,
          // 免二次验证：写入即视为已验证（Telegram 档再做 /start 验证）
          verifiedAt: new Date(),
        })
        .where(eq(schema.channelBinding.id, existing.id));
      const [row] = await db
        .select()
        .from(schema.channelBinding)
        .where(eq(schema.channelBinding.id, existing.id))
        .limit(1);
      return c.json({ channel: shape(row!) });
    }

    const id = crypto.randomUUID();
    await db.insert(schema.channelBinding).values({
      id,
      workspaceId,
      userId: sub,
      kind,
      config,
      enabled: enabled === false ? 0 : 1,
      verifiedAt: new Date(),
    });
    const [row] = await db
      .select()
      .from(schema.channelBinding)
      .where(eq(schema.channelBinding.id, id))
      .limit(1);
    return c.json({ channel: shape(row!) }, 201);
  })
  // 生成企业微信「绑定码」：把它发给智能机器人即完成账号关联
  .post("/wecom/link-code", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const code = createWecomLinkCode(workspaceId, sub);
    return c.json({ code });
  })
  // 删除我的某条渠道绑定
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const id = c.req.param("id");
    const [row] = await db
      .select({ id: schema.channelBinding.id })
      .from(schema.channelBinding)
      .where(
        and(
          eq(schema.channelBinding.id, id),
          eq(schema.channelBinding.workspaceId, workspaceId),
          eq(schema.channelBinding.userId, sub),
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "渠道不存在" }, 404);
    await db
      .delete(schema.channelBinding)
      .where(eq(schema.channelBinding.id, id));
    return c.json({ ok: true });
  });
