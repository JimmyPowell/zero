import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";

// 查询某用户在某工作空间的成员身份（不存在则 null）
export async function getMembership(userId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
