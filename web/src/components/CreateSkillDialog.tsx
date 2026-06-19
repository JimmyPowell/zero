import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUi } from "@/lib/ui-store";
import { api, ApiError } from "@/lib/api-client";

// 新建 / 编辑技能：name + description + SKILL.md 正文（不含 frontmatter）。
// 编辑时按 id 拉取详情以载入正文（列表项不含 content）。
export function CreateSkillDialog({
  open,
  workspaceId,
  skillId,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspaceId: string;
  skillId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useUi();
  const editing = !!skillId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!skillId) {
      setName("");
      setDescription("");
      setContent("");
      return;
    }
    let alive = true;
    setLoading(true);
    void api
      .getSkill(workspaceId, skillId)
      .then((r) => {
        if (!alive) return;
        setName(r.skill.name);
        setDescription(r.skill.description);
        setContent(r.skill.content ?? "");
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, skillId, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (skillId) {
        await api.updateSkill(workspaceId, skillId, {
          name: name.trim(),
          description: description.trim(),
          content: content.trim() || null,
        });
      } else {
        await api.createSkill(workspaceId, {
          name: name.trim(),
          description: description.trim(),
          content: content.trim() || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog w-full max-w-[640px] rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-foreground">
          {editing ? t("skills.formEditTitle") : t("skills.formNewTitle")}
        </h2>

        {loading ? (
          <div className="mt-5 h-64 animate-pulse rounded-xl bg-muted/50" />
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("skills.name")}
              </span>
              <Input
                autoFocus
                placeholder={t("skills.namePh")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("skills.desc")}
              </span>
              <Input
                placeholder={t("skills.descPh")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <span className="text-xs text-muted-foreground/80">
                {t("skills.descHint")}
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("skills.content")}
              </span>
              <Textarea
                className="min-h-[220px] font-mono text-[13px]"
                placeholder={t("skills.contentPh")}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={submitting || loading || !name.trim() || !description.trim()}
          >
            {submitting
              ? editing
                ? t("skills.saving")
                : t("skills.creating")
              : editing
                ? t("skills.save")
                : t("skills.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
