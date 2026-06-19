import { useEffect, useState } from "react";
import { GitBranch, FolderGit2, Plus, Unlink, ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { CreateRepoDialog } from "@/components/CreateRepoDialog";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import {
  api,
  type Repo,
  type IssueRepoRef,
  type UpdateIssuePayload,
} from "@/lib/api-client";
import { pillTrigger } from "./pill";

export function RepoBinding({
  workspaceId,
  repo,
  baseBranch,
  onPatch,
}: {
  workspaceId: string;
  repo: IssueRepoRef | null;
  baseBranch: string | null;
  onPatch: (payload: UpdateIssuePayload) => void;
}) {
  const { t } = useUi();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [branch, setBranch] = useState(baseBranch ?? "");

  useEffect(() => setBranch(baseBranch ?? ""), [baseBranch]);

  useEffect(() => {
    let alive = true;
    void api
      .listRepos(workspaceId)
      .then((r) => alive && setRepos(r.repos))
      .catch(() => alive && setRepos([]));
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  function bind(r: Repo) {
    // 首次绑定且未设分支时，用仓库默认分支兜底
    onPatch({ repoId: r.id, baseBranch: baseBranch ?? r.defaultBranch });
  }
  function saveBranch() {
    const v = branch.trim();
    if ((baseBranch ?? "") !== v) onPatch({ baseBranch: v || null });
  }

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(pillTrigger, "max-w-full")}>
          <GitBranch className="size-4 text-muted-foreground" />
          <span className={cn("truncate", !repo && "text-muted-foreground")}>
            {repo ? repo.name : t("repo.bind")}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          {repos.map((r) => (
            <DropdownMenuItem key={r.id} onSelect={() => bind(r)}>
              <FolderGit2 className="text-muted-foreground" />
              <span className="flex-1 truncate">{r.name}</span>
              <DropdownMenuCheck active={repo?.id === r.id} />
            </DropdownMenuItem>
          ))}
          {repos.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setAddOpen(true)}>
            <Plus className="text-muted-foreground" />
            {t("repo.add")}
          </DropdownMenuItem>
          {repo && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onPatch({ repoId: null, baseBranch: null })}
              >
                <Unlink />
                {t("repo.unbind")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {repo && (
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onBlur={saveBranch}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={t("repo.branchPh")}
          className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-active-fg"
        />
      )}

      <CreateRepoDialog
        open={addOpen}
        workspaceId={workspaceId}
        onClose={() => setAddOpen(false)}
        onCreated={(r) => {
          setRepos((prev) => [r, ...prev]);
          bind(r);
        }}
      />
    </div>
  );
}
