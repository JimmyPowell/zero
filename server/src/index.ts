import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { config } from "@/config";
import { authRoutes } from "@/routes/auth";
import { workspaceRoutes } from "@/routes/workspaces";
import { issueRoutes } from "@/routes/issues";
import { repoRoutes } from "@/routes/repos";
import { projectRoutes } from "@/routes/projects";
import { knowledgeRoutes } from "@/routes/knowledge";
import { agentRoutes } from "@/routes/agents";
import { skillRoutes } from "@/routes/skills";
import { runtimeRoutes } from "@/routes/runtimes";
import { daemonRoutes } from "@/routes/daemon";
import { channelRoutes } from "@/routes/channels";
import {
  attachmentRoutes,
  attachmentDownloadRoutes,
} from "@/routes/attachments";
import { startOutboxWorker } from "@/lib/outbox";
import { startWakeupWorker } from "@/lib/continuation";
import { startWecomBot } from "@/lib/channels/wecom-bot";
import { startTelegramBot } from "@/lib/channels/telegram-bot";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: config.corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/auth", authRoutes);
app.route("/workspaces", workspaceRoutes);
app.route("/workspaces/:wsId/issues", issueRoutes);
app.route("/workspaces/:wsId/repos", repoRoutes);
app.route("/workspaces/:wsId/projects", projectRoutes);
app.route("/workspaces/:wsId/knowledge", knowledgeRoutes);
app.route("/workspaces/:wsId/agents", agentRoutes);
app.route("/workspaces/:wsId/skills", skillRoutes);
app.route("/workspaces/:wsId/runtimes", runtimeRoutes);
app.route("/workspaces/:wsId/channels", channelRoutes);
app.route("/workspaces/:wsId/attachments", attachmentRoutes);
app.route("/daemon", daemonRoutes);
app.route("/attachments", attachmentDownloadRoutes);

// 通知发件箱后台投递
startOutboxWorker();
// Agent 自触发续跑：扫到点的延时唤醒并点燃（process 看护由 daemon 探活上报）
startWakeupWorker();
// 企业微信智能机器人长连接（配置了 Bot ID/Secret 才启动）
startWecomBot();
// Telegram bot 长轮询（配置了 token 才启动）
startTelegramBot();

console.log(`Zero server listening on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
