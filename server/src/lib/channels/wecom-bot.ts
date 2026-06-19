import AiBot, { generateReqId } from "@wecom/aibot-node-sdk";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { config } from "@/config";

// 企业微信「智能机器人」长连接（官方 @wecom/aibot-node-sdk）。
// - 出站：sendWecomMessage(target, …) 主动推送通知（issue 创建/完成）。
// - 绑定：用户把「设置页生成的一次性绑定码」发给机器人 → 收消息时核对码 →
//   写 channel_binding(kind=wecom, config={target}) 把 Zero 用户 ↔ 企微 userid 关联。
// 单连接 / 单进程；SDK 自带心跳 + 指数退避重连。

type WSClient = InstanceType<typeof AiBot.WSClient>;

let client: WSClient | null = null;
let ready = false;

export function isWecomReady(): boolean {
  return ready;
}

// 待兑换的绑定码：内存暂存（与收消息回调同进程，足够；进程重启仅丢未兑换的码）
const pendingCodes = new Map<
  string,
  { workspaceId: string; userId: string; expiresAt: number }
>();

export function createWecomLinkCode(
  workspaceId: string,
  userId: string,
): string {
  const code = `ZERO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  pendingCodes.set(code, {
    workspaceId,
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 分钟有效
  });
  return code;
}

async function upsertWecomBinding(
  workspaceId: string,
  userId: string,
  target: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.channelBinding.id })
    .from(schema.channelBinding)
    .where(
      and(
        eq(schema.channelBinding.workspaceId, workspaceId),
        eq(schema.channelBinding.userId, userId),
        eq(schema.channelBinding.kind, "wecom"),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(schema.channelBinding)
      .set({ config: { target }, enabled: 1, verifiedAt: new Date() })
      .where(eq(schema.channelBinding.id, existing.id));
  } else {
    await db.insert(schema.channelBinding).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId,
      kind: "wecom",
      config: { target },
      verifiedAt: new Date(),
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reply(frame: any, text: string): Promise<void> {
  try {
    await client?.replyStream(frame, generateReqId("stream"), text, true);
  } catch (e) {
    console.error("[wecom] 回复失败:", e);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleIncoming(frame: any): Promise<void> {
  const content: string = (frame?.body?.text?.content ?? "").trim();
  const userid: string | undefined = frame?.body?.from?.userid;
  const chattype: string | undefined = frame?.body?.chattype;
  const chatid: string | undefined = frame?.body?.chatid;
  const target = chattype === "group" ? chatid : userid;
  if (!target) return;

  // 绑定码兑换
  const entry = pendingCodes.get(content);
  if (entry) {
    pendingCodes.delete(content);
    if (entry.expiresAt < Date.now()) {
      await reply(frame, "⚠️ 绑定码已过期，请回设置页重新生成。");
      return;
    }
    await upsertWecomBinding(entry.workspaceId, entry.userId, target);
    await reply(frame, "✅ 已绑定到 Zero，以后通知会发到这里。");
    console.log(`[wecom] 绑定成功 user=${entry.userId} target=${target}`);
    return;
  }

  // 非绑定码：当前阶段只做主动推送，给个提示（双向回控下一步）
  await reply(
    frame,
    "发送 Zero 设置页里生成的「绑定码」即可关联账号；回控功能即将上线。",
  );
}

export function startWecomBot(): void {
  const { botId, secret } = config.wecom;
  if (!botId || !secret) {
    console.log("[wecom] 未配置 Bot ID/Secret，跳过智能机器人");
    return;
  }
  client = new AiBot.WSClient({ botId, secret });
  client.on("authenticated", () => {
    ready = true;
    console.log("[wecom] 智能机器人长连接已就绪");
  });
  client.on("disconnected", () => {
    ready = false;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on("message.text", (frame: any) => void handleIncoming(frame));
  client.connect();
}

// 主动推送一条 markdown 通知给 target（userid 单聊 / chatid 群聊）
export async function sendWecomMessage(
  target: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!client || !ready) {
    throw new Error("企业微信机器人未就绪（未配置或未连上）");
  }
  const content = `**${subject}**\n${body}`.slice(0, 4000);
  const res = (await client.sendMessage(target, {
    msgtype: "markdown",
    markdown: { content },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as { errcode?: number; errmsg?: string };
  if (res && typeof res.errcode === "number" && res.errcode !== 0) {
    throw new Error(`wecom errcode ${res.errcode}: ${res.errmsg ?? ""}`);
  }
}
