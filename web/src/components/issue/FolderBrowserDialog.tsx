import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderGit2,
  House,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import {
  api,
  ApiError,
  type Runtime,
  type RuntimeDirListing,
} from "@/lib/api-client";

// 浏览执行机（运行时所在机器）的目录树来选「工作目录就地」：
// 浏览器 → server → daemon 中继列目录，不要求浏览器和 daemon 同机。
// 点子目录进入，面包屑 / 上一级逐级返回，也可直接输入路径跳转；「选择此目录」回填当前目录。
export function FolderBrowserDialog({
  open,
  workspaceId,
  preferredRuntimeId,
  initialPath,
  onClose,
  onPick,
}: {
  open: boolean;
  workspaceId: string;
  // 指派的智能体所绑运行时（任务实际在那台机器上跑），没有则从在线运行时里选
  preferredRuntimeId?: string | null;
  initialPath?: string;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const { t } = useUi();
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [runtimeId, setRuntimeId] = useState<string | null>(null);
  const [listing, setListing] = useState<RuntimeDirListing | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0); // 只认最后一次请求的结果（快速连点时丢弃旧响应）

  // 打开时拉运行时列表，默认选指派智能体的那台（在线时），否则第一台在线的
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRuntimes(null);
    setListing(null);
    setError(null);
    void api
      .listRuntimes(workspaceId)
      .then((r) => {
        if (!alive) return;
        const online = r.runtimes.filter((x) => x.online);
        setRuntimes(online);
        const preferred = online.find((x) => x.id === preferredRuntimeId);
        setRuntimeId((preferred ?? online[0])?.id ?? null);
      })
      .catch((err) => {
        if (!alive) return;
        setRuntimes([]);
        setError(err instanceof ApiError ? err.message : "网络错误，请重试");
      });
    return () => {
      alive = false;
    };
  }, [open, workspaceId, preferredRuntimeId]);

  async function load(path: string, hidden = showHidden, fallbackHome = false) {
    if (!runtimeId) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.browseRuntimeDir(workspaceId, runtimeId, path, hidden);
      if (my !== seq.current) return;
      setListing(r);
      setPathDraft(r.path);
    } catch (err) {
      if (my !== seq.current) return;
      // 初始路径已不存在等情况：退回主目录，不让人对着一个错误发呆
      if (fallbackHome && path) return void load("", hidden);
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  // 换运行时（含首次选定）→ 从已填路径或主目录开始
  useEffect(() => {
    if (open && runtimeId) void load(initialPath?.trim() ?? "", showHidden, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runtimeId]);

  if (!open) return null;

  const cur = listing?.path ?? "";
  // 面包屑：/ → /home → /home/you …
  const crumbs = cur
    .split("/")
    .filter(Boolean)
    .map((seg, i, all) => ({ seg, path: "/" + all.slice(0, i + 1).join("/") }));
  const noRuntime = runtimes !== null && runtimes.length === 0;

  return createPortal(
    <div
      className="zero-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="zero-dialog flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-base font-semibold text-foreground">
            {t("binding.browseTitle")}
          </h2>
          {runtimes && runtimes.length > 0 && (
            <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {t("binding.browseRuntime")}
              {runtimes.length > 1 ? (
                <select
                  value={runtimeId ?? ""}
                  onChange={(e) => setRuntimeId(e.target.value)}
                  className="h-7 max-w-[180px] truncate rounded-md border border-border bg-background px-1.5 text-xs text-foreground outline-none"
                >
                  {runtimes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="truncate font-medium text-foreground">
                  {runtimes[0]!.name}
                </span>
              )}
            </label>
          )}
        </div>

        {noRuntime ? (
          <p className="mx-5 my-6 rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
            {error ?? t("binding.browseNoRuntime")}
          </p>
        ) : (
          <>
            {/* 路径栏：上一级 / 主目录 / 输入跳转 */}
            <div className="mt-4 flex gap-1.5 px-5">
              <IconBtn
                title={t("binding.browseUp")}
                disabled={!listing?.parent || loading}
                onClick={() => listing?.parent && void load(listing.parent)}
              >
                <ArrowUp className="size-4" />
              </IconBtn>
              <IconBtn
                title={t("binding.browseHome")}
                disabled={!runtimeId || loading}
                onClick={() => void load("")}
              >
                <House className="size-4" />
              </IconBtn>
              <input
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void load(pathDraft.trim());
                  }
                }}
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-active-fg"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!runtimeId || loading}
                onClick={() => void load(pathDraft.trim())}
              >
                {t("binding.browseGo")}
              </Button>
            </div>

            {/* 面包屑 */}
            <div className="mt-2 flex min-h-5 flex-wrap items-center gap-0.5 px-5 font-mono text-[11px] text-muted-foreground">
              <button
                type="button"
                className="rounded px-1 hover:bg-sidebar-accent hover:text-foreground"
                onClick={() => void load("/")}
              >
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight className="size-3 opacity-50" />}
                  <button
                    type="button"
                    className={cn(
                      "rounded px-1 hover:bg-sidebar-accent hover:text-foreground",
                      i === crumbs.length - 1 && "text-foreground",
                    )}
                    onClick={() => void load(c.path)}
                  >
                    {c.seg}
                  </button>
                </span>
              ))}
            </div>

            {/* 子目录列表 */}
            <div className="mx-5 mt-2 h-[320px] overflow-y-auto rounded-xl border border-border">
              {error ? (
                <p className="m-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : !listing ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("binding.browseLoading")}
                </div>
              ) : listing.entries.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  {t("binding.browseEmpty")}
                </p>
              ) : (
                <ul className={cn("py-1", loading && "opacity-60")}>
                  {listing.entries.map((e) => {
                    const Icon = e.isRepo ? FolderGit2 : Folder;
                    return (
                      <li key={e.name}>
                        <button
                          type="button"
                          onClick={() =>
                            void load(cur === "/" ? `/${e.name}` : `${cur}/${e.name}`)
                          }
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-sidebar-accent"
                        >
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              e.isRepo ? "text-active-fg" : "text-amber-500",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{e.name}</span>
                          {e.isRepo && (
                            <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                              {t("binding.browseRepo")}
                            </span>
                          )}
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {listing?.truncated && (
              <p className="mx-5 mt-1 text-[11px] text-muted-foreground">
                {t("binding.browseTruncated")}
              </p>
            )}
          </>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showHidden}
              disabled={noRuntime}
              onChange={(e) => {
                setShowHidden(e.target.checked);
                if (listing) void load(listing.path, e.target.checked);
              }}
            />
            {t("binding.browseHidden")}
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!listing || loading || !!error}
              onClick={() => listing && onPick(listing.path)}
            >
              {t("binding.browsePick")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
