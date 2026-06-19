import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { config } from "@/config";
import * as schema from "./schema";

// 连接池：开发期单进程足够
const pool = mysql.createPool(config.databaseUrl);

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
