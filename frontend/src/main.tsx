import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { App } from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ToastProvider } from "./toast/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createAppQueryClient } from "./lib/queryClient";
import bootstrapSnapshot from "./generated/bootstrapSnapshot.json";
import "./index.css";

/*
 * Local development should always show the current Vite bundle. If a previous
 * production/PWA preview registered a service worker on localhost, it can keep
 * serving stale UI code and make actions like "Generate report" look broken
 * even while the backend is working. Clear those registrations in dev only.
 */
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations.map((registration) => registration.unregister()),
      ),
    );
}

const queryClient = createAppQueryClient();

type BootstrapSnapshot = {
  queries?: Array<{ key: QueryKey; data: unknown }>;
};

function seedBootstrapSnapshot(snapshot: BootstrapSnapshot) {
  for (const entry of snapshot.queries ?? []) {
    queryClient.setQueryData(entry.key, entry.data);
    void queryClient.invalidateQueries({
      queryKey: entry.key,
      exact: true,
      refetchType: "none",
    });
  }
}

seedBootstrapSnapshot(bootstrapSnapshot as BootstrapSnapshot);

/*
 * Fail loudly with a clear message if the mount node is missing, rather than
 * the cryptic crash a non-null assertion (`!`) would produce on `null`.
 */
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Root element "#root" not found — cannot mount the app.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
