// Zero 本地运行时 daemon
// 用法：
//   zero-daemon start --server <url> --token <token>   后台启动（常驻）
//   zero-daemon status                                  查看状态
//   zero-daemon stop                                    停止
//   zero-daemon run   --server <url> --token <token>    前台运行（调试）
// 职责（B2b）：发现本地编码 Agent CLI → 用配对令牌连上服务端 → 周期心跳。
// 后续（B3）会在此基础上认领 task、在 worktree 里跑 agent、流式回传。

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
const ZERO_DIR = join(homedir(), ".zero");
const PID_FILE = join(ZERO_DIR, "daemon.pid");
const LOG_FILE = join(ZERO_DIR, "daemon.log");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function ensureDir() {
  if (!existsSync(ZERO_DIR)) mkdirSync(ZERO_DIR, { recursive: true });
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

// 发现本地 CLI：在 PATH 中找 claude / codex / opencode
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

// 前台 worker：连服务端 + 心跳。忽略 SIGHUP，使其在终端关闭后仍存活
async function worker() {
  process.on("SIGHUP", () => {});
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

  const timer = setInterval(async () => {
    try {
      await post(server, token, "/daemon/heartbeat", {
        capabilities: discover(),
      });
    } catch (err) {
      console.error(`心跳失败：${(err as Error).message}`);
    }
  }, HEARTBEAT_MS);

  const shutdown = () => {
    clearInterval(timer);
    console.log(`[${new Date().toISOString()}] 已停止。`);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// 后台启动：把 worker 以分离子进程方式拉起，写 pid + 日志
function start() {
  ensureDir();
  const existing = readPid();
  if (existing != null && pidAlive(existing)) {
    console.log(`daemon 已在运行（pid ${existing}）。重启请先 stop。`);
    return;
  }
  const { server, token } = requireConn();
  const out = openSync(LOG_FILE, "a");
  const scriptPath = import.meta.path;
  // 区分「bun 跑脚本」与「编译后单二进制」两种重启自身的方式
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
const sub = SUBS.includes(raw) ? raw : "start"; // 无子命令默认后台启动

if (sub === "stop") stop();
else if (sub === "status") status();
else if (sub === "run") await worker();
else start();
