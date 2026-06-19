import { ActorAvatar } from "@/components/ActorAvatar";
import { useUi } from "@/lib/ui-store";
import { relativeTime } from "@/lib/time";
import { statusMeta, priorityMeta } from "@/lib/issue-meta";
import type {
  IssueEvent,
  IssueStatus,
  IssuePriority,
  AssigneeRef,
} from "@/lib/api-client";

function interp(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export function Timeline({ events }: { events: IssueEvent[] }) {
  const { t, locale } = useUi();

  const statusLabel = (v?: string | null) =>
    v ? t(statusMeta[v as IssueStatus]?.labelKey ?? v) : "";
  const priorityLabel = (v?: string | null) =>
    v ? t(priorityMeta[v as IssuePriority]?.labelKey ?? v) : "";

  return (
    <ol className="flex flex-col">
      {events.map((ev) => {
        const actorName = ev.actor?.name ?? t("timeline.system");
        const time = relativeTime(ev.createdAt, locale);

        // 评论：卡片
        if (ev.kind === "comment") {
          return (
            <li key={ev.id} className="flex gap-3 py-2.5">
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
                <div className="mt-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                  {ev.body}
                </div>
              </div>
            </li>
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
        } else {
          text = ev.kind; // Phase B 的 run_* 事件占位
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
