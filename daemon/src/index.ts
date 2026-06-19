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

const HEARTBEAT_MS = 20_000;
const CLAIM_MS = 5_000;
const PICKER_PORT = 8799; // 本地文件夹选择器（仅 127.0.0.1）
const ZERO_DIR = join(homedir(), ".zero");
const PID_FILE = join(ZERO_DIR, "daemon.pid");
const LOG_FILE = join(ZERO_DIR, "daemon.log");
const WORK_DIR = join(ZERO_DIR, "work"); // 空目录模式
const REPOS_DIR = join(ZERO_DIR, "repos"); // URL 仓库的源 clone 缓存
const WORKTREES_DIR = join(ZERO_DIR, "worktrees"); // 每个 issue 一棵 worktree

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

type WorkSpec =
  | { mode: "repo"; repoUrl: string; baseBranch: string; branch: string }
  | { mode: "dir"; path: string }
  | { mode: "empty" };

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
    work?: WorkSpec;
  };
}

// ---- git / 工作目录准备 ----

async function git(
  args: string[],
  cwd?: string,
): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: process.env,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

function isGitUrl(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(s) || s.endsWith(".git");
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

// 据工作模式准备 cwd：仓库→worktree / 工作目录→就地 / 空目录。失败抛错。
async function prepareWorkdir(work: WorkSpec, issueId: string): Promise<string> {
  if (work.mode === "dir") {
    if (!existsSync(work.path)) throw new Error(`工作目录不存在：${work.path}`);
    return work.path; // 就地
  }
  if (work.mode === "empty") {
    const dir = join(WORK_DIR, issueId);
    ensureDir(dir);
    return dir;
  }
  // mode === "repo" → 隔离 worktree
  let source: string;
  if (isGitUrl(work.repoUrl)) {
    ensureDir(REPOS_DIR);
    source = join(REPOS_DIR, sanitize(work.repoUrl));
    if (!existsSync(source)) {
      const r = await git(["clone", work.repoUrl, source]);
      if (!r.ok) throw new Error(`克隆仓库失败：${r.err || r.out}`);
    } else {
      await git(["fetch", "--all", "--prune"], source); // best-effort
    }
  } else {
    source = work.repoUrl; // 本地仓库路径
    if (!existsSync(source)) throw new Error(`本地仓库不存在：${source}`);
    const chk = await git(["rev-parse", "--git-dir"], source);
    if (!chk.ok) throw new Error(`不是 git 仓库：${source}`);
  }
  // 每个 issue 一棵 worktree：已存在则复用（改动/会话累积），否则新建分支
  const worktreePath = join(WORKTREES_DIR, issueId);
  if (existsSync(worktreePath)) return worktreePath;
  ensureDir(WORKTREES_DIR);
  let r = await git(
    ["worktree", "add", "-b", work.branch, worktreePath, work.baseBranch],
    source,
  );
  if (!r.ok) {
    // 分支已存在 → 直接挂这条分支
    r = await git(["worktree", "add", worktreePath, work.branch], source);
    if (!r.ok) throw new Error(`创建 worktree 失败：${r.err || r.out}`);
  }
  return worktreePath;
}

// ---- 本地文件夹选择器（仅供本机网页调用，弹原生对话框选目录）----

async function pickFolder(): Promise<string | null> {
  if (process.platform !== "darwin") return null; // 目前仅 macOS
  const proc = Bun.spawn({
    cmd: [
      "osascript",
      "-e",
      'POSIX path of (choose folder with prompt "选择工作目录")',
    ],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0 || !out) return null; // 用户取消
  return out.replace(/\/$/, ""); // 去掉尾部斜杠
}

function startPicker() {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
  try {
    Bun.serve({
      port: PICKER_PORT,
      hostname: "127.0.0.1",
      idleTimeout: 255, // 选目录可能停留较久
      async fetch(req) {
        if (req.method === "OPTIONS")
          return new Response(null, { headers: cors });
        const url = new URL(req.url);
        if (url.pathname === "/pick-folder") {
          const path = await pickFolder();
          return Response.json({ path }, { headers: cors });
        }
        return new Response("zero-daemon picker", { headers: cors });
      },
    });
    console.log(`本地选择器：http://127.0.0.1:${PICKER_PORT}`);
  } catch (err) {
    console.error(
      `选择器启动失败（手动输入路径仍可用）：${(err as Error).message}`,
    );
  }
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
  const work = context?.work;
  if (work?.mode === "repo") {
    L.push(
      `\nYou are in a git worktree of repo "${context?.repo?.name ?? ""}" on branch ${work.branch} (based off ${work.baseBranch}). Make the code changes, commit them with git, then end with a concise summary.`,
    );
  } else if (work?.mode === "dir") {
    L.push(
      `\nYou are working directly in the directory ${work.path} (in-place, NOT isolated). Complete the task, then end with a concise summary.`,
    );
  } else {
    L.push(
      "\n(No repo/dir attached yet — respond with your plan / answer, then a concise summary.)",
    );
  }
  return L.join("\n");
}

// 跑 Claude Code（无头），返回最终文本 + 会话 id
async function runClaude(
  prompt: string,
  cwd: string,
  opts: { model?: string | null; sessionId?: string | null },
): Promise<{ ok: boolean; result?: string; sessionId?: string; error?: string }> {
  const cmd = [
    "claude",
    "-p",
    "--output-format",
    "json",
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
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // claude --output-format json 即使出错也常把结构化结果写在 stdout（最后一行）
  let parsed:
    | { result?: string; session_id?: string; is_error?: boolean; subtype?: string }
    | null = null;
  try {
    const last = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    parsed = JSON.parse(last);
  } catch {
    /* 非 JSON 输出 */
  }

  if (code !== 0 || parsed?.is_error) {
    const detail =
      (parsed?.result && parsed.result.trim()) ||
      stderr.trim() ||
      stdout.trim().slice(0, 800) ||
      `claude exited ${code}`;
    console.error(
      `claude 失败 (exit ${code}): ${detail.slice(0, 400)}`,
    );
    return { ok: false, error: String(detail).slice(0, 800) };
  }
  return {
    ok: true,
    result: parsed?.result ?? stdout.slice(0, 4000),
    sessionId: parsed?.session_id,
  };
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
  const issueId = claim.task.issueId;
  const priorSession = claim.task.sessionId;
  const title = claim.context?.issue.title ?? "";
  console.log(`认领任务 ${taskId}（${title}）`);
  try {
    if (claim.agent?.provider !== "claude_code") {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: `provider ${claim.agent?.provider} 暂未支持（当前只接 Claude Code）`,
      });
      return;
    }
    // 准备工作目录（仓库→worktree / 工作目录→就地 / 空目录）；按 issue 固定保证会话可续
    let cwd: string;
    try {
      cwd = await prepareWorkdir(
        claim.context?.work ?? { mode: "empty" },
        issueId,
      );
    } catch (err) {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: `准备工作目录失败：${(err as Error).message}`,
      });
      return;
    }
    const prompt = buildPrompt(claim);
    let r = await runClaude(prompt, cwd, {
      model: claim.agent.model,
      sessionId: priorSession,
    });
    // 会话失效（换目录/过期/被删）→ 新会话重跑；上下文已全在 prompt 里，不失忆
    if (
      !r.ok &&
      priorSession &&
      /no conversation found|session id/i.test(r.error ?? "")
    ) {
      console.log(`会话 ${priorSession} 失效，改用新会话重跑`);
      r = await runClaude(prompt, cwd, { model: claim.agent.model });
    }
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

  startPicker(); // 本地文件夹选择器

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
