import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { config } from "@/config";
import * as schema from "./schema";

// 连接池：开发期单进程足够。
// timezone=Z：强制按 UTC 存取 DATETIME，不再依赖运行进程所在时区——
// 部署到任意时区的机器（或换终端重启）都一致：一律存 UTC，前端按浏览器本地时区显示。
const sep = config.databaseUrl.includes("?") ? "&" : "?";
const pool = mysql.createPool(`${config.databaseUrl}${sep}timezone=Z`);

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
