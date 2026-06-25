import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Paperclip,
  X,
  FolderKanban,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from "lucide-react";

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
// 懒加载：diff 查看器（含 @git-diff-view + lowlight 语法高亮）只在点开时才拉，不压初始包
const DiffOverlay = lazy(() =>
  import("@/components/issue/DiffOverlay").then((m) => ({
    default: m.DiffOverlay,
  })),
);
import { DescriptionField } from "@/components/issue/DescriptionField";
import {
  ImageLightbox,
  type LightboxImage,
} from "@/components/issue/ImageLightbox";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { issuesActions, useIssues, filterByProject } from "@/lib/issues-store";
import { issueKey, statusMeta } from "@/lib/issue-meta";
import { relativeTime } from "@/lib/time";
import {
  api,
  attachmentUrl,
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
  // 列表（沿用需求页的项目筛选上下文），用于上一条/下一条需求导航
  const { issues, projectFilter } = useIssues();

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
  const [pendingLightbox, setPendingLightbox] = useState<number | null>(null);

  // 上一条 / 下一条需求：在「按当前项目筛选后的列表」里定位本 issue 的邻居
  const navList = filterByProject(issues, projectFilter);
  const navIdx = issue ? navList.findIndex((i) => i.id === issue.id) : -1;
  const prevIssue = navIdx > 0 ? navList[navIdx - 1] : null;
  const nextIssue =
    navIdx >= 0 && navIdx < navList.length - 1 ? navList[navIdx + 1] : null;

  // 返回上一级：有浏览历史就回退，否则兜底回需求列表（深链直达时也稳）
  function goBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/requirements");
  }
  const goPrev = () => prevIssue && navigate(`/issues/${prevIssue.id}`);
  const goNext = () => nextIssue && navigate(`/issues/${nextIssue.id}`);

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

  // 深链直达详情（没先逛过列表）时补拉需求列表，让上/下一条可用
  useEffect(() => {
    if (wsId && issues.length === 0) void issuesActions.load(wsId);
  }, [wsId, issues.length]);

  // 键盘：Esc 返回上一级，[ / ] 切上一条 / 下一条需求；在输入框/文本域内不拦截
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        goBack();
      } else if (e.key === "[" && prevIssue) {
        e.preventDefault();
        navigate(`/issues/${prevIssue.id}`);
      } else if (e.key === "]" && nextIssue) {
        e.preventDefault();
        navigate(`/issues/${nextIssue.id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, prevIssue?.id, nextIssue?.id]);

  // 进入需求默认落到底部（最新一条消息）；每个 issue 仅自动跳一次，避免轮询刷新时打断阅读
  const scrolledForId = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "ready" || !id) return;
    if (scrolledForId.current === id) return;
    scrolledForId.current = id;
    const el = mainRef.current;
    if (!el) return;
    // 等时间线渲染完成再跳，双 rAF 兜住首帧布局
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      }),
    );
  }, [status, id]);

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
  const StatusIcon = statusMeta[issue.status].Icon;

  // 待发图片附件（用于 chip 缩略图 + 灯箱左右切换）；按 id 定位，避免同名误开
  const pendingImageAtts = pending.filter((p) => p.mime.startsWith("image/"));
  const pendingImages: LightboxImage[] = pendingImageAtts.map((p) => ({
    url: attachmentUrl(p.url),
    filename: p.filename,
  }));

  return (
    <>
    <Panel className="overflow-hidden p-0">
      <div className="flex h-full">
        {/* 主区：标题 / 描述 / 时间线 / 评论 —— 仅此处随内容滚动 */}
        <main
          ref={mainRef}
          className="flex min-w-0 flex-1 flex-col overflow-y-auto"
        >
          {/* 吸顶面包屑：返回 · 需求›编号 · 状态 · 标题 · 上/下一条 —— 滚到哪都在 */}
          <div className="sticky top-0 z-10 border-b border-border bg-background/85 px-8 backdrop-blur-sm">
            <div className="mx-auto flex h-12 w-full max-w-[760px] items-center gap-2 text-sm">
              <button
                type="button"
                onClick={goBack}
                title={t("detail.backHint")}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                <span className="hidden sm:inline">{t("detail.back")}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/requirements")}
                className="shrink-0 rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("detail.crumbRequirements")}
              </button>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {issueKey(issue.number)}
              </span>
              <StatusIcon
                className={cn(
                  "size-4 shrink-0",
                  statusMeta[issue.status].className,
                )}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {issue.title}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!prevIssue}
                  title={t("detail.prevIssue")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!nextIssue}
                  title={t("detail.nextIssue")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="px-8 py-6">
            <div className="mx-auto w-full max-w-[760px]">
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
              {/* 待发附件：图片显缩略图（点开灯箱），其它显文件 chip */}
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap items-start gap-2">
                  {pending.map((a) => {
                    const remove = () =>
                      setPending((p) => p.filter((x) => x.id !== a.id));
                    if (a.mime.startsWith("image/")) {
                      const imgIdx = pendingImageAtts.findIndex(
                        (x) => x.id === a.id,
                      );
                      return (
                        <div key={a.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => setPendingLightbox(imgIdx)}
                            className="block cursor-zoom-in"
                          >
                            <img
                              src={attachmentUrl(a.url)}
                              alt={a.filename}
                              className="size-16 rounded-lg border border-border object-cover transition-opacity hover:opacity-90"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={remove}
                            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    }
                    return (
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
                          onClick={remove}
                          className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    );
                  })}
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
      <Suspense fallback={null}>
        <DiffOverlay
          workspaceId={wsId}
          issueId={issue.id}
          taskId={openDiffTaskId}
          onClose={() => setOpenDiffTaskId(null)}
        />
      </Suspense>
    )}
    {pendingLightbox != null && pendingImages[pendingLightbox] && (
      <ImageLightbox
        images={pendingImages}
        index={pendingLightbox}
        onIndex={setPendingLightbox}
        onClose={() => setPendingLightbox(null)}
      />
    )}
    </>
  );
}
