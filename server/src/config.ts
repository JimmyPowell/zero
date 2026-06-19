// 集中读取环境变量，统一类型与默认值
export const config = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl:
    process.env.DATABASE_URL ?? "mysql://zero:zero@127.0.0.1:3307/zero",
  jwtSecret: process.env.JWT_SECRET ?? "dev-zero-secret-change-me-in-prod",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};
