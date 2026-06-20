import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FolderKanban, Trash2 } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { api, type Project } from "@/lib/api-client";

const statusTone: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  in_progress: "bg-[#2563eb]/10 text-[#2563eb]",
  paused: "bg-amber-500/10 text-amber-600",
  completed: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function ProjectsView() {
  const { t } = useUi();
  const { currentWorkspace } = useAuth();
  const navigate = useNavigate();
  const wsId = currentWorkspace?.id ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    setStatus("loading");
    api
      .listProjects(wsId)
      .then((r) => {
        if (!alive) return;
        setProjects(r.projects);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId]);

  function onSaved(saved: Project) {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [saved, ...prev];
    });
  }
  async function remove(p: Project) {
    if (!wsId) return;
    if (!window.confirm(t("projects.deleteConfirm"))) return;
    await api.deleteProject(wsId, p.id);
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
  }

  const loading = status === "loading" && projects.length === 0;

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("projects.title")}
          </h2>
          {wsId && (
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
            >
              <Plus className="size-4" />
              {t("projects.new")}
            </Button>
          )}
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
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
            <FolderKanban className="size-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("projects.empty")}
            </p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              {t("projects.emptyHint")}
            </p>
            {wsId && (
              <Button
                size="sm"
                className="mt-4 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="size-4" />
                {t("projects.new")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/projects/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/projects/${p.id}`);
                }}
                className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-[#2563eb]/40 hover:bg-muted/30"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
                  {p.icon || "📁"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    /{p.slug}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs",
                    statusTone[p.status] ?? statusTone.planned,
                  )}
                >
                  {t(`pstatus.${p.status}`)}
                </span>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title={t("projects.delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(p);
                    }}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {wsId && (
        <CreateProjectDialog
          open={dialogOpen}
          workspaceId={wsId}
          project={null}
          onClose={() => setDialogOpen(false)}
          onSaved={onSaved}
        />
      )}
    </Panel>
  );
}
