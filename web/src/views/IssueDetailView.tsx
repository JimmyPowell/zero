import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  FolderKanban,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Trash2,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
// 懒加载：diff 查看器（含 @git-diff-view + lowlight 语法高亮）只在点开时才拉，不压初始包
const DiffOverlay = lazy(() =>
  import("@/components/issue/DiffOverlay").then((m) => ({
    default: m.DiffOverlay,
  })),
);
import { DescriptionField } from "@/components/issue/DescriptionField";
import { CommentComposer } from "@/components/issue/CommentComposer";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { toast } from "@/lib/toast-store";
import { issuesActions, useIssues, filterByProject } from "@/lib/issues-store";
import { issueKey, statusMeta } from "@/lib/issue-meta";
import { relativeTime } from "@/lib/time";
import {
  api,
  type IssueDetail,
  type IssueEvent,
  type Member,
  type Agent,
  type Project,
  type RunSummary,
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
  const { currentWorkspace, user } = useAuth();
  const wsId = currentWorkspace?.id ?? null;
  const mainRef = useRef<HTMLElement>(null);
  // 列表（沿用需求页的项目筛选上下文），用于上一条/下一条需求导航
  const { issues, projectFilter } = useIssues();

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [events, setEvents] = useState<IssueEvent[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [openDiffTaskId, setOpenDiffTaskId] = useState<string | null>(null);
  // 删除需求确认弹窗（替代原生 confirm）：open 控制显隐，deleting 防重复点击
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editTitle, setEditTitle] = useState("");

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

  // 删除/恢复权限：本人（creator/评论作者）或工作空间 admin/owner
  const canModerate =
    currentWorkspace?.role === "owner" || currentWorkspace?.role === "admin";
  const canDeleteIssue =
    !!issue && (issue.creatorId === user?.id || canModerate);

  // 确认弹窗里点「删除」后真正执行（确认 UI 见底部 ConfirmDialog）
  async function deleteIssue() {
    if (!wsId || !issue || deleting) return;
    setDeleting(true);
    try {
      await api.deleteIssue(wsId, issue.id);
      issuesActions.remove(issue.id);
      setConfirmDelete(false);
      toast.success({
        title: t("toast.issueDeleted"),
        description: t("toast.trashHint"),
        to: "/trash",
      });
      goBack();
    } catch {
      toast.error({ title: t("toast.issueDeleteFailed") });
    } finally {
      setDeleting(false);
    }
  }

  // 刷新时间线 + 运行摘要（useCallback 稳定引用，供 Timeline memo / 轮询 / 子组件复用）
  const refresh = useCallback(async () => {
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
  }, [wsId, id]);

  // 删除评论：不弹确认（时间线就地保留「已删除 + 恢复」占位，本身就是后悔药）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deleteComment = useCallback(
    async (eventId: string) => {
      if (!wsId || !issue) return;
      try {
        await api.deleteComment(wsId, issue.id, eventId);
        await refresh();
        toast.success({ title: t("toast.commentDeleted") });
      } catch {
        toast.error({ title: t("toast.issueDeleteFailed") });
      }
    },
    [wsId, issue?.id, refresh],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const restoreComment = useCallback(
    async (eventId: string) => {
      if (!wsId || !issue) return;
      try {
        await api.restoreComment(wsId, issue.id, eventId);
        await refresh();
      } catch {
        toast.error({ title: t("toast.issueDeleteFailed") });
      }
    },
    [wsId, issue?.id, refresh],
  );

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
        // 打开即标记已读：更新服务端已读水位 + 本地列表即时清掉未读标记
        void api.markIssueRead(wsId, id).catch(() => {});
        issuesActions.markRead(id);
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId, id]);

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
      // 有浮层/弹窗开着时（图片灯箱 / 运行日志 / diff / 各 Dialog，均带 .zero-overlay），
      // 按键交给浮层自己处理，详情页不抢 —— 否则在灯箱里按 Esc 会先关灯箱、又连详情页一起退掉。
      if (document.querySelector(".zero-overlay")) return;
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

  // 评论发送成功后：追加新事件 + 刷新（拉运行卡片 / 启动轮询）。useCallback 稳引用给子组件。
  const onPosted = useCallback(
    (event: IssueEvent) => {
      setEvents((prev) => [...prev, event]);
      return refresh();
    },
    [refresh],
  );

  // 运行卡片索引 + 打开回调：useMemo/useCallback 稳定引用，让 Timeline 的 memo 生效
  const runsById = useMemo(
    () => Object.fromEntries(runs.map((r) => [r.taskId, r])),
    [runs],
  );
  const onOpenRun = useCallback((taskId: string) => setOpenRunId(taskId), []);
  const onOpenDiff = useCallback(
    (taskId: string) => setOpenDiffTaskId(taskId),
    [],
  );

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

  const openRun = openRunId ? runsById[openRunId] : null;
  const StatusIcon = statusMeta[issue.status].Icon;

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
                {canDeleteIssue && (
                  <>
                    <span className="mx-1 h-4 w-px bg-border" />
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      title={t("detail.deleteIssue")}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
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
              onOpenRun={onOpenRun}
              onOpenDiff={onOpenDiff}
              currentUserId={user?.id ?? null}
              canModerate={canModerate}
              onDeleteComment={deleteComment}
              onRestoreComment={restoreComment}
            />

            {/* 评论输入：独立组件，打字只重渲染它自己，不触动时间线（性能） */}
            <CommentComposer
              wsId={wsId}
              issueId={issue.id}
              onPosted={onPosted}
            />
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
    <ConfirmDialog
      open={confirmDelete}
      title={t("detail.deleteIssue")}
      description={t("detail.deleteIssueConfirm")}
      confirmText={t("detail.deleteIssue")}
      cancelText={t("common.cancel")}
      destructive
      busy={deleting}
      onConfirm={deleteIssue}
      onCancel={() => setConfirmDelete(false)}
    />
    </>
  );
}
