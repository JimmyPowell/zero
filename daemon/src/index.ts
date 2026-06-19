// Zero 本地运行时 daemon
// 职责（B2b）：发现本地编码 Agent CLI → 用配对令牌连上服务端 → 周期心跳。
// 后续（B3）会在此基础上认领 task、在 worktree 里跑 agent、流式回传。

const HEARTBEAT_MS = 20_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const server = (
  arg("server") ??
  process.env.ZERO_SERVER ??
  "http://localhost:8787"
).replace(/\/$/, "");
const token = arg("token") ?? process.env.ZERO_TOKEN;

if (!token) {
  console.error(
    "缺少令牌。用法：zero-daemon --server <url> --token <token>\n" +
      "（或设置环境变量 ZERO_SERVER / ZERO_TOKEN）",
  );
  process.exit(1);
}

// 发现本地 CLI：在 PATH 中找 claude / codex / opencode
function discover(): Record<string, boolean> {
  return {
    claude_code: Bun.which("claude") != null,
    codex: Bun.which("codex") != null,
    opencode: Bun.which("opencode") != null,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} → ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

function enabled(caps: Record<string, boolean>): string {
  const on = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length ? on.join(", ") : "（未发现任何 CLI）";
}

async function main() {
  const caps = discover();
  console.log(`Zero daemon → ${server}`);
  console.log(`发现工具：${enabled(caps)}`);

  let info: { runtimeId: string; workspaceId: string; name: string };
  try {
    info = await post("/daemon/hello", { capabilities: caps });
  } catch (err) {
    console.error(`连接失败：${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`已连接：${info.name}（runtime ${info.runtimeId}）`);
  console.log("保持心跳中… Ctrl+C 退出");

  const timer = setInterval(async () => {
    try {
      await post("/daemon/heartbeat", { capabilities: discover() });
    } catch (err) {
      console.error(`心跳失败：${(err as Error).message}`);
    }
  }, HEARTBEAT_MS);

  const stop = () => {
    clearInterval(timer);
    console.log("\n已停止。");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

void main();
