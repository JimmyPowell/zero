// 执行事件线协议（daemon 侧副本，与 server/src/lib/run-events.ts 保持一致）。
// 各 provider 的 adapter 把原生流翻译成这套统一形态后上报；server / web 只认这套。

export type RunEventType =
  | "run_status" // 生命周期 / 元信息：init、result
  | "assistant_text" // 模型可见文本
  | "thinking" // 模型思考 / 推理
  | "tool_call" // 发起一次工具调用
  | "tool_result" // 工具返回
  | "usage" // token / 费用
  | "error"; // 错误

export type RunTool =
  | "read"
  | "edit"
  | "write"
  | "exec"
  | "search"
  | "task"
  | "other";

export interface RunEvent {
  type: RunEventType;
  tool?: RunTool | null;
  toolName?: string | null;
  text?: string | null;
  payload?: unknown;
}

// 上报形态：在该 task 内单调递增的 seq
export interface OutgoingRunEvent extends RunEvent {
  seq: number;
}
