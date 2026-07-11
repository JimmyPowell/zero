import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { api, ApiError, type InviteRole } from "@/lib/api-client";

type Expiry = "7" | "30" | "never";

export function InviteMemberDialog({
  open,
  workspaceId,
  canInviteAdmin,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspaceId: string;
  canInviteAdmin: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { t } = useUi();
  const [role, setRole] = useState<InviteRole>("member");
  const [expiry, setExpiry] = useState<Expiry>("7");
  const [once, setOnce] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setRole("member");
    setExpiry("7");
    setOnce(false);
    setUrl(null);
    setCopied(false);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function generate() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.createInvite(workspaceId, {
        role,
        expiresInDays: expiry === "never" ? 0 : Number(expiry),
        ...(once ? { maxUses: 1 } : {}),
      });
      setUrl(r.url);
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("invite.err"));
    } finally {
      setSubmitting(false);
    }
  }

  function copy() {
    if (!url) return;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const roleOptions: { value: InviteRole; label: string }[] = [
    { value: "member", label: t("invite.roleMember") },
    ...(canInviteAdmin
      ? [{ value: "admin" as const, label: t("invite.roleAdmin") }]
      : []),
  ];
  const expiryOptions: { value: Expiry; label: string }[] = [
    { value: "7", label: t("invite.expiry7") },
    { value: "30", label: t("invite.expiry30") },
    { value: "never", label: t("invite.expiryNever") },
  ];

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="zero-dialog w-full max-w-[440px] rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">
          {t("invite.title")}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("invite.desc")}
        </p>

        {url ? (
          <div className="mt-5">
            <p className="text-sm text-muted-foreground">
              {t("invite.linkReady")}
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <Link2 className="size-4 flex-shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {url}
              </code>
              <button
                type="button"
                onClick={copy}
                title={t("invite.copy")}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                {copied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => reset()}>
                {t("invite.again")}
              </Button>
              <Button onClick={close}>{t("invite.done")}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            {/* 角色 */}
            <div>
              <p className="text-xs text-muted-foreground">
                {t("invite.roleLabel")}
              </p>
              <div className="mt-1.5 flex gap-2">
                {roleOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setRole(o.value)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                      role === o.value
                        ? "border-[#2563eb] bg-[#2563eb]/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {role === "admin" && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("invite.roleAdminHint")}
                </p>
              )}
            </div>

            {/* 有效期 */}
            <div>
              <p className="text-xs text-muted-foreground">
                {t("invite.expiryLabel")}
              </p>
              <div className="mt-1.5 flex gap-2">
                {expiryOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setExpiry(o.value)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                      expiry === o.value
                        ? "border-[#2563eb] bg-[#2563eb]/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 仅一次 */}
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground select-none">
              <input
                type="checkbox"
                checked={once}
                onChange={(e) => setOnce(e.target.checked)}
                className="size-4 rounded border-border accent-[#2563eb]"
              />
              {t("invite.onceLabel")}
            </label>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button onClick={generate} disabled={submitting}>
                {submitting ? t("invite.generating") : t("invite.generate")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
