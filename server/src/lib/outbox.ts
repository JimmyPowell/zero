import { and, asc, eq, lte } from "drizzle-orm";

import { db, schema } from "@/db";
import { sendEmail } from "@/lib/channels/email";
import { sendWecomMessage } from "@/lib/channels/wecom-bot";

// 通知发件箱 worker：周期拉取 pending 且到期的行 → 按渠道投递 → 成功置 sent / 失败退避重试。
// 单进程足够（与 run-bus 同哲学）。多实例部署时再加 SKIP LOCKED / 分布式锁。

const BATCH = 20;
let running = false;

type OutboxRow = schema.NotificationOutbox;

async function deliver(row: OutboxRow): Promise<void> {
  const [binding] = await db
    .select()
    .from(schema.channelBinding)
    .where(eq(schema.channelBinding.id, row.bindingId))
    .limit(1);
  if (!binding || binding.enabled !== 1) {
    throw new Error("渠道绑定不存在或已停用");
  }

  if (row.channel === "email") {
    const address = (binding.config as { address?: string })?.address;
    if (!address) throw new Error("email 绑定缺少 address");
    const html = (row.payload as { html?: string } | null)?.html;
    await sendEmail({
      to: address,
      subject: row.subject ?? "",
      text: row.body ?? "",
      html,
    });
    return;
  }
  if (row.channel === "wecom") {
    const target = (binding.config as { target?: string })?.target;
    if (!target) throw new Error("wecom 绑定缺少 target");
    await sendWecomMessage(target, row.subject ?? "", row.body ?? "");
    return;
  }
  // 其它渠道（telegram/feishu/webpush）后续 adapter 补
  throw new Error(`暂不支持的渠道：${row.channel}`);
}

// 跑一轮投递（导出便于测试 / 手动触发）。并发保护：上一轮没跑完就跳过。
export async function flushOutboxOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = await db
      .select()
      .from(schema.notificationOutbox)
      .where(
        and(
          eq(schema.notificationOutbox.status, "pending"),
          lte(schema.notificationOutbox.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(schema.notificationOutbox.nextAttemptAt))
      .limit(BATCH);

    for (const row of rows) {
      try {
        await deliver(row);
        await db
          .update(schema.notificationOutbox)
          .set({
            status: "sent",
            sentAt: new Date(),
            attempts: row.attempts + 1,
          })
          .where(eq(schema.notificationOutbox.id, row.id));
      } catch (err) {
        const attempts = row.attempts + 1;
        const dead = attempts >= row.maxAttempts;
        // 指数退避：30s、1m、2m … 封顶 30m
        const delaySec = Math.min(1800, 30 * 2 ** (attempts - 1));
        await db
          .update(schema.notificationOutbox)
          .set({
            status: dead ? "dead" : "pending",
            attempts,
            nextAttemptAt: new Date(Date.now() + delaySec * 1000),
            lastError: String((err as Error)?.message ?? err).slice(0, 1000),
          })
          .where(eq(schema.notificationOutbox.id, row.id));
        if (dead) {
          console.error(
            `[outbox] 投递最终失败（已达上限 ${row.maxAttempts} 次）id=${row.id}`,
          );
        }
      }
    }
  } catch (err) {
    console.error("[outbox] tick 失败：", err);
  } finally {
    running = false;
  }
}

export function startOutboxWorker(intervalMs = 5000): void {
  setInterval(() => {
    void flushOutboxOnce();
  }, intervalMs);
  console.log(`[outbox] worker 已启动（每 ${intervalMs}ms 一轮）`);
}
