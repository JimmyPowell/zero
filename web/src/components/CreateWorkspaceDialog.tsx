import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { ApiError } from "@/lib/api-client";

export function CreateWorkspaceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useUi();
  const { createWorkspace } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  function reset() {
    setName("");
    setDescription("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createWorkspace(name.trim(), description.trim() || undefined);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="zero-dialog w-full max-w-[420px] rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">
          {t("ws.createTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("ws.createDesc")}
        </p>

        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3.5">
          <Input
            required
            autoFocus
            placeholder={t("ws.namePh")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder={t("ws.descPh")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? t("ws.creating") : t("ws.createBtn")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
