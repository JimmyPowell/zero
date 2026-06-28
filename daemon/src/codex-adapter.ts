// Codex provider adapter：把 `codex exec --json` 的一行 JSON 事件翻译成
// 与 provider 无关的规范化 RunEvent[]（含 text 摘要 + detail 完整内容）。
//
// 事件外壳（codex-cli 0.135.0，实测）：
//   {type:"thread.started", thread_id}
//   {type:"turn.started"} / {type:"turn.completed", usage} / {type:"turn.failed", error:{message}}
//   {type:"item.started"|"item.completed"|"item.updated", item:{id, type, ...}}
//   {type:"error", message}
// item.type（实测）：command_execution / file_change / mcp_tool_call / web_search /
//   agent_message / reasoning / todo_list。command_execution、mcp_tool_call 走 started+completed
//   且同享 item.id（据此配对 toolUseId）；file_change / web_search / agent_message / reasoning
//   只来 completed。用量（turn.completed.usage）与会话 id（thread_id）由 runner 另读；
//   这里也产 usage 事件供时间线展示（与 claude 对齐）。

import type { RunEvent } from "./run-events";
import {
  asText,
  capPayload,
  detailCap,
  normalizeToolName,
  num,
  preview,
} from "./adapter-util";

function pick<T = unknown>(
  o: Record<string, any>,
  ...keys: string[]
): T | undefined {
  for (const k of keys) if (o[k] != null) return o[k] as T;
  return undefined;
}

// file_change 的 changes[] → 「+add a.ts ~update b.ts -delete c.ts」式摘要
function fileChangeSummary(changes: any[]): { text: string; detail: string } {
  const sym = (k: string) =>
    /del|remove/i.test(k) ? "-" : /add|create/i.test(k) ? "+" : "~";
  const lines = changes.map((c) => {
    const path = asText(pick(c, "path", "file", "name") ?? "");
    const kind = String(pick(c, "kind", "type", "change") ?? "update");
    return `${sym(kind)}${kind} ${path}`.trim();
  });
  return {
    text: `${changes.length} 个文件：${lines.slice(0, 4).join(", ")}${lines.length > 4 ? " …" : ""}`,
    detail: lines.join("\n"),
  };
}

function itemEvents(
  item: Record<string, any>,
  phase: "start" | "done" | "update",
): RunEvent[] {
  const type = String(pick(item, "type", "item_type", "itemType") ?? "");
  const id = typeof item.id === "string" ? item.id : null;
  const out: RunEvent[] = [];

  // 命令执行（started + completed，同 id → 配对）
  if (/command|exec|shell/i.test(type)) {
    if (phase === "start") {
      const cmd = asText(pick(item, "command", "cmd") ?? "");
      out.push({
        type: "tool_call",
        tool: "exec",
        toolName: "exec_command",
        text: preview(cmd || "exec_command", 200),
        detail: detailCap(cmd),
        toolUseId: id,
        payload: capPayload(item),
      });
    } else if (phase === "done") {
      const output = asText(
        pick(item, "aggregated_output", "aggregatedOutput", "output") ?? "",
      );
      const exit = pick<number>(item, "exit_code", "exitCode");
      const head = exit != null ? `[exit ${exit}]\n` : "";
      out.push({
        type: "tool_result",
        text: preview(output || "命令完成"),
        detail: detailCap(head + output),
        toolUseId: id,
        payload: capPayload({ exit }),
      });
    }
    return out;
  }

  // 文件改动（只来 completed）：读 changes[]，补一个 tool_call 让「改了哪些文件」在时间线可见
  if (/file.?change|patch/i.test(type)) {
    if (phase === "done") {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const { text, detail } = changes.length
        ? fileChangeSummary(changes)
        : {
            text: "改动已应用",
            detail: asText(pick(item, "diff", "output") ?? "改动已应用"),
          };
      out.push({
        type: "tool_call",
        tool: "edit",
        toolName: "apply_patch",
        text: preview(text, 200),
        detail: detailCap(detail),
        toolUseId: id,
        payload: capPayload(item),
      });
      out.push({
        type: "tool_result",
        text: "改动已应用",
        detail: detailCap(detail),
        toolUseId: id,
        payload: capPayload({ changes: changes.length }),
      });
    }
    return out;
  }

  // MCP 工具调用（started + completed，同 id）
  if (/mcp.?tool/i.test(type)) {
    const server = asText(pick(item, "server") ?? "");
    const tool = asText(pick(item, "tool", "name") ?? "tool");
    const label = server ? `${server}.${tool}` : tool;
    if (phase === "start") {
      let argsText = "";
      try {
        argsText = JSON.stringify(item.arguments ?? {}, null, 2);
      } catch {
        argsText = "";
      }
      out.push({
        type: "tool_call",
        tool: normalizeToolName(tool),
        toolName: `mcp:${label}`,
        text: preview(`MCP ${label}`, 200),
        detail: detailCap(argsText),
        toolUseId: id,
        payload: capPayload(item),
      });
    } else if (phase === "done") {
      const err = pick(item, "error");
      const resText = err
        ? `error: ${asText(err)}`
        : asText(item.result?.content ?? item.result ?? "");
      out.push({
        type: "tool_result",
        text: preview(resText || `${label} 完成`),
        detail: detailCap(resText),
        toolUseId: id,
        payload: capPayload({ server, tool, isError: err != null }),
      });
    }
    return out;
  }

  // 联网搜索（completed）
  if (/web.?search|search/i.test(type)) {
    if (phase === "done") {
      const q = asText(pick(item, "query", "q") ?? "");
      out.push({
        type: "tool_call",
        tool: "search",
        toolName: "web_search",
        text: preview(`WebSearch ${q}`.trim(), 200),
        detail: detailCap(q),
        toolUseId: id,
        payload: capPayload(item),
      });
    }
    return out;
  }

  // 待办 / 计划（completed）
  if (/todo|plan/i.test(type)) {
    if (phase === "done") {
      const items = Array.isArray(item.items) ? item.items : [];
      const lines = items.map((t: any) => {
        const done = pick(t, "completed", "done");
        const txt = asText(pick(t, "text", "title", "content") ?? "");
        return `${done ? "[x]" : "[ ]"} ${txt}`;
      });
      if (lines.length) {
        out.push({
          type: "run_status",
          text: preview(`计划 · ${items.length} 项`),
          detail: detailCap(lines.join("\n")),
          payload: capPayload(item),
        });
      }
    }
    return out;
  }

  // 代理消息（最终/中间回复；只在 completed 出，避免 update 重复）
  if (/agent.?message|assistant|message/i.test(type)) {
    if (phase === "done") {
      const text = asText(pick(item, "text", "message", "content") ?? "");
      if (text.trim()) {
        out.push({
          type: "assistant_text",
          text: preview(text),
          detail: detailCap(text),
          payload: capPayload(item),
        });
      }
    }
    return out;
  }

  // 推理 / 思考（只在 completed 出，避免 streaming update 重复刷屏）
  if (/reason|think/i.test(type)) {
    if (phase === "done") {
      const text = asText(pick(item, "text", "content") ?? "");
      if (text.trim()) {
        out.push({
          type: "thinking",
          text: preview(text),
          detail: detailCap(text),
          payload: capPayload(item),
        });
      }
    }
    return out;
  }

  return out;
}

// turn.completed.usage → 时间线 usage 事件（codex 经 ChatGPT 订阅，无单价/时长，只列 token）
function codexUsageEvent(o: Record<string, any>): RunEvent | null {
  const u = (o.usage ?? o.turn?.usage ?? {}) as Record<string, any>;
  const input = num(pick(u, "input_tokens", "input", "prompt_tokens"));
  const cached = num(pick(u, "cached_input_tokens", "cache_read_tokens"));
  const output = num(pick(u, "output_tokens", "output", "completion_tokens"));
  const reasoning = num(u.reasoning_output_tokens);
  const line = [
    input != null ? `输入 ${input}` : null,
    output != null ? `输出 ${output}` : null,
    reasoning != null ? `推理 ${reasoning}` : null,
    cached != null ? `缓存读 ${cached}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!line) return null;
  return {
    type: "usage",
    text: line,
    detail: line,
    payload: capPayload({ usage: u }),
  };
}

export function codexAdapter(obj: unknown): RunEvent[] {
  const out: RunEvent[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, any>;
  const item = (o.item ?? {}) as Record<string, any>;

  switch (o.type) {
    case "thread.started":
      if (o.thread_id)
        out.push({
          type: "run_status",
          text: "初始化 · codex",
          payload: capPayload({ thread_id: o.thread_id }),
        });
      break;

    case "item.started":
      return itemEvents(item, "start");
    case "item.completed":
      return itemEvents(item, "done");
    case "item.updated":
      return itemEvents(item, "update");

    case "turn.completed": {
      const u = codexUsageEvent(o);
      if (u) out.push(u);
      out.push({
        type: "run_status",
        text: "执行结束",
        payload: capPayload({ usage: o.usage }),
      });
      break;
    }

    case "turn.failed": {
      const msg = asText(o.error?.message ?? o.error ?? "codex turn failed");
      out.push({
        type: "error",
        text: preview(msg),
        detail: detailCap(msg),
        payload: capPayload(o.error ?? null),
      });
      break;
    }

    case "error": {
      const msg = asText(o.message ?? "codex error");
      // 「Reconnecting…」是可恢复的重连提示，降级为状态而非错误
      const reconnecting = /reconnect/i.test(msg);
      out.push({
        type: reconnecting ? "run_status" : "error",
        text: preview(msg),
        detail: detailCap(msg),
        payload: capPayload(o),
      });
      break;
    }

    // turn.started：无实质内容（已有 run_started）
    default:
      break;
  }
  return out;
}
