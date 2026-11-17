import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { initTheme } from "@workingspace/ui/theme";
import { AppShell } from "./components/app-shell";
import { LoginPage } from "./pages/login-page";
import "./index.css";

initTheme();

// Akai web: chat (6b.1, /chat/:id?) + Pengaturan Model (sumber, model, pembagian tugas, pemakaian).
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/chat" replace /> },
      { path: "/chat/:id?", lazy: async () => ({ Component: (await import("./pages/chat-page")).ChatPage }) },
      // Pengaturan (dialog, select, tabel) dimuat malas agar halaman masuk ringan
      { path: "/projects", lazy: async () => ({ Component: (await import("./pages/projects-page")).ProjectsPage }) },
      { path: "/projects/:id", lazy: async () => ({ Component: (await import("./pages/project-page")).ProjectPage }) },
      {
        path: "/connectors",
        lazy: async () => ({ Component: (await import("./pages/connectors-page")).ConnectorsPage }),
      },
      { path: "/plugins", lazy: async () => ({ Component: (await import("./pages/plugins-page")).PluginsPage }) },
      {
        path: "/schedules",
        lazy: async () => ({ Component: (await import("./pages/schedules-page")).SchedulesPage }),
      },
      { path: "/skills", lazy: async () => ({ Component: (await import("./pages/skills-page")).SkillsPage }) },
      { path: "/memory", lazy: async () => ({ Component: (await import("./pages/memory-page")).MemoryPage }) },
      { path: "/models", lazy: async () => ({ Component: (await import("./pages/models-page")).ModelsPage }) },
      { path: "*", element: <Navigate to="/chat" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster richColors position="top-center" />
  </StrictMode>,
);
