import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
  FileText,
  Server,
  Cpu,
} from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ActorAvatar";
import { CreateAgentDialog, providerLabel } from "@/components/CreateAgentDialog";
import { SkillAttachDialog } from "@/components/SkillAttachDialog";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { api, type AgentDetail, type RunStatus } from "@/lib/api-client";

function fmtCost(n: number): string {
  return `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const RUN_DOT: Record<RunStatus, string> = {
  queued: "bg-amber-400",
  running: "bg-[#2563eb]",
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

type Tab = "instructions" | "skills" | "activity";

export function AgentDetailView() {
  const { t, locale } = useUi();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("skills");
  const [editOpen, setEditOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  const load = useCallback(() => {
    if (!wsId || !id) return;
    api
      .getAgent(wsId, id)
      .then((d) => {
        setDetail(d);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [wsId, id]);

  useEffect(() => {
    setStatus("loading");
    load();
  }, [load]);

  const back = (
    <button
      type="button"
      onClick={() => navigate("/agents")}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t("agent.back")}
    </button>
  );

  if (status === "error" || (status === "ready" && !detail)) {
    return (
      <Panel>
        <div className="mx-auto w-full max-w-[820px]">
          {back}
          <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            {t("agent.notFound")}
          </div>
        </div>
      </Panel>
    );
  }

  if (!detail) {
    return (
      <Panel>
        <div className="mx-auto w-full max-w-[820px]">
          {back}
          <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        </div>
      </Panel>
    );
  }

  const { agent, runtime, skills, usage, recentRuns } = detail;

  async function detach(skillId: string) {
    if (!wsId || !id) return;
    const ids = skills.filter((s) => s.id !== skillId).map((s) => s.id);
    const r = await api.setAgentSkills(wsId, id, ids);
    setDetail((prev) => (prev ? { ...prev, skills: r.skills } : prev));
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "skills", label: t("agent.tabSkills") },
    { key: "instructions", label: t("agent.tabInstructions") },
    { key: "activity", label: t("agent.tabActivity") },
  ];

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px] pb-10">
        {back}

        {/* 头部 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <ActorAvatar
              type="agent"
              name={agent.name}
              url={agent.avatarUrl}
              className="size-10"
            />
            <div>
              <h2 className="text-xl font-semibold text-foreground">{agent.name}</h2>
              {agent.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {agent.description}
                </p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            {t("agent.edit")}
          </Button>
        </div>

        {/* 属性 */}
        <div className="mt-6">
          <SectionLabel>{t("agent.secProps")}</SectionLabel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("agents.provider")}</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-foreground">
                <Cpu className="size-3.5" />
                {providerLabel[agent.provider] ?? agent.provider}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("agents.model")}</p>
              <p className="mt-0.5 text-foreground">
                {agent.model || (
                  <span className="text-muted-foreground">{t("agent.noModel")}</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("agents.runtime")}</p>
              {runtime ? (
                <button
                  type="button"
                  onClick={() => navigate(`/runtime/${runtime.id}`)}
                  className="mt-0.5 inline-flex items-center gap-1.5 text-foreground hover:text-[#2563eb]"
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      runtime.online ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                  />
                  {runtime.name}
                </button>
              ) : (
                <p className="mt-0.5 inline-flex items-center gap-1 text-muted-foreground">
                  <Server className="size-3.5" />
                  {t("agent.noRuntime")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* tab 切换 */}
        <div className="mt-6 flex gap-1 border-b border-border">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === tb.key
                  ? "border-[#2563eb] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tb.label}
              {tb.key === "skills" && skills.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {skills.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {/* 技能 */}
          {tab === "skills" && (
            <div>
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="max-w-lg text-xs text-muted-foreground">
                  {t("agent.skillsHint")}
                </p>
                <Button size="sm" variant="outline" onClick={() => setAttachOpen(true)}>
                  <Plus className="size-4" />
                  {t("agent.addSkill")}
                </Button>
              </div>
              {skills.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
                  <FileText className="size-7 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("agent.skillsEmpty")}
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {skills.map((s) => (
                    <li
                      key={s.id}
                      className="group flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5"
                    >
                      <FileText className="mt-0.5 size-4 shrink-0 text-violet-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {s.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        title={t("agent.removeSkill")}
                        onClick={() => void detach(s.id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 系统指令 */}
          {tab === "instructions" && (
            <div>
              <p className="mb-3 max-w-lg text-xs text-muted-foreground">
                {t("agent.instructionsHint")}
              </p>
              {agent.instructions ? (
                <pre className="overflow-auto rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
                  {agent.instructions}
                </pre>
              ) : (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("agent.instructionsEmpty")}
                </div>
              )}
            </div>
          )}

          {/* 活动 */}
          {tab === "activity" && (
            <div>
              <div className="mb-4 flex gap-3">
                <div className="flex-1 rounded-xl border border-border bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">{t("agent.usageRuns")}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {usage.runs}
                  </p>
                </div>
                <div className="flex-1 rounded-xl border border-border bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">{t("agent.usageCost")}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {fmtCost(usage.costUsd)}
                  </p>
                </div>
                <div className="flex-1 rounded-xl border border-border bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {t("agent.usageTokens")}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {fmtTokens(usage.inputTokens + usage.outputTokens)}
                  </p>
                </div>
              </div>

              <SectionLabel>{t("agent.secActivity")}</SectionLabel>
              {recentRuns.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("agent.activityEmpty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {recentRuns.map((r) => (
                    <li
                      key={r.taskId}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/issues/${r.issueId}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") navigate(`/issues/${r.issueId}`);
                      }}
                      className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-[#2563eb]/40 hover:bg-muted/30"
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", RUN_DOT[r.status])} />
                      <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                        ZERO-{r.issueNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {r.issueTitle}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t(`run.status.${r.status}`)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {relativeTime(r.createdAt, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {wsId && (
        <>
          <CreateAgentDialog
            open={editOpen}
            workspaceId={wsId}
            agent={agent}
            onClose={() => setEditOpen(false)}
            onSaved={load}
          />
          {id && (
            <SkillAttachDialog
              open={attachOpen}
              workspaceId={wsId}
              agentId={id}
              attachedIds={skills.map((s) => s.id)}
              onClose={() => setAttachOpen(false)}
              onSaved={(next) =>
                setDetail((prev) => (prev ? { ...prev, skills: next } : prev))
              }
            />
          )}
        </>
      )}
    </Panel>
  );
}
