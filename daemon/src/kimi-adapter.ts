// Kimi CLI provider adapter：把 `kimi --print --output-format stream-json` 的一行 JSON
// 翻译成与 provider 无关的规范化 RunEvent[]（text 摘要 + detail 完整内容）。
// 事件 schema 实测自 kimi-cli 1.47.0（OpenAI-chat 风格，逐条消息）：
//   {role:"assistant", content:""|[{type:"text",text}], reasoning_content?,
//    tool_calls?:[{type:"function", id, function:{name, arguments(JSON 字符串)}}]}
//   {role:"tool", content:[{type:"text",text}]|string, tool_call_id}
//   {role:"user", ...}（我们推送的 prompt，忽略）
// 注意：sessionId 不在 stdout（在 stderr，由 runner 抓）；此模式不吐 usage/cost。

import type { RunEvent } from "./run-events";
import {
  asText,
  capPayload,
  detailCap,
  normalizeToolName,
  preview,
} from "./adapter-util";

// tool_calls[].function.arguments 是 JSON 字符串 → 解析成对象
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { _raw: raw };
    }
  }
  return {};
}

function toolCallSummary(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown) => (v == null ? "" : String(v));
  if (typeof args.command === "string") return preview(args.command, 200);
  const hint = str(
    args.file_path ?? args.filePath ?? args.path ?? args.pattern ?? args.query,
  );
  return hint ? `${name} ${hint}` : name;
}

function toolCallDetail(name: string, args: Record<string, unknown>): string {
  if (typeof args.command === "string") return detailCap(args.command);
  try {
    return detailCap(JSON.stringify(args, null, 2));
  } catch {
    return name;
  }
}

// 一行 stream-json → 规范化事件数组
export function kimiAdapter(obj: unknown): RunEvent[] {
  const out: RunEvent[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, any>;

  switch (o.role) {
    case "assistant": {
      // 推理/思考（OpenAI 兼容常见 reasoning_content）
      if (
        typeof o.reasoning_content === "string" &&
        o.reasoning_content.trim()
      ) {
        out.push({
          type: "thinking",
          text: preview(o.reasoning_content),
          detail: detailCap(o.reasoning_content),
          payload: capPayload({ reasoning: true }),
        });
      }
      // 可见文本：content 可能是字符串或 [{type:"text",text}]
      const text = asText(o.content);
      if (text.trim()) {
        out.push({
          type: "assistant_text",
          text: preview(text),
          detail: detailCap(text),
          payload: capPayload({ role: "assistant" }),
        });
      }
      // 工具调用
      if (Array.isArray(o.tool_calls)) {
        for (const tc of o.tool_calls) {
          const fn = (tc?.function ?? {}) as Record<string, any>;
          const name = String(fn.name ?? tc?.name ?? "tool");
          const args = parseArgs(fn.arguments ?? tc?.arguments);
          out.push({
            type: "tool_call",
            tool: normalizeToolName(name),
            toolName: name,
            text: toolCallSummary(name, args),
            detail: toolCallDetail(name, args),
            payload: capPayload({ id: tc?.id, name, args }),
          });
        }
      }
      break;
    }

    case "tool": {
      const full = asText(o.content);
      out.push({
        type: "tool_result",
        text: preview(full || "工具完成"),
        detail: detailCap(full),
        payload: capPayload({ tool_call_id: o.tool_call_id }),
      });
      break;
    }

    // role:"user"（我们推送的 prompt）/ 其它 → 忽略
    default:
      break;
  }
  return out;
}
