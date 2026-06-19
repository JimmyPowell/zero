import { useEffect, useState } from "react";
import { Mail, MessageSquare, Bell, Trash2, type LucideIcon } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type ChannelBinding,
  type UpsertChannelPayload,
} from "@/lib/api-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isUrl(v: string): boolean {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

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

// 单个渠道卡片：邮件 / 企业微信 共用，按 kind 取不同配置字段
function ChannelCard({
  wsId,
  kind,
  icon: Icon,
  label,
  desc,
  placeholder,
  binding,
  defaultValue,
  configKey,
  validate,
  invalidMsg,
  statusText,
  onChanged,
}: {
  wsId: string | null;
  kind: "email" | "wecom";
  icon: LucideIcon;
  label: string;
  desc: string;
  placeholder: string;
  binding: ChannelBinding | null;
  defaultValue: string;
  configKey: "address" | "webhookUrl";
  validate: (v: string) => boolean;
  invalidMsg: string;
  statusText: (binding: ChannelBinding) => string;
  onChanged: () => void;
}) {
  const { t } = useUi();
  const baseValue = binding?.config[configKey] ?? defaultValue;
  const baseEnabled = binding ? binding.enabled : true;

  const [value, setValue] = useState(baseValue);
  const [enabled, setEnabled] = useState(baseEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 绑定变化（首次加载 / 保存后重载）→ 同步本地态
  useEffect(() => {
    setValue(binding?.config[configKey] ?? defaultValue);
    setEnabled(binding ? binding.enabled : true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding]);

  const dirty = value !== baseValue || enabled !== baseEnabled;
  const active = binding != null && binding.enabled;

  async function save() {
    if (!wsId || saving) return;
    const v = value.trim();
    if (!validate(v)) {
      setError(invalidMsg);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: UpsertChannelPayload =
        kind === "email"
          ? { kind: "email", address: v, enabled }
          : { kind: "wecom", webhookUrl: v, enabled };
      await api.upsertChannel(wsId, payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!wsId || !binding) return;
    if (!window.confirm(t("settings.removeConfirm"))) return;
    await api.deleteChannel(wsId, binding.id);
    onChanged();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb]/10 text-[#2563eb]">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {label}
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
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>

          <Input
            className="mt-3"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {binding ? statusText(binding) : ""}
            </p>
            <div className="flex items-center gap-2">
              {binding && (
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
        </div>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { t } = useUi();
  const { currentWorkspace, user } = useAuth();
  const wsId = currentWorkspace?.id ?? null;
  const fallbackEmail = user?.email ?? "";

  const [channels, setChannels] = useState<ChannelBinding[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  function load() {
    if (!wsId) {
      setStatus("ready");
      return;
    }
    api
      .listChannels(wsId)
      .then((r) => {
        setChannels(r.channels);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }

  useEffect(() => {
    setStatus("loading");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  const emailBinding = channels.find((c) => c.kind === "email") ?? null;
  const wecomBinding = channels.find((c) => c.kind === "wecom") ?? null;

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

        {status === "loading" ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
            <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <ChannelCard
              wsId={wsId}
              kind="email"
              icon={Mail}
              label={t("settings.email")}
              desc={t("settings.emailDesc")}
              placeholder={t("settings.emailPh")}
              binding={emailBinding}
              defaultValue={fallbackEmail}
              configKey="address"
              validate={(v) => EMAIL_RE.test(v)}
              invalidMsg={t("settings.invalidEmail")}
              statusText={(b) =>
                t("settings.willSendTo").replace("{addr}", b.config.address ?? "")
              }
              onChanged={load}
            />
            <ChannelCard
              wsId={wsId}
              kind="wecom"
              icon={MessageSquare}
              label={t("settings.wecom")}
              desc={t("settings.wecomDesc")}
              placeholder={t("settings.wecomPh")}
              binding={wecomBinding}
              defaultValue=""
              configKey="webhookUrl"
              validate={isUrl}
              invalidMsg={t("settings.invalidUrl")}
              statusText={() => t("settings.wecomConfigured")}
              onChanged={load}
            />
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground/70">
          {t("settings.moreSoon")}
        </p>
      </div>
    </Panel>
  );
}
