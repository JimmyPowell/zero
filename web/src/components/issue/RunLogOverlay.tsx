import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Filter, X, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { providerLabel } from "@/components/CreateAgentDialog";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { relativeTime } from "@/lib/time";
import {
  api,
  type RunEventRow,
  type RunEventType,
  type RunStatus,
  type RunSummary,
} from "@/lib/api-client";

const ACTIVE = (s: RunStatus) => s === "queued" || s === "running";

// 进度条分段着色（按事件类型）—— 复刻 Multica 顶部彩色条
const BAR_COLOR: Record<RunEventType, string> = {
  assistant_text: "bg-emerald-400",
  thinking: "bg-teal-300",
  tool_call: "bg-blue-400",
  tool_result: "bg-slate-300 dark:bg-slate-600",
  run_status: "bg-violet-300",
  usage: "bg-amber-300",
  error: "bg-red-400",
};

// 每条事件左侧的类型标签
function eventChip(ev: RunEventRow): {
  label: string;
  cls: string;
  mono: boolean;
} {
  switch (ev.type) {
    case "assistant_text":
      return { label: "Agent", cls: "bg-emerald-500 text-white", mono: false };
    case "thinking":
      return {
        label: "思考",
        cls: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
        mono: false,
      };
    case "tool_call":
      return {
        label: ev.toolName ?? ev.tool ?? "tool",
        cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
        mono: false,
      };
    case "tool_result":
      return {
        label: "输出",
        cls: "bg-muted text-muted-foreground",
        mono: true,
      };
    case "run_status":
      return {
        label: "状态",
        cls: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
        mono: false,
      };
    case "usage":
      return {
        label: "用量",
        cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
        mono: false,
      };
    case "error":
      return {
        label: "错误",
        cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
        mono: false,
      };
  }
}

const STATUS_PILL: Record<
  RunStatus,
  { key: string; cls: string; dot: string }
> = {
  queued: {
    key: "run.status.queued",
    cls: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  running: {
    key: "run.status.running",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  succeeded: {
    key: "run.status.succeeded",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  failed: {
    key: "run.status.failed",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    dot: "bg-red-500",
  },
  cancelled: {
    key: "run.status.cancelled",
    cls: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

type FilterKey = "all" | "text" | "tools" | "errors";
const FILTER_TYPES: Record<FilterKey, RunEventType[] | null> = {
  all: null,
  text: ["assistant_text", "thinking"],
  tools: ["tool_call", "tool_result"],
  errors: ["error"],
};

function fmtDuration(run: RunSummary): string | null {
  if (run.startedAt && run.finishedAt) {
    const ms =
      new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (ms >= 0) return `${Math.round(ms / 100) / 10}s`;
  }
  return null;
}

export function RunLogOverlay({
  workspaceId,
  issueId,
  run,
  onClose,
  onFinished,
}: {
  workspaceId: string;
  issueId: string;
  run: RunSummary;
  onClose: () => void;
  onFinished?: () => void;
}) {
  const { t, locale } = useUi();
  const [events, setEvents] = useState<RunEventRow[]>([]);
  const [status, setStatus] = useState<RunStatus>(run.status);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 合并并按 seq 去重排序
  const upsert = (incoming: RunEventRow[]) =>
    setEvents((prev) => {
      const map = new Map<number, RunEventRow>();
      for (const e of prev) map.set(e.seq, e);
      for (const e of incoming) map.set(e.seq, e);
      return [...map.values()].sort((a, b) => a.seq - b.seq);
    });

  // 1) 历史回放 + 2) 活动中订阅 SSE 实时流
  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;

    void api
      .listRunEvents(workspaceId, issueId, run.taskId)
      .then((r) => {
        if (!alive) return;
        upsert(r.events);
        const lastSeq = r.events.length ? r.events[r.events.length - 1].seq : -1;
        if (!ACTIVE(run.status)) return;
        // 活动中：从 lastSeq 之后订阅实时（断线 EventSource 自动按 Last-Event-ID 续传）
        es = new EventSource(
          api.runStreamUrl(workspaceId, issueId, run.taskId, lastSeq),
        );
        es.addEventListener("run", (ev) => {
          try {
            upsert([JSON.parse((ev as MessageEvent).data)]);
          } catch {
            /* ignore */
          }
        });
        es.addEventListener("end", (ev) => {
          try {
            const d = JSON.parse((ev as MessageEvent).data);
            if (d?.status) setStatus(d.status as RunStatus);
          } catch {
            /* ignore */
          }
          es?.close(); // 收到终态即关闭，避免重连
          onFinished?.();
        });
      })
      .catch(() => {});

    return () => {
      alive = false;
      es?.close();
    };
  }, [workspaceId, issueId, run.taskId, run.status, onFinished]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 活动中自动滚到底
  useEffect(() => {
    if (ACTIVE(status) && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, status]);

  const toolCalls = useMemo(
    () => events.filter((e) => e.type === "tool_call").length,
    [events],
  );
  const shown = useMemo(() => {
    const types = FILTER_TYPES[filter];
    return types ? events.filter((e) => types.includes(e.type)) : events;
  }, [events, filter]);

  const duration = fmtDuration(run);
  const pill = STATUS_PILL[status];

  async function copyAll() {
    const text = events
      .map((e) => {
        const c = eventChip(e);
        return `#${e.seq + 1} [${c.label}] ${e.text ?? ""}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[8vh] backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog flex max-h-[80vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl"
      >
        {/* 头部 */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              pill.cls,
            )}
          >
            <span className={cn("size-1.5 rounded-full", pill.dot)} />
            {t(pill.key)}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {run.provider && (
              <span className="text-foreground">
                {providerLabel[run.provider]}
              </span>
            )}
            {run.runtimeName && <span>{run.runtimeName}</span>}
            {duration && <span>{duration}</span>}
            <span>
              {toolCalls} {t("runlog.toolCalls")}
            </span>
            <span>
              {events.length} {t("runlog.events")}
            </span>
            <span>{relativeTime(run.createdAt, locale)}</span>
          </div>

          {/* 筛选 */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
              <Filter className="size-3.5" />
              {t(`runlog.filter.${filter}`)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[120px]">
              {(["all", "text", "tools", "errors"] as FilterKey[]).map((f) => (
                <DropdownMenuItem key={f} onSelect={() => setFilter(f)}>
                  <span className="flex-1">{t(`runlog.filter.${f}`)}</span>
                  <DropdownMenuCheck active={f === filter} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={copyAll}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? t("runlog.copied") : t("runlog.copyAll")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 彩色进度条 */}
        {events.length > 0 && (
          <div className="flex h-1.5 w-full gap-px px-5 pt-3">
            {events.map((e) => (
              <span
                key={e.seq}
                className={cn("h-full flex-1 rounded-sm", BAR_COLOR[e.type])}
              />
            ))}
          </div>
        )}

        {/* 事件列表 */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {shown.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {t("runlog.empty")}
            </div>
          ) : (
            <ol className="flex flex-col">
              {shown.map((e) => {
                const c = eventChip(e);
                return (
                  <li
                    key={e.seq}
                    className="flex items-start gap-3 border-b border-border/40 px-3 py-2.5 last:border-0"
                  >
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                        c.cls,
                      )}
                    >
                      {c.label}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-foreground",
                        c.mono && "font-mono text-[13px] text-muted-foreground",
                      )}
                    >
                      {e.text}
                    </span>
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground/60">
                      #{e.seq + 1}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {run.error && (
          <div className="border-t border-border bg-red-500/5 px-5 py-2.5 text-xs text-red-600 dark:text-red-400">
            {run.error}
          </div>
        )}

        <div className="flex justify-end border-t border-border px-5 py-2.5">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("runtime.done")}
          </Button>
        </div>
      </div>
    </div>
  );
}
