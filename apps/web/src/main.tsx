import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
import "./styles/kairo.css";
import "./styles/fx.css";
import "./styles/astra.css";
import { registerPwa } from "./pwa/install";
import { ToastProvider } from "./ui/Toast";

// Installable as an app (Chrome, Edge, Android; iPhone and iPad via Add to Home Screen).
registerPwa();

// Monaco cancels its own pending work (suggestions, ghost text) while the student types,
// and some of those cancellations surface as unhandled "Canceled" rejections. They are
// expected, not errors.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as { name?: string; message?: string } | undefined;
  if (reason && (reason.name === "Canceled" || reason.message === "Canceled")) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
