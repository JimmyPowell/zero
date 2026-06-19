import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import { config } from "@/config";

// 独立的迁移连接（单连接，跑完即关）
const connection = await mysql.createConnection(config.databaseUrl);
const db = drizzle(connection);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete.");

await connection.end();
process.exit(0);
