import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { StatusPicker } from "@/components/issue/StatusPicker";
import { PriorityPicker } from "@/components/issue/PriorityPicker";
import {
  AssigneePicker,
  type AssigneeValue,
} from "@/components/issue/AssigneePicker";
import {
  BindingPicker,
  type BindingValue,
} from "@/components/issue/BindingPicker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { pillTrigger } from "@/components/issue/pill";
import {
  useAttachmentComposer,
  PendingAttachments,
} from "@/components/issue/AttachmentComposer";
import { FolderKanban, ChevronDown, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { toast } from "@/lib/toast-store";
import { issueKey } from "@/lib/issue-meta";
import {
  api,
  ApiError,
  type Issue,
  type IssueStatus,
  type IssuePriority,
  type Member,
  type Agent,
  type Project,
} from "@/lib/api-client";

export function CreateIssueDialog({
  open,
  workspaceId,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (issue: Issue) => void;
}) {
  const { t } = useUi();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>("in_progress");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [assignee, setAssignee] = useState<AssigneeValue>(null);
  const [binding, setBinding] = useState<BindingValue>({ kind: "none" });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 正文粘贴/拖拽/选文件的附件编排（与详情页评论框共用）
  const att = useAttachmentComposer(workspaceId);

  // 打开时拉取成员 + 智能体供指派
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([
      api.listMembers(workspaceId).catch(() => ({ members: [] as Member[] })),
      api.listAgents(workspaceId).catch(() => ({ agents: [] as Agent[] })),
      api
        .listProjects(workspaceId)
        .catch(() => ({ projects: [] as Project[] })),
    ]).then(([m, a, p]) => {
      if (!alive) return;
      setMembers(m.members);
      setAgents(a.agents);
      setProjects(p.projects);
    });
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  // Esc 关闭。本弹窗自身是一层 .zero-overlay；若上面还叠了更高的浮层
  // （正文附件的图片灯箱，也是 .zero-overlay），Esc 交给它，弹窗不抢，避免一起退掉。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelectorAll(".zero-overlay").length > 1) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function reset() {
    setTitle("");
    setDescription("");
    setStatus("in_progress");
    setBinding({ kind: "none" });
    setPriority("none");
    setAssignee(null);
    setProjectId(null);
    setError(null);
    att.reset();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { issue } = await api.createIssue(workspaceId, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assigneeType: assignee?.type,
        assigneeId: assignee?.id,
        projectId: projectId ?? undefined,
        ...(binding.kind === "repo"
          ? { repoId: binding.repoId, baseBranch: binding.baseBranch }
          : {}),
        ...(binding.kind === "dir" && binding.workDir.trim()
          ? { workDir: binding.workDir.trim() }
          : {}),
        ...(att.pending.length
          ? { attachmentIds: att.pending.map((p) => p.id) }
          : {}),
      });
      onCreated(issue);
      reset();
      onClose();
      // 成功提示（右下角，可点击跳转到该需求详情）
      toast.success({
        title: t("toast.issueCreated"),
        description: `${issueKey(issue.number)} ${issue.title}`,
        to: `/issues/${issue.id}`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "网络错误，请重试";
      setError(msg);
      toast.error({ title: t("toast.issueCreateFailed"), description: msg });
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
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        className="zero-dialog w-full max-w-[580px] overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        <div className="px-5 pt-5 pb-3">
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            {t("issue.newTitle")}
          </p>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("issue.titlePh")}
            className="w-full bg-transparent text-[17px] font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <PendingAttachments
            className="mb-1 mt-3 flex flex-wrap items-start gap-2"
            pending={att.pending}
            onRemove={att.removeOne}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onPaste={att.dropzone.onPaste}
            onDrop={att.dropzone.onDrop}
            onDragOver={att.dropzone.onDragOver}
            onDragLeave={att.dropzone.onDragLeave}
            placeholder={t("issue.descPh")}
            className={cn(
              "mt-2.5 min-h-[110px] w-full resize-none rounded-lg bg-transparent text-sm leading-relaxed text-foreground outline-none transition-shadow placeholder:text-muted-foreground/70",
              att.dragOver && "ring-2 ring-active-fg/30",
            )}
          />
          <label className="mt-0.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
            <Paperclip className="size-3.5" />
            {att.uploading ? t("detail.uploading") : t("detail.attach")}
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void att.pickFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {/* 属性胶囊行 */}
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <StatusPicker value={status} onChange={setStatus} />
          <PriorityPicker value={priority} onChange={setPriority} />
          <AssigneePicker
            members={members}
            agents={agents}
            value={assignee}
            onChange={setAssignee}
          />
          <DropdownMenu>
            <DropdownMenuTrigger className={pillTrigger}>
              <FolderKanban className="size-3.5 text-muted-foreground" />
              <span className={cn(!projectId && "text-muted-foreground")}>
                {projects.find((p) => p.id === projectId)?.title ??
                  t("projects.none")}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]">
              <DropdownMenuItem onSelect={() => setProjectId(null)}>
                <span className="flex-1">{t("projects.none")}</span>
                <DropdownMenuCheck active={projectId == null} />
              </DropdownMenuItem>
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => setProjectId(p.id)}
                >
                  <span className="flex-1 truncate">{p.title}</span>
                  <DropdownMenuCheck active={projectId === p.id} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 工作区绑定（仓库 / 工作目录 / 不绑） */}
        <div className="px-5 pb-4">
          <p className="mb-1.5 text-xs text-muted-foreground">
            {t("binding.label")}
          </p>
          <BindingPicker
            workspaceId={workspaceId}
            value={binding}
            onChange={setBinding}
          />
        </div>

        {error && (
          <p className="mx-5 mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {t("issue.submitHint")}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? t("issue.creating") : t("issue.create")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
