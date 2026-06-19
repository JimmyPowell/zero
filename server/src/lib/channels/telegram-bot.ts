import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { config } from "@/config";
import {
  handleChatMessage,
  handleChatCallback,
  type ChatReply,
} from "@/lib/chat/core";

// Telegram bot 渠道（出站推送 + 入站双向回控）。
// - 出站：sendTelegramMessage(chatId, …) 推送通知，附状态按钮。
// - 入站：长轮询 getUpdates；命令/回复/按钮 → 聊天核心 → issue 动作。
// 长轮询出站连接，无需公网回调；国内本机走 config.telegram.proxy。

const API = "https://api.telegram.org";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tgApi(method: string, params: Record<string, any>): Promise<any> {
  const url = `${API}/bot${config.telegram.token}/${method}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  };
  if (config.telegram.proxy) opts.proxy = config.telegram.proxy;
  const res = await fetch(url, opts);
  const data = (await res.json()) as {
    ok: boolean;
    result?: unknown;
    description?: string;
  };
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`);
  return data.result;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 已发通知 messageId → issueId（供「回复通知即评论」）。内存，重启丢失（C1）。
const tgMsgToIssue = new Map<string, string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderKeyboard(buttons?: ChatReply["buttons"]): any {
  if (!buttons || !buttons.length) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.label, callback_data: b.data })),
    ),
  };
}

// 推送通知（带状态按钮 + 记住 msg↔issue 供回复绑定）
export async function sendTelegramMessage(
  chatId: string,
  subject: string,
  body: string,
  opts: { issueId?: string } = {},
): Promise<void> {
  if (!config.telegram.token) throw new Error("Telegram 未配置 token");
  const text = `<b>${esc(subject)}</b>\n${esc(body)}`.slice(0, 4000);
  const reply_markup = opts.issueId
    ? renderKeyboard([
        [
          { label: "✅ 完成", data: `s:done:${opts.issueId}` },
          { label: "🔍 评审", data: `s:in_review:${opts.issueId}` },
        ],
      ])
    : undefined;
  const sent = await tgApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup,
  });
  if (opts.issueId && sent?.message_id != null) {
    tgMsgToIssue.set(`${chatId}:${sent.message_id}`, opts.issueId);
  }
}

// 发送一条聊天回复（命令/按钮结果），纯文本 + 可选按钮
async function sendReply(chatId: number | string, reply: ChatReply): Promise<void> {
  await tgApi("sendMessage", {
    chat_id: chatId,
    text: reply.text,
    reply_markup: renderKeyboard(reply.buttons),
  });
}

// ---- 绑定码 ----
const pendingCodes = new Map<
  string,
  { workspaceId: string; userId: string; expiresAt: number }
>();

export function createTelegramLinkCode(
  workspaceId: string,
  userId: string,
): string {
  const code = `ZERO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  pendingCodes.set(code, {
    workspaceId,
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return code;
}

async function upsertTelegramBinding(
  workspaceId: string,
  userId: string,
  chatId: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.channelBinding.id })
    .from(schema.channelBinding)
    .where(
      and(
        eq(schema.channelBinding.workspaceId, workspaceId),
        eq(schema.channelBinding.userId, userId),
        eq(schema.channelBinding.kind, "telegram"),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(schema.channelBinding)
      .set({ config: { chatId }, enabled: 1, verifiedAt: new Date() })
      .where(eq(schema.channelBinding.id, existing.id));
  } else {
    await db.insert(schema.channelBinding).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId,
      kind: "telegram",
      config: { chatId },
      verifiedAt: new Date(),
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUpdate(u: any): Promise<void> {
  // 按钮点击
  if (u.callback_query) {
    const cbq = u.callback_query;
    const chatId = cbq.message?.chat?.id;
    const data = String(cbq.data ?? "");
    try {
      const { reply, toast } = await handleChatCallback(
        "telegram",
        String(chatId),
        data,
      );
      await tgApi("answerCallbackQuery", {
        callback_query_id: cbq.id,
        text: toast ?? "",
      }).catch(() => {});
      if (chatId != null) await sendReply(chatId, reply);
    } catch (e) {
      console.error("[telegram] 回调处理失败:", (e as Error).message);
    }
    return;
  }

  const msg = u.message;
  const text: string = (msg?.text ?? "").trim();
  const chatId = msg?.chat?.id;
  if (!text || chatId == null) return;

  // 绑定码兑换（/start CODE 或直接发码）
  const codeCandidate = text.startsWith("/start ") ? text.slice(7).trim() : text;
  const entry = pendingCodes.get(codeCandidate);
  if (entry) {
    pendingCodes.delete(codeCandidate);
    if (entry.expiresAt < Date.now()) {
      await tgApi("sendMessage", {
        chat_id: chatId,
        text: "⚠️ 绑定码已过期，请回设置页重新生成。",
      });
      return;
    }
    await upsertTelegramBinding(entry.workspaceId, entry.userId, String(chatId));
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: "✅ 已绑定到 Zero，以后通知会发到这里。发 /help 看能干啥。",
    });
    console.log(`[telegram] 绑定成功 user=${entry.userId} chatId=${chatId}`);
    return;
  }

  // 回复某条通知 → 评论那个 issue
  const replyToId = msg.reply_to_message?.message_id;
  const replyIssueId = replyToId
    ? (tgMsgToIssue.get(`${chatId}:${replyToId}`) ?? null)
    : null;

  try {
    const reply = await handleChatMessage("telegram", String(chatId), {
      text,
      replyIssueId,
    });
    if (reply) await sendReply(chatId, reply);
  } catch (e) {
    console.error("[telegram] 消息处理失败:", (e as Error).message);
  }
}

let running = false;
let offset = 0;
let commandsSet = false;

// 注册命令菜单。在「连上之后」调用并重试，避免启动瞬时抖动导致静默失败。
async function registerCommands(): Promise<void> {
  try {
    await tgApi("setMyCommands", {
      commands: [
        { command: "new", description: "新建 issue（/new 标题，或引导式）" },
        { command: "issues", description: "列出最近 issue 并点选" },
        { command: "search", description: "搜索 issue（/search 关键词）" },
        { command: "use", description: "选中某个 issue（如 /use 12）" },
        { command: "show", description: "看 issue 详情" },
        { command: "comment", description: "评论（/comment 12 文字）" },
        { command: "status", description: "改状态（/status 12 完成）" },
        { command: "priority", description: "改优先级（/priority 12 高）" },
        { command: "assign", description: "指派（/assign 12 agent名|me）" },
        { command: "ws", description: "切换工作空间" },
        { command: "help", description: "帮助" },
      ],
    });
    commandsSet = true;
    console.log("[telegram] 命令菜单已注册");
  } catch (e) {
    console.error("[telegram] setMyCommands 失败（下轮重试）:", (e as Error).message);
  }
}

async function pollLoop(): Promise<void> {
  while (running) {
    try {
      const updates = await tgApi("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      // 连通后再注册命令（成功才置位；失败下轮自动重试）
      if (!commandsSet) await registerCommands();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const u of updates as any[]) {
        offset = u.update_id + 1;
        try {
          await handleUpdate(u);
        } catch (e) {
          console.error("[telegram] 处理更新失败:", (e as Error).message);
        }
      }
    } catch (e) {
      console.error("[telegram] getUpdates 失败:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export function startTelegramBot(): void {
  if (!config.telegram.token) {
    console.log("[telegram] 未配置 TELEGRAM_BOT_TOKEN，跳过");
    return;
  }
  running = true;
  void pollLoop(); // 命令菜单在 pollLoop 连通后注册（带重试）
  console.log(
    `[telegram] 已启动长轮询${config.telegram.proxy ? "（经代理）" : ""}`,
  );
}
