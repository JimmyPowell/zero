import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { StatusPicker } from "@/components/issue/StatusPicker";
import { PriorityPicker } from "@/components/issue/PriorityPicker";
import { AssigneePicker } from "@/components/issue/AssigneePicker";
import { BindingPicker } from "@/components/issue/BindingPicker";
import { Timeline } from "@/components/issue/Timeline";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { issuesActions } from "@/lib/issues-store";
import { issueKey } from "@/lib/issue-meta";
import { relativeTime } from "@/lib/time";
import {
  api,
  type IssueDetail,
  type IssueEvent,
  type Member,
  type Agent,
  type UpdateIssuePayload,
} from "@/lib/api-client";

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

export function IssueDetailView() {
  const { t, locale } = useUi();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [events, setEvents] = useState<IssueEvent[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!wsId || !id) return;
    let alive = true;
    setStatus("loading");
    Promise.all([
      api.getIssue(wsId, id),
      api.listEvents(wsId, id),
      api.listMembers(wsId).catch(() => ({ members: [] as Member[] })),
      api.listAgents(wsId).catch(() => ({ agents: [] as Agent[] })),
    ])
      .then(([d, e, m, a]) => {
        if (!alive) return;
        setIssue(d.issue);
        setEditTitle(d.issue.title);
        setEditDesc(d.issue.description ?? "");
        setEvents(e.events);
        setMembers(m.members);
        setAgents(a.agents);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId, id]);

  async function patch(payload: UpdateIssuePayload) {
    if (!wsId || !issue) return;
    try {
      const { issue: updated } = await api.updateIssue(wsId, issue.id, payload);
      setIssue(updated);
      issuesActions.replace(updated);
      const { events: fresh } = await api.listEvents(wsId, issue.id);
      setEvents(fresh);
    } catch {
      if (issue) {
        setEditTitle(issue.title);
        setEditDesc(issue.description ?? "");
      }
    }
  }

  async function postComment() {
    const body = comment.trim();
    if (!body || !wsId || !issue || posting) return;
    setPosting(true);
    try {
      const { event } = await api.addComment(wsId, issue.id, body);
      setEvents((prev) => [...prev, event]);
      setComment("");
    } finally {
      setPosting(false);
    }
  }

  if (status === "loading") {
    return (
      <Panel>
        <div className="w-full max-w-[760px]">
          <div className="h-5 w-40 animate-pulse rounded bg-muted/60" />
          <div className="mt-4 h-8 w-2/3 animate-pulse rounded bg-muted/60" />
          <div className="mt-6 h-24 w-full animate-pulse rounded-lg bg-muted/40" />
        </div>
      </Panel>
    );
  }

  if (status === "error" || !issue) {
    return (
      <Panel>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-sm text-muted-foreground">{t("detail.notFound")}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => navigate("/overview")}
          >
            {t("detail.back")}
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden p-0">
      <div className="flex h-full">
        {/* 主区：标题 / 描述 / 时间线 / 评论 —— 仅此处随内容滚动 */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-[760px]">
            {/* 顶部：返回 + 编号 */}
            <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                {t("detail.back")}
              </button>
              <span className="shrink-0 font-mono text-xs">
                {issueKey(issue.number)}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {issue.title}
              </span>
            </div>

            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => {
                const v = editTitle.trim();
                if (v && v !== issue.title) void patch({ title: v });
                else setEditTitle(issue.title);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-full bg-transparent text-xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={() => {
                if (editDesc !== (issue.description ?? ""))
                  void patch({ description: editDesc || null });
              }}
              placeholder={t("detail.descPh")}
              className="mt-2 min-h-[60px] w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
            />

            <div className="my-5 h-px bg-border" />

            <SectionLabel>{t("detail.activity")}</SectionLabel>
            <Timeline events={events} />

            {/* 评论输入 */}
            <div className="mt-4">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    void postComment();
                }}
                placeholder={t("detail.commentPh")}
                className="min-h-[72px] w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-active-fg"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  disabled={!comment.trim() || posting}
                  onClick={postComment}
                  className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                >
                  {posting ? t("detail.posting") : t("detail.send")}
                </Button>
              </div>
            </div>
          </div>
        </main>

        {/* 右侧属性栏：钉在最右，独立滚动 */}
        <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-border px-5 py-6">
          <SectionLabel>{t("detail.properties")}</SectionLabel>
          <div className="flex flex-col gap-3">
            <PropRow label={t("prop.status")}>
              <StatusPicker
                value={issue.status}
                onChange={(s) => void patch({ status: s })}
              />
            </PropRow>
            <PropRow label={t("prop.priority")}>
              <PriorityPicker
                value={issue.priority}
                onChange={(p) => void patch({ priority: p })}
              />
            </PropRow>
            <PropRow label={t("prop.assignee")}>
              <AssigneePicker
                members={members}
                agents={agents}
                value={
                  issue.assignee
                    ? { type: issue.assignee.type, id: issue.assignee.id }
                    : null
                }
                onChange={(a) =>
                  void patch({
                    assigneeType: a?.type ?? null,
                    assigneeId: a?.id ?? null,
                  })
                }
              />
            </PropRow>
          </div>

          <div className="my-4 h-px bg-border" />

          <SectionLabel>{t("binding.label")}</SectionLabel>
          <BindingPicker
            workspaceId={wsId!}
            issueNumber={issue.number}
            value={
              issue.repo
                ? {
                    kind: "repo",
                    repoId: issue.repo.id,
                    baseBranch: issue.baseBranch ?? issue.repo.defaultBranch,
                  }
                : issue.workDir
                  ? { kind: "dir", workDir: issue.workDir }
                  : { kind: "none" }
            }
            onChange={(v) => {
              if (v.kind === "repo")
                void patch({ repoId: v.repoId, baseBranch: v.baseBranch });
              else if (v.kind === "dir") void patch({ workDir: v.workDir });
              else void patch({ repoId: null, workDir: null });
            }}
          />

          <div className="my-4 h-px bg-border" />

          <SectionLabel>{t("detail.details")}</SectionLabel>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>{t("detail.created")}</span>
              <span className="text-foreground">
                {relativeTime(issue.createdAt, locale)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t("issue.lastActivity")}</span>
              <span className="text-foreground">
                {relativeTime(issue.lastActivityAt, locale)}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </Panel>
  );
}
