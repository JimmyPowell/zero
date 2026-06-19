import { useEffect, useState, type FormEvent } from "react";
import { Copy, Check, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { api, ApiError } from "@/lib/api-client";

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
  onClose,
  onDone,
}: {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useUi();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setToken(null);
    }
  }, [open]);

  if (!open) return null;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createRuntime(workspaceId, { name: name.trim() });
      setToken(res.token);
      onDone(); // 刷新列表（新建的运行时已存在，离线态）
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
      <div
        className="zero-dialog w-full max-w-[480px] rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {token == null ? (
          <form onSubmit={create}>
            <h2 className="text-lg font-semibold text-foreground">
              {t("runtime.addTitle")}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("runtime.addDesc")}
            </p>
            <Input
              autoFocus
              className="mt-4"
              placeholder={t("runtime.namePh")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
                {submitting ? t("runtime.creating") : t("runtime.create")}
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
