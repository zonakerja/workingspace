import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import { restoreSsoLoginPrompt } from "@/features/security/pin-prompt";
import { bootstrapSession } from "@/lib/api/client";
import { initThemeSync } from "@/stores/ui-store";
import "./index.css";

initThemeSync();
// Baru kembali dari masuk lewat SSO → tawaran PIN seperti login biasa
restoreSsoLoginPrompt();
void bootstrapSession();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
