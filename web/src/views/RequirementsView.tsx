import { useOutletContext, useNavigate } from "react-router-dom";
import { Plus, Inbox, List, LayoutGrid } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { IssueRow } from "@/components/issue/IssueRow";
import { RequirementsBoard } from "@/components/issue/RequirementsBoard";
import { ProjectFilter } from "@/components/issue/ProjectFilter";
import { SortFilter } from "@/components/issue/SortFilter";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { useIssues, filterByProject, sortIssues } from "@/lib/issues-store";
import type { LayoutContext } from "@/components/Layout";

export function RequirementsView() {
  const { t, viewMode, setViewMode, issueSort } = useUi();
  const navigate = useNavigate();
  const { workspaces, currentWorkspace } = useAuth();
  const { openCreateWorkspace, openCreateIssue } =
    useOutletContext<LayoutContext>();
  const { status, issues, error, load, projectFilter } = useIssues();

  const wsId = currentWorkspace?.id ?? null;
  const filtered = sortIssues(filterByProject(issues, projectFilter), issueSort);

  // 没有任何工作空间 → 引导创建
  if (workspaces.length === 0) {
    return (
      <Panel>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("ws.emptyTitle")}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {t("ws.emptyHint")}
          </p>
          <Button className="mt-5" onClick={openCreateWorkspace}>
            {t("workspace.create")}
          </Button>
        </div>
      </Panel>
    );
  }

  // idle（尚未发起加载）也按加载中处理，避免首屏闪一下空状态
  const loading = status !== "ready" && status !== "error" && issues.length === 0;
  const showEmpty = !loading && !error && issues.length === 0;

  return (
    <Panel className="flex flex-col">
      {/* 标题行 + 视图切换 + 新建 */}
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t("issue.listTitle")}
        </h2>
        <div className="flex items-center gap-2">
          {/* 按项目筛选（选择存 issues-store，列表/看板共用） */}
          {wsId && <ProjectFilter workspaceId={wsId} />}
          {/* 排序（选择存 ui-store/localStorage，列表/看板共用） */}
          <SortFilter />
          {/* 列表 / 看板 切换（选择持久化在 ui-store） */}
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button
              type="button"
              title={t("view.list")}
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center justify-center rounded-md px-2 py-1 transition-colors",
                viewMode === "list"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="size-4" />
            </button>
            <button
              type="button"
              title={t("view.board")}
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center justify-center rounded-md px-2 py-1 transition-colors",
                viewMode === "board"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
          <Button
            size="sm"
            onClick={openCreateIssue}
            className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
          >
            <Plus className="size-4" />
            {t("issue.create")}
          </Button>
        </div>
      </div>

      {/* 内容区：加载 / 错误 / 空 → 占位；否则按视图渲染 */}
      {loading ? (
        <div className="flex flex-col gap-1.5 py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => wsId && void load(wsId, { force: true })}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : showEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
          <Inbox className="size-7 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {t("issue.emptyTitle")}
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {t("issue.emptyHint")}
          </p>
          <Button
            size="sm"
            className="mt-4 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
            onClick={openCreateIssue}
          >
            <Plus className="size-4" />
            {t("issue.create")}
          </Button>
        </div>
      ) : viewMode === "board" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <RequirementsBoard />
        </div>
      ) : filtered.length === 0 ? (
        // 有需求但当前项目筛选下为空
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t("issue.filterEmpty")}
        </div>
      ) : (
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {filtered.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onClick={(i) => navigate(`/issues/${i.id}`)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
