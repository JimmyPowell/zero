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
    case "Agent": // Claude Code 子代理启动工具（新版叫 Agent）
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
    case "Agent": {
      const sub = str(i.subagent_type);
      const desc = str(i.description);
      return `子代理${sub ? ` ${sub}` : ""}${desc ? `：${desc}` : ""}`.trim();
    }
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

// 折叠态预览：压成一行 + 长度上限
function preview(s: string, n = 160): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

// 展开态完整内容上限（防 DB 膨胀；列为 TEXT）
const DETAIL_CAP = 16000;
function detailCap(s: string): string {
  return s.length > DETAIL_CAP
    ? `${s.slice(0, DETAIL_CAP)}\n…（已截断，共 ${s.length} 字）`
    : s;
}

// 工具输入的完整展示：Bash 给命令本身，其它给格式化 JSON 参数
function toolCallDetail(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "Bash" && typeof i.command === "string") return detailCap(i.command);
  try {
    return detailCap(JSON.stringify(i, null, 2));
  } catch {
    return "";
  }
}

// 一行 stream-json → 规范化事件数组
export function claudeAdapter(obj: unknown): RunEvent[] {
  const out: RunEvent[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, any>;
  // 子代理结构化：该流对象若带 parent_tool_use_id，说明它来自某子代理内部（属父 Task/Agent 调用）
  const parentToolUseId =
    typeof o.parent_tool_use_id === "string" ? o.parent_tool_use_id : null;

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
          out.push({
            type: "assistant_text",
            text: preview(b.text),
            detail: detailCap(b.text),
            payload: b,
          });
        } else if (b?.type === "thinking" && b.thinking?.trim()) {
          out.push({
            type: "thinking",
            text: preview(b.thinking),
            detail: detailCap(b.thinking),
            payload: capPayload(b),
          });
        } else if (b?.type === "tool_use") {
          out.push({
            type: "tool_call",
            tool: normalizeTool(b.name),
            toolName: b.name,
            text: toolCallText(b.name, b.input),
            detail: toolCallDetail(b.name, b.input),
            toolUseId: typeof b.id === "string" ? b.id : null, // 子代理据此把内部步骤挂到此调用下
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
          const full = resultText(b.content);
          out.push({
            type: "tool_result",
            text: preview(full),
            detail: detailCap(full),
            payload: capPayload({
              tool_use_id: b.tool_use_id,
              is_error: b.is_error,
            }),
          });
        }
      }
      break;
    }

    case "result": {
      const ms = num(o.duration_ms);
      const cost = num(o.total_cost_usd);
      const u = (o.usage ?? {}) as Record<string, any>;
      const tokenLine = [
        u.input_tokens != null ? `输入 ${u.input_tokens}` : null,
        u.output_tokens != null ? `输出 ${u.output_tokens}` : null,
        u.cache_read_input_tokens != null
          ? `缓存读 ${u.cache_read_input_tokens}`
          : null,
        u.cache_creation_input_tokens != null
          ? `缓存写 ${u.cache_creation_input_tokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      out.push({
        type: "usage",
        text: `用时 ${ms != null ? `${Math.round(ms / 100) / 10}s` : "?"} · ${o.num_turns ?? "?"} 轮${cost != null ? ` · $${cost.toFixed(4)}` : ""}`,
        detail: tokenLine || null,
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
  // 来自子代理内部的事件，统一打上父调用 id（顶层事件不带）
  if (parentToolUseId) for (const e of out) e.parentToolUseId = parentToolUseId;
  return out;
}
