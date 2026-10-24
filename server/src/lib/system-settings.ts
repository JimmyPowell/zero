import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

// 全站级配置（system_setting 表）。读时不缓存：直接改库立即生效，无需重启。
// 无记录 = 用这里的默认值（registration_open 默认开放，兼容旧部署）。

const REGISTRATION_OPEN = "registration_open";

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select({ value: schema.systemSetting.value })
    .from(schema.systemSetting)
    .where(eq(schema.systemSetting.key, key))
    .limit(1);
  return row ? (row.value as T) : fallback;
}

async function setSetting(key: string, value: unknown, userId: string) {
  await db
    .insert(schema.systemSetting)
    .values({ key, value, updatedBy: userId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: userId } });
}

// 是否开放注册。改库时 value 存 JSON 布尔（true / false）。
export async function isRegistrationOpen(): Promise<boolean> {
  return (await getSetting<unknown>(REGISTRATION_OPEN, true)) !== false;
}

export async function setRegistrationOpen(open: boolean, userId: string) {
  await setSetting(REGISTRATION_OPEN, open, userId);
}

// 系统管理员（user.is_admin = 1）：全站开关的管理者
export async function isSystemAdmin(userId: string): Promise<boolean> {
  const [u] = await db
    .select({ isAdmin: schema.user.isAdmin })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return u?.isAdmin === 1;
}
