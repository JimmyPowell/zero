import { useEffect, useState, type FormEvent } from "react";
import { Copy, Check, Terminal, ChevronDown, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { pillTrigger } from "@/components/issue/pill";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type Runtime,
  type RuntimeVisibility,
} from "@/lib/api-client";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8787";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function CreateRuntimeDialog({
  open,
  workspaceId,
  runtime,
  onClose,
  onDone,
}: {
  open: boolean;
  workspaceId: string;
  runtime?: Runtime | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useUi();
  const { workspaces } = useAuth();
  const editing = !!runtime;
  // 编辑时仅 owner 可调触达范围；创建者天然是 owner
  const canEditReach = !editing || !!runtime?.isOwner;

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<RuntimeVisibility>("workspace");
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [reach, setReach] = useState<Set<string>>(new Set([workspaceId]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(runtime?.name ?? "");
    setVisibility(runtime?.visibility ?? "workspace");
    setMaxConcurrency(runtime?.maxConcurrency ?? 1);
    setReach(new Set([workspaceId]));
    setError(null);
    setToken(null);
    // 编辑：拉详情拿当前触达范围
    if (runtime) {
      void api
        .getRuntime(workspaceId, runtime.id)
        .then((d) => setReach(new Set(d.reach.map((r) => r.id))))
        .catch(() => {});
    }
  }, [open, runtime, workspaceId]);

  if (!open) return null;

  function toggleReach(id: string) {
    if (id === workspaceId) return; // 当前空间必选
    setReach((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const ids = [...reach];
      if (editing) {
        await api.updateRuntime(workspaceId, runtime!.id, {
          name: name.trim(),
          visibility,
          maxConcurrency,
          ...(canEditReach ? { workspaceIds: ids } : {}),
        });
        onDone();
        onClose();
      } else {
        const res = await api.createRuntime(workspaceId, {
          name: name.trim(),
          visibility,
          maxConcurrency,
          workspaceIds: ids,
        });
        setToken(res.token); // 进入配对/令牌展示
        onDone();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  const reachLabel =
    reach.size <= 1
      ? workspaces.find((w) => w.id === workspaceId)?.name ?? "当前工作空间"
      : t("runtime.reachCount").replace("{n}", String(reach.size));

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="zero-dialog w-full max-w-[480px] rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {token == null ? (
          <form onSubmit={submit}>
            <h2 className="text-lg font-semibold text-foreground">
              {editing ? t("runtime.editTitle") : t("runtime.addTitle")}
            </h2>
            {!editing && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t("runtime.addDesc")}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-4">
              {/* 名称 */}
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("runtime.namePh")}
                </span>
                <Input
                  autoFocus
                  placeholder={t("runtime.namePh")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              {/* 谁能用（可见性） */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("runtime.visibility")}
                </span>
                <div className="flex gap-2">
                  {(["workspace", "private"] as RuntimeVisibility[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVisibility(v)}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                        visibility === v
                          ? "border-[#2563eb] bg-[#2563eb]/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {v === "workspace"
                        ? t("runtime.visWorkspace")
                        : t("runtime.visPrivate")}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {visibility === "workspace"
                    ? t("runtime.visWorkspaceHint")
                    : t("runtime.visPrivateHint")}
                </span>
              </div>

              {/* 在哪些工作空间（触达范围）—— 多工作空间且可编辑时才显示 */}
              {workspaces.length > 1 && canEditReach && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-muted-foreground">
                    {t("runtime.reach")}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger className={cn(pillTrigger, "max-w-full")}>
                      <span className="truncate">{reachLabel}</span>
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-h-[260px] min-w-[240px] overflow-auto"
                    >
                      {workspaces.map((w) => {
                        const isCurrent = w.id === workspaceId;
                        return (
                          <DropdownMenuItem
                            key={w.id}
                            disabled={isCurrent}
                            onSelect={(e) => {
                              e.preventDefault();
                              toggleReach(w.id);
                            }}
                          >
                            <span className="flex-1 truncate">
                              {w.name}
                              {isCurrent ? ` · ${t("runtime.you")}` : ""}
                            </span>
                            <DropdownMenuCheck active={reach.has(w.id)} />
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="text-xs text-muted-foreground">
                    {t("runtime.reachHint")}
                  </span>
                </div>
              )}

              {/* 并发上限 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("runtime.concurrency")}
                </span>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setMaxConcurrency((v) => Math.max(1, v - 1))
                    }
                    disabled={maxConcurrency <= 1}
                  >
                    <Minus className="size-4" />
                  </Button>
                  <span className="w-8 text-center text-sm font-medium tabular-nums">
                    {maxConcurrency}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setMaxConcurrency((v) => Math.min(16, v + 1))
                    }
                    disabled={maxConcurrency >= 16}
                  >
                    <Plus className="size-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("runtime.concurrencyHint")}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting
                  ? editing
                    ? t("runtime.saving")
                    : t("runtime.creating")
                  : editing
                    ? t("runtime.save")
                    : t("runtime.create")}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <Terminal className="size-5 text-active-fg" />
              <h2 className="text-lg font-semibold text-foreground">
                {t("runtime.pairTitle")}
              </h2>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("runtime.pairDesc")}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <CopyRow
                label={t("runtime.command")}
                value={`zero-daemon --server ${API_BASE} --token ${token}`}
              />
              <CopyRow label={t("runtime.token")} value={token} />
            </div>

            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("runtime.tokenOnce")}
            </p>

            <div className="mt-5 flex justify-end">
              <Button onClick={onClose}>{t("runtime.done")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
