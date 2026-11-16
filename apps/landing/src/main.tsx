import { initTheme } from "@workingspace/ui/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LandingPage } from "./landing-page";
import "./index.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
