import { useEffect, useState } from "react";
import { Plus, Bot, Pencil, Trash2 } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ActorAvatar";
import {
  CreateAgentDialog,
  providerLabel,
} from "@/components/CreateAgentDialog";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { api, type Agent, type Runtime } from "@/lib/api-client";

export function AgentsView() {
  const { t } = useUi();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [agents, setAgents] = useState<Agent[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);

  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    setStatus("loading");
    Promise.all([
      api.listAgents(wsId),
      api.listRuntimes(wsId).catch(() => ({ runtimes: [] as Runtime[] })),
    ])
      .then(([ag, rt]) => {
        if (!alive) return;
        setAgents(ag.agents);
        setRuntimes(rt.runtimes);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [wsId]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(agent: Agent) {
    setEditing(agent);
    setDialogOpen(true);
  }
  function onSaved(saved: Agent) {
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === saved.id);
      return exists
        ? prev.map((a) => (a.id === saved.id ? saved : a))
        : [saved, ...prev];
    });
  }
  async function remove(agent: Agent) {
    if (!wsId) return;
    if (!window.confirm(t("agents.deleteConfirm"))) return;
    await api.deleteAgent(wsId, agent.id);
    setAgents((prev) => prev.filter((a) => a.id !== agent.id));
  }

  const loading = status === "loading" && agents.length === 0;

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px]">
        {/* 标题行 + 新建 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("agents.title")}
          </h2>
          {wsId && (
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
            >
              <Plus className="size-4" />
              {t("agents.new")}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col gap-1.5 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
            <Bot className="size-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("agents.empty")}
            </p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              {t("agents.emptyHint")}
            </p>
            {wsId && (
              <Button
                size="sm"
                className="mt-4 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                onClick={openCreate}
              >
                <Plus className="size-4" />
                {t("agents.new")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {agents.map((agent) => {
              const rt = agent.runtimeId
                ? runtimes.find((r) => r.id === agent.runtimeId)
                : null;
              return (
              <div
                key={agent.id}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-active-fg/30"
              >
                <ActorAvatar
                  type="agent"
                  name={agent.name}
                  url={agent.avatarUrl}
                  className="size-8"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {agent.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {providerLabel[agent.provider]}
                    {agent.model ? ` · ${agent.model}` : ""} ·{" "}
                    {rt ? rt.name : t("agents.noRuntime")}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title={t("agents.edit")}
                    onClick={() => openEdit(agent)}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    title={t("agents.delete")}
                    onClick={() => remove(agent)}
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
        <CreateAgentDialog
          open={dialogOpen}
          workspaceId={wsId}
          agent={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={onSaved}
        />
      )}
    </Panel>
  );
}
