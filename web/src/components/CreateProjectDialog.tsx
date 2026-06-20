import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { pillTrigger } from "@/components/issue/pill";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import {
  api,
  ApiError,
  type Project,
  type ProjectStatus,
  type Member,
} from "@/lib/api-client";

const STATUSES: ProjectStatus[] = [
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
];

export function CreateProjectDialog({
  open,
  workspaceId,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspaceId: string;
  project: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const { t } = useUi();
  const editing = !!project;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planned");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(project?.title ?? "");
    setDescription(project?.description ?? "");
    setStatus(project?.status ?? "planned");
    setLeadId(project?.leadId ?? null);
    setError(null);
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api
      .listMembers(workspaceId)
      .then((r) => alive && setMembers(r.members))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const lead = leadId ? members.find((m) => m.id === leadId) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = editing
        ? (
            await api.updateProject(workspaceId, project!.id, {
              title: title.trim(),
              description: description.trim() || null,
              status,
              leadId,
            })
          ).project
        : (
            await api.createProject(workspaceId, {
              title: title.trim(),
              description: description.trim() || undefined,
              status,
              leadId: leadId ?? undefined,
            })
          ).project;
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog w-full max-w-[480px] rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-foreground">
          {t("projects.createTitle")}
        </h2>

        <div className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {t("projects.title")}
            </span>
            <Input
              autoFocus
              placeholder={t("projects.namePh")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {t("agents.description")}
            </span>
            <Textarea
              placeholder={t("projects.descPh")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="flex gap-3">
            {/* 状态 */}
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("prop.status")}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className={pillTrigger}>
                  <span>{t(`pstatus.${status}`)}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[160px]">
                  {STATUSES.map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => setStatus(s)}>
                      <span className="flex-1">{t(`pstatus.${s}`)}</span>
                      <DropdownMenuCheck active={s === status} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>

            {/* 负责人 */}
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("projects.lead")}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className={pillTrigger}>
                  <span className={cn(!lead && "text-muted-foreground")}>
                    {lead ? lead.name : t("projects.noLead")}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[180px]">
                  <DropdownMenuItem onSelect={() => setLeadId(null)}>
                    <span className="flex-1">{t("projects.noLead")}</span>
                    <DropdownMenuCheck active={leadId == null} />
                  </DropdownMenuItem>
                  {members.map((m) => (
                    <DropdownMenuItem key={m.id} onSelect={() => setLeadId(m.id)}>
                      <span className="flex-1 truncate">{m.name}</span>
                      <DropdownMenuCheck active={leadId === m.id} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !title.trim()}>
            {submitting
              ? editing
                ? t("agents.saving")
                : t("projects.creating")
              : editing
                ? t("agents.save")
                : t("projects.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
