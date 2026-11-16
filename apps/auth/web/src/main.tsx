import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AccountPage } from "./pages/account-page";
import { LoginPage } from "./pages/login-page";
import { RegisterPage } from "./pages/register-page";
import { ForgotPasswordPage, ResetPasswordPage, VerifyPage } from "./pages/token-pages";
import { initTheme } from "@workingspace/ui/theme";
import "./index.css";

// Tema: Terang / Gelap / Ikuti sistem (pilihan per peramban, lib/theme.ts)
initTheme();

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/account" replace /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/verify", element: <VerifyPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset", element: <ResetPasswordPage /> },
  { path: "/account", element: <AccountPage /> },
  // Khusus super admin → dimuat malas (tabel, dialog, select tidak membebani halaman masuk)
  { path: "/admin", lazy: async () => ({ Component: (await import("./pages/admin-page")).AdminPage }) },
  { path: "*", element: <Navigate to="/account" replace /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
