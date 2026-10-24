import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Outside Tauri (plain `pnpm dev` in a browser), fake the backend with sample data.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  (await import("./lib/mock")).installMock();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
