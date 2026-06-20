import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Pencil, Trash2, Link2 } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import {
  api,
  type Project,
  type ProjectResource,
  type Member,
} from "@/lib/api-client";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

export function ProjectDetailView() {
  const { t } = useUi();
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [project, setProject] = useState<Project | null>(null);
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!wsId || !id) return;
    let alive = true;
    setStatus("loading");
    Promise.all([
      api.getProject(wsId, id),
      api.listMembers(wsId).catch(() => ({ members: [] as Member[] })),
    ])
      .then(([p, m]) => {
        if (!alive) return;
        setProject(p.project);
        setResources(p.resources);
        setMembers(m.members);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId, id]);

  async function remove() {
    if (!wsId || !project) return;
    if (!window.confirm(t("projects.deleteConfirm"))) return;
    await api.deleteProject(wsId, project.id);
    navigate("/projects");
  }

  if (status === "loading") {
    return (
      <Panel>
        <div className="mx-auto w-full max-w-[760px]">
          <div className="h-8 w-40 animate-pulse rounded bg-muted/50" />
          <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted/40" />
        </div>
      </Panel>
    );
  }
  if (status === "error" || !project) {
    return (
      <Panel>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-sm text-muted-foreground">{t("project.notFound")}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate("/projects")}
          >
            {t("project.back")}
          </Button>
        </div>
      </Panel>
    );
  }

  const lead = project.leadId
    ? members.find((m) => m.id === project.leadId)
    : null;

  return (
    <Panel className="flex flex-col">
      <div className="mx-auto w-full max-w-[760px]">
        <button
          type="button"
          onClick={() => navigate("/projects")}
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {t("project.back")}
        </button>

        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
            {project.icon || "📁"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {project.title}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              /{project.slug}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" />
              {t("agent.edit")}
            </Button>
            <button
              type="button"
              title={t("projects.delete")}
              onClick={() => void remove()}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t("prop.status")} value={t(`pstatus.${project.status}`)} />
          <Field
            label={t("projects.lead")}
            value={lead ? lead.name : t("projects.noLead")}
          />
          <Field
            label={t("project.created")}
            value={new Date(project.createdAt).toLocaleDateString()}
          />
        </div>

        {project.description && (
          <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
            {project.description}
          </p>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-foreground">
            {t("project.secResources")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("project.resourcesHint")}
          </p>
          {resources.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              {t("project.noResources")}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {resources.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5"
                >
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {r.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {r.label || JSON.stringify(r.ref)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {wsId && (
        <CreateProjectDialog
          open={editOpen}
          workspaceId={wsId}
          project={project}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => setProject(saved)}
        />
      )}
    </Panel>
  );
}
