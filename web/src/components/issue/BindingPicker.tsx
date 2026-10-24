import { useEffect, useState } from "react";
import {
  FolderGit2,
  Folder,
  FolderSearch,
  Plus,
  ChevronDown,
  Boxes,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { CreateRepoDialog } from "@/components/CreateRepoDialog";
import { FolderBrowserDialog } from "./FolderBrowserDialog";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { api, type Repo } from "@/lib/api-client";
import { pillTrigger } from "./pill";

export type BindingValue =
  | { kind: "repo"; repoId: string; baseBranch: string }
  | { kind: "dir"; workDir: string }
  | { kind: "none" };

function baseName(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function BindingPicker({
  workspaceId,
  value,
  issueNumber,
  runtimeId,
  onChange,
}: {
  workspaceId: string;
  value: BindingValue;
  issueNumber?: number;
  // 指派的智能体所绑运行时：「浏览」默认看那台机器的目录
  runtimeId?: string | null;
  onChange: (v: BindingValue) => void;
}) {
  const { t } = useUi();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [dirEditing, setDirEditing] = useState(false);
  const [dirDraft, setDirDraft] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);

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

  // 已绑工作目录时，草稿跟随committed值
  useEffect(() => {
    if (value.kind === "dir") setDirDraft(value.workDir);
  }, [value]);

  const repo =
    value.kind === "repo" ? repos.find((r) => r.id === value.repoId) : null;
  const branch = issueNumber ? `zero/ZERO-${issueNumber}` : "zero/ZERO-N";
  const showDir = dirEditing || value.kind === "dir";

  // 提交工作目录绑定（非空才提交）
  function commitDir(path?: string) {
    const p = (path ?? dirDraft).trim();
    if (p && !(value.kind === "dir" && value.workDir === p)) {
      onChange({ kind: "dir", workDir: p });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(pillTrigger, "max-w-full")}>
          {value.kind === "repo" ? (
            <>
              <FolderGit2 className="size-4 text-muted-foreground" />
              <span className="truncate">{repo?.name ?? t("binding.repo")}</span>
            </>
          ) : value.kind === "dir" ? (
            <>
              <Folder className="size-4 text-amber-500" />
              <span className="truncate">{baseName(value.workDir)}</span>
            </>
          ) : (
            <>
              <Boxes className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t("binding.none")}</span>
            </>
          )}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[240px]">
          <DropdownMenuItem
            onSelect={() => {
              setDirEditing(false);
              onChange({ kind: "none" });
            }}
          >
            <Boxes className="text-muted-foreground" />
            <span className="flex-1">{t("binding.none")}</span>
            <DropdownMenuCheck active={value.kind === "none" && !dirEditing} />
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            <span className="text-xs text-muted-foreground">
              {t("binding.repoSection")}
            </span>
          </DropdownMenuLabel>
          {repos.map((r) => (
            <DropdownMenuItem
              key={r.id}
              onSelect={() => {
                setDirEditing(false);
                onChange({
                  kind: "repo",
                  repoId: r.id,
                  baseBranch: r.defaultBranch,
                });
              }}
            >
              <FolderGit2 className="text-muted-foreground" />
              <span className="flex-1 truncate">{r.name}</span>
              <DropdownMenuCheck
                active={value.kind === "repo" && value.repoId === r.id}
              />
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setAddOpen(true)}>
            <Plus className="text-muted-foreground" />
            {t("binding.addRepo")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            <span className="text-xs text-muted-foreground">
              {t("binding.dirSection")}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              setDirDraft(value.kind === "dir" ? value.workDir : "");
              setDirEditing(true);
            }}
          >
            <Folder className="text-muted-foreground" />
            {t("binding.bindDir")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 绑工作目录：路径输入 + 浏览（选完/失焦/回车即提交，无需单独确定）*/}
      {showDir && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5">
            <input
              autoFocus={dirEditing}
              value={dirDraft}
              onChange={(e) => setDirDraft(e.target.value)}
              onBlur={() => commitDir()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDir();
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === "Escape") setDirEditing(false);
              }}
              placeholder={t("binding.dirPh")}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-active-fg"
            />
            <button
              type="button"
              title={t("binding.browse")}
              onClick={() => setBrowseOpen(true)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <FolderSearch className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* 仓库模式：基准分支输入 */}
      {value.kind === "repo" && (
        <input
          value={value.baseBranch}
          onChange={(e) => onChange({ ...value, baseBranch: e.target.value })}
          placeholder={t("repo.branchPh")}
          className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-active-fg"
        />
      )}

      {/* 当前模式说明 */}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {value.kind === "repo"
          ? `${t("binding.worktreeHint")} · ${branch}`
          : value.kind === "dir"
            ? t("binding.inPlaceHint")
            : t("binding.emptyHint")}
      </p>

      {/* 浏览执行机目录（经 server 中继到 daemon）→ 选完回填并立即提交 */}
      <FolderBrowserDialog
        open={browseOpen}
        workspaceId={workspaceId}
        preferredRuntimeId={runtimeId}
        initialPath={dirDraft}
        onClose={() => setBrowseOpen(false)}
        onPick={(p) => {
          setBrowseOpen(false);
          setDirDraft(p);
          commitDir(p);
        }}
      />

      <CreateRepoDialog
        open={addOpen}
        workspaceId={workspaceId}
        onClose={() => setAddOpen(false)}
        onCreated={(r) => {
          setRepos((prev) => [r, ...prev]);
          setDirEditing(false);
          onChange({ kind: "repo", repoId: r.id, baseBranch: r.defaultBranch });
        }}
      />
    </div>
  );
}
