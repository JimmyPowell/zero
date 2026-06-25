import nodemailer, { type Transporter } from "nodemailer";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { config } from "@/config";
import { db, schema } from "@/db";
import { decryptSecret } from "@/lib/crypto-box";

// 邮件渠道 adapter。SMTP 配置解析顺序：
//   1) DB（channel_provider, kind=email, enabled=1）—— 设置页可视化编辑，密码加密存 secret_enc
//   2) env（config.smtp）—— 老部署兜底
//   3) 都没有 → dev 回退（打印到控制台，视为成功），便于无凭据先验证整条通知管线。
// transporter 按工作空间缓存，配置指纹变化（在设置页改了）→ 自动重建。

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

// 解析后的 SMTP 配置（来源 DB 或 env）
export type SmtpConf = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  source: "db" | "env";
};

// 读某工作空间的 email 服务端配置：DB 命中优先，否则回退 env；都不完整则 null（→ dev 回退）。
export async function resolveSmtp(
  workspaceId: string,
): Promise<SmtpConf | null> {
  // 1) DB 优先
  try {
    const [row] = await db
      .select()
      .from(schema.channelProvider)
      .where(
        and(
          eq(schema.channelProvider.workspaceId, workspaceId),
          eq(schema.channelProvider.kind, "email"),
          eq(schema.channelProvider.enabled, 1),
        ),
      )
      .limit(1);
    if (row) {
      const cfg = (row.config ?? {}) as Partial<SmtpConf>;
      let pass = "";
      if (row.secretEnc) {
        try {
          pass = decryptSecret(row.secretEnc);
        } catch (err) {
          console.error(
            "[email] 解密 SMTP 凭据失败（CONFIG_ENC_KEY 是否变更/缺失？）：",
            err,
          );
        }
      }
      const conf: SmtpConf = {
        host: cfg.host ?? "",
        port: Number(cfg.port ?? 465),
        secure: cfg.secure ?? true,
        user: cfg.user ?? "",
        pass,
        from: cfg.from ?? "",
        fromName: cfg.fromName ?? "Zero",
        source: "db",
      };
      // DB 行存在（即使不完整）即视为「该工作空间已自管配置」，不再回退 env，
      // 避免管理员以为关掉了却仍用 env 偷偷发信。
      return conf.host && conf.from ? conf : null;
    }
  } catch (err) {
    console.error("[email] 读取 DB SMTP 配置失败，回退 env：", err);
  }

  // 2) env 兜底
  const s = config.smtp;
  if (s.host && s.from) {
    return {
      host: s.host,
      port: s.port,
      secure: s.secure,
      user: s.user,
      pass: s.pass,
      from: s.from,
      fromName: s.fromName,
      source: "env",
    };
  }
  return null;
}

export async function isEmailConfigured(workspaceId: string): Promise<boolean> {
  return (await resolveSmtp(workspaceId)) !== null;
}

function buildTransport(c: SmtpConf): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user || c.pass ? { user: c.user, pass: c.pass } : undefined,
  });
}

function fromHeader(c: SmtpConf): string {
  return c.fromName ? `${c.fromName} <${c.from}>` : c.from;
}

// 按工作空间缓存 transporter；指纹（配置内容）变化即重建，避免改了配置仍用旧连接。
const cache = new Map<string, { fp: string; tp: Transporter }>();

function fingerprint(c: SmtpConf): string {
  return createHash("sha256")
    .update(
      [c.host, c.port, c.secure, c.user, c.pass, c.from, c.fromName].join("|"),
    )
    .digest("hex");
}

function transporterFor(workspaceId: string, c: SmtpConf): Transporter {
  const fp = fingerprint(c);
  const hit = cache.get(workspaceId);
  if (hit && hit.fp === fp) return hit.tp;
  const tp = buildTransport(c);
  cache.set(workspaceId, { fp, tp });
  return tp;
}

// 用「指定配置」直接发信，不走缓存（测试发信用：配置可能尚未持久化）。
export async function sendEmailWith(
  conf: SmtpConf,
  msg: EmailMessage,
): Promise<void> {
  await buildTransport(conf).sendMail({
    from: fromHeader(conf),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

// 给某工作空间发信：解析配置 → 缓存 transporter 投递；未配置则 dev 回退打印。
export async function sendEmail(
  workspaceId: string,
  msg: EmailMessage,
): Promise<void> {
  const conf = await resolveSmtp(workspaceId);
  if (!conf) {
    console.log(
      `[email:dev] (SMTP 未配置，未真正发信)\n  to: ${msg.to}\n  subject: ${msg.subject}\n  ${msg.text.replace(/\n/g, "\n  ")}`,
    );
    return;
  }
  await transporterFor(workspaceId, conf).sendMail({
    from: fromHeader(conf),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
