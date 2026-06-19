import { useEffect, useState } from "react";
import { Plus, Server, Trash2 } from "lucide-react";

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

  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [addOpen, setAddOpen] = useState(false);

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

  async function remove(rt: Runtime) {
    if (!wsId) return;
    if (!window.confirm(t("runtime.deleteConfirm"))) return;
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
              onClick={() => setAddOpen(true)}
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
                className="h-14 animate-pulse rounded-xl bg-muted/50"
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
                onClick={() => setAddOpen(true)}
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
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      rt.online ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                    title={rt.online ? t("runtime.online") : t("runtime.offline")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {rt.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {rt.online ? t("runtime.online") : t("runtime.offline")}
                      {caps ? ` · ${caps}` : ` · ${t("runtime.notConnected")}`}
                      {rt.lastHeartbeatAt
                        ? ` · ${relativeTime(rt.lastHeartbeatAt, locale)}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    title={t("runtime.delete")}
                    onClick={() => remove(rt)}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {wsId && (
        <CreateRuntimeDialog
          open={addOpen}
          workspaceId={wsId}
          onClose={() => setAddOpen(false)}
          onDone={load}
        />
      )}
    </Panel>
  );
}
