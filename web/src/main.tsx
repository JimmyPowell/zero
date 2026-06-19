import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";

import "@/styles/index.css";
import { Layout } from "@/components/Layout";
import { OverviewView } from "@/views/OverviewView";
import { PlaceholderView } from "@/views/PlaceholderView";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <OverviewView /> },
      {
        path: "requirements",
        element: <PlaceholderView titleKey="menu.requirements" />,
      },
      {
        path: "runtime",
        element: <PlaceholderView titleKey="menu.runtime" />,
      },
      { path: "agents", element: <PlaceholderView titleKey="menu.agents" /> },
      { path: "*", element: <Navigate to="/overview" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
