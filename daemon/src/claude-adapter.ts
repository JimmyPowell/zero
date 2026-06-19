// Claude Code provider adapter：把 `claude -p --output-format stream-json` 的
// 一行原生 JSON 翻译成与 provider 无关的规范化 RunEvent[]。
// 接 Codex / OpenCode 时各加一个同形态的 adapter，index.ts 按 provider 选用即可。

import type { RunEvent, RunTool } from "./run-events";

// Claude Code 工具名 → 规范化类目
function normalizeTool(name: string): RunTool {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "read";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Write":
      return "write";
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "exec";
    case "Grep":
    case "Glob":
    case "WebSearch":
    case "WebFetch":
      return "search";
    case "Task":
      return "task";
    default:
      return "other";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… (+${s.length - n})` : s;
}

// 限制单条 payload 大小，避免大文件读写撑爆 DB / 网络（原始保真以可读为度）
function capPayload(p: unknown): unknown {
  try {
    const s = JSON.stringify(p);
    if (s.length <= 8000) return p;
    return { truncated: true, bytes: s.length, preview: s.slice(0, 2000) };
  } catch {
    return { truncated: true, note: "unserializable" };
  }
}

// 工具调用的人类可读摘要
function toolCallText(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? "" : String(v));
  switch (name) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return `${name} ${str(i.file_path ?? i.path ?? i.notebook_path)}`.trim();
    case "Bash":
      return i.command ? truncate(str(i.command), 400) : name;
    case "Grep":
      return `Grep ${str(i.pattern)}${i.path ? ` in ${str(i.path)}` : ""}`.trim();
    case "Glob":
      return `Glob ${str(i.pattern)}`.trim();
    case "Task":
      return `Task ${str(i.description ?? i.subagent_type)}`.trim();
    case "WebFetch":
      return `WebFetch ${str(i.url)}`.trim();
    case "WebSearch":
      return `WebSearch ${str(i.query)}`.trim();
    default:
      try {
        return `${name} ${truncate(JSON.stringify(i), 200)}`;
      } catch {
        return name;
      }
  }
}

// tool_result 的内容统一成字符串
function resultText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === "string" ? b : ((b as { text?: string })?.text ?? ""),
      )
      .join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// 一行 stream-json → 规范化事件数组
export function claudeAdapter(obj: unknown): RunEvent[] {
  const out: RunEvent[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, any>;

  switch (o.type) {
    case "system":
      if (o.subtype === "init") {
        const tools = Array.isArray(o.tools) ? o.tools.length : null;
        out.push({
          type: "run_status",
          text: `初始化 · ${o.model ?? "claude"}${tools != null ? ` · ${tools} 个工具` : ""}`,
          payload: capPayload(o),
        });
      }
      break;

    case "assistant": {
      const content = o.message?.content ?? [];
      for (const b of content) {
        if (b?.type === "text" && b.text?.trim()) {
          out.push({ type: "assistant_text", text: b.text, payload: b });
        } else if (b?.type === "thinking" && b.thinking?.trim()) {
          out.push({
            type: "thinking",
            text: truncate(b.thinking, 4000),
            payload: capPayload(b),
          });
        } else if (b?.type === "tool_use") {
          out.push({
            type: "tool_call",
            tool: normalizeTool(b.name),
            toolName: b.name,
            text: toolCallText(b.name, b.input),
            payload: capPayload(b),
          });
        }
      }
      break;
    }

    case "user": {
      const content = o.message?.content ?? [];
      for (const b of content) {
        if (b?.type === "tool_result") {
          out.push({
            type: "tool_result",
            text: truncate(resultText(b.content), 2000),
            payload: capPayload({
              tool_use_id: b.tool_use_id,
              is_error: b.is_error,
              content: truncate(resultText(b.content), 6000),
            }),
          });
        }
      }
      break;
    }

    case "result": {
      const ms = num(o.duration_ms);
      const cost = num(o.total_cost_usd);
      out.push({
        type: "usage",
        text: `用时 ${ms != null ? `${Math.round(ms / 100) / 10}s` : "?"} · ${o.num_turns ?? "?"} 轮${cost != null ? ` · $${cost.toFixed(4)}` : ""}`,
        payload: capPayload({
          usage: o.usage,
          total_cost_usd: o.total_cost_usd,
          duration_ms: o.duration_ms,
          num_turns: o.num_turns,
        }),
      });
      out.push({
        type: o.is_error ? "error" : "run_status",
        text: o.is_error ? `执行出错（${o.subtype ?? "error"}）` : "执行结束",
        payload: capPayload({ subtype: o.subtype, is_error: o.is_error }),
      });
      break;
    }
  }
  return out;
}
