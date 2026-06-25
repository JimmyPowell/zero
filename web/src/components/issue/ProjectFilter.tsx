import { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { useUi } from "@/lib/ui-store";
import { useIssues, NO_PROJECT } from "@/lib/issues-store";
import { api, type Project } from "@/lib/api-client";
import { pillTrigger } from "./pill";

// 需求页头部的「按项目筛选」下拉。选择存在 issues-store，列表与看板共用。
export function ProjectFilter({ workspaceId }: { workspaceId: string }) {
  const { t } = useUi();
  const { projectFilter, setProjectFilter } = useIssues();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .listProjects(workspaceId)
      .then((r) => alive && setProjects(r.projects))
      .catch(() => {
        /* 拉取失败就只保留「全部/未分类」两项，不阻塞页面 */
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  // 触发器当前显示的文案
  const label =
    projectFilter == null
      ? t("issue.filterAllProjects")
      : projectFilter === NO_PROJECT
        ? t("issue.filterNoProject")
        : (projects.find((p) => p.id === projectFilter)?.title ??
          t("issue.filterAllProjects"));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillTrigger}>
        <FolderKanban className="size-4 text-muted-foreground" />
        <span className="max-w-[140px] truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem onSelect={() => setProjectFilter(null)}>
          <span className="flex-1">{t("issue.filterAllProjects")}</span>
          <DropdownMenuCheck active={projectFilter == null} />
        </DropdownMenuItem>
        {projects.length > 0 && <DropdownMenuSeparator />}
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => setProjectFilter(p.id)}>
            <span className="text-sm">{p.icon || "📁"}</span>
            <span className="flex-1 truncate">{p.title}</span>
            <DropdownMenuCheck active={projectFilter === p.id} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setProjectFilter(NO_PROJECT)}>
          <span className="flex-1">{t("issue.filterNoProject")}</span>
          <DropdownMenuCheck active={projectFilter === NO_PROJECT} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
