import { useEffect, useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";

import { Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { issuesActions } from "@/lib/issues-store";
import { toast } from "@/lib/toast-store";
import { statusMeta, issueKey } from "@/lib/issue-meta";
import { relativeTime } from "@/lib/time";
import { api, type TrashIssue } from "@/lib/api-client";

// 回收站：本工作空间里已软删的需求，可一键恢复。
export function TrashView() {
  const { t, locale } = useUi();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [items, setItems] = useState<TrashIssue[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    setStatus("loading");
    api
      .listTrash(wsId)
      .then((r) => {
        if (!alive) return;
        setItems(r.issues);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId]);

  async function restore(it: TrashIssue) {
    if (!wsId || restoringId) return;
    setRestoringId(it.id);
    try {
      await api.restoreIssue(wsId, it.id);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      void issuesActions.refresh(); // 恢复后重新出现在需求列表
      toast.success({ title: t("toast.issueRestored") });
    } catch {
      toast.error({ title: t("toast.issueDeleteFailed") });
    } finally {
      setRestoringId(null);
    }
  }

  const loading = status === "loading" && items.length === 0;

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-4 flex items-center gap-2">
          <Trash2 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {t("trash.title")}
          </h2>
        </div>

        {loading ? (
          <div className="flex flex-col gap-1.5 py-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-muted/50"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
            <Trash2 className="size-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("trash.empty")}
            </p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              {t("trash.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((it) => {
              const sm = statusMeta[it.status];
              const SIcon = sm.Icon;
              return (
                <div
                  key={it.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <span className="w-[68px] shrink-0 font-mono text-xs text-muted-foreground">
                    {issueKey(it.number)}
                  </span>
                  <SIcon className={cn("size-4 shrink-0", sm.className)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {it.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("trash.deletedAt")} {relativeTime(it.deletedAt, locale)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={restoringId === it.id}
                    onClick={() => void restore(it)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-sidebar-accent disabled:opacity-50"
                  >
                    <RotateCcw className="size-3.5" />
                    {restoringId === it.id
                      ? t("trash.restoring")
                      : t("trash.restore")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
