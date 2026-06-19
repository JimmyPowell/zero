import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://zero:zero@127.0.0.1:3307/zero",
  },
  verbose: true,
  strict: true,
});
