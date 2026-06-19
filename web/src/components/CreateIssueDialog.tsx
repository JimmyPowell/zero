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
import { useUi } from "@/lib/ui-store";
import {
  api,
  ApiError,
  type Issue,
  type IssueStatus,
  type IssuePriority,
  type Member,
  type Agent,
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
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 打开时拉取成员 + 智能体供指派
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([
      api.listMembers(workspaceId).catch(() => ({ members: [] as Member[] })),
      api.listAgents(workspaceId).catch(() => ({ agents: [] as Agent[] })),
    ]).then(([m, a]) => {
      if (!alive) return;
      setMembers(m.members);
      setAgents(a.agents);
    });
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
    setError(null);
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
        ...(binding.kind === "repo"
          ? { repoId: binding.repoId, baseBranch: binding.baseBranch }
          : {}),
        ...(binding.kind === "dir" && binding.workDir.trim()
          ? { workDir: binding.workDir.trim() }
          : {}),
      });
      onCreated(issue);
      reset();
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
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("issue.descPh")}
            className="mt-2.5 min-h-[110px] w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />
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
