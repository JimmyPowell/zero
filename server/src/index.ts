import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { config } from "@/config";
import { authRoutes } from "@/routes/auth";
import { workspaceRoutes } from "@/routes/workspaces";
import { issueRoutes } from "@/routes/issues";
import { repoRoutes } from "@/routes/repos";
import { agentRoutes } from "@/routes/agents";
import { runtimeRoutes } from "@/routes/runtimes";
import { daemonRoutes } from "@/routes/daemon";
import { channelRoutes } from "@/routes/channels";
import { startOutboxWorker } from "@/lib/outbox";

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
app.route("/workspaces/:wsId/agents", agentRoutes);
app.route("/workspaces/:wsId/runtimes", runtimeRoutes);
app.route("/workspaces/:wsId/channels", channelRoutes);
app.route("/daemon", daemonRoutes);

// 通知发件箱后台投递
startOutboxWorker();

console.log(`Zero server listening on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
