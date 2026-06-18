import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { ToastProvider } from "../../src/toast/ToastProvider";

/**
 * Shared page-test render helpers.
 *
 * Every page test needs to mount its component inside the full provider stack
 * (Theme → Toast → React Query → Router). This module is the single source of
 * those wrappers — the audit (§9, "duplicated renderPage/renderWithRoute test
 * helpers") flagged that seven test files each re-declared identical copies.
 * They now all import from here so a change to the provider tree is one edit.
 *
 * A fresh `QueryClient` is created per render (retries disabled) so each test
 * starts with an empty cache and failures surface immediately rather than
 * being retried into a timeout.
 */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Render a page ELEMENT inside the provider stack + a `MemoryRouter` started
 * at `initialPath` (default "/"). Use when the component reads no route params.
 *
 * @param ui - The page element to render.
 * @param initialPath - The router's initial entry (default "/").
 */
export function renderPage(ui: React.ReactElement, initialPath = "/") {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={makeClient()}>
          <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

/**
 * Render `Component` under a single `<Route path={path}>` with the router
 * started at `initialPath`, so route params (`:creatorId`, etc.) resolve as
 * they do in the real app.
 *
 * @param path - The route pattern (e.g. "/creators/:creatorId").
 * @param Component - The page component to mount at that route.
 * @param initialPath - The concrete URL the router starts at.
 */
export function renderWithRoute(
  path: string,
  Component: React.ComponentType,
  initialPath: string,
) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={makeClient()}>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path={path} element={<Component />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}
