// Zero 上下文 MCP server（stdio · JSON-RPC 2.0 · 换行分隔）。
// §3.1 混合模型的"pull 加深"一端：push 把地板（issue + 最近评论 + work）塞进 prompt，
// 这里给 agent 按需回拉更深上下文的工具。由 daemon 起 claude 时经 --mcp-config 注入，
// 凭运行时令牌读 Zero 服务端（已做工作空间隔离）。被 import 时不自启（import.meta.main 守卫）。

const SERVER = process.env.ZERO_SERVER ?? "";
const TOKEN = process.env.ZERO_TOKEN ?? "";
const ISSUE = process.env.ZERO_ISSUE_ID ?? "";
const TASK = process.env.ZERO_TASK_ID ?? "";

async function api(path: string, reqBody?: unknown): Promise<any> {
  const r = await fetch(`${SERVER}${path}`, {
    method: reqBody !== undefined ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(reqBody !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: reqBody !== undefined ? JSON.stringify(reqBody) : undefined,
  });
  const t = await r.text();
  const body = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body;
}

// POST：不在非 2xx 时抛（让工具读 body.ok/body.error 给 agent 友好提示）
async function apiPost(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
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
  {
    name: "zero_wake_me",
    description:
      "Schedule yourself to be re-invoked after a delay to continue THIS issue. This run is NON-INTERACTIVE and single-shot: when you end your turn the run ENDS and you are NOT automatically resumed. If you need to wait for something (a long task, a timer) and then continue or report, call this BEFORE ending — you resume with full session memory. Do NOT sleep or busy-wait. Delay range 5–3600 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        after_sec: {
          type: "number",
          description: "Seconds from now to wake you (5–3600).",
        },
        note: {
          type: "string",
          description:
            "Short reminder to yourself of why you're waking / what to do on wake.",
        },
      },
      required: ["after_sec"],
    },
  },
  {
    name: "zero_watch_pid",
    description:
      "Register a background process (by PID) to watch; when it exits you'll be re-invoked to continue THIS issue. To start a job that OUTLIVES this single-shot run, launch it with the provided `zero-bg` helper (NOT a bare `&`/setsid, which gets killed at run end): `pid=$(zero-bg 'your long command' /tmp/job.log)`, then pass that PID here. Without this you will NOT be called back when the job finishes. (Exit code isn't captured — re-check results/log yourself on wake.)",
    inputSchema: {
      type: "object",
      properties: {
        pid: {
          type: "number",
          description: "PID of the detached background process to watch.",
        },
        note: {
          type: "string",
          description:
            "Short reminder of what the process does / what to do when it finishes.",
        },
      },
      required: ["pid"],
    },
  },
  {
    name: "zero_search_knowledge",
    description:
      "Search the TEAM KNOWLEDGE BASE (conventions, decisions, gotchas, runbooks) for this workspace. Use when you need team-specific rules/context not already in your prompt. Returns matching docs with snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for (keywords)." },
      },
      required: ["query"],
    },
  },
  {
    name: "zero_write_knowledge",
    description:
      "Save a durable note to the TEAM KNOWLEDGE BASE (a convention, decision, gotcha or runbook worth remembering across issues). Use when the user asks to remember/沉淀 something, or when you discover a reusable rule. Defaults to this issue's project.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Doc path ending in .md, e.g. decisions/auth.md or gotchas/staging-db.md",
        },
        content: {
          type: "string",
          description: "Markdown content; a few sentences, start with a # title.",
        },
        pinned: {
          type: "boolean",
          description:
            "If true, always inject into future agent runs. Use sparingly, only for core always-apply rules.",
        },
      },
      required: ["path", "content"],
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
  if (name === "zero_wake_me") {
    const afterSec = Number(args.after_sec ?? args.afterSec);
    if (!Number.isFinite(afterSec)) throw new Error("after_sec 必填（秒）");
    const d = await apiPost(`/daemon/issues/${ISSUE}/wake`, {
      afterSec,
      note: args.note,
      taskId: TASK || undefined,
    });
    if (d?.ok)
      return `已安排：约 ${d.afterSec}s 后自动唤醒你继续本 issue（${d.fireAt}）。现在结束本轮 run 即可——届时你会带着完整会话记忆被重新拉起。`;
    return `登记失败：${d?.error ?? "未知错误"}`;
  }
  if (name === "zero_watch_pid") {
    const pid = Number(args.pid);
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error("pid 必须是正整数");
    const d = await apiPost(`/daemon/issues/${ISSUE}/watch`, {
      pid,
      note: args.note,
      taskId: TASK || undefined,
    });
    if (d?.ok)
      return `已登记看护 PID ${pid}：它结束后自动唤醒你继续。注意该进程须脱离本会话（setsid/nohup/disown）才能在本轮 run 结束后存活；现在结束本轮 run 即可。`;
    return `登记失败：${d?.error ?? "未知错误"}`;
  }
  if (name === "zero_search_knowledge") {
    const qs = new URLSearchParams();
    qs.set("q", String(args.query ?? ""));
    const d = await api(`/daemon/issues/${ISSUE}/knowledge?${qs}`);
    return JSON.stringify(d.hits ?? [], null, 2);
  }
  if (name === "zero_write_knowledge") {
    const d = await api(`/daemon/issues/${ISSUE}/knowledge/write`, {
      path: args.path,
      content: args.content,
      pinned: args.pinned,
    });
    return `saved: ${d.path}`;
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
