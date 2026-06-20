import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Lock,
  Users,
  Gauge,
  Server,
  Bot,
  Terminal,
} from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { CreateRuntimeDialog } from "@/components/CreateRuntimeDialog";
import { providerLabel } from "@/components/CreateAgentDialog";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  api,
  type AgentProvider,
  type RuntimeDetail,
  type RuntimeUsageDetail,
} from "@/lib/api-client";

function fmtCost(n: number): string {
  return `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

export function RuntimeDetailView() {
  const { t, locale } = useUi();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [detail, setDetail] = useState<RuntimeDetail | null>(null);
  const [usage, setUsage] = useState<RuntimeUsageDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    if (!wsId || !id) return;
    Promise.all([
      api.getRuntime(wsId, id),
      api.getRuntimeUsage(wsId, id, 30),
    ])
      .then(([d, u]) => {
        setDetail(d);
        setUsage(u);
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
      onClick={() => navigate("/runtime")}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t("runtime.back")}
    </button>
  );

  if (status === "error" || (status === "ready" && !detail)) {
    return (
      <Panel>
        <div className="mx-auto w-full max-w-[820px]">
          {back}
          <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            {t("runtime.notFound")}
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

  const rt = detail.runtime;
  const maxDayCost = Math.max(0.0001, ...usage!.byDay.map((d) => d.costUsd));
  const ownerName = rt.isOwner ? t("runtime.you") : rt.ownerName ?? "—";
  // daemon 上报的底层 coding CLI（与列表页同一份 capabilities）
  const caps = Object.entries(rt.capabilities ?? {})
    .filter(([, on]) => on)
    .map(([k]) => k);

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px] pb-10">
        {back}

        {/* 头部 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "size-2.5 rounded-full",
                rt.online ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            <h2 className="text-xl font-semibold text-foreground">{rt.name}</h2>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
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
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            {t("runtime.edit")}
          </Button>
        </div>

        {/* 基本信息 */}
        <div className="mt-6">
          <SectionLabel>{t("runtime.secBasic")}</SectionLabel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {t("runtime.owner")}
              </p>
              <p className="mt-0.5 text-foreground">{ownerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("runtime.concurrency")}
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-foreground">
                <Gauge className="size-3.5" />
                {rt.maxConcurrency}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("runtime.kind")}
              </p>
              <p className="mt-0.5 text-foreground">{rt.kind}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("runtime.heartbeat")}
              </p>
              <p className="mt-0.5 text-foreground">
                {rt.lastHeartbeatAt
                  ? relativeTime(rt.lastHeartbeatAt, locale)
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* 发现的工具（daemon 上报的底层 coding CLI） */}
        <div className="mt-6">
          <SectionLabel>{t("runtime.secCaps")}</SectionLabel>
          {caps.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {t("runtime.noCaps")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {caps.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-sm text-foreground"
                >
                  <Terminal className="size-3.5 text-muted-foreground" />
                  {providerLabel[k as AgentProvider] ?? k}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 触达范围 */}
        <div className="mt-6">
          <SectionLabel>{t("runtime.secReach")}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {detail.reach.map((w) => (
              <span
                key={w.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm",
                  w.id === wsId
                    ? "border-[#2563eb]/40 bg-[#2563eb]/10 text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                <Server className="size-3.5" />
                {w.name}
              </span>
            ))}
          </div>
        </div>

        {/* 绑定的智能体 */}
        <div className="mt-6">
          <SectionLabel>{t("runtime.secAgents")}</SectionLabel>
          {detail.agents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {t("runtime.noAgents")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {detail.agents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"
                >
                  <Bot className="size-4 text-violet-500" />
                  <span className="flex-1 truncate text-foreground">
                    {a.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {providerLabel[a.provider] ?? a.provider}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 用量与成本 */}
        <div className="mt-6">
          <div className="mb-2.5 flex items-baseline justify-between">
            <SectionLabel>{t("runtime.secUsage")}</SectionLabel>
            <span className="text-xs text-muted-foreground">
              {t("runtime.usageWindow")}
            </span>
          </div>

          <div className="flex gap-3">
            <Stat label={t("runtime.cost")} value={fmtCost(detail.usage.costUsd)} />
            <Stat label={t("runtime.runs")} value={String(detail.usage.runs)} />
            <Stat
              label={t("runtime.tokens")}
              value={fmtTokens(
                detail.usage.inputTokens + detail.usage.outputTokens,
              )}
            />
          </div>

          {detail.usage.noCostRuns > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("runtime.noCostHint").replace(
                "{n}",
                String(detail.usage.noCostRuns),
              )}
            </p>
          )}

          {detail.usage.runs === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {t("runtime.noUsage")}
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {/* 按天 */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t("runtime.byDay")}
                </p>
                <div className="flex flex-col gap-1.5">
                  {usage!.byDay.map((d) => (
                    <div key={d.date} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {d.date.slice(5)}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-[#2563eb]"
                          style={{
                            width: `${Math.max(4, (d.costUsd / maxDayCost) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">
                        {fmtCost(d.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 按智能体 */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t("runtime.byAgent")}
                </p>
                <div className="flex flex-col gap-1.5">
                  {usage!.byAgent.map((a) => (
                    <div
                      key={a.agentId ?? "unknown"}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Bot className="size-3.5 shrink-0 text-violet-500" />
                      <span className="flex-1 truncate text-foreground">
                        {a.agentName ?? "—"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {fmtTokens(a.tokens)} · {a.runs}
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">
                        {fmtCost(a.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {wsId && (
        <CreateRuntimeDialog
          open={editOpen}
          workspaceId={wsId}
          runtime={rt}
          onClose={() => setEditOpen(false)}
          onDone={load}
        />
      )}
    </Panel>
  );
}
