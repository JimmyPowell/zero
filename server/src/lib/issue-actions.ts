import { and, desc, eq, like, or, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { enqueueTaskForIssue } from "@/lib/dispatch";
import { notifyIssueEvent } from "@/lib/notify";

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

export const ISSUE_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export const PRIORITY_LABEL: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
  none: "无",
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

// 新建 issue（默认进行中），写 created 事件 + 派发 + 通知。返回 ref。
export async function createIssue(
  workspaceId: string,
  creatorUserId: string,
  opts: { title: string; description?: string | null },
): Promise<IssueRef> {
  const id = crypto.randomUUID();
  const createdEventId = crypto.randomUUID();
  let number = 0;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${schema.issue.number}), 0)` })
      .from(schema.issue)
      .where(eq(schema.issue.workspaceId, workspaceId));
    number = Number(row?.max ?? 0) + 1;
    await tx.insert(schema.issue).values({
      id,
      workspaceId,
      number,
      title: opts.title,
      description: opts.description ?? null,
      status: "in_progress",
      priority: "none",
      creatorId: creatorUserId,
    });
    await tx.insert(schema.issueEvent).values({
      id: createdEventId,
      issueId: id,
      workspaceId,
      actorType: "member",
      actorId: creatorUserId,
      kind: "created",
    });
  });
  await enqueueTaskForIssue(id);
  void notifyIssueEvent({ kind: "created", issueId: id, eventId: createdEventId });
  return { id, number, title: opts.title, status: "in_progress" };
}

export async function searchIssues(
  workspaceId: string,
  q: string,
): Promise<IssueRef[]> {
  const kw = `%${q}%`;
  return db
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
        or(like(schema.issue.title, kw), like(schema.issue.description, kw)),
      ),
    )
    .orderBy(desc(schema.issue.createdAt))
    .limit(8);
}

export async function setIssuePriority(
  workspaceId: string,
  issueId: string,
  actorUserId: string,
  priority: IssuePriority,
): Promise<{ from: string; to: string } | null> {
  const [cur] = await db
    .select({ priority: schema.issue.priority })
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!cur || cur.priority === priority) return null;
  await db
    .update(schema.issue)
    .set({ priority })
    .where(eq(schema.issue.id, issueId));
  await db.insert(schema.issueEvent).values({
    id: crypto.randomUUID(),
    issueId,
    workspaceId,
    actorType: "member",
    actorId: actorUserId,
    kind: "priority_change",
    meta: { from: cur.priority, to: priority },
  });
  return { from: cur.priority, to: priority };
}

export async function listAgents(
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.agent)
    .where(eq(schema.agent.workspaceId, workspaceId));
}

export async function findAgentByName(
  workspaceId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const agents = await listAgents(workspaceId);
  const low = name.trim().toLowerCase();
  return (
    agents.find((a) => a.name.toLowerCase() === low) ??
    agents.find((a) => a.name.toLowerCase().includes(low)) ??
    null
  );
}

export async function getUserName(userId: string): Promise<string | null> {
  const [u] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return u?.name ?? null;
}

// 指派给 member 或 agent；写 assignment 事件；agent 且非 backlog 则派发。
export async function assignIssue(
  workspaceId: string,
  issueId: string,
  actorUserId: string,
  assignee: { type: "member" | "agent"; id: string; name: string },
): Promise<{ name: string } | null> {
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
  if (!cur) return null;
  await db
    .update(schema.issue)
    .set({ assigneeType: assignee.type, assigneeId: assignee.id })
    .where(eq(schema.issue.id, issueId));
  await db.insert(schema.issueEvent).values({
    id: crypto.randomUUID(),
    issueId,
    workspaceId,
    actorType: "member",
    actorId: actorUserId,
    kind: "assignment",
    meta: { to: { type: assignee.type, id: assignee.id, name: assignee.name } },
  });
  if (assignee.type === "agent" && cur.status !== "backlog") {
    await enqueueTaskForIssue(issueId);
  }
  return { name: assignee.name };
}

// 用户所属工作空间（用于 /ws 切换）
export async function listWorkspacesForUser(
  userId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.workspace.id, name: schema.workspace.name })
    .from(schema.member)
    .innerJoin(
      schema.workspace,
      eq(schema.member.workspaceId, schema.workspace.id),
    )
    .where(eq(schema.member.userId, userId));
}

export async function isWorkspaceMember(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [m] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return !!m;
}
