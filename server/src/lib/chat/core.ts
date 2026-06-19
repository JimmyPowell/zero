import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import * as actions from "@/lib/issue-actions";

// 平台无关的「聊天指挥」核心：解析意图 → 调共享动作层 → 返回结构化回复。
// Telegram / 企微 各自的适配器把原生输入翻成调用、把 ChatReply 翻成原生消息+按钮。

export type ChatChannel = "telegram" | "wecom";
export type ChatButton = { label: string; data: string };
export type ChatReply = { text: string; buttons?: ChatButton[][] };

type Session = {
  workspaceId: string;
  userId: string;
  activeIssueId?: string;
  activeNumber?: number;
};
const sessions = new Map<string, Session>();

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function parseNum(s: string): number | null {
  const m = s.trim().match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// 从渠道绑定恢复 (workspace, user)；缓存到 session
async function resolveSession(
  channel: ChatChannel,
  chatId: string,
): Promise<Session | null> {
  const key = `${channel}:${chatId}`;
  const cached = sessions.get(key);
  if (cached) return cached;
  const field = channel === "wecom" ? "target" : "chatId";
  const rows = await db
    .select()
    .from(schema.channelBinding)
    .where(
      and(
        eq(schema.channelBinding.kind, channel),
        eq(schema.channelBinding.enabled, 1),
      ),
    )
    .orderBy(desc(schema.channelBinding.createdAt));
  const b = rows.find(
    (r) => (r.config as Record<string, string>)?.[field] === String(chatId),
  );
  if (!b || !b.userId) return null;
  const s: Session = { workspaceId: b.workspaceId, userId: b.userId };
  sessions.set(key, s);
  return s;
}

function statusButtons(issueId: string, current?: string): ChatButton[][] {
  const opts: [actions.IssueStatus, string][] = [
    ["done", "✅ 完成"],
    ["in_review", "🔍 评审"],
    ["in_progress", "▶️ 进行中"],
  ];
  return [
    opts
      .filter(([st]) => st !== current)
      .map(([st, label]) => ({ label, data: `s:${st}:${issueId}` })),
  ];
}

async function briefReply(
  s: Session,
  issueId: string,
  prefix?: string,
): Promise<ChatReply> {
  const b = await actions.getIssueBrief(s.workspaceId, issueId);
  if (!b) return { text: "该 issue 不存在或不在当前工作空间。" };
  const lines: string[] = [];
  if (prefix) lines.push(prefix, "");
  lines.push(`ZERO-${b.number} ${b.title}`);
  lines.push(
    `状态：${actions.STATUS_LABEL[b.status] ?? b.status} · 指派：${b.assigneeName ?? "未指派"}`,
  );
  if (b.recentComments.length) {
    lines.push("最近评论：");
    for (const c of b.recentComments)
      lines.push(`· ${c.author}：${truncate(c.body, 40)}`);
  }
  return { text: lines.join("\n"), buttons: statusButtons(issueId, b.status) };
}

const HELP = [
  "Zero 聊天指挥（C1）：",
  "· /issues — 列出最近 issue 并点选",
  "· /use ZERO-12 — 选中某个 issue",
  "· /show [ZERO-12] — 看详情",
  "选中后：直接打字即评论它；按钮可改状态。",
  "也可直接回复某条通知 → 评论那个 issue。",
].join("\n");

async function handleCommand(
  s: Session,
  text: string,
): Promise<ChatReply> {
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd.toLowerCase()) {
    case "/start":
    case "/help":
      return { text: HELP };
    case "/issues": {
      const list = await actions.listIssuesFor(s.workspaceId, { limit: 8 });
      if (!list.length) return { text: "当前工作空间还没有 issue。" };
      return {
        text: "最近的 issue（点一个进行操作）：",
        buttons: list.map((i) => [
          { label: `ZERO-${i.number} ${truncate(i.title, 24)}`, data: `o:${i.id}` },
        ]),
      };
    }
    case "/use": {
      const n = parseNum(arg);
      if (n == null) return { text: "用法：/use ZERO-12" };
      const iss = await actions.findIssueByNumber(s.workspaceId, n);
      if (!iss) return { text: `找不到 ZERO-${n}` };
      s.activeIssueId = iss.id;
      s.activeNumber = iss.number;
      return briefReply(s, iss.id, `已选中 ZERO-${iss.number}，直接打字即评论它。`);
    }
    case "/show": {
      let id = s.activeIssueId;
      const n = parseNum(arg);
      if (n != null) {
        const iss = await actions.findIssueByNumber(s.workspaceId, n);
        if (!iss) return { text: `找不到 ZERO-${n}` };
        id = iss.id;
        s.activeIssueId = id;
        s.activeNumber = iss.number;
      }
      if (!id) return { text: "用法：/show ZERO-12（或先 /use 选中）" };
      return briefReply(s, id);
    }
    default:
      return { text: `未知命令。\n\n${HELP}` };
  }
}

// 普通消息（命令 / 回复绑定 / 活动态打字）
export async function handleChatMessage(
  channel: ChatChannel,
  chatId: string,
  input: { text: string; replyIssueId?: string | null },
): Promise<ChatReply | null> {
  const s = await resolveSession(channel, chatId);
  if (!s)
    return {
      text: "尚未绑定 Zero。请到设置页生成绑定码后发给我完成关联。",
    };
  const text = input.text.trim();
  if (!text) return null;
  if (text.startsWith("/")) return handleCommand(s, text);

  // 非命令：回复绑定 > 活动 issue → 评论
  const target = input.replyIssueId ?? s.activeIssueId;
  if (target) {
    await actions.addIssueComment(s.workspaceId, target, s.userId, text);
    const b = await actions.getIssueBrief(s.workspaceId, target);
    return {
      text: `💬 已评论到 ZERO-${b?.number ?? "?"}（${truncate(b?.title ?? "", 20)}）`,
      buttons: statusButtons(target, b?.status),
    };
  }
  return {
    text: "想评论哪个 issue？发 /issues 选一个，或 /use ZERO-12 指定后直接打字。",
  };
}

// 按钮点击
export async function handleChatCallback(
  channel: ChatChannel,
  chatId: string,
  data: string,
): Promise<{ reply: ChatReply; toast?: string }> {
  const s = await resolveSession(channel, chatId);
  if (!s) return { reply: { text: "尚未绑定 Zero。" } };
  const [kind, a, b] = data.split(":");
  if (kind === "o") {
    // 选中 issue
    const id = a;
    s.activeIssueId = id;
    const brief = await actions.getIssueBrief(s.workspaceId, id);
    if (brief) s.activeNumber = brief.number;
    return {
      reply: await briefReply(s, id, "已选中，直接打字即评论它。"),
      toast: "已选中",
    };
  }
  if (kind === "s") {
    // 改状态 s:<status>:<id>
    const status = a as actions.IssueStatus;
    const id = b;
    const r = await actions.setIssueStatus(s.workspaceId, id, s.userId, status);
    const label = actions.STATUS_LABEL[status] ?? status;
    return {
      reply: await briefReply(
        s,
        id,
        r ? `状态已改为「${label}」` : `状态未变（已是「${label}」）`,
      ),
      toast: r ? `→ ${label}` : "未变",
    };
  }
  return { reply: { text: "未知操作。" } };
}
