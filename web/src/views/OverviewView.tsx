import { useOutletContext, useNavigate } from "react-router-dom";
import { Plus, Inbox } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { IssueRow } from "@/components/issue/IssueRow";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { useIssues } from "@/lib/issues-store";
import type { LayoutContext } from "@/components/Layout";

export function OverviewView() {
  const { t } = useUi();
  const navigate = useNavigate();
  const { workspaces, currentWorkspace } = useAuth();
  const { openCreateWorkspace, openCreateIssue } =
    useOutletContext<LayoutContext>();
  const { status, issues, error, load } = useIssues();

  const wsId = currentWorkspace?.id ?? null;

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

  return (
    <Panel>
      <div className="w-full">
        {/* 标题行 + 新建 */}
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("issue.listTitle")}
          </h2>
          <Button
            size="sm"
            onClick={openCreateIssue}
            className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
          >
            <Plus className="size-4" />
            {t("issue.create")}
          </Button>
        </div>

        {/* 列表 */}
        <div className="mt-2">
          {loading ? (
            <div className="flex flex-col gap-1.5 py-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-muted/60"
                />
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
          ) : issues.length === 0 ? (
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
          ) : (
            <div className="-mx-1 flex flex-col">
              {issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onClick={(i) => navigate(`/issues/${i.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
