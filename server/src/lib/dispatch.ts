import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { signAttachmentPath } from "@/lib/storage";

// 把一个 issue 派发给它指派的 agent（满足条件则建一条 queued task）
// 返回新建的 taskId，或 null（不满足/已去重）
export async function enqueueTaskForIssue(
  issueId: string,
  triggerEventId?: string | null,
): Promise<string | null> {
  const [iss] = await db
    .select()
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
    .limit(1);
  if (!iss) return null;
  // 仅指派给 agent、且已移出 backlog 才执行
  if (iss.assigneeType !== "agent" || !iss.assigneeId) return null;
  if (iss.status === "backlog") return null;

  const [ag] = await db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, iss.assigneeId))
    .limit(1);
  if (!ag) return null;

  // 未绑定运行时 → 记一条系统事件提示，不入队
  if (!ag.runtimeId) {
    await db.insert(schema.issueEvent).values({
      id: crypto.randomUUID(),
      issueId,
      workspaceId: iss.workspaceId,
      actorType: "system",
      actorId: null,
      kind: "run_failed",
      meta: { reason: "no_runtime" },
    });
    return null;
  }

  // 去重：同一 (issue, agent) 已有未结束任务则跳过
  const active = await db
    .select({ id: schema.task.id })
    .from(schema.task)
    .where(
      and(
        eq(schema.task.issueId, issueId),
        eq(schema.task.agentId, ag.id),
        inArray(schema.task.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (active.length > 0) return null;

  // 复用上次会话（同 agent×issue 最近一次结束任务的 session_id）
  const [last] = await db
    .select({ sessionId: schema.task.sessionId })
    .from(schema.task)
    .where(
      and(
        eq(schema.task.issueId, issueId),
        eq(schema.task.agentId, ag.id),
        inArray(schema.task.status, ["succeeded", "failed"]),
      ),
    )
    .orderBy(desc(schema.task.createdAt))
    .limit(1);

  const id = crypto.randomUUID();
  await db.insert(schema.task).values({
    id,
    workspaceId: iss.workspaceId,
    issueId,
    agentId: ag.id,
    runtimeId: ag.runtimeId,
    triggerEventId: triggerEventId ?? null,
    sessionId: last?.sessionId ?? null,
  });
  // 立刻写一条「排队中」时间线事件 —— 否则从入队到 daemon 轮询认领之间前端无反馈
  await db.insert(schema.issueEvent).values({
    id: crypto.randomUUID(),
    issueId,
    workspaceId: iss.workspaceId,
    actorType: "agent",
    actorId: ag.id,
    kind: "run_queued",
    meta: { taskId: id },
  });
  return id;
}

// 装配发给 agent 的结构化上下文（服务端主动拼，不靠 agent 自取）
// opts.resuming + opts.agentId：续接已有会话时，算出"上一轮已看过的前缀评论条数"
// resumeFromIndex，daemon 据此在 resume 那轮只推增量评论（旧的已在会话记忆里）。
export async function assembleContext(
  issueId: string,
  opts?: { agentId?: string; resuming?: boolean },
) {
  const [iss] = await db
    .select({
      number: schema.issue.number,
      title: schema.issue.title,
      description: schema.issue.description,
      status: schema.issue.status,
      baseBranch: schema.issue.baseBranch,
      repoId: schema.issue.repoId,
      workDir: schema.issue.workDir,
    })
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
    .limit(1);
  if (!iss) return null;

  // 最近 20 条评论（含作者，member/agent 都解析）。
  // 取「最新 20 条」用 desc+limit，再 reverse 回时间正序（最早→最晚），
  // 供 resumeFromIndex 前缀计数与展示。注意：不能用 asc+limit（那是最老 20 条）。
  const comments = await db
    .select({
      body: schema.issueEvent.body,
      createdAt: schema.issueEvent.createdAt,
      actorType: schema.issueEvent.actorType,
      memberName: schema.user.name,
      agentName: schema.agent.name,
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
    .limit(20);
  comments.reverse(); // desc 取到最新 20 条后翻回时间正序（最早→最晚）

  let repo = null;
  if (iss.repoId) {
    const [r] = await db
      .select()
      .from(schema.repo)
      .where(eq(schema.repo.id, iss.repoId))
      .limit(1);
    if (r) {
      repo = {
        name: r.name,
        url: r.url,
        defaultBranch: r.defaultBranch,
        baseBranch: iss.baseBranch ?? r.defaultBranch,
      };
    }
  }

  // 工作模式：daemon 据此决定 cwd（仓库→worktree / 工作目录→就地 / 空目录）
  const work:
    | { mode: "repo"; repoUrl: string; baseBranch: string; branch: string }
    | { mode: "dir"; path: string }
    | { mode: "empty" } = repo
    ? {
        mode: "repo",
        repoUrl: repo.url,
        baseBranch: repo.baseBranch,
        branch: `zero/ZERO-${iss.number}`,
      }
    : iss.workDir
      ? { mode: "dir", path: iss.workDir }
      : { mode: "empty" };

  // 增量推送：续接会话时，找上一条已结束 task 的起跑时刻当截止点，
  // 算出当前 20 条窗口里"早于截止点"的前缀条数（已在上一轮上下文里）。
  // 用 startedAt（取不到回退 createdAt）+ `<` 比较：宁可多带，绝不漏带 agent 没见过的评论。
  let resumeFromIndex = 0;
  if (opts?.resuming && opts.agentId) {
    const [prior] = await db
      .select({
        startedAt: schema.task.startedAt,
        createdAt: schema.task.createdAt,
      })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.issueId, issueId),
          eq(schema.task.agentId, opts.agentId),
          inArray(schema.task.status, ["succeeded", "failed"]),
        ),
      )
      .orderBy(desc(schema.task.createdAt))
      .limit(1);
    const cutoff = prior?.startedAt ?? prior?.createdAt ?? null;
    if (cutoff) {
      resumeFromIndex = comments.filter(
        (c) => c.createdAt != null && c.createdAt < cutoff,
      ).length;
    }
  }

  // 该 issue 的附件（已 link 到评论的）；daemon 据 size 决定小推/大拉，
  // signedPath 拼上 server 基址即可拉取（签名鉴权，不需令牌）
  const attachments = await db
    .select({
      id: schema.attachment.id,
      filename: schema.attachment.filename,
      mime: schema.attachment.mime,
      size: schema.attachment.sizeBytes,
    })
    .from(schema.attachment)
    .where(eq(schema.attachment.issueId, issueId))
    .orderBy(asc(schema.attachment.createdAt));

  return {
    issue: {
      number: iss.number,
      title: iss.title,
      description: iss.description,
      status: iss.status,
    },
    comments: comments.map((cm) => ({
      author: cm.agentName ?? cm.memberName ?? "system",
      authorType: cm.actorType,
      body: cm.body,
      createdAt: cm.createdAt,
    })),
    repo,
    work,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      signedPath: signAttachmentPath(a.id, 7200),
    })),
    // daemon: resume 那轮只渲染 comments.slice(resumeFromIndex)；新会话/回退渲染全量
    resumeFromIndex,
  };
}
