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
  onChange,
}: {
  workspaceId: string;
  value: BindingValue;
  issueNumber?: number;
  onChange: (v: BindingValue) => void;
}) {
  const { t } = useUi();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [dirInput, setDirInput] = useState(false);
  const [dirPath, setDirPath] = useState("");
  const [browseErr, setBrowseErr] = useState(false);

  // 调本机 daemon 的本地选择器，弹原生文件夹对话框回填绝对路径
  async function browseFolder() {
    setBrowseErr(false);
    try {
      const res = await fetch("http://127.0.0.1:8799/pick-folder", {
        signal: AbortSignal.timeout(180000),
      });
      const data = (await res.json()) as { path: string | null };
      if (data.path) setDirPath(data.path);
    } catch {
      setBrowseErr(true);
    }
  }

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

  const repo =
    value.kind === "repo" ? repos.find((r) => r.id === value.repoId) : null;
  const branch = issueNumber ? `zero/ZERO-${issueNumber}` : "zero/ZERO-N";

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
          <DropdownMenuItem onSelect={() => onChange({ kind: "none" })}>
            <Boxes className="text-muted-foreground" />
            <span className="flex-1">{t("binding.none")}</span>
            <DropdownMenuCheck active={value.kind === "none"} />
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
              onSelect={() =>
                onChange({
                  kind: "repo",
                  repoId: r.id,
                  baseBranch: r.defaultBranch,
                })
              }
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
              setDirPath(value.kind === "dir" ? value.workDir : "");
              setDirInput(true);
            }}
          >
            <Folder className="text-muted-foreground" />
            {t("binding.bindDir")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 绑工作目录的路径输入（浏览 → 调本机选择器回填）*/}
      {dirInput && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dirPath.trim()) {
                  onChange({ kind: "dir", workDir: dirPath.trim() });
                  setDirInput(false);
                }
                if (e.key === "Escape") setDirInput(false);
              }}
              placeholder={t("binding.dirPh")}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-active-fg"
            />
            <button
              type="button"
              title={t("binding.browse")}
              onClick={browseFolder}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <FolderSearch className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (dirPath.trim()) {
                  onChange({ kind: "dir", workDir: dirPath.trim() });
                  setDirInput(false);
                }
              }}
              className="shrink-0 rounded-lg border border-border px-2.5 text-xs text-foreground hover:bg-sidebar-accent"
            >
              {t("binding.confirm")}
            </button>
          </div>
          {browseErr && (
            <p className="text-[11px] text-muted-foreground">
              {t("binding.browseErr")}
            </p>
          )}
        </div>
      )}

      {/* 仓库模式：基准分支 + 模式提示 */}
      {value.kind === "repo" && (
        <input
          value={value.baseBranch}
          onChange={(e) =>
            onChange({ ...value, baseBranch: e.target.value })
          }
          placeholder={t("repo.branchPh")}
          className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-active-fg"
        />
      )}

      {/* 当前模式说明（清晰展示给用户） */}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {value.kind === "repo"
          ? `${t("binding.worktreeHint")} · ${branch}`
          : value.kind === "dir"
            ? t("binding.inPlaceHint")
            : t("binding.emptyHint")}
      </p>

      <CreateRepoDialog
        open={addOpen}
        workspaceId={workspaceId}
        onClose={() => setAddOpen(false)}
        onCreated={(r) => {
          setRepos((prev) => [r, ...prev]);
          onChange({ kind: "repo", repoId: r.id, baseBranch: r.defaultBranch });
        }}
      />
    </div>
  );
}
