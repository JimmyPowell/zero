// 各 provider adapter 共用的小工具：摘要/详情截断、payload 限大小、工具名归一化。
import type { RunTool } from "./run-events";

export function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// 折叠态预览：压成一行 + 长度上限
export function preview(s: string, n = 160): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

// 展开态完整内容上限（防 DB 膨胀；run_event.detail 为 TEXT）
const DETAIL_CAP = 16000;
export function detailCap(s: string): string {
  return s.length > DETAIL_CAP
    ? `${s.slice(0, DETAIL_CAP)}\n…（已截断，共 ${s.length} 字）`
    : s;
}

// 限制单条原始 payload 大小，避免大读写撑爆 DB / 网络
export function capPayload(p: unknown): unknown {
  try {
    const s = JSON.stringify(p);
    if (s.length <= 8000) return p;
    return { truncated: true, bytes: s.length, preview: s.slice(0, 2000) };
  } catch {
    return { truncated: true, note: "unserializable" };
  }
}

// 把内容（字符串 / 数组 / 对象）统一成字符串
export function asText(content: unknown): string {
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

// 跨 provider 的工具名 → 规范化类目（read|edit|write|exec|search|task|other）
export function normalizeToolName(name: string): RunTool {
  const n = (name || "").toLowerCase();
  if (
    n.includes("bash") ||
    n.includes("exec") ||
    n.includes("shell") ||
    n.includes("command") ||
    n.includes("terminal")
  )
    return "exec";
  if (
    n.includes("patch") ||
    n.includes("edit") ||
    n.includes("apply") ||
    n.includes("str_replace")
  )
    return "edit";
  if (n.includes("write") || n.includes("create")) return "write";
  if (n.includes("read") || n === "cat" || n.includes("notebook")) return "read";
  if (
    n.includes("grep") ||
    n.includes("glob") ||
    n.includes("search") ||
    n.includes("fetch") ||
    n.includes("find") ||
    n === "ls" ||
    n.includes("list")
  )
    return "search";
  if (n.includes("task") || n.includes("agent")) return "task";
  return "other";
}
