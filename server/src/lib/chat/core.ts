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
  // 多步流程（/new 引导式）
  flow?: { kind: "new"; step: "title" | "desc"; draft: { title?: string } };
};
const sessions = new Map<string, Session>();

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function parseNum(s: string): number | null {
  const m = s.trim().match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

const STATUS_ALIASES: Record<string, actions.IssueStatus> = {
  done: "done", 完成: "done", 已完成: "done",
  review: "in_review", in_review: "in_review", 评审: "in_review", 待评审: "in_review",
  progress: "in_progress", in_progress: "in_progress", doing: "in_progress", 进行中: "in_progress",
  todo: "todo", 待办: "todo",
  backlog: "backlog", 待办池: "backlog",
  cancel: "cancelled", cancelled: "cancelled", 取消: "cancelled", 已取消: "cancelled",
};
const PRIORITY_ALIASES: Record<string, actions.IssuePriority> = {
  urgent: "urgent", 紧急: "urgent",
  high: "high", 高: "high",
  medium: "medium", 中: "medium",
  low: "low", 低: "low",
  none: "none", 无: "none",
};
function parseStatus(w?: string): actions.IssueStatus | null {
  return w ? (STATUS_ALIASES[w.toLowerCase()] ?? null) : null;
}
function parsePriority(w?: string): actions.IssuePriority | null {
  return w ? (PRIORITY_ALIASES[w.toLowerCase()] ?? null) : null;
}

// 解析「[ZERO-N] 其余…」：首 token 是 issue 引用则取它，否则用活动 issue
async function pickIssue(
  s: Session,
  tokens: string[],
): Promise<{ issueId?: string; number?: number; rest: string[]; error?: string }> {
  if (tokens.length && /^(?:zero-|#)?\d+$/i.test(tokens[0])) {
    const n = Number(tokens[0].replace(/\D/g, ""));
    const iss = await actions.findIssueByNumber(s.workspaceId, n);
    if (!iss) return { rest: tokens.slice(1), error: `找不到 ZERO-${n}` };
    return { issueId: iss.id, number: iss.number, rest: tokens.slice(1) };
  }
  if (!s.activeIssueId)
    return { rest: tokens, error: "未指定 issue：带上 ZERO-12，或先 /use 选中。" };
  return { issueId: s.activeIssueId, number: s.activeNumber, rest: tokens };
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
  "Zero 聊天指挥：",
  "· /new <标题> — 新建（或 /new 引导式）",
  "· /issues、/search <词> — 列表 / 搜索",
  "· /use ZERO-12 — 选中",
  "· /show [ZERO-12] — 详情",
  "· /comment [ZERO-12] <文字> — 评论",
  "· /status [ZERO-12] <完成|评审|进行中|待办|取消>",
  "· /priority [ZERO-12] <紧急|高|中|低|无>",
  "· /assign [ZERO-12] <agent名|me> — 指派",
  "· /ws — 切换工作空间",
  "选中后直接打字即评论它；回复通知也能评论那条。",
].join("\n");

async function handleFlow(s: Session, text: string): Promise<ChatReply> {
  const f = s.flow;
  if (!f) return { text: "" };
  if (f.kind === "new") {
    if (f.step === "title") {
      f.draft.title = text;
      f.step = "desc";
      return { text: `标题：${text}\n请输入描述（发「-」跳过）。` };
    }
    const desc = text === "-" ? null : text;
    const title = f.draft.title ?? text;
    s.flow = undefined;
    const iss = await actions.createIssue(s.workspaceId, s.userId, {
      title,
      description: desc,
    });
    s.activeIssueId = iss.id;
    s.activeNumber = iss.number;
    return briefReply(s, iss.id, `✅ 已创建 ZERO-${iss.number}`);
  }
  s.flow = undefined;
  return { text: "已重置。" };
}

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
    case "/cancel":
      if (s.flow) {
        s.flow = undefined;
        return { text: "已取消当前操作。" };
      }
      return { text: "没有进行中的操作。" };
    case "/new": {
      if (arg.trim()) {
        const iss = await actions.createIssue(s.workspaceId, s.userId, {
          title: arg.trim(),
        });
        s.activeIssueId = iss.id;
        s.activeNumber = iss.number;
        return briefReply(s, iss.id, `✅ 已创建 ZERO-${iss.number}`);
      }
      s.flow = { kind: "new", step: "title", draft: {} };
      return { text: "新建 issue：请输入标题。（/cancel 取消）" };
    }
    case "/search": {
      if (!arg.trim()) return { text: "用法：/search 关键词" };
      const list = await actions.searchIssues(s.workspaceId, arg.trim());
      if (!list.length) return { text: `没有匹配「${arg.trim()}」的 issue。` };
      return {
        text: `搜索「${arg.trim()}」：`,
        buttons: list.map((i) => [
          { label: `ZERO-${i.number} ${truncate(i.title, 24)}`, data: `o:${i.id}` },
        ]),
      };
    }
    case "/comment": {
      const p = await pickIssue(s, rest);
      if (p.error || !p.issueId) return { text: p.error ?? "未指定 issue" };
      const body = p.rest.join(" ").trim();
      if (!body) return { text: "用法：/comment ZERO-12 评论内容" };
      await actions.addIssueComment(s.workspaceId, p.issueId, s.userId, body);
      const b = await actions.getIssueBrief(s.workspaceId, p.issueId);
      return {
        text: `💬 已评论到 ZERO-${b?.number}`,
        buttons: statusButtons(p.issueId, b?.status),
      };
    }
    case "/status": {
      const p = await pickIssue(s, rest);
      if (p.error || !p.issueId) return { text: p.error ?? "未指定 issue" };
      const st = parseStatus(p.rest[0]);
      if (!st)
        return { text: "用法：/status ZERO-12 完成|评审|进行中|待办|取消" };
      const r = await actions.setIssueStatus(s.workspaceId, p.issueId, s.userId, st);
      return briefReply(
        s,
        p.issueId,
        r ? `状态已改为「${actions.STATUS_LABEL[st]}」` : "状态未变",
      );
    }
    case "/priority": {
      const p = await pickIssue(s, rest);
      if (p.error || !p.issueId) return { text: p.error ?? "未指定 issue" };
      const pr = parsePriority(p.rest[0]);
      if (!pr) return { text: "用法：/priority ZERO-12 紧急|高|中|低|无" };
      const r = await actions.setIssuePriority(s.workspaceId, p.issueId, s.userId, pr);
      return briefReply(
        s,
        p.issueId,
        r ? `优先级已改为「${actions.PRIORITY_LABEL[pr]}」` : "优先级未变",
      );
    }
    case "/assign": {
      const p = await pickIssue(s, rest);
      if (p.error || !p.issueId) return { text: p.error ?? "未指定 issue" };
      const who = p.rest[0];
      const agents = await actions.listAgents(s.workspaceId);
      const agentNames = agents.map((a) => a.name).join("、") || "（无）";
      if (!who)
        return { text: `用法：/assign ZERO-12 <agent名|me>。可选：${agentNames}` };
      if (who.toLowerCase() === "me" || who === "我") {
        const name = (await actions.getUserName(s.userId)) ?? "我";
        await actions.assignIssue(s.workspaceId, p.issueId, s.userId, {
          type: "member",
          id: s.userId,
          name,
        });
        return briefReply(s, p.issueId, `已指派给 ${name}`);
      }
      const ag = await actions.findAgentByName(s.workspaceId, who);
      if (!ag) return { text: `找不到 agent「${who}」。可选：${agentNames}` };
      await actions.assignIssue(s.workspaceId, p.issueId, s.userId, {
        type: "agent",
        id: ag.id,
        name: ag.name,
      });
      return briefReply(s, p.issueId, `已指派给 ${ag.name}（agent），将自动执行。`);
    }
    case "/ws": {
      const wss = await actions.listWorkspacesForUser(s.userId);
      if (wss.length <= 1) return { text: "你只有一个工作空间。" };
      return {
        text: "切换工作空间：",
        buttons: wss.map((w) => [{ label: w.name, data: `w:${w.id}` }]),
      };
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
  // 多步流程优先：流程进行中且非命令文本 → 喂给流程
  if (s.flow && !text.startsWith("/")) return handleFlow(s, text);
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
  if (kind === "w") {
    // 切换工作空间 w:<wsId>
    const wsId = a;
    if (!(await actions.isWorkspaceMember(s.userId, wsId)))
      return { reply: { text: "无权切换到该工作空间。" } };
    s.workspaceId = wsId;
    s.activeIssueId = undefined;
    s.activeNumber = undefined;
    return {
      reply: { text: "已切换工作空间。发 /issues 看该空间的 issue。" },
      toast: "已切换",
    };
  }
  return { reply: { text: "未知操作。" } };
}
