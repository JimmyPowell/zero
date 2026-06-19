// 集中读取环境变量，统一类型与默认值
export const config = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl:
    process.env.DATABASE_URL ?? "mysql://zero:zero@127.0.0.1:3307/zero",
  jwtSecret: process.env.JWT_SECRET ?? "dev-zero-secret-change-me-in-prod",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // 邮件链接里 issue 的 web 基址
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  // 邮件（SMTP）。未配置 SMTP_HOST 时邮件 adapter 进 dev 回退（打印不发信）。
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true") !== "false",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "",
    fromName: process.env.SMTP_FROM_NAME ?? "Zero",
  },
  // 企业微信智能机器人（长连接，Bot ID + Secret）。未配置则不启动 bot。
  wecom: {
    botId: process.env.WECOM_BOT_ID ?? "",
    secret: process.env.WECOM_BOT_SECRET ?? "",
  },
};
