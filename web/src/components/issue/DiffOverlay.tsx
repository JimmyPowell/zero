import { useEffect, useState } from "react";
import { X, FileDiff } from "lucide-react";

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

// 手写彩色 unified diff（直接吃 git patch，按行首着色）
function DiffBody({ patch }: { patch: string }) {
  return (
    <div className="overflow-x-auto bg-card font-mono text-xs leading-[1.5]">
      {patch.split("\n").map((line, i) => {
        let cls = "text-foreground/80";
        if (line.startsWith("@@")) cls = "bg-[#2563eb]/10 text-[#2563eb]";
        else if (line.startsWith("+++") || line.startsWith("---"))
          cls = "text-muted-foreground";
        else if (line.startsWith("+"))
          cls = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
        else if (line.startsWith("-"))
          cls = "bg-red-500/10 text-red-700 dark:text-red-300";
        else if (/^(diff |index |new file|deleted file|rename |similarity )/.test(line))
          cls = "text-muted-foreground/70";
        return (
          <div key={i} className={cn("px-3 whitespace-pre", cls)}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

function FileBlock({ file }: { file: RunFileChange }) {
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
          <DiffBody patch={file.patch} />
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t("diff.noPatch")}
          </p>
        ))}
    </div>
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
  const { t } = useUi();
  const [summary, setSummary] = useState<RunChangeSummary | null>(null);
  const [files, setFiles] = useState<RunFileChange[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

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

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog flex max-h-[84vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
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
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
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
                <FileBlock key={f.id} file={f} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
