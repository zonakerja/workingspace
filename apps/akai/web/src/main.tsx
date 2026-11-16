import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { initTheme } from "@workingspace/ui/theme";
import { AppShell } from "./components/app-shell";
import { LoginPage } from "./pages/login-page";
import "./index.css";

initTheme();

// Langkah 6a.3: Akai web = Pengaturan Model (sumber, model, pembagian tugas, pemakaian). Chat menyusul (6b).
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/models" replace /> },
      // Pengaturan (dialog, select, tabel) dimuat malas agar halaman masuk ringan
      { path: "/models", lazy: async () => ({ Component: (await import("./pages/models-page")).ModelsPage }) },
      { path: "*", element: <Navigate to="/models" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster richColors position="top-center" />
  </StrictMode>,
);
