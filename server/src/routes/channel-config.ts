import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import { encryptSecret, isCryptoConfigured } from "@/lib/crypto-box";
import { resolveSmtp, sendEmailWith } from "@/lib/channels/email";

// 渠道「服务端配置」（A 层）：SMTP 发信凭据等，与 channel_binding（B 层收件人）对称。
// 仅工作空间 owner/admin 可读写。密码加密落库（channel_provider.secret_enc），永不回前端。

function isAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

const emailConfigSchema = z.object({
  host: z.string().trim().min(1, "SMTP host 不能为空"),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().optional(),
  // 留空/不传 = 保留原密码；有值 = 更新
  pass: z.string().optional(),
  from: z.string().trim().email("发件地址格式不正确"),
  fromName: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

// 脱敏视图：永不含密码明文，只暴露「是否已设密码」
function shape(row: schema.ChannelProvider | undefined) {
  if (!row) return null;
  const c = (row.config ?? {}) as Record<string, unknown>;
  return {
    host: (c.host as string) ?? "",
    port: (c.port as number) ?? 465,
    secure: (c.secure as boolean) ?? true,
    user: (c.user as string) ?? "",
    from: (c.from as string) ?? "",
    fromName: (c.fromName as string) ?? "Zero",
    enabled: row.enabled === 1,
    hasPassword: Boolean(row.secretEnc),
    updatedAt: row.updatedAt,
  };
}

async function getEmailRow(workspaceId: string) {
  const [row] = await db
    .select()
    .from(schema.channelProvider)
    .where(
      and(
        eq(schema.channelProvider.workspaceId, workspaceId),
        eq(schema.channelProvider.kind, "email"),
      ),
    )
    .limit(1);
  return row;
}

// 测试发信限频：每工作空间 10s 一次，避免被当成对任意 SMTP 主机的发信探测器
const lastTestAt = new Map<string, number>();
const TEST_COOLDOWN_MS = 10_000;

export const channelConfigRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 读 email 服务端配置（admin-only）
  .get("/email", async (c) => {
    if (!isAdmin(c.get("member").role))
      return c.json({ error: "需要管理员权限" }, 403);
    const row = await getEmailRow(c.get("workspaceId"));
    return c.json({ config: shape(row), cryptoReady: isCryptoConfigured() });
  })
  // upsert email 服务端配置（admin-only）
  .put("/email", zValidator("json", emailConfigSchema), async (c) => {
    if (!isAdmin(c.get("member").role))
      return c.json({ error: "需要管理员权限" }, 403);
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");
    const body = c.req.valid("json");

    const existing = await getEmailRow(workspaceId);

    // 密码：有值 → 加密；留空 → 保留原密文
    let secretEnc = existing?.secretEnc ?? null;
    if (body.pass !== undefined && body.pass !== "") {
      if (!isCryptoConfigured())
        return c.json(
          { error: "服务端未配置 CONFIG_ENC_KEY，无法安全存储密码" },
          400,
        );
      secretEnc = encryptSecret(body.pass);
    }

    const cfg = {
      host: body.host,
      port: body.port ?? 465,
      secure: body.secure ?? true,
      user: body.user ?? "",
      from: body.from,
      fromName: body.fromName ?? "Zero",
    };
    const enabled = body.enabled === false ? 0 : 1;

    if (existing) {
      await db
        .update(schema.channelProvider)
        .set({ config: cfg, secretEnc, enabled, updatedBy: sub })
        .where(eq(schema.channelProvider.id, existing.id));
    } else {
      await db.insert(schema.channelProvider).values({
        id: crypto.randomUUID(),
        workspaceId,
        kind: "email",
        config: cfg,
        secretEnc,
        enabled,
        updatedBy: sub,
      });
    }
    return c.json({ config: shape(await getEmailRow(workspaceId)) });
  })
  // 发送测试邮件（admin-only）：用「已保存的」配置发到当前登录用户的邮箱
  .post("/email/test", async (c) => {
    if (!isAdmin(c.get("member").role))
      return c.json({ error: "需要管理员权限" }, 403);
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");

    const now = Date.now();
    const last = lastTestAt.get(workspaceId) ?? 0;
    if (now - last < TEST_COOLDOWN_MS)
      return c.json({ error: "操作太频繁，请稍后再试" }, 429);
    lastTestAt.set(workspaceId, now);

    const [u] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, sub))
      .limit(1);
    if (!u?.email) return c.json({ error: "当前账号没有邮箱" }, 400);

    const conf = await resolveSmtp(workspaceId);
    if (!conf)
      return c.json({ error: "尚未配置 SMTP（host/from 必填且需启用）" }, 400);

    try {
      await sendEmailWith(conf, {
        to: u.email,
        subject: "[Zero] 邮件通知测试",
        text:
          "这是一封来自 Zero 的测试邮件。\n" +
          "收到即说明 SMTP 配置正确，邮件通知渠道已就绪。\n\n" +
          `发信来源：${conf.source === "db" ? "数据库配置（设置页）" : "环境变量"}`,
      });
      return c.json({ ok: true, sentTo: u.email });
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: String((err as Error)?.message ?? err).slice(0, 500),
        },
        400,
      );
    }
  });
