// Zero 上下文 MCP server（stdio · JSON-RPC 2.0 · 换行分隔）。
// §3.1 混合模型的"pull 加深"一端：push 把地板（issue + 最近评论 + work）塞进 prompt，
// 这里给 agent 按需回拉更深上下文的工具。由 daemon 起 claude 时经 --mcp-config 注入，
// 凭运行时令牌读 Zero 服务端（已做工作空间隔离）。被 import 时不自启（import.meta.main 守卫）。

const SERVER = process.env.ZERO_SERVER ?? "";
const TOKEN = process.env.ZERO_TOKEN ?? "";
const ISSUE = process.env.ZERO_ISSUE_ID ?? "";

async function api(path: string): Promise<any> {
  const r = await fetch(`${SERVER}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const t = await r.text();
  const body = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body;
}

const TOOLS = [
  {
    name: "zero_older_comments",
    description:
      "Fetch OLDER comments on THIS issue, beyond the recent window already in your prompt. Use when you need earlier discussion or decisions. Returns comments oldest-first.",
    inputSchema: {
      type: "object",
      properties: {
        before: {
          type: "string",
          description:
            "ISO timestamp cursor; return comments created strictly before it. Omit for the most recent older page.",
        },
        limit: {
          type: "number",
          description: "Max comments to return (default 50, max 200).",
        },
      },
    },
  },
  {
    name: "zero_prior_runs",
    description:
      "List prior agent runs on THIS issue (status, agent, timing, failure reason). Use to see what past runs did or why one failed.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max runs (default 20, max 100)." },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, any>): Promise<string> {
  if (name === "zero_older_comments") {
    const qs = new URLSearchParams();
    if (args.before) qs.set("before", String(args.before));
    if (args.limit) qs.set("limit", String(args.limit));
    const d = await api(`/daemon/issues/${ISSUE}/comments?${qs}`);
    return JSON.stringify(d.comments ?? [], null, 2);
  }
  if (name === "zero_prior_runs") {
    const qs = new URLSearchParams();
    if (args.limit) qs.set("limit", String(args.limit));
    const d = await api(`/daemon/issues/${ISSUE}/runs?${qs}`);
    return JSON.stringify(d.runs ?? [], null, 2);
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export async function handle(msg: any): Promise<void> {
  const { id, method, params } = msg ?? {};
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "zero-context", version: "0.1.0" },
      },
    });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    try {
      const text = await callTool(params.name, params.arguments ?? {});
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `error: ${(e as Error).message}` }],
          isError: true,
        },
      });
    }
  } else if (typeof method === "string" && method.startsWith("notifications/")) {
    // 通知无需响应
  } else if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    });
  }
}

async function main() {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += dec.decode(chunk as Uint8Array, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      await handle(msg);
    }
  }
}

if (import.meta.main) await main();
