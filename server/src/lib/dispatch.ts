import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { signAttachmentPath } from "@/lib/storage";
import { getPinnedKnowledge } from "@/lib/kb";

// task 的触发来源（run_queued.meta.trigger，前端据此展示"为什么跑了"）
export type TaskTrigger = "assignee" | "mention" | "wake";

// 单条评论最多触发的被 @ agent 数（防一条评论 @ 全员放大）
const MAX_MENTIONS_PER_COMMENT = 5;
// 距上一条人(member)评论以来，agent/system 评论的连续条数上限——超过则 @ 不再互相唤醒。
// 与 continuation.ts 的 MAX_AUTO_CHAIN 同款语义（A@B→B@A 每回合 +1 条 agent 评论 → 封顶 12 回合）。
const MAX_MENTION_CHAIN = 12;

// 把一个 issue 派发给指定 agent（满足条件则建一条 queued task）。
// @mention / 自唤醒 / assignee 三种触发最终都收敛到这里（docs/agent-mention-design.md §4）。
// 返回新建的 taskId，或 null（不满足/已去重）
export async function enqueueTaskForAgent(
  issueId: string,
  agentId: string,
  triggerEventId?: string | null,
  opts?: { trigger?: TaskTrigger },
): Promise<string | null> {
  const [iss] = await db
    .select()
    .from(schema.issue)
    .where(and(eq(schema.issue.id, issueId), isNull(schema.issue.deletedAt)))
    .limit(1);
  if (!iss) return null;
  if (iss.status === "backlog") return null;

  // agent 必须与 issue 同 workspace（@mention 只解析本 workspace agent，这里兜底防越权）
  const [ag] = await db
    .select()
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.id, agentId),
        eq(schema.agent.workspaceId, iss.workspaceId),
      ),
    )
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
      meta: { reason: "no_runtime", agentId: ag.id },
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

  // 复用上次会话（同 agent×issue 最近一次结束任务的 session_id）。
  // runtime 一致性：agent 换绑机器后旧 session 在旧机器上，resume 注定失败——直接不带，省一次回退。
  const [last] = await db
    .select({
      sessionId: schema.task.sessionId,
      runtimeId: schema.task.runtimeId,
    })
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
  const sessionId =
    last && last.runtimeId === ag.runtimeId ? last.sessionId : null;

  const id = crypto.randomUUID();
  await db.insert(schema.task).values({
    id,
    workspaceId: iss.workspaceId,
    issueId,
    agentId: ag.id,
    runtimeId: ag.runtimeId,
    triggerEventId: triggerEventId ?? null,
    sessionId,
  });
  // 立刻写一条「排队中」时间线事件 —— 否则从入队到 daemon 轮询认领之间前端无反馈
  await db.insert(schema.issueEvent).values({
    id: crypto.randomUUID(),
    issueId,
    workspaceId: iss.workspaceId,
    actorType: "agent",
    actorId: ag.id,
    kind: "run_queued",
    meta: { taskId: id, trigger: opts?.trigger ?? "assignee" },
  });
  return id;
}

// 把一个 issue 派发给它指派的 agent（薄壳：解析 assignee → enqueueTaskForAgent）
export async function enqueueTaskForIssue(
  issueId: string,
  triggerEventId?: string | null,
  trigger: TaskTrigger = "assignee",
): Promise<string | null> {
  const [iss] = await db
    .select({
      assigneeType: schema.issue.assigneeType,
      assigneeId: schema.issue.assigneeId,
    })
    .from(schema.issue)
    .where(and(eq(schema.issue.id, issueId), isNull(schema.issue.deletedAt)))
    .limit(1);
  // 仅指派给 agent 才执行（backlog 等其余闸门在 enqueueTaskForAgent 里）
  if (!iss || iss.assigneeType !== "agent" || !iss.assigneeId) return null;
  return enqueueTaskForAgent(issueId, iss.assigneeId, triggerEventId, {
    trigger,
  });
}

// 本 workspace 的全部 agent（供 @mention 解析用的候选名单；含未绑 runtime 的——
// 点到了会落一条 no_runtime 系统事件当反馈）
export async function workspaceMentionAgents(
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.agent)
    .where(eq(schema.agent.workspaceId, workspaceId));
}

// 距最近一条 member 评论以来的 agent/system 评论条数 = agent 间自动触发的连续深度
async function mentionChainDepth(issueId: string): Promise<number> {
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
        inArray(schema.issueEvent.actorType, ["agent", "system"]),
        gt(schema.issueEvent.createdAt, since),
      ),
    );
  return Number(cnt?.n ?? 0);
}

// 评论里的 @mention → 给每个被点名 agent 建 task（fan-out）。返回实际入队的 taskId 列表。
// authorAgentId：评论作者是 agent 时传入 —— 过滤自我点名 + 启用链深护栏（人评论天然清零链深，不设闸）。
export async function fanOutMentions(opts: {
  issueId: string;
  workspaceId: string;
  eventId: string;
  mentionAgentIds: string[];
  authorAgentId?: string | null;
}): Promise<string[]> {
  const ids = [...new Set(opts.mentionAgentIds)]
    .filter((id) => id !== opts.authorAgentId)
    .slice(0, MAX_MENTIONS_PER_COMMENT);
  if (ids.length === 0) return [];

  // 链深护栏：agent 评论触发别的 agent 才可能成环（A@B→B@A ping-pong）
  if (opts.authorAgentId) {
    const chain = await mentionChainDepth(opts.issueId);
    if (chain >= MAX_MENTION_CHAIN) {
      await db.insert(schema.issueEvent).values({
        id: crypto.randomUUID(),
        issueId: opts.issueId,
        workspaceId: opts.workspaceId,
        actorType: "system",
        actorId: null,
        kind: "comment",
        body: `⚠️ agent 间已连续自动触发 ${chain} 次，本次 @ 提及不再唤醒对方，等待人工介入（回复一条评论即可恢复）。`,
        meta: { wake: "mention-limit" },
      });
      return [];
    }
  }

  const enqueued: string[] = [];
  for (const agentId of ids) {
    const taskId = await enqueueTaskForAgent(
      opts.issueId,
      agentId,
      opts.eventId,
      { trigger: "mention" },
    );
    if (taskId) enqueued.push(taskId);
  }
  return enqueued;
}

// 装配发给 agent 的结构化上下文（服务端主动拼，不靠 agent 自取）
// opts.resuming + opts.agentId：续接已有会话时，算出"上一轮已看过的前缀评论条数"
// resumeFromIndex，daemon 据此在 resume 那轮只推增量评论（旧的已在会话记忆里）。
export async function assembleContext(
  issueId: string,
  opts?: {
    agentId?: string;
    resuming?: boolean;
    // 本次 task 的触发事件：若其 meta.mentions 点名了本 agent，上下文带 mentionedBy（prompt 明示"你被点名"）
    triggerEventId?: string | null;
  },
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
      projectId: schema.issue.projectId,
      workspaceId: schema.issue.workspaceId,
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
        isNull(schema.issueEvent.deletedAt), // 已软删评论不进 agent 上下文
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
  } else if (!iss.workDir && iss.projectId) {
    // 继承项目主仓库：issue 未显式绑仓库/工作目录，但归属某项目时，
    // 取该项目的 project_resource(kind=repo)——primary 优先，否则按 position 最前。
    const repoResources = await db
      .select()
      .from(schema.projectResource)
      .where(
        and(
          eq(schema.projectResource.projectId, iss.projectId),
          eq(schema.projectResource.kind, "repo"),
        ),
      )
      .orderBy(asc(schema.projectResource.position));
    const chosen =
      repoResources.find(
        (rr) => (rr.ref as { primary?: boolean })?.primary === true,
      ) ?? repoResources[0];
    const ref = (chosen?.ref ?? {}) as { repoId?: string; baseBranch?: string };
    if (ref.repoId) {
      const [r] = await db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.id, ref.repoId))
        .limit(1);
      if (r) {
        repo = {
          name: r.name,
          url: r.url,
          defaultBranch: r.defaultBranch,
          baseBranch: ref.baseBranch || r.defaultBranch,
        };
      }
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

  const knowledge = await getPinnedKnowledge(iss.workspaceId, iss.projectId);

  // 协作者名单：本 workspace 其他已绑 runtime 的 agent（prompt 的 Teammates 段，@名字 即可点名协作）
  const collabRows = await db
    .select({
      id: schema.agent.id,
      name: schema.agent.name,
      description: schema.agent.description,
    })
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.workspaceId, iss.workspaceId),
        isNotNull(schema.agent.runtimeId),
      ),
    );
  const collaborators = collabRows
    .filter((a) => a.id !== opts?.agentId)
    .map((a) => ({
      name: a.name,
      blurb: a.description?.split("\n")[0]?.slice(0, 80) || null,
    }));

  // 被 @ 点名：触发事件的 meta.mentions 含本 agent → 告诉它是谁点的名
  let mentionedBy: { name: string; type: string } | null = null;
  if (opts?.triggerEventId && opts.agentId) {
    const [tev] = await db
      .select({
        meta: schema.issueEvent.meta,
        actorType: schema.issueEvent.actorType,
        actorId: schema.issueEvent.actorId,
      })
      .from(schema.issueEvent)
      .where(eq(schema.issueEvent.id, opts.triggerEventId))
      .limit(1);
    const mentions = (tev?.meta as { mentions?: string[] } | null)?.mentions;
    if (mentions?.includes(opts.agentId) && tev?.actorId) {
      if (tev.actorType === "agent") {
        const [a] = await db
          .select({ name: schema.agent.name })
          .from(schema.agent)
          .where(eq(schema.agent.id, tev.actorId))
          .limit(1);
        mentionedBy = { name: a?.name ?? "agent", type: "agent" };
      } else if (tev.actorType === "member") {
        const [u] = await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, tev.actorId))
          .limit(1);
        mentionedBy = { name: u?.name ?? "member", type: "member" };
      }
    }
  }

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
    knowledge,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      signedPath: signAttachmentPath(a.id, 7200),
    })),
    // daemon: resume 那轮只渲染 comments.slice(resumeFromIndex)；新会话/回退渲染全量
    resumeFromIndex,
    // @mention 协作（docs/agent-mention-design.md §4.2）
    collaborators,
    mentionedBy,
  };
}
