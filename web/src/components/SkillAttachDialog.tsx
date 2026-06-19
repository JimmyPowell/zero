import { useEffect, useState } from "react";
import { Check, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { api, ApiError, type Skill, type AgentSkillRef } from "@/lib/api-client";

// 给 agent 添加技能：列出库里「尚未挂载」的技能，多选后整体 setAgentSkills。
export function SkillAttachDialog({
  open,
  workspaceId,
  agentId,
  attachedIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspaceId: string;
  agentId: string;
  attachedIds: string[];
  onClose: () => void;
  onSaved: (skills: AgentSkillRef[]) => void;
}) {
  const { t } = useUi();
  const [all, setAll] = useState<Skill[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPicked(new Set());
    let alive = true;
    setLoading(true);
    void api
      .listSkills(workspaceId)
      .then((r) => alive && setAll(r.skills))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "加载失败"))
      .finally(() => alive && setLoading(false));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, workspaceId, onClose]);

  if (!open) return null;

  const attached = new Set(attachedIds);
  const available = all.filter((s) => !attached.has(s.id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (saving || picked.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const ids = [...attachedIds, ...picked];
      const r = await api.setAgentSkills(workspaceId, agentId, ids);
      onSaved(r.skills);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog flex max-h-[70vh] w-full max-w-[520px] flex-col rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-foreground">
          {t("agent.attachTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("agent.attachDesc")}</p>

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-muted/50" />
          ) : available.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t("agent.attachEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {available.map((s) => {
                const on = picked.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        on
                          ? "border-[#2563eb]/40 bg-[#2563eb]/5"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                          on
                            ? "border-[#2563eb] bg-[#2563eb] text-white"
                            : "border-border",
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          {s.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {s.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={confirm} disabled={saving || picked.size === 0}>
            {saving
              ? t("agent.attachSaving")
              : `${t("agent.attachConfirm")}${picked.size ? ` (${picked.size})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
