import { useEffect, useState, type ReactNode } from "react";
import { X, FileDiff } from "lucide-react";
import { DiffView, DiffModeEnum, getLang } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import {
  api,
  type RunFileChange,
  type RunChangeSummary,
} from "@/lib/api-client";

const statusBadge: Record<string, { label: string; cls: string }> = {
  added: {
    label: "A",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  modified: {
    label: "M",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  deleted: { label: "D", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
  renamed: { label: "R", cls: "bg-[#2563eb]/15 text-[#2563eb]" },
};

// 用 @git-diff-view/react 渲染单文件 git patch：GitHub 风格、内置 lowlight 语法高亮、
// 大文件虚拟滚动。只喂 patch（hunks）→ 纯 diff 模式，无需整文件内容。
function DiffBody({
  file,
  mode,
  wrap,
  dark,
}: {
  file: RunFileChange;
  mode: DiffModeEnum;
  wrap: boolean;
  dark: boolean;
}) {
  const newName = file.path;
  const oldName = file.oldPath ?? file.path;
  return (
    <div className="overflow-x-auto bg-card text-xs">
      <DiffView
        data={{
          hunks: [file.patch ?? ""],
          oldFile: { fileName: oldName, fileLang: getLang(oldName) },
          newFile: { fileName: newName, fileLang: getLang(newName) },
        }}
        diffViewMode={mode}
        diffViewWrap={wrap}
        diffViewHighlight
        diffViewTheme={dark ? "dark" : "light"}
        diffViewFontSize={12}
      />
    </div>
  );
}

function FileBlock({
  file,
  mode,
  wrap,
  dark,
}: {
  file: RunFileChange;
  mode: DiffModeEnum;
  wrap: boolean;
  dark: boolean;
}) {
  const { t } = useUi();
  const badge = statusBadge[file.status] ?? statusBadge.modified;
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70"
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-bold",
            badge.cls,
          )}
        >
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {!file.isBinary && (
          <span className="shrink-0 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{file.additions}
            </span>{" "}
            <span className="text-red-600 dark:text-red-400">
              −{file.deletions}
            </span>
          </span>
        )}
      </button>
      {open &&
        (file.isBinary ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t("diff.binary")}
          </p>
        ) : file.patch ? (
          <DiffBody file={file} mode={mode} wrap={wrap} dark={dark} />
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t("diff.noPatch")}
          </p>
        ))}
    </div>
  );
}

// 段控小按钮（统一/并排/换行 切换）
function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function DiffOverlay({
  workspaceId,
  issueId,
  taskId,
  onClose,
}: {
  workspaceId: string;
  issueId: string;
  taskId: string;
  onClose: () => void;
}) {
  const { t, isDark } = useUi();
  const [summary, setSummary] = useState<RunChangeSummary | null>(null);
  const [files, setFiles] = useState<RunFileChange[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Unified);
  const [wrap, setWrap] = useState(true);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    api
      .listRunFiles(workspaceId, issueId, taskId)
      .then((r) => {
        if (!alive) return;
        setSummary(r.summary);
        setFiles(r.files);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [workspaceId, issueId, taskId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasFiles = status === "ready" && files.length > 0;

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog flex max-h-[84vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <FileDiff className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            {t("diff.title")}
          </span>
          {summary && (
            <span className="text-xs text-muted-foreground">
              ·{" "}
              {t("diff.filesChanged").replace(
                "{n}",
                String(summary.filesChanged),
              )}{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                +{summary.additions}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                −{summary.deletions}
              </span>
            </span>
          )}
          {/* 统一/并排 + 换行 切换 */}
          {hasFiles && (
            <div className="ml-auto flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
              <Seg
                active={mode === DiffModeEnum.Unified}
                onClick={() => setMode(DiffModeEnum.Unified)}
              >
                {t("diff.unified")}
              </Seg>
              <Seg
                active={mode === DiffModeEnum.Split}
                onClick={() => setMode(DiffModeEnum.Split)}
              >
                {t("diff.split")}
              </Seg>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <Seg active={wrap} onClick={() => setWrap((v) => !v)}>
                {t("diff.wrap")}
              </Seg>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
              hasFiles ? "" : "ml-auto",
            )}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {status === "loading" ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("diff.loading")}
            </p>
          ) : status === "error" || files.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("diff.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {files.map((f) => (
                <FileBlock
                  key={f.id}
                  file={f}
                  mode={mode}
                  wrap={wrap}
                  dark={isDark}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
