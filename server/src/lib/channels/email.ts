import nodemailer, { type Transporter } from "nodemailer";

import { config } from "@/config";

// 邮件渠道 adapter。SMTP 已配置 → 真正发信；未配置 → dev 回退（打印到控制台，
// 视为成功），便于无凭据先验证整条通知管线（参照 Multica 本地把验证码打到 stdout）。

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.from);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth:
        config.smtp.user || config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!isEmailConfigured()) {
    // dev 回退：不真正发信，打印内容
    console.log(
      `[email:dev] (SMTP 未配置，未真正发信)\n  to: ${msg.to}\n  subject: ${msg.subject}\n  ${msg.text.replace(/\n/g, "\n  ")}`,
    );
    return;
  }
  const from = config.smtp.fromName
    ? `${config.smtp.fromName} <${config.smtp.from}>`
    : config.smtp.from;
  await getTransporter().sendMail({
    from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
