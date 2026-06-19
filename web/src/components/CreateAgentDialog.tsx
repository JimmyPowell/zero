import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { pillTrigger } from "@/components/issue/pill";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import {
  api,
  ApiError,
  type Agent,
  type AgentProvider,
  type Runtime,
} from "@/lib/api-client";

const PROVIDERS: AgentProvider[] = [
  "claude_code",
  "codex",
  "opencode",
  "codebuddy",
];
export const providerLabel: Record<AgentProvider, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  codebuddy: "CodeBuddy",
};

// 各 provider 常用模型建议（低成本优先）；点选即填入。模型框仍可自由输入。
const modelSuggestions: Record<AgentProvider, string[]> = {
  claude_code: ["haiku", "sonnet", "opus"],
  codex: [], // codex 模型 id 依本机 codex 版本而定，不给可能失效的建议
  opencode: ["opencode/deepseek-v4-flash-free"],
  // CodeBuddy（腾讯网关）支持模型，低成本在前
  codebuddy: [
    "gemini-3.1-flash-lite",
    "gemini-3.0-flash",
    "gemini-2.5-flash",
    "deepseek-v3-2-volc",
    "kimi-k2.5",
    "glm-5.0",
    "gemini-3.1-pro",
    "gpt-5.5",
  ],
};

export function CreateAgentDialog({
  open,
  workspaceId,
  agent,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspaceId: string;
  agent: Agent | null;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}) {
  const { t } = useUi();
  const editing = !!agent;

  const [name, setName] = useState("");
  const [provider, setProvider] = useState<AgentProvider>("claude_code");
  const [model, setModel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [runtimeId, setRuntimeId] = useState<string | null>(null);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 打开时初始化 + 拉取运行时
  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? "");
    setProvider(agent?.provider ?? "claude_code");
    setModel(agent?.model ?? "");
    setInstructions(agent?.instructions ?? "");
    setRuntimeId(agent?.runtimeId ?? null);
    setError(null);
  }, [open, agent]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api
      .listRuntimes(workspaceId)
      .then((r) => alive && setRuntimes(r.runtimes))
      .catch(() => alive && setRuntimes([]));
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const boundRuntime = runtimeId
    ? runtimes.find((r) => r.id === runtimeId)
    : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = editing
        ? (
            await api.updateAgent(workspaceId, agent!.id, {
              name: name.trim(),
              provider,
              model: model.trim() || null,
              instructions: instructions.trim() || null,
              runtimeId,
            })
          ).agent
        : (
            await api.createAgent(workspaceId, {
              name: name.trim(),
              provider,
              model: model.trim() || undefined,
              instructions: instructions.trim() || undefined,
              runtimeId,
            })
          ).agent;
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog w-full max-w-[480px] rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-foreground">
          {editing ? t("agents.formEditTitle") : t("agents.formNewTitle")}
        </h2>

        <div className="mt-5 flex flex-col gap-4">
          {/* 名称 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {t("agents.name")}
            </span>
            <Input
              autoFocus
              placeholder={t("agents.namePh")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {/* 底层工具 + 运行时 */}
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("agents.provider")}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className={pillTrigger}>
                  <span>{providerLabel[provider]}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[180px]">
                  {PROVIDERS.map((p) => (
                    <DropdownMenuItem key={p} onSelect={() => setProvider(p)}>
                      <span className="flex-1">{providerLabel[p]}</span>
                      <DropdownMenuCheck active={p === provider} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>

            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("agents.runtime")}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className={pillTrigger}>
                  <span className={cn(!boundRuntime && "text-muted-foreground")}>
                    {boundRuntime ? boundRuntime.name : t("agents.noRuntimeBind")}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  <DropdownMenuItem onSelect={() => setRuntimeId(null)}>
                    <span className="flex-1">{t("agents.noRuntimeBind")}</span>
                    <DropdownMenuCheck active={runtimeId == null} />
                  </DropdownMenuItem>
                  {runtimes.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onSelect={() => setRuntimeId(r.id)}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          r.online
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="flex-1 truncate">{r.name}</span>
                      <DropdownMenuCheck active={runtimeId === r.id} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
          </div>

          {/* 模型 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {t("agents.model")}
            </span>
            <Input
              placeholder={t("agents.modelPh")}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            {modelSuggestions[provider].length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {modelSuggestions[provider].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      model === m
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </label>

          {/* 系统指令 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {t("agents.instructions")}
            </span>
            <Textarea
              placeholder={t("agents.instructionsPh")}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
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
                ? t("agents.saving")
                : t("agents.creating")
              : editing
                ? t("agents.save")
                : t("agents.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
