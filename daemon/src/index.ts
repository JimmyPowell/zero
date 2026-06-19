// Zero 本地运行时 daemon
// 用法：
//   zero-daemon start --server <url> --token <token>   后台启动（常驻）
//   zero-daemon status / stop                           状态 / 停止
//   zero-daemon run   --server <url> --token <token>    前台运行（调试）
// 职责：发现本地编码 Agent CLI → 配对令牌连服务端 → 心跳 →
//       认领 task → 跑 agent（B3.2：Claude Code）→ 回传结果。

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { claudeAdapter } from "./claude-adapter";
import { makeReporter, type Reporter } from "./reporter";
import type { OutgoingRunEvent } from "./run-events";

const HEARTBEAT_MS = 20_000;
const CLAIM_MS = 5_000;
const ZERO_DIR = join(homedir(), ".zero");
const PID_FILE = join(ZERO_DIR, "daemon.pid");
const LOG_FILE = join(ZERO_DIR, "daemon.log");
const WORK_DIR = join(ZERO_DIR, "work");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const n = Number(readFileSync(PID_FILE, "utf8").trim());
  return Number.isFinite(n) ? n : null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requireConn(): { server: string; token: string } {
  const server = (
    arg("server") ??
    process.env.ZERO_SERVER ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  const token = arg("token") ?? process.env.ZERO_TOKEN;
  if (!token) {
    console.error("缺少令牌：--token <token>（或环境变量 ZERO_TOKEN）");
    process.exit(1);
  }
  return { server, token };
}

function discover(): Record<string, boolean> {
  return {
    claude_code: Bun.which("claude") != null,
    codex: Bun.which("codex") != null,
    opencode: Bun.which("opencode") != null,
  };
}

async function post<T>(
  server: string,
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function enabled(caps: Record<string, boolean>): string {
  const on = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length ? on.join(", ") : "（未发现任何 CLI）";
}

// ---- 任务执行 ----

interface Claim {
  task: { id: string; issueId: string; sessionId: string | null } | null;
  agent?: {
    name: string;
    provider: string;
    model: string | null;
    instructions: string | null;
  };
  context?: {
    issue: { number: number; title: string; description: string | null };
    comments: { author: string; body: string | null }[];
    repo: {
      name: string;
      url: string;
      baseBranch: string;
    } | null;
  };
}

// 把服务端装配好的上下文拼成给 agent 的 prompt
function buildPrompt(claim: Claim): string {
  const { agent, context } = claim;
  const L: string[] = [];
  L.push(`You are "${agent?.name}", an agent on the Zero platform.`);
  if (agent?.instructions) L.push(agent.instructions);
  L.push("");
  L.push(`# Issue ZERO-${context?.issue.number}: ${context?.issue.title}`);
  if (context?.issue.description) L.push(context.issue.description);
  if (context?.comments.length) {
    L.push("\n## Conversation so far");
    for (const cm of context.comments) L.push(`- ${cm.author}: ${cm.body ?? ""}`);
  }
  if (context?.repo) {
    L.push(
      `\nRepository: ${context.repo.name} (${context.repo.url}), base branch ${context.repo.baseBranch}.`,
    );
  } else {
    L.push("\n(No repository attached yet — respond with your plan / answer.)");
  }
  L.push(
    "\nComplete the task, then end with a concise summary of what you did.",
  );
  return L.join("\n");
}

// 跑 Claude Code（无头，流式）：逐行解析 stream-json，经 adapter 规范化后
// 通过 reporter 实时上报执行流；返回最终文本 + 会话 id（供 complete 回传）。
async function runClaude(
  prompt: string,
  cwd: string,
  opts: { model?: string | null; sessionId?: string | null },
  reporter: Reporter,
): Promise<{ ok: boolean; result?: string; sessionId?: string; error?: string }> {
  const cmd = [
    "claude",
    "-p",
    "--output-format",
    "stream-json",
    "--verbose", // stream-json 配合 -p 必须带 --verbose
    "--dangerously-skip-permissions",
  ];
  if (opts.model) cmd.push("--model", opts.model);
  if (opts.sessionId) cmd.push("--resume", opts.sessionId);

  const proc = Bun.spawn({
    cmd,
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: process.env,
  });

  let seq = 0;
  let result: string | undefined;
  let sessionId: string | undefined;
  let isError = false;

  const handleLine = (line: string) => {
    let obj: Record<string, any>;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // 非 JSON 行跳过
    }
    // 捕获最终结果 / 会话 id
    if (obj.type === "system" && obj.subtype === "init" && obj.session_id) {
      sessionId ??= obj.session_id;
    }
    if (obj.type === "result") {
      if (typeof obj.result === "string") result = obj.result;
      if (obj.session_id) sessionId = obj.session_id;
      if (obj.is_error) isError = true;
    }
    for (const e of claudeAdapter(obj)) {
      reporter.push({ ...e, seq: seq++ } satisfies OutgoingRunEvent);
    }
  };

  // 逐行读 stdout（stream-json 为换行分隔的 JSON）
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  const stderrPromise = new Response(proc.stderr).text();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());

  const [stderr, code] = await Promise.all([stderrPromise, proc.exited]);

  if (code !== 0 || isError) {
    const detail =
      (result && result.trim()) || stderr.trim() || `claude exited ${code}`;
    console.error(`claude 失败 (exit ${code}): ${detail.slice(0, 400)}`);
    return {
      ok: false,
      result,
      sessionId,
      error: String(detail).slice(0, 800),
    };
  }
  return { ok: true, result: result ?? "", sessionId };
}

let busy = false;

async function tick(server: string, token: string) {
  if (busy) return;
  let claim: Claim;
  try {
    claim = await post<Claim>(server, token, "/daemon/tasks/claim", {});
  } catch (err) {
    console.error(`认领失败：${(err as Error).message}`);
    return;
  }
  if (!claim.task) return;

  busy = true;
  const taskId = claim.task.id;
  const title = claim.context?.issue.title ?? "";
  console.log(`认领任务 ${taskId}（${title}）`);
  try {
    if (claim.agent?.provider !== "claude_code") {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: `provider ${claim.agent?.provider} 暂未支持（当前只接 Claude Code）`,
      });
      return;
    }
    const cwd = join(WORK_DIR, taskId);
    ensureDir(cwd);
    const reporter = makeReporter(async (events) => {
      await post(server, token, `/daemon/tasks/${taskId}/events`, { events });
    });
    const r = await runClaude(
      buildPrompt(claim),
      cwd,
      { model: claim.agent.model, sessionId: claim.task.sessionId },
      reporter,
    );
    await reporter.flush(); // 收尾，确保尾部事件全部送达
    if (r.ok) {
      await post(server, token, `/daemon/tasks/${taskId}/complete`, {
        summary: r.result,
        sessionId: r.sessionId,
      });
      console.log(`任务 ${taskId} 完成`);
    } else {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: r.error,
      });
      console.log(`任务 ${taskId} 失败：${r.error}`);
    }
  } catch (err) {
    try {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: (err as Error).message,
      });
    } catch {
      /* 上报失败也忽略 */
    }
  } finally {
    busy = false;
  }
}

// 前台 worker：连服务端 + 心跳 + 认领执行。忽略 SIGHUP，关终端不退
async function worker() {
  process.on("SIGHUP", () => {});
  ensureDir(WORK_DIR);
  const { server, token } = requireConn();
  const caps = discover();
  console.log(`[${new Date().toISOString()}] Zero daemon → ${server}`);
  console.log(`发现工具：${enabled(caps)}`);

  let info: { runtimeId: string; workspaceId: string; name: string };
  try {
    info = await post(server, token, "/daemon/hello", { capabilities: caps });
  } catch (err) {
    console.error(`连接失败：${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`已连接：${info.name}（runtime ${info.runtimeId}）`);

  const hb = setInterval(async () => {
    try {
      await post(server, token, "/daemon/heartbeat", {
        capabilities: discover(),
      });
    } catch (err) {
      console.error(`心跳失败：${(err as Error).message}`);
    }
  }, HEARTBEAT_MS);

  const claimer = setInterval(() => void tick(server, token), CLAIM_MS);

  const shutdown = () => {
    clearInterval(hb);
    clearInterval(claimer);
    console.log(`[${new Date().toISOString()}] 已停止。`);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---- 进程生命周期 ----

function start() {
  ensureDir(ZERO_DIR);
  const existing = readPid();
  if (existing != null && pidAlive(existing)) {
    console.log(`daemon 已在运行（pid ${existing}）。重启请先 stop。`);
    return;
  }
  const { server, token } = requireConn();
  const out = openSync(LOG_FILE, "a");
  const scriptPath = import.meta.path;
  const cmd = existsSync(scriptPath)
    ? [process.execPath, scriptPath, "run", "--server", server, "--token", token]
    : [process.execPath, "run", "--server", server, "--token", token];

  const child = Bun.spawn({
    cmd,
    stdout: out,
    stderr: out,
    stdin: "ignore",
    env: { ...process.env },
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  console.log(`已在后台启动（pid ${child.pid}）`);
  console.log(`日志：${LOG_FILE}`);
  console.log(`查看状态：zero-daemon status　停止：zero-daemon stop`);
}

function stop() {
  const pid = readPid();
  if (pid == null) {
    console.log("daemon 未在运行。");
    return;
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* 已退出 */
    }
    console.log(`已停止 daemon（pid ${pid}）。`);
  } else {
    console.log("daemon 未在运行（清理残留 pid 文件）。");
  }
  try {
    rmSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function status() {
  const pid = readPid();
  if (pid != null && pidAlive(pid)) {
    console.log(`运行中（pid ${pid}）　日志：${LOG_FILE}`);
    return;
  }
  if (pid != null) {
    try {
      rmSync(PID_FILE);
    } catch {
      /* ignore */
    }
  }
  console.log("未运行。");
}

const SUBS = ["start", "stop", "status", "run"];
const raw = process.argv[2] ?? "";
const sub = SUBS.includes(raw) ? raw : "start";

if (sub === "stop") stop();
else if (sub === "status") status();
else if (sub === "run") await worker();
else start();
