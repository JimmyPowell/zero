import { ActorAvatar } from "@/components/ActorAvatar";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { relativeTime } from "@/lib/time";
import { statusMeta, priorityMeta, issueKey } from "@/lib/issue-meta";
import type { Issue } from "@/lib/api-client";

export function IssueRow({
  issue,
  onClick,
}: {
  issue: Issue;
  onClick?: (issue: Issue) => void;
}) {
  const { t, locale } = useUi();
  const sm = statusMeta[issue.status];
  const pm = priorityMeta[issue.priority];
  const SIcon = sm.Icon;
  const PIcon = pm.Icon;

  return (
    <button
      type="button"
      onClick={() => onClick?.(issue)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent"
    >
      <span title={t(pm.labelKey)} className="flex shrink-0">
        <PIcon className={cn("size-4", pm.className)} />
      </span>
      <span className="w-[68px] shrink-0 font-mono text-xs text-muted-foreground">
        {issueKey(issue.number)}
      </span>
      <span title={t(sm.labelKey)} className="flex shrink-0">
        <SIcon className={cn("size-4", sm.className)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          {issue.unread && (
            <span
              title={t("issue.unread")}
              className="size-1.5 shrink-0 rounded-full bg-[#2563eb]"
            />
          )}
          <span
            className={cn(
              "truncate text-sm text-foreground",
              issue.unread && "font-semibold",
            )}
          >
            {issue.title}
          </span>
        </span>
        {issue.lastMessage && (
          <span
            title={issue.lastMessage}
            className="truncate text-xs text-muted-foreground"
          >
            {issue.lastMessage}
          </span>
        )}
      </span>
      <span
        title={t("issue.lastActivity")}
        className="shrink-0 text-xs text-muted-foreground tabular-nums"
      >
        {relativeTime(issue.lastActivityAt, locale)}
      </span>
      {issue.assignee && (
        <ActorAvatar
          type={issue.assignee.type}
          name={issue.assignee.name}
          url={issue.assignee.avatarUrl}
          className="size-5 shrink-0"
        />
      )}
    </button>
  );
}
