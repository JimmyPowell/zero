import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { api, ApiError, type Repo } from "@/lib/api-client";

export function CreateRepoDialog({
  open,
  workspaceId,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (repo: Repo) => void;
}) {
  const { t } = useUi();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  function reset() {
    setName("");
    setUrl("");
    setBranch("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { repo } = await api.createRepo(workspaceId, {
        name: name.trim(),
        url: url.trim(),
        defaultBranch: branch.trim() || undefined,
      });
      onCreated(repo);
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
      className="zero-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="zero-dialog w-full max-w-[420px] rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">
          {t("repo.addTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("repo.addDesc")}
        </p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-3.5">
          <Input
            autoFocus
            placeholder={t("repo.namePh")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder={t("repo.urlPh")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            placeholder={t("repo.branchDefaultPh")}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
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
            <Button
              type="submit"
              disabled={submitting || !name.trim() || !url.trim()}
            >
              {submitting ? t("repo.creating") : t("repo.create")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
