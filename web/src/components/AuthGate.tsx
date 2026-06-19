import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth, restoreAuth } from "@/lib/auth-store";

let restoreStarted = false;

/** 应用启动时恢复登录态；未登录跳转到 /auth */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!restoreStarted) {
      restoreStarted = true;
      void restoreAuth();
    }
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-sidebar">
        <span className="text-sm text-muted-foreground">加载中…</span>
      </div>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
