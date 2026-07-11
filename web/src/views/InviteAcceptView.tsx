import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useUi } from "@/lib/ui-store";
import { useAuth, restoreAuth } from "@/lib/auth-store";
import { api, ApiError, type InvitePreview } from "@/lib/api-client";

let restoreStarted = false;

export function InviteAcceptView() {
  const { t } = useUi();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { status, refreshWorkspaces, selectWorkspace } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 直接打开链接（未经 AuthGate）时，自己触发一次登录态恢复
  useEffect(() => {
    if (!restoreStarted) {
      restoreStarted = true;
      void restoreAuth();
    }
  }, []);

  // 登录后拉取邀请预览
  useEffect(() => {
    if (status !== "authenticated" || !token) return;
    setLoadingPreview(true);
    api
      .previewInvite(token)
      .then((p) => setPreview(p))
      .catch(() =>
        setPreview({
          valid: false,
          reason: "not_found",
          role: null,
          workspace: null,
          inviterName: null,
          alreadyMember: false,
        }),
      )
      .finally(() => setLoadingPreview(false));
  }, [status, token]);

  if (status === "loading") {
    return <Centered>{t("accept.loading")}</Centered>;
  }

  // 未登录：跳登录页，登录后回到本邀请页
  if (status === "anonymous") {
    return (
      <Navigate to="/auth" replace state={{ from: `/invite/${token}` }} />
    );
  }

  async function accept() {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const r = await api.acceptInvite(token);
      await refreshWorkspaces();
      selectWorkspace(r.workspace.id);
      navigate("/requirements", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("accept.err"));
    } finally {
      setJoining(false);
    }
  }

  async function enterExisting() {
    if (!preview?.workspace) return;
    await refreshWorkspaces();
    selectWorkspace(preview.workspace.id);
    navigate("/requirements", { replace: true });
  }

  const roleName = preview?.role
    ? t(`members.role.${preview.role}`)
    : "";

  return (
    <div className="flex min-h-svh items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-card p-7 shadow-xl">
        {loadingPreview ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("accept.loading")}
          </p>
        ) : !preview || (!preview.valid && !preview.alreadyMember) ? (
          <>
            <h1 className="text-lg font-semibold text-foreground">
              {t("accept.invalid")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(`accept.reason.${preview?.reason ?? "not_found"}`)}
            </p>
            <Button
              variant="outline"
              className="mt-5 w-full"
              onClick={() => navigate("/", { replace: true })}
            >
              {t("accept.back")}
            </Button>
          </>
        ) : (
          <>
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[#2563eb] text-xl font-bold text-white">
              {(preview.workspace?.name ?? "?").charAt(0).toUpperCase()}
            </span>
            <h1 className="mt-4 text-lg font-semibold text-foreground">
              {t("accept.title")}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {preview.inviterName
                ? t("accept.invitedBy").replace("{name}", preview.inviterName)
                : t("accept.invited")}{" "}
              <span className="font-medium text-foreground">
                {preview.workspace?.name}
              </span>
            </p>
            {roleName && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("accept.asRole").replace("{role}", roleName)}
              </p>
            )}

            {preview.alreadyMember ? (
              <>
                <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  {t("accept.already")}
                </p>
                <Button className="mt-4 w-full" onClick={enterExisting}>
                  {t("accept.enter")}
                </Button>
              </>
            ) : (
              <>
                {error && (
                  <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  className="mt-5 w-full bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
                  onClick={accept}
                  disabled={joining}
                >
                  {joining ? t("accept.joining") : t("accept.join")}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-sidebar">
      <span className="text-sm text-muted-foreground">{children}</span>
    </div>
  );
}
