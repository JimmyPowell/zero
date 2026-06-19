import { useEffect, useState, type FormEvent } from "react";
import { Github } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { api, ApiError } from "@/lib/api-client";

// 从 GitHub 导入技能：粘贴含 SKILL.md 的目录 / 文件链接
export function ImportSkillDialog({
  open,
  workspaceId,
  onClose,
  onImported,
}: {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useUi();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.importSkill(workspaceId, url.trim());
      onImported();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog w-full max-w-[520px] rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Github className="size-5" />
          {t("skills.importTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("skills.importDesc")}
        </p>

        <div className="mt-4">
          <Input
            autoFocus
            placeholder={t("skills.importPh")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !url.trim()}>
            {submitting ? t("skills.importing") : t("skills.importBtn")}
          </Button>
        </div>
      </form>
    </div>
  );
}
