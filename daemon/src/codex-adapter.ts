// Codex provider adapter：把 `codex exec --json` 的一行 JSON 事件翻译成
// 与 provider 无关的规范化 RunEvent[]（含 text 摘要 + detail 完整内容）。
//
// 事件外壳实测自 codex-cli 0.135.0（点号类型）：
//   {type:"thread.started", thread_id}
//   {type:"turn.started"} / {type:"turn.completed", usage} / {type:"turn.failed", error:{message}}
//   {type:"item.started"|"item.completed"|"item.updated", item:{...}}
//   {type:"error", message}
// 成功路径的 item.* 字段名参考 Multica 的 codex 解析（command_execution/file_change/
// agent_message/reasoning），并做了多字段名兜底；待一次真实成功运行最终校验。
// 会话 id（thread_id）+ 用量（turn.completed.usage）由 runner 读取，这里不产出。

import type { RunEvent } from "./run-events";
import { asText, capPayload, detailCap, preview } from "./adapter-util";

function pick<T = unknown>(o: Record<string, any>, ...keys: string[]): T | undefined {
  for (const k of keys) if (o[k] != null) return o[k] as T;
  return undefined;
}

function itemEvents(item: Record<string, any>, phase: "start" | "done"): RunEvent[] {
  const type = String(pick(item, "type", "item_type", "itemType") ?? "");
  const out: RunEvent[] = [];

  // 命令执行
  if (/command|exec/i.test(type)) {
    if (phase === "start") {
      const cmd = asText(pick(item, "command", "cmd") ?? "");
      out.push({
        type: "tool_call",
        tool: "exec",
        toolName: "exec_command",
        text: preview(cmd || "exec_command", 200),
        detail: detailCap(cmd),
        payload: capPayload(item),
      });
    } else {
      const output = asText(
        pick(item, "aggregated_output", "aggregatedOutput", "output") ?? "",
      );
      const exit = pick<number>(item, "exit_code", "exitCode");
      const head = exit != null ? `[exit ${exit}]\n` : "";
      out.push({
        type: "tool_result",
        text: preview(output || "命令完成"),
        detail: detailCap(head + output),
        payload: capPayload({ exit }),
      });
    }
    return out;
  }

  // 文件改动 / 打补丁
  if (/file|patch|change|edit/i.test(type)) {
    if (phase === "start") {
      const target = asText(pick(item, "path", "command", "changes") ?? "");
      out.push({
        type: "tool_call",
        tool: "edit",
        toolName: "patch_apply",
        text: preview(target || "patch_apply", 200),
        detail: detailCap(target),
        payload: capPayload(item),
      });
    } else {
      out.push({
        type: "tool_result",
        text: "改动已应用",
        detail: detailCap(asText(pick(item, "output", "diff") ?? "改动已应用")),
        payload: capPayload(item),
      });
    }
    return out;
  }

  // 代理消息（最终/中间回复）
  if (/agent.?message|message|assistant/i.test(type)) {
    const text = asText(pick(item, "text", "message", "content") ?? "");
    if (text.trim() && phase === "done") {
      out.push({
        type: "assistant_text",
        text: preview(text),
        detail: detailCap(text),
        payload: capPayload(item),
      });
    }
    return out;
  }

  // 推理 / 思考
  if (/reason|think/i.test(type)) {
    const text = asText(pick(item, "text", "content") ?? "");
    if (text.trim() && phase === "done") {
      out.push({
        type: "thinking",
        text: preview(text),
        detail: detailCap(text),
        payload: capPayload(item),
      });
    }
    return out;
  }

  return out;
}

export function codexAdapter(obj: unknown): RunEvent[] {
  const out: RunEvent[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, any>;
  const item = (o.item ?? {}) as Record<string, any>;

  switch (o.type) {
    case "item.started":
      return itemEvents(item, "start");
    case "item.completed":
    case "item.updated":
      return itemEvents(item, "done");

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

    // thread.started / turn.started / turn.completed：会话 id 与用量由 runner 读取
    default:
      break;
  }
  return out;
}
