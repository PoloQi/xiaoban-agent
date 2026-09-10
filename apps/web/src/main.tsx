import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

async function renderApp() {
  const query = new URLSearchParams(window.location.search);
  const showInternalSafetyPreview = import.meta.env.DEV
    && query.get("internalSafetyPreview") === "1";
  const RootComponent = showInternalSafetyPreview
    ? (await import("./InternalSafetyPreview")).InternalSafetyPreview
    : App;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RootComponent />
    </StrictMode>,
  );
}

void renderApp();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js");
  });
}
