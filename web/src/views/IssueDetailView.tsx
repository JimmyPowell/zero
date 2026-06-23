import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Paperclip, X, FolderKanban, ChevronDown } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { StatusPicker } from "@/components/issue/StatusPicker";
import { PriorityPicker } from "@/components/issue/PriorityPicker";
import { AssigneePicker } from "@/components/issue/AssigneePicker";
import { BindingPicker } from "@/components/issue/BindingPicker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { pillTrigger } from "@/components/issue/pill";
import { cn } from "@/lib/utils";
import { Timeline } from "@/components/issue/Timeline";
import { RunLogOverlay } from "@/components/issue/RunLogOverlay";
import { ScrollNav } from "@/components/issue/ScrollNav";
import { DiffOverlay } from "@/components/issue/DiffOverlay";
import { DescriptionField } from "@/components/issue/DescriptionField";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { issuesActions } from "@/lib/issues-store";
import { issueKey } from "@/lib/issue-meta";
import { relativeTime } from "@/lib/time";
import {
  api,
  type Attachment,
  type IssueDetail,
  type IssueEvent,
  type Member,
  type Agent,
  type Project,
  type RunSummary,
  type UpdateIssuePayload,
} from "@/lib/api-client";

function fmtSize(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))}KB`;
  return `${n}B`;
}

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
  const mainRef = useRef<HTMLElement>(null);

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [events, setEvents] = useState<IssueEvent[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [openDiffTaskId, setOpenDiffTaskId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editTitle, setEditTitle] = useState("");
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!wsId || !id) return;
    let alive = true;
    setStatus("loading");
    Promise.all([
      api.getIssue(wsId, id),
      api.listEvents(wsId, id),
      api.listRuns(wsId, id).catch(() => ({ runs: [] as RunSummary[] })),
      api.listMembers(wsId).catch(() => ({ members: [] as Member[] })),
      api.listAgents(wsId).catch(() => ({ agents: [] as Agent[] })),
      api.listProjects(wsId).catch(() => ({ projects: [] as Project[] })),
    ])
      .then(([d, e, r, m, a, p]) => {
        if (!alive) return;
        setIssue(d.issue);
        setEditTitle(d.issue.title);
        setEvents(e.events);
        setRuns(r.runs);
        setMembers(m.members);
        setAgents(a.agents);
        setProjects(p.projects);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId, id]);

  // 刷新时间线 + 运行摘要
  async function refresh() {
    if (!wsId || !id) return;
    try {
      const [e, r] = await Promise.all([
        api.listEvents(wsId, id),
        api.listRuns(wsId, id),
      ]);
      setEvents(e.events);
      setRuns(r.runs);
    } catch {
      /* 忽略瞬时错误，下个轮询周期再试 */
    }
  }

  // 有运行处于活动态时轮询，让时间线/运行卡片实时跟进（细粒度走浮层 SSE）
  const hasActiveRun = runs.some(
    (r) => r.status === "queued" || r.status === "running",
  );
  useEffect(() => {
    if (!wsId || !id || !hasActiveRun) return;
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, id, hasActiveRun]);

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
      }
    }
  }

  async function postComment() {
    const body = comment.trim();
    if ((!body && pending.length === 0) || !wsId || !issue || posting) return;
    setPosting(true);
    try {
      const { event } = await api.addComment(
        wsId,
        issue.id,
        body,
        pending.map((p) => p.id),
      );
      setEvents((prev) => [...prev, event]);
      setComment("");
      setPending([]);
      // 评论可能触发了 agent 执行 → 拉取最新运行卡片（并启动轮询）
      await refresh();
    } finally {
      setPosting(false);
    }
  }

  // 选文件即上传，拿到 id 进待发列表（提交评论时一起 link）
  async function onPickFiles(files: FileList | null) {
    if (!files || !files.length || !wsId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const { attachment } = await api.uploadAttachment(wsId, file);
          setPending((prev) => [...prev, attachment]);
        } catch {
          /* 单个失败忽略，继续传其余 */
        }
      }
    } finally {
      setUploading(false);
    }
  }

  // 直接粘贴图片/文件：从剪贴板取出文件，走同一条上传链路
  function onPasteFiles(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault(); // 有文件时拦截，避免把文件名当文本插入
      void onPickFiles(files);
    }
  }

  // 拖拽文件到输入框
  function onDropFiles(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) void onPickFiles(files);
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

  const runsById = Object.fromEntries(runs.map((r) => [r.taskId, r]));
  const openRun = openRunId ? runsById[openRunId] : null;

  return (
    <>
    <Panel className="overflow-hidden p-0">
      <div className="flex h-full">
        {/* 主区：标题 / 描述 / 时间线 / 评论 —— 仅此处随内容滚动 */}
        <main
          ref={mainRef}
          className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6"
        >
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
            <DescriptionField
              value={issue.description ?? ""}
              placeholder={t("detail.descPh")}
              onSave={(v) => {
                if (v !== (issue.description ?? ""))
                  void patch({ description: v || null });
              }}
            />

            <div className="my-5 h-px bg-border" />

            <SectionLabel>{t("detail.activity")}</SectionLabel>
            <Timeline
              events={events}
              runs={runsById}
              onOpenRun={(taskId) => setOpenRunId(taskId)}
              onOpenDiff={(taskId) => setOpenDiffTaskId(taskId)}
            />

            {/* 评论输入 */}
            <div className="mt-4">
              {/* 待发附件 chip */}
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pending.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs"
                    >
                      <Paperclip className="size-3 text-muted-foreground" />
                      <span className="max-w-[160px] truncate text-foreground">
                        {a.filename}
                      </span>
                      <span className="text-muted-foreground">
                        {fmtSize(a.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPending((p) => p.filter((x) => x.id !== a.id))
                        }
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    void postComment();
                }}
                onPaste={onPasteFiles}
                onDrop={onDropFiles}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragOver) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                placeholder={t("detail.commentPh")}
                className={cn(
                  "min-h-[72px] w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-active-fg",
                  dragOver && "border-active-fg ring-2 ring-active-fg/30",
                )}
              />
              <div className="mt-2 flex items-center justify-between">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
                  <Paperclip className="size-3.5" />
                  {uploading ? t("detail.uploading") : t("detail.attach")}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void onPickFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <Button
                  size="sm"
                  disabled={
                    (!comment.trim() && pending.length === 0) ||
                    posting ||
                    uploading
                  }
                  onClick={postComment}
                  className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                >
                  {posting ? t("detail.posting") : t("detail.send")}
                </Button>
              </div>
            </div>
          </div>
          <ScrollNav scrollRef={mainRef} />
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
            <PropRow label={t("prop.project")}>
              <DropdownMenu>
                <DropdownMenuTrigger className={pillTrigger}>
                  <FolderKanban className="size-3.5 text-muted-foreground" />
                  <span
                    className={cn(
                      "truncate",
                      !issue.project && "text-muted-foreground",
                    )}
                  >
                    {issue.project?.title ?? t("projects.none")}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[180px]">
                  <DropdownMenuItem onSelect={() => void patch({ projectId: null })}>
                    <span className="flex-1">{t("projects.none")}</span>
                    <DropdownMenuCheck active={!issue.project} />
                  </DropdownMenuItem>
                  {projects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={() => void patch({ projectId: p.id })}
                    >
                      <span className="flex-1 truncate">{p.title}</span>
                      <DropdownMenuCheck active={issue.project?.id === p.id} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
    {openRun && wsId && (
      <RunLogOverlay
        workspaceId={wsId}
        issueId={issue.id}
        run={openRun}
        onClose={() => setOpenRunId(null)}
        onFinished={() => void refresh()}
      />
    )}
    {openDiffTaskId && wsId && (
      <DiffOverlay
        workspaceId={wsId}
        issueId={issue.id}
        taskId={openDiffTaskId}
        onClose={() => setOpenDiffTaskId(null)}
      />
    )}
    </>
  );
}
