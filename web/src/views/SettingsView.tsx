import { useEffect, useState } from "react";
import { Mail, Bell, Trash2 } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { api, ApiError, type ChannelBinding } from "@/lib/api-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 轻量开关（无现成 Switch 组件，内联一个）
function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 flex-shrink-0 rounded-full transition-colors",
        checked ? "bg-[#2563eb]" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function SettingsView() {
  const { t } = useUi();
  const { currentWorkspace, user } = useAuth();
  const wsId = currentWorkspace?.id ?? null;
  const fallbackEmail = user?.email ?? "";

  const [loaded, setLoaded] = useState<ChannelBinding | null>(null);
  const [address, setAddress] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载我的邮件渠道绑定
  useEffect(() => {
    if (!wsId) {
      setAddress(fallbackEmail);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    api
      .listChannels(wsId)
      .then((r) => {
        const email = r.channels.find((c) => c.kind === "email") ?? null;
        setLoaded(email);
        setAddress(email?.config.address ?? fallbackEmail);
        setEnabled(email ? email.enabled : true);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  const baseAddress = loaded?.config.address ?? fallbackEmail;
  const baseEnabled = loaded ? loaded.enabled : true;
  const dirty = address !== baseAddress || enabled !== baseEnabled;

  async function save() {
    if (!wsId || saving) return;
    const addr = address.trim();
    if (!EMAIL_RE.test(addr)) {
      setError(t("settings.invalidEmail"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.upsertChannel(wsId, {
        kind: "email",
        address: addr,
        enabled,
      });
      setLoaded(res.channel);
      setAddress(res.channel.config.address ?? addr);
      setEnabled(res.channel.enabled);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!wsId || !loaded) return;
    if (!window.confirm(t("settings.removeConfirm"))) return;
    await api.deleteChannel(wsId, loaded.id);
    setLoaded(null);
    setAddress(fallbackEmail);
    setEnabled(true);
  }

  const active = loaded != null && loaded.enabled;

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[680px]">
        <h2 className="text-sm font-semibold text-foreground">
          {t("settings.title")}
        </h2>

        {/* 通知 section */}
        <div className="mt-5 flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.notifTitle")}
          </h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.notifDesc")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          {t("settings.notifEvents")}
        </p>

        {/* 邮件渠道卡片 */}
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb]/10 text-[#2563eb]">
              <Mail className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  {t("settings.email")}
                  <span
                    className={cn(
                      "ml-2 rounded-full px-2 py-0.5 text-[11px] font-normal",
                      active
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {active ? t("settings.on") : t("settings.off")}
                  </span>
                </p>
                <Switch checked={enabled} onChange={setEnabled} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.emailDesc")}
              </p>

              {status === "loading" ? (
                <div className="mt-3 h-9 animate-pulse rounded-lg bg-muted/50" />
              ) : (
                <>
                  <Input
                    className="mt-3"
                    type="email"
                    placeholder={t("settings.emailPh")}
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setError(null);
                    }}
                  />
                  {error && (
                    <p className="mt-2 text-xs text-destructive">{error}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">
                      {loaded
                        ? t("settings.willSendTo").replace(
                            "{addr}",
                            loaded.config.address ?? "",
                          )
                        : ""}
                    </p>
                    <div className="flex items-center gap-2">
                      {loaded && (
                        <button
                          type="button"
                          onClick={remove}
                          title={t("settings.remove")}
                          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                      <Button
                        size="sm"
                        onClick={save}
                        disabled={saving || (!dirty && !saved)}
                        className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                      >
                        {saving
                          ? t("settings.saving")
                          : saved
                            ? t("settings.saved")
                            : t("settings.save")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground/70">
          {t("settings.moreSoon")}
        </p>
      </div>
    </Panel>
  );
}
