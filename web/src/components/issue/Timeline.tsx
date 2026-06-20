import { ChevronRight, Paperclip, FileDiff } from "lucide-react";

import { ActorAvatar } from "@/components/ActorAvatar";
import { Markdown } from "@/components/Markdown";
import { useUi } from "@/lib/ui-store";
import { relativeTime } from "@/lib/time";
import { statusMeta, priorityMeta } from "@/lib/issue-meta";
import { cn } from "@/lib/utils";
import { attachmentUrl } from "@/lib/api-client";
import type {
  Attachment,
  IssueEvent,
  IssueStatus,
  IssuePriority,
  AssigneeRef,
  RunStatus,
  RunSummary,
} from "@/lib/api-client";

function fmtSize(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))}KB`;
  return `${n}B`;
}

// 评论里的附件：图片显缩略图、其它显可下载 chip
function AttachmentChip({ att }: { att: Attachment }) {
  const href = attachmentUrl(att.url);
  if (att.mime.startsWith("image/")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        <img
          src={href}
          alt={att.filename}
          className="max-h-44 max-w-[220px] rounded-lg border border-border object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
    >
      <Paperclip className="size-3.5 text-muted-foreground" />
      <span className="max-w-[180px] truncate text-foreground">
        {att.filename}
      </span>
      <span className="text-muted-foreground">{fmtSize(att.size)}</span>
    </a>
  );
}

function interp(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const RUN_PILL: Record<RunStatus, { cls: string; dot: string }> = {
  queued: { cls: "text-muted-foreground", dot: "bg-muted-foreground/50" },
  running: { cls: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500 animate-pulse" },
  succeeded: { cls: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  failed: { cls: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
  cancelled: { cls: "text-muted-foreground", dot: "bg-muted-foreground/50" },
};

function runDuration(run: RunSummary): string | null {
  if (run.startedAt && run.finishedAt) {
    const ms =
      new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (ms >= 0) return `${Math.round(ms / 100) / 10}s`;
  }
  return null;
}

// 时间线里的「运行卡片」：状态 + 统计 + 打开执行日志
function RunCard({
  actorName,
  actorAvatar,
  run,
  time,
  onOpen,
}: {
  actorName: string;
  actorAvatar?: string | null;
  run: RunSummary;
  time: string;
  onOpen: () => void;
}) {
  const { t } = useUi();
  const pill = RUN_PILL[run.status];
  const dur = runDuration(run);
  return (
    <li data-msg className="flex gap-3 py-2.5">
      <ActorAvatar
        type="agent"
        name={actorName}
        url={actorAvatar}
        className="mt-0.5 size-7"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">
            {actorName}
          </span>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="mt-1.5 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:border-active-fg/40 hover:bg-sidebar-accent"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              pill.cls,
            )}
          >
            <span className={cn("size-1.5 rounded-full", pill.dot)} />
            {t(`run.status.${run.status}`)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {run.toolCallCount} {t("runlog.toolCalls")} · {run.eventCount}{" "}
            {t("runlog.events")}
            {dur ? ` · ${dur}` : ""}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-active-fg">
            {t("runlog.viewLog")}
            <ChevronRight className="size-3.5" />
          </span>
        </button>
      </div>
    </li>
  );
}

// 时间线里的「改动卡片」：改了几个文件 + ±行，点开看 diff
function DiffCard({
  actorName,
  actorAvatar,
  time,
  filesChanged,
  additions,
  deletions,
  onOpen,
}: {
  actorName: string;
  actorAvatar?: string | null;
  time: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  onOpen: () => void;
}) {
  const { t } = useUi();
  return (
    <li className="flex gap-3 py-2.5">
      <ActorAvatar
        type="agent"
        name={actorName}
        url={actorAvatar}
        className="mt-0.5 size-7"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">
            {actorName}
          </span>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="mt-1.5 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:border-active-fg/40 hover:bg-sidebar-accent"
        >
          <FileDiff className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            {t("diff.filesChanged").replace("{n}", String(filesChanged))}
            {"  "}
            <span className="text-emerald-600 dark:text-emerald-400">
              +{additions}
            </span>{" "}
            <span className="text-red-600 dark:text-red-400">−{deletions}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-active-fg">
            {t("diff.view")}
            <ChevronRight className="size-3.5" />
          </span>
        </button>
      </div>
    </li>
  );
}

export function Timeline({
  events,
  runs = {},
  onOpenRun,
  onOpenDiff,
}: {
  events: IssueEvent[];
  runs?: Record<string, RunSummary>;
  onOpenRun?: (taskId: string) => void;
  onOpenDiff?: (taskId: string) => void;
}) {
  const { t, locale } = useUi();

  const statusLabel = (v?: string | null) =>
    v ? t(statusMeta[v as IssueStatus]?.labelKey ?? v) : "";
  const priorityLabel = (v?: string | null) =>
    v ? t(priorityMeta[v as IssuePriority]?.labelKey ?? v) : "";

  // 有 run_queued 事件的 task：运行卡片从 run_queued 渲染（状态 runs[] 实时取：排队中→执行中→…），
  // run_started 跳过避免重复；旧 issue 无 run_queued → 仍由 run_started 渲染卡片。
  const queuedTaskIds = new Set(
    events
      .filter((e) => e.kind === "run_queued")
      .map((e) => (e.meta as { taskId?: string } | null)?.taskId)
      .filter(Boolean) as string[],
  );

  return (
    <ol className="flex flex-col">
      {events.map((ev) => {
        const actorName = ev.actor?.name ?? t("timeline.system");
        const time = relativeTime(ev.createdAt, locale);
        const meta = ev.meta as {
          taskId?: string;
          reason?: string;
          error?: string;
        } | null;

        // 评论：卡片
        if (ev.kind === "comment") {
          return (
            <li key={ev.id} data-msg className="flex gap-3 py-2.5">
              <ActorAvatar
                type={ev.actor?.type}
                name={ev.actor?.name}
                url={ev.actor?.avatarUrl}
                className="mt-0.5 size-7"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {actorName}
                  </span>
                  <span className="text-xs text-muted-foreground">{time}</span>
                </div>
                <div className="mt-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground">
                  {ev.body && <Markdown>{ev.body}</Markdown>}
                  {ev.attachments && ev.attachments.length > 0 && (
                    <div
                      className={cn(
                        "flex flex-wrap gap-2",
                        ev.body && "mt-2",
                      )}
                    >
                      {ev.attachments.map((a) => (
                        <AttachmentChip key={a.id} att={a} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        }

        // 运行卡片（状态/统计/打开日志）：从该 task 的首个运行事件渲染
        // —— 有 run_queued 用它（能显示"排队中"），否则用 run_started（兼容旧 issue）。
        const firstRunEvt =
          ev.kind === "run_queued" ||
          (ev.kind === "run_started" && !queuedTaskIds.has(meta?.taskId ?? ""));
        if (firstRunEvt && meta?.taskId && runs[meta.taskId]) {
          return (
            <RunCard
              key={ev.id}
              actorName={actorName}
              actorAvatar={ev.actor?.avatarUrl}
              run={runs[meta.taskId]}
              time={time}
              onOpen={() => onOpenRun?.(meta.taskId!)}
            />
          );
        }
        // 已被运行卡片覆盖的后续运行事件 → 不重复展示
        // （no_runtime 这类无 taskId 的失败仍走下方活动行）
        if (
          ((ev.kind === "run_started" &&
            queuedTaskIds.has(meta?.taskId ?? "")) ||
            ev.kind === "run_finished" ||
            ev.kind === "run_failed" ||
            ev.kind === "run_cancelled") &&
          meta?.taskId
        ) {
          return null;
        }

        // 变更可视化：diff_ready → 改动卡片
        if (ev.kind === "diff_ready" && meta?.taskId) {
          const m = ev.meta as {
            filesChanged?: number;
            additions?: number;
            deletions?: number;
          } | null;
          return (
            <DiffCard
              key={ev.id}
              actorName={actorName}
              actorAvatar={ev.actor?.avatarUrl}
              time={time}
              filesChanged={m?.filesChanged ?? 0}
              additions={m?.additions ?? 0}
              deletions={m?.deletions ?? 0}
              onOpen={() => onOpenDiff?.(meta.taskId!)}
            />
          );
        }

        // 变更：活动行
        let text = "";
        if (ev.kind === "created") {
          text = t("timeline.created");
        } else if (ev.kind === "status_change") {
          text = interp(t("timeline.status"), {
            from: statusLabel(ev.meta?.from as string),
            to: statusLabel(ev.meta?.to as string),
          });
        } else if (ev.kind === "priority_change") {
          text = interp(t("timeline.priority"), {
            from: priorityLabel(ev.meta?.from as string),
            to: priorityLabel(ev.meta?.to as string),
          });
        } else if (ev.kind === "assignment") {
          const to = ev.meta?.to as AssigneeRef | null | undefined;
          text = to
            ? interp(t("timeline.assigned"), { name: to.name ?? "" })
            : t("timeline.unassigned");
        } else if (ev.kind === "run_queued") {
          text = t("timeline.runQueued");
        } else if (ev.kind === "run_started") {
          text = t("timeline.runStarted");
        } else if (ev.kind === "run_finished") {
          text = t("timeline.runFinished");
        } else if (ev.kind === "run_failed") {
          text =
            meta?.reason === "no_runtime"
              ? t("timeline.noRuntime")
              : t("timeline.runFailed") + (ev.body ? `：${ev.body}` : "");
        } else {
          text = ev.kind;
        }

        return (
          <li
            key={ev.id}
            className="flex items-center gap-2.5 py-1.5 text-sm text-muted-foreground"
          >
            <span className="flex size-7 shrink-0 items-center justify-center">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            </span>
            <span className="min-w-0">
              <span className="font-medium text-foreground">{actorName}</span>{" "}
              {text}
              <span className="text-muted-foreground/70"> · {time}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
