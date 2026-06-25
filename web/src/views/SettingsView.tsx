import { useEffect, useState, type ReactNode } from "react";
import {
  Mail,
  MessageSquare,
  Send,
  Bell,
  Server,
  Trash2,
  Copy,
  Check,
  type LucideIcon,
} from "lucide-react";

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
  type UpsertEmailProviderPayload,
} from "@/lib/api-client";

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

// 渠道卡片（邮件这类「填值即生效」的渠道；企业微信走绑定码，见 WecomCard）
function ChannelCard({
  wsId,
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
  icon: LucideIcon;
  label: string;
  desc: string;
  placeholder: string;
  binding: ChannelBinding | null;
  defaultValue: string;
  configKey: "address";
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
      const payload: UpsertChannelPayload = {
        kind: "email",
        address: v,
        enabled,
      };
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

// 绑定码型渠道卡片（企业微信 / Telegram 共用）：生成码 → 用户发给 bot → 自动绑定
function LinkCodeCard({
  wsId,
  icon: Icon,
  label,
  desc,
  boundText,
  codeHint,
  unbindConfirm,
  genCode,
  binding,
  onChanged,
}: {
  wsId: string | null;
  icon: LucideIcon;
  label: string;
  desc: string;
  boundText: string;
  codeHint: string;
  unbindConfirm: string;
  genCode: (wsId: string) => Promise<string>;
  binding: ChannelBinding | null;
  onChanged: () => void;
}) {
  const { t } = useUi();
  const [code, setCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const active = binding != null && binding.enabled;

  // 展示了绑定码且尚未绑定 → 轮询刷新，用户发码后自动显示「已绑定」
  useEffect(() => {
    if (!code || active) return;
    const id = setInterval(() => onChanged(), 3000);
    return () => clearInterval(id);
  }, [code, active, onChanged]);
  // 绑定成功后收起绑定码
  useEffect(() => {
    if (active) setCode(null);
  }, [active]);

  async function gen() {
    if (!wsId || generating) return;
    setGenerating(true);
    try {
      setCode(await genCode(wsId));
    } finally {
      setGenerating(false);
    }
  }

  async function unbind() {
    if (!wsId || !binding) return;
    if (!window.confirm(unbindConfirm)) return;
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
            {active && (
              <button
                type="button"
                onClick={unbind}
                title={t("settings.unbind")}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>

          {active ? (
            <p className="mt-3 text-xs text-emerald-600">{boundText}</p>
          ) : code ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">{codeHint}</p>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <code className="flex-1 font-mono text-sm font-semibold text-foreground">
                  {code}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(code);
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
          ) : (
            <div className="mt-3">
              <Button
                size="sm"
                onClick={gen}
                disabled={generating}
                className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
              >
                {generating ? t("settings.generating") : t("settings.genCode")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 带标签的输入项
function Labeled({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// SMTP 服务器卡片（A 层：发信凭据，仅 owner/admin 可见可改）。密码 write-only，永不回显。
function SmtpServerCard({ wsId }: { wsId: string | null }) {
  const { t } = useUi();
  const [cryptoReady, setCryptoReady] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("465");
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [fromName, setFromName] = useState("Zero");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!wsId) return;
    api
      .getEmailProvider(wsId)
      .then((r) => {
        setCryptoReady(r.cryptoReady);
        if (r.config) {
          setHost(r.config.host);
          setPort(String(r.config.port));
          setSecure(r.config.secure);
          setUser(r.config.user);
          setFrom(r.config.from);
          setFromName(r.config.fromName || "Zero");
          setEnabled(r.config.enabled);
          setHasPassword(r.config.hasPassword);
        }
      })
      .catch(() => {});
  }, [wsId]);

  async function save() {
    if (!wsId || saving) return;
    if (!host.trim() || !from.trim()) {
      setMsg({ ok: false, text: t("settings.smtpNeedHostFrom") });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const payload: UpsertEmailProviderPayload = {
        host: host.trim(),
        port: Number(port) || 465,
        secure,
        user: user.trim(),
        from: from.trim(),
        fromName: fromName.trim() || "Zero",
        enabled,
      };
      if (pass) payload.pass = pass; // 留空 = 不改
      const r = await api.upsertEmailProvider(wsId, payload);
      if (r.config) setHasPassword(r.config.hasPassword);
      setPass("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : t("settings.netErr"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!wsId || testing) return;
    setTesting(true);
    setMsg(null);
    try {
      const r = await api.testEmailProvider(wsId);
      setMsg({
        ok: true,
        text: t("settings.smtpTestOk").replace("{addr}", r.sentTo ?? ""),
      });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : t("settings.netErr"),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb]/10 text-[#2563eb]">
          <Server className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {t("settings.smtpTitle")}
              <span
                className={cn(
                  "ml-2 rounded-full px-2 py-0.5 text-[11px] font-normal",
                  enabled && host
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {enabled && host ? t("settings.on") : t("settings.off")}
              </span>
            </p>
            <Switch checked={enabled} onChange={setEnabled} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.smtpDesc")}
          </p>

          {!cryptoReady && (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              {t("settings.smtpNoCrypto")}
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Labeled label={t("settings.smtpHost")}>
                <Input
                  placeholder="smtp.qq.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </Labeled>
            </div>
            <Labeled label={t("settings.smtpPort")}>
              <Input
                inputMode="numeric"
                placeholder="465"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </Labeled>
            <div className="flex items-end justify-between gap-2 pb-1">
              <span className="text-xs text-muted-foreground">
                {t("settings.smtpSecure")}
              </span>
              <Switch checked={secure} onChange={setSecure} />
            </div>
            <Labeled label={t("settings.smtpUser")}>
              <Input
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </Labeled>
            <Labeled label={t("settings.smtpPass")}>
              <Input
                type="password"
                placeholder={
                  hasPassword
                    ? t("settings.smtpPassSet")
                    : t("settings.smtpPassPh")
                }
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </Labeled>
            <Labeled label={t("settings.smtpFrom")}>
              <Input
                placeholder="noreply@yourdomain.com"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Labeled>
            <Labeled label={t("settings.smtpFromName")}>
              <Input
                placeholder="Zero"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
            </Labeled>
          </div>

          {msg && (
            <p
              className={cn(
                "mt-2 text-xs",
                msg.ok ? "text-emerald-600" : "text-destructive",
              )}
            >
              {msg.text}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {t("settings.smtpTestHint")}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={test}
                disabled={testing || saving}
              >
                {testing ? t("settings.smtpTesting") : t("settings.smtpTest")}
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving}
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
  // SMTP 发信凭据是工作空间级发信身份，仅 owner/admin 可配置
  const isAdmin =
    currentWorkspace?.role === "owner" || currentWorkspace?.role === "admin";

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
  const telegramBinding = channels.find((c) => c.kind === "telegram") ?? null;

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
            {isAdmin && <SmtpServerCard wsId={wsId} />}
            <ChannelCard
              wsId={wsId}
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
            <LinkCodeCard
              wsId={wsId}
              icon={MessageSquare}
              label={t("settings.wecom")}
              desc={t("settings.wecomDesc")}
              boundText={t("settings.wecomBound")}
              codeHint={t("settings.wecomCodeHint")}
              unbindConfirm={t("settings.wecomUnbindConfirm")}
              genCode={(id) => api.createWecomLinkCode(id).then((r) => r.code)}
              binding={wecomBinding}
              onChanged={load}
            />
            <LinkCodeCard
              wsId={wsId}
              icon={Send}
              label={t("settings.telegram")}
              desc={t("settings.telegramDesc")}
              boundText={t("settings.telegramBound")}
              codeHint={t("settings.telegramCodeHint")}
              unbindConfirm={t("settings.telegramUnbindConfirm")}
              genCode={(id) =>
                api.createTelegramLinkCode(id).then((r) => r.code)
              }
              binding={telegramBinding}
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
