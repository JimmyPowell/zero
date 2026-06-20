import { z } from "zod";

// 规范化执行事件的线协议（与 provider 无关）。
// daemon 里各 provider 的 adapter 负责把原生流翻译成这套；server / web 只认这套。

export const RUN_EVENT_TYPES = [
  "run_status", // 生命周期 / 元信息：init、result
  "assistant_text", // 模型可见文本
  "thinking", // 模型思考 / 推理
  "tool_call", // 发起一次工具调用
  "tool_result", // 工具返回
  "usage", // token / 费用
  "error", // 错误
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export const RUN_TOOLS = [
  "read",
  "edit",
  "write",
  "exec",
  "search",
  "task",
  "other",
] as const;
export type RunTool = (typeof RUN_TOOLS)[number];

// daemon 上报的单条事件（seq 由 daemon 在该 task 内单调分配）
export const incomingRunEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.enum(RUN_EVENT_TYPES),
  tool: z.enum(RUN_TOOLS).nullish(),
  toolName: z.string().max(128).nullish(),
  text: z.string().nullish(),
  detail: z.string().max(20000).nullish(),
  // 子代理结构化：tool_use 自身 id / 所属子代理父调用 id
  toolUseId: z.string().max(64).nullish(),
  parentToolUseId: z.string().max(64).nullish(),
  payload: z.unknown().nullish(),
});
export type IncomingRunEvent = z.infer<typeof incomingRunEventSchema>;
