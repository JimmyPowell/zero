import { useEffect, useState } from "react";
import { Plus, Github, FileText, Trash2, Pencil, Bot } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { CreateSkillDialog } from "@/components/CreateSkillDialog";
import { ImportSkillDialog } from "@/components/ImportSkillDialog";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { api, type Skill } from "@/lib/api-client";

export function SkillsView() {
  const { t } = useUi();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [skills, setSkills] = useState<Skill[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editId, setEditId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  function load() {
    if (!wsId) return;
    api
      .listSkills(wsId)
      .then((r) => {
        setSkills(r.skills);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }

  useEffect(() => {
    if (!wsId) return;
    setStatus("loading");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  function openCreate() {
    setEditId(null);
    setCreateOpen(true);
  }
  function openEdit(id: string) {
    setEditId(id);
    setCreateOpen(true);
  }
  async function remove(s: Skill) {
    if (!wsId) return;
    if (!window.confirm(t("skills.deleteConfirm"))) return;
    await api.deleteSkill(wsId, s.id);
    setSkills((prev) => prev.filter((x) => x.id !== s.id));
  }

  const loading = status === "loading" && skills.length === 0;

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("skills.title")}
          </h2>
          {wsId && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Github className="size-4" />
                {t("skills.import")}
              </Button>
              <Button
                size="sm"
                onClick={openCreate}
                className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
              >
                <Plus className="size-4" />
                {t("skills.new")}
              </Button>
            </div>
          )}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{t("skills.subtitle")}</p>

        {loading ? (
          <div className="flex flex-col gap-1.5 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
            <FileText className="size-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("skills.empty")}
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {t("skills.emptyHint")}
            </p>
            {wsId && (
              <Button
                size="sm"
                className="mt-4 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                onClick={openCreate}
              >
                <Plus className="size-4" />
                {t("skills.new")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {skills.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => openEdit(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openEdit(s.id);
                }}
                className="group flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-[#2563eb]/40 hover:bg-muted/30"
              >
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {s.name}
                    </p>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]",
                        s.source === "github"
                          ? "bg-zinc-100 text-zinc-600"
                          : "bg-sky-100 text-sky-700",
                      )}
                    >
                      {s.source === "github" ? (
                        <Github className="size-3" />
                      ) : (
                        <Pencil className="size-3" />
                      )}
                      {s.source === "github"
                        ? t("skills.sourceGithub")
                        : t("skills.sourceManual")}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {s.description}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground/80">
                    <span className="inline-flex items-center gap-0.5">
                      <Bot className="size-3" />
                      {t("skills.usedBy").replace("{n}", String(s.agentCount))}
                    </span>
                    {s.fileCount > 0 && (
                      <>
                        <span>·</span>
                        <span>{t("skills.files").replace("{n}", String(s.fileCount))}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
                  <button
                    type="button"
                    title={t("skills.edit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(s.id);
                    }}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    title={t("skills.delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(s);
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
        <>
          <CreateSkillDialog
            open={createOpen}
            workspaceId={wsId}
            skillId={editId}
            onClose={() => setCreateOpen(false)}
            onSaved={load}
          />
          <ImportSkillDialog
            open={importOpen}
            workspaceId={wsId}
            onClose={() => setImportOpen(false)}
            onImported={load}
          />
        </>
      )}
    </Panel>
  );
}
