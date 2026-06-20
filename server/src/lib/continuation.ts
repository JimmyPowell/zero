// Agent 自触发续跑：点燃一个 agent_wakeup → 插系统评论(why) + enqueueTaskForIssue(复用 session)。
// timer 由本文件的 sweeper 扫 fire_at 点燃；process 由 daemon 探活后经 /daemon/watches/sync 点燃。
// 设计与护栏见 docs/agent-continuation.md。
import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { enqueueTaskForIssue } from "@/lib/dispatch";

// 距上一条「人(member)评论」以来，允许的连续自动续跑次数上限。超过即暂停、等人介入。
const MAX_AUTO_CHAIN = 12;
// 单 issue 同时 pending 的唤醒数上限（注册时校验）。
export const MAX_PENDING_WAKEUPS = 5;
// 延时唤醒的合法区间（秒）。
export const WAKE_MIN_SEC = 5;
export const WAKE_MAX_SEC = 3600;
// 定时 sweeper 周期。
const WAKEUP_SWEEP_MS = 5000;

// issue 处于这些活动态时才允许自唤醒（done/cancelled/backlog/blocked 静默作废）。
const FIREABLE = ["todo", "in_progress", "in_review"] as const;

async function markExpired(id: string): Promise<void> {
  await db
    .update(schema.agentWakeup)
    .set({ status: "expired", firedAt: new Date() })
    .where(eq(schema.agentWakeup.id, id));
}

// 插一条系统评论（既是时间线痕迹，也会被 assembleContext 带进续跑上下文）。返回 eventId。
async function insertSystemComment(
  w: schema.AgentWakeup,
  body: string,
  wakeKind: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.issueEvent).values({
    id,
    issueId: w.issueId,
    workspaceId: w.workspaceId,
    actorType: "system",
    actorId: null,
    kind: "comment",
    body,
    meta: { wake: wakeKind, wakeupId: w.id },
  });
  return id;
}

// 距最近一条 member 评论以来的「系统续跑评论」条数 = 当前连续自动续跑深度。
async function autoChainDepth(issueId: string): Promise<number> {
  const [lastMember] = await db
    .select({ createdAt: schema.issueEvent.createdAt })
    .from(schema.issueEvent)
    .where(
      and(
        eq(schema.issueEvent.issueId, issueId),
        eq(schema.issueEvent.kind, "comment"),
        eq(schema.issueEvent.actorType, "member"),
      ),
    )
    .orderBy(desc(schema.issueEvent.createdAt))
    .limit(1);
  const since = lastMember?.createdAt ?? new Date(0);
  const [cnt] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.issueEvent)
    .where(
      and(
        eq(schema.issueEvent.issueId, issueId),
        eq(schema.issueEvent.kind, "comment"),
        eq(schema.issueEvent.actorType, "system"),
        gt(schema.issueEvent.createdAt, since),
      ),
    );
  return Number(cnt?.n ?? 0);
}

// 点燃一个唤醒。返回 true=真的入队了续跑；false=被护栏作废/跳过。
export async function fireWakeup(w: schema.AgentWakeup): Promise<boolean> {
  // 状态闸：仅活动态 issue 才自唤醒
  const [iss] = await db
    .select({ status: schema.issue.status })
    .from(schema.issue)
    .where(eq(schema.issue.id, w.issueId))
    .limit(1);
  if (!iss || !FIREABLE.includes(iss.status as (typeof FIREABLE)[number])) {
    await markExpired(w.id);
    return false;
  }

  // 链深护栏：连续自动续跑过多 → 暂停、等人介入
  const chain = await autoChainDepth(w.issueId);
  if (chain >= MAX_AUTO_CHAIN) {
    await insertSystemComment(
      w,
      `⚠️ 已连续自动续跑 ${chain} 次仍未收敛，暂停自动续跑，等待人工介入（回复一条评论即可恢复）。`,
      "limit",
    );
    await markExpired(w.id);
    return false;
  }

  const reason =
    w.kind === "timer"
      ? `⏰ 你之前设定的延时唤醒已到${w.note ? `（${w.note}）` : ""}。请继续这个 issue —— 检查你在等的东西、推进或汇报进度。`
      : `🔔 你登记看护的后台进程（PID ${w.pid}）已结束${w.note ? `（${w.note}）` : ""}。请检查它的产出/结果，然后继续或汇报。`;
  const ev = await insertSystemComment(w, reason, w.kind);
  // 复用现成派发：自动续上 session_id（resume）+ 对已有活动任务去重
  await enqueueTaskForIssue(w.issueId, ev);
  await db
    .update(schema.agentWakeup)
    .set({ status: "fired", firedAt: new Date() })
    .where(eq(schema.agentWakeup.id, w.id));
  return true;
}

// 定时唤醒 sweeper：周期扫到点的 timer 唤醒并点燃。挂在 server 启动处。
export function startWakeupWorker(): void {
  const tick = async () => {
    try {
      const due = await db
        .select()
        .from(schema.agentWakeup)
        .where(
          and(
            eq(schema.agentWakeup.kind, "timer"),
            eq(schema.agentWakeup.status, "pending"),
            lte(schema.agentWakeup.fireAt, new Date()),
          ),
        )
        .orderBy(asc(schema.agentWakeup.fireAt))
        .limit(20);
      for (const w of due) await fireWakeup(w);
    } catch (e) {
      console.error(`唤醒 sweeper 出错：${(e as Error).message}`);
    }
  };
  setInterval(() => void tick(), WAKEUP_SWEEP_MS);
}
