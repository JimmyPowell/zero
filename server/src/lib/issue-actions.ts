import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { enqueueTaskForIssue } from "@/lib/dispatch";

// 共享 issue 动作层：HTTP 路由与「聊天指挥」(Telegram/企微) 共用同一份业务逻辑。
// 这里只放聊天回控 C1 需要的；后续命令全集逐步补齐，并让 routes/issues.ts 也收敛到这里。

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  backlog: "待办池",
  todo: "待办",
  in_progress: "进行中",
  in_review: "评审中",
  done: "已完成",
  cancelled: "已取消",
};

export type IssueRef = {
  id: string;
  number: number;
  title: string;
  status: string;
};

// ZERO-N → issue
export async function findIssueByNumber(
  workspaceId: string,
  number: number,
): Promise<IssueRef | null> {
  const [row] = await db
    .select({
      id: schema.issue.id,
      number: schema.issue.number,
      title: schema.issue.title,
      status: schema.issue.status,
    })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.workspaceId, workspaceId),
        eq(schema.issue.number, number),
      ),
    )
    .limit(1);
  return row ?? null;
}

// 最近 issue（聊天里列出供点选）
export async function listIssuesFor(
  workspaceId: string,
  opts: { limit?: number } = {},
): Promise<IssueRef[]> {
  return db
    .select({
      id: schema.issue.id,
      number: schema.issue.number,
      title: schema.issue.title,
      status: schema.issue.status,
    })
    .from(schema.issue)
    .where(eq(schema.issue.workspaceId, workspaceId))
    .orderBy(desc(schema.issue.createdAt))
    .limit(opts.limit ?? 8);
}

// 详情简报（状态/指派/最近评论）
export async function getIssueBrief(workspaceId: string, issueId: string) {
  const [iss] = await db
    .select({
      id: schema.issue.id,
      number: schema.issue.number,
      title: schema.issue.title,
      status: schema.issue.status,
      priority: schema.issue.priority,
      assigneeType: schema.issue.assigneeType,
      assigneeId: schema.issue.assigneeId,
    })
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!iss) return null;

  let assigneeName: string | null = null;
  if (iss.assigneeType === "member" && iss.assigneeId) {
    const [u] = await db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, iss.assigneeId))
      .limit(1);
    assigneeName = u?.name ?? null;
  } else if (iss.assigneeType === "agent" && iss.assigneeId) {
    const [a] = await db
      .select({ name: schema.agent.name })
      .from(schema.agent)
      .where(eq(schema.agent.id, iss.assigneeId))
      .limit(1);
    assigneeName = a?.name ?? null;
  }

  const comments = await db
    .select({
      body: schema.issueEvent.body,
      actorType: schema.issueEvent.actorType,
      memberName: schema.user.name,
      agentName: schema.agent.name,
      createdAt: schema.issueEvent.createdAt,
    })
    .from(schema.issueEvent)
    .leftJoin(
      schema.user,
      and(
        eq(schema.issueEvent.actorType, "member"),
        eq(schema.issueEvent.actorId, schema.user.id),
      ),
    )
    .leftJoin(
      schema.agent,
      and(
        eq(schema.issueEvent.actorType, "agent"),
        eq(schema.issueEvent.actorId, schema.agent.id),
      ),
    )
    .where(
      and(
        eq(schema.issueEvent.issueId, issueId),
        eq(schema.issueEvent.kind, "comment"),
      ),
    )
    .orderBy(desc(schema.issueEvent.createdAt))
    .limit(3);

  return {
    ...iss,
    assigneeName,
    recentComments: comments
      .reverse()
      .map((c) => ({
        author: c.agentName ?? c.memberName ?? "system",
        body: c.body ?? "",
      })),
  };
}

// 评论（触发被指派的 agent）。返回新事件 id。
export async function addIssueComment(
  workspaceId: string,
  issueId: string,
  actorUserId: string,
  body: string,
): Promise<string> {
  const eventId = crypto.randomUUID();
  await db.insert(schema.issueEvent).values({
    id: eventId,
    issueId,
    workspaceId,
    actorType: "member",
    actorId: actorUserId,
    kind: "comment",
    body,
  });
  await enqueueTaskForIssue(issueId, eventId);
  return eventId;
}

// 改状态（写 status_change 事件；移出 backlog 且指派 agent 则入队）。
// 返回 {from,to} 或 null（无变化 / issue 不存在）。
export async function setIssueStatus(
  workspaceId: string,
  issueId: string,
  actorUserId: string,
  status: IssueStatus,
): Promise<{ from: string; to: string } | null> {
  const [cur] = await db
    .select({
      status: schema.issue.status,
      assigneeType: schema.issue.assigneeType,
      assigneeId: schema.issue.assigneeId,
    })
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!cur || cur.status === status) return null;

  await db
    .update(schema.issue)
    .set({ status })
    .where(eq(schema.issue.id, issueId));
  await db.insert(schema.issueEvent).values({
    id: crypto.randomUUID(),
    issueId,
    workspaceId,
    actorType: "member",
    actorId: actorUserId,
    kind: "status_change",
    meta: { from: cur.status, to: status },
  });
  // 移出 backlog 且指派给 agent → 派发
  if (
    cur.status === "backlog" &&
    status !== "backlog" &&
    cur.assigneeType === "agent" &&
    cur.assigneeId
  ) {
    await enqueueTaskForIssue(issueId);
  }
  return { from: cur.status, to: status };
}
