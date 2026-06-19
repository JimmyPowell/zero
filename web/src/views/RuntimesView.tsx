import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Server, Trash2, Pencil, Lock, Users, Gauge } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { CreateRuntimeDialog } from "@/components/CreateRuntimeDialog";
import { providerLabel } from "@/components/CreateAgentDialog";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { api, type Runtime, type AgentProvider } from "@/lib/api-client";

function capsLabel(caps: Record<string, boolean> | null): string {
  if (!caps) return "";
  return Object.entries(caps)
    .filter(([, on]) => on)
    .map(([k]) => providerLabel[k as AgentProvider] ?? k)
    .join(" · ");
}

export function RuntimesView() {
  const { t, locale } = useUi();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;
  const navigate = useNavigate();

  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Runtime | null>(null);

  function load() {
    if (!wsId) return;
    api
      .listRuntimes(wsId)
      .then((r) => {
        setRuntimes(r.runtimes);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }

  // 进入即加载，并每 15s 轮询刷新在线状态
  useEffect(() => {
    if (!wsId) return;
    setStatus("loading");
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(rt: Runtime) {
    setEditing(rt);
    setDialogOpen(true);
  }

  async function remove(rt: Runtime) {
    if (!wsId) return;
    const msg = rt.isOwner
      ? t("runtime.deleteOwnConfirm")
      : t("runtime.detachConfirm");
    if (!window.confirm(msg)) return;
    await api.deleteRuntime(wsId, rt.id);
    setRuntimes((prev) => prev.filter((r) => r.id !== rt.id));
  }

  const loading = status === "loading" && runtimes.length === 0;

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("runtime.title")}
          </h2>
          {wsId && (
            <Button
              size="sm"
              onClick={openAdd}
              className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
            >
              <Plus className="size-4" />
              {t("runtime.add")}
            </Button>
          )}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("runtime.subtitle")}
        </p>

        {loading ? (
          <div className="flex flex-col gap-1.5 py-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-muted/50"
              />
            ))}
          </div>
        ) : runtimes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
            <Server className="size-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("runtime.empty")}
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {t("runtime.emptyHint")}
            </p>
            {wsId && (
              <Button
                size="sm"
                className="mt-4 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                onClick={openAdd}
              >
                <Plus className="size-4" />
                {t("runtime.add")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {runtimes.map((rt) => {
              const caps = capsLabel(rt.capabilities);
              return (
                <div
                  key={rt.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/runtime/${rt.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/runtime/${rt.id}`);
                  }}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-[#2563eb]/40 hover:bg-muted/30"
                >
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      rt.online ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                    title={
                      rt.online ? t("runtime.online") : t("runtime.offline")
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {rt.name}
                      </p>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]",
                          rt.visibility === "private"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-sky-100 text-sky-700",
                        )}
                      >
                        {rt.visibility === "private" ? (
                          <Lock className="size-3" />
                        ) : (
                          <Users className="size-3" />
                        )}
                        {rt.visibility === "private"
                          ? t("runtime.private")
                          : t("runtime.shared")}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs text-muted-foreground">
                      <span>
                        {rt.online ? t("runtime.online") : t("runtime.offline")}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">
                        <Gauge className="size-3" />
                        {rt.maxConcurrency}
                      </span>
                      {rt.agentCount > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            {t("runtime.agentsBound").replace(
                              "{n}",
                              String(rt.agentCount),
                            )}
                          </span>
                        </>
                      )}
                      {caps ? (
                        <>
                          <span>·</span>
                          <span className="truncate">{caps}</span>
                        </>
                      ) : (
                        <>
                          <span>·</span>
                          <span>{t("runtime.notConnected")}</span>
                        </>
                      )}
                      {rt.lastHeartbeatAt && (
                        <>
                          <span>·</span>
                          <span>{relativeTime(rt.lastHeartbeatAt, locale)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
                    <button
                      type="button"
                      title={t("runtime.edit")}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(rt);
                      }}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      title={t("runtime.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(rt);
                      }}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {wsId && (
        <CreateRuntimeDialog
          open={dialogOpen}
          workspaceId={wsId}
          runtime={editing}
          onClose={() => setDialogOpen(false)}
          onDone={load}
        />
      )}
    </Panel>
  );
}
