import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { config } from "@/config";

// Telegram bot 渠道。
// - 出站：sendTelegramMessage(chatId, …) 推送通知（issue 创建/完成）。
// - 入站：长轮询 getUpdates 收消息；用「绑定码」把 Zero 用户 ↔ telegram chatId 关联。
// 长轮询是出站连接，无需公网回调；国内本机直连不了 Telegram 时走 config.telegram.proxy。

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
  if (config.telegram.proxy) opts.proxy = config.telegram.proxy; // Bun fetch 支持 proxy
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

export async function sendTelegramMessage(
  chatId: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!config.telegram.token) throw new Error("Telegram 未配置 token");
  const text = `<b>${esc(subject)}</b>\n${esc(body)}`.slice(0, 4000);
  await tgApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// ---- 绑定码（内存暂存，与长轮询同进程）----
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
  const msg = u?.message;
  const text: string = (msg?.text ?? "").trim();
  const chatId = msg?.chat?.id;
  if (!text || chatId == null) return;

  // 支持 "/start CODE" 深链 或 直接发码
  const code = text.startsWith("/start ") ? text.slice(7).trim() : text;
  const entry = pendingCodes.get(code);
  if (entry) {
    pendingCodes.delete(code);
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
      text: "✅ 已绑定到 Zero，以后通知会发到这里。",
    });
    console.log(`[telegram] 绑定成功 user=${entry.userId} chatId=${chatId}`);
    return;
  }
  await tgApi("sendMessage", {
    chat_id: chatId,
    text: "发送 Zero 设置页里生成的「绑定码」即可关联账号；回控功能即将上线。",
  });
}

let running = false;
let offset = 0;

async function pollLoop(): Promise<void> {
  while (running) {
    try {
      const updates = await tgApi("getUpdates", { offset, timeout: 25 });
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
      await new Promise((r) => setTimeout(r, 3000)); // 退避
    }
  }
}

export function startTelegramBot(): void {
  if (!config.telegram.token) {
    console.log("[telegram] 未配置 TELEGRAM_BOT_TOKEN，跳过");
    return;
  }
  running = true;
  void pollLoop();
  console.log(
    `[telegram] 已启动长轮询${config.telegram.proxy ? "（经代理）" : ""}`,
  );
}
