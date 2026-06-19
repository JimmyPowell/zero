import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { ApiError } from "@/lib/api-client";

type Mode = "login" | "register";

export function AuthView() {
  const { t } = useUi();
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name.trim() || undefined);
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-[380px]">
        {/* 品牌 */}
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[#2563eb] text-lg font-bold text-white">
            Z
          </span>
          <span className="text-xl font-semibold tracking-tight text-foreground">
            Zero
          </span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <h1 className="mb-5 text-lg font-semibold text-foreground">
            {mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
          </h1>

          <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("auth.email")}
              </span>
              <Input
                type="email"
                required
                autoComplete="email"
                placeholder={t("auth.emailPh")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t("auth.password")}
              </span>
              <Input
                type="password"
                required
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={t("auth.passwordPh")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {mode === "register" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("auth.name")}
                </span>
                <Input
                  type="text"
                  placeholder={t("auth.namePh")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="mt-1 h-10 w-full justify-center"
            >
              {submitting
                ? t("auth.submitting")
                : mode === "login"
                  ? t("auth.loginBtn")
                  : t("auth.registerBtn")}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-active-fg hover:underline"
            onClick={() => {
              setMode((m) => (m === "login" ? "register" : "login"));
              setError(null);
            }}
          >
            {mode === "login" ? t("auth.toRegister") : t("auth.toLogin")}
          </button>
        </div>
      </div>
    </div>
  );
}
