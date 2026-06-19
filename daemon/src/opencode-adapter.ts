// OpenCode provider adapter：把 `opencode run --format json` 的一行 JSON 事件
// 翻译成与 provider 无关的规范化 RunEvent[]（含 text 摘要 + detail 完整内容）。
// 事件 schema 实测自 opencode 1.15.13：
//   {type:"step_start"|"text"|"tool_use"|"step_finish"|"error", sessionID, part:{...}, error?}
//   part(tool): {type:"tool", tool, callID, state:{status,input,output,metadata:{exit,output}}}
//   part(text): {type:"text", text}
// 用量（tokens + cost）在 step_finish.part 里，由 runner 直接读取，这里不产出 usage 事件。

import type { RunEvent } from "./run-events";
import {
  asText,
  capPayload,
  detailCap,
  normalizeToolName,
  preview,
} from "./adapter-util";

function toolCallDetail(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.command === "string") return detailCap(i.command); // bash 等
  try {
    return detailCap(JSON.stringify(i, null, 2));
  } catch {
    return tool;
  }
}

function toolCallSummary(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? "" : String(v));
  if (typeof i.command === "string") return preview(i.command, 200);
  const hint = str(i.filePath ?? i.file_path ?? i.path ?? i.pattern ?? i.query);
  return hint ? `${tool} ${hint}` : tool;
}

export function opencodeAdapter(obj: unknown): RunEvent[] {
  const out: RunEvent[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, any>;
  const part = (o.part ?? {}) as Record<string, any>;

  switch (o.type) {
    case "text": {
      const text = typeof part.text === "string" ? part.text : "";
      if (text.trim()) {
        out.push({
          type: "assistant_text",
          text: preview(text),
          detail: detailCap(text),
          payload: capPayload(part),
        });
      }
      break;
    }

    case "tool_use": {
      const tool = String(part.tool ?? "tool");
      const state = (part.state ?? {}) as Record<string, any>;
      const input = state.input;
      out.push({
        type: "tool_call",
        tool: normalizeToolName(tool),
        toolName: tool,
        text: toolCallSummary(tool, input),
        detail: toolCallDetail(tool, input),
        payload: capPayload({ tool, callID: part.callID, input }),
      });
      // opencode 单条 tool_use 事件即携带结果：state.status=completed 时一并产出 tool_result
      if (state.status === "completed") {
        const meta = (state.metadata ?? {}) as Record<string, any>;
        const output = asText(state.output ?? meta.output ?? "");
        const exit = meta.exit;
        const head = exit != null ? `[exit ${exit}]\n` : "";
        out.push({
          type: "tool_result",
          text: preview(output || `${tool} 完成`),
          detail: detailCap(head + output),
          payload: capPayload({ tool, callID: part.callID, exit }),
        });
      }
      break;
    }

    case "error": {
      const err = (o.error ?? {}) as Record<string, any>;
      const msg =
        err?.data?.message || err?.message || err?.name || "opencode 出错";
      out.push({
        type: "error",
        text: preview(String(msg)),
        detail: detailCap(String(msg)),
        payload: capPayload(o.error ?? null),
      });
      break;
    }

    // step_start：无实质内容（已有 run_started）；step_finish：用量由 runner 读取
    default:
      break;
  }
  return out;
}
