import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";

import "@/styles/index.css";
import { Layout } from "@/components/Layout";
import { AuthGate } from "@/components/AuthGate";
import { RequirementsView } from "@/views/RequirementsView";
import { IssueDetailView } from "@/views/IssueDetailView";
import { AgentsView } from "@/views/AgentsView";
import { AgentDetailView } from "@/views/AgentDetailView";
import { SkillsView } from "@/views/SkillsView";
import { RuntimesView } from "@/views/RuntimesView";
import { RuntimeDetailView } from "@/views/RuntimeDetailView";
import { SettingsView } from "@/views/SettingsView";
import { AuthView } from "@/views/AuthView";
import { useAuth, restoreAuth } from "@/lib/auth-store";

let restoreStarted = false;

/** /auth 页：已登录则回首页；否则展示登录注册 */
function AuthRoute() {
  const { status } = useAuth();

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
  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }
  return <AuthView />;
}

const router = createBrowserRouter([
  { path: "/auth", element: <AuthRoute /> },
  {
    path: "/",
    element: (
      <AuthGate>
        <Layout />
      </AuthGate>
    ),
    children: [
      { index: true, element: <Navigate to="/requirements" replace /> },
      { path: "overview", element: <Navigate to="/requirements" replace /> },
      { path: "requirements", element: <RequirementsView /> },
      { path: "issues/:id", element: <IssueDetailView /> },
      { path: "runtime", element: <RuntimesView /> },
      { path: "runtime/:id", element: <RuntimeDetailView /> },
      { path: "agents", element: <AgentsView /> },
      { path: "agents/:id", element: <AgentDetailView /> },
      { path: "skills", element: <SkillsView /> },
      { path: "settings", element: <SettingsView /> },
      { path: "*", element: <Navigate to="/requirements" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
