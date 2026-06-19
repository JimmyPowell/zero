import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { config } from "@/config";

// 已实现 adapter 的渠道（outbox worker 能投递的）。新增渠道在此登记。
const SUPPORTED_CHANNELS = ["email", "wecom"] as const;

// 通知分发入口：某 issue 事件发生后调用，解析收件人 → 渲染 → 落 notification_outbox。
// 设计为 fire-and-forget：调用方不 await、不让它影响主请求；内部自吞异常绝不抛出。

// N1 支持的通知点
export type NotifyKind = "created" | "run_finished";

type NotifyParams = {
  kind: NotifyKind;
  issueId: string;
  eventId?: string | null; // 来源 issue_event.id
};

const STATUS_LABEL: Record<string, string> = {
  backlog: "待办池",
  todo: "待办",
  in_progress: "进行中",
  in_review: "评审中",
  done: "已完成",
  cancelled: "已取消",
};

function issueUrl(issueId: string): string {
  return `${config.appUrl.replace(/\/$/, "")}/issues/${issueId}`;
}

function render(
  kind: NotifyKind,
  issue: { number: number; title: string; status: string; description: string | null },
  issueId: string,
): { subject: string; text: string; html: string } {
  const ref = `ZERO-${issue.number}`;
  const url = issueUrl(issueId);
  let subject: string;
  let lead: string;
  if (kind === "created") {
    subject = `[${ref}] 新需求：${issue.title}`;
    lead = `新需求已创建（当前状态：${STATUS_LABEL[issue.status] ?? issue.status}）。`;
  } else {
    subject = `[${ref}] ${issue.title} — 智能体已完成，待评审`;
    lead = `智能体已完成执行，需求进入「${STATUS_LABEL[issue.status] ?? issue.status}」，等待你 review。`;
  }
  const descLine = issue.description?.trim()
    ? `\n\n${issue.description.trim().slice(0, 500)}`
    : "";
  const text = `${ref} ${issue.title}\n\n${lead}${descLine}\n\n打开：${url}`;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html =
    `<p><strong>${esc(ref)}</strong> ${esc(issue.title)}</p>` +
    `<p>${esc(lead)}</p>` +
    (descLine ? `<p style="color:#555;white-space:pre-wrap">${esc(issue.description!.trim().slice(0, 500))}</p>` : "") +
    `<p><a href="${esc(url)}">打开需求 →</a></p>`;
  return { subject, text, html };
}

export async function notifyIssueEvent(params: NotifyParams): Promise<void> {
  try {
    const { kind, issueId, eventId } = params;

    const [issue] = await db
      .select({
        id: schema.issue.id,
        workspaceId: schema.issue.workspaceId,
        number: schema.issue.number,
        title: schema.issue.title,
        status: schema.issue.status,
        description: schema.issue.description,
        creatorId: schema.issue.creatorId,
        assigneeType: schema.issue.assigneeType,
        assigneeId: schema.issue.assigneeId,
      })
      .from(schema.issue)
      .where(eq(schema.issue.id, issueId))
      .limit(1);
    if (!issue) return;

    // 收件人（N1）：创建者 + 指派人(若为 member)。去重。
    const memberIds = new Set<string>();
    if (issue.creatorId) memberIds.add(issue.creatorId);
    if (issue.assigneeType === "member" && issue.assigneeId)
      memberIds.add(issue.assigneeId);
    if (memberIds.size === 0) return;

    // 取这些用户在本工作空间「已启用、且已实现 adapter」的渠道绑定
    const bindings = await db
      .select()
      .from(schema.channelBinding)
      .where(
        and(
          eq(schema.channelBinding.workspaceId, issue.workspaceId),
          inArray(schema.channelBinding.kind, [...SUPPORTED_CHANNELS]),
          eq(schema.channelBinding.enabled, 1),
          inArray(schema.channelBinding.userId, [...memberIds]),
        ),
      );
    if (bindings.length === 0) return;

    const { subject, text, html } = render(kind, issue, issueId);

    // 每个绑定一条 outbox；渲染内容渠道无关，各 adapter 自行格式化
    const rows = bindings.map((b) => ({
      id: crypto.randomUUID(),
      workspaceId: issue.workspaceId,
      eventId: eventId ?? null,
      issueId,
      bindingId: b.id,
      channel: b.kind,
      subject,
      body: text,
      payload: { html },
      // status / attempts / nextAttemptAt 走默认（pending / 0 / now）
    }));
    await db.insert(schema.notificationOutbox).values(rows);
  } catch (err) {
    // 通知失败绝不影响主流程
    console.error("[notify] 分发失败：", err);
  }
}
