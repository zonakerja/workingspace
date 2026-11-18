import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { NotFoundPage, RouteError } from "@/components/common/route-error";
import { RequireAuth } from "@/features/auth/require-auth";

/**
 * Peta rute aplikasi. Setiap modul di-lazy-load (code splitting) dan memiliki
 * error boundary sendiri. Tab modul ada di segmen URL: /planner/:tab.
 */
export const router = createBrowserRouter([
  { path: "/login", lazy: () => import("@/features/auth/login-page"), errorElement: <RouteError /> },
  // Brankas digital publik (tanpa login): bukti data dukung renaksi yang dibuka atasan / pejabat pembina kepegawaian
  { path: "/brankas/:token", lazy: () => import("@/features/vault/public-vault-page"), errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      // Jendela Google Picker (tanpa kerangka aplikasi), dibuka tombol "Dari Drive"
      { path: "/drive-picker", lazy: () => import("@/features/drive/drive-picker-page") },
      {
        element: <AppShell />,
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { index: true, lazy: () => import("@/features/overview/overview-page") },
              { path: "planner/:tab?", lazy: () => import("@/features/planner/planner-page") },
              { path: "notes/:tab?", lazy: () => import("@/features/notes/notes-page") },
              { path: "knowledge/:tab?", lazy: () => import("@/features/knowledge/workspace/knowledge-page") },
              { path: "working-space/:tab?", lazy: () => import("@/features/working-space/working-space-page") },
              { path: "file-control/:tab?", lazy: () => import("@/features/file-control/file-control-page") },
              { path: "requests/:tab?", lazy: () => import("@/features/requests/requests-page") },
              { path: "agent/:tab?", lazy: () => import("@/features/agent/agent-page") },
              { path: "kinerja/:tab?", lazy: () => import("@/features/kinerja/kinerja-page") },
              { path: "srikandi/:tab?", lazy: () => import("@/features/srikandi/srikandi-page") },
              { path: "siman/:tab?", lazy: () => import("@/features/siman/siman-page") },
              { path: "email/:tab?", lazy: () => import("@/features/email/email-page") },
              { path: "custom/:slug", lazy: () => import("@/features/custom/custom-menu-page") },
              { path: "tools/:tab?", lazy: () => import("@/features/tools/tools-page") },
              { path: "settings/:tab?", lazy: () => import("@/features/settings/settings-page") },
              { path: "profile", lazy: () => import("@/features/profile/profile-page") },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
