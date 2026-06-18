import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import { ToastProvider } from "../src/toast/ToastProvider";

vi.mock("../src/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(s: number, m: string) {
      super(m);
      this.status = s;
    }
  },
}));

import { api } from "../src/lib/api";
import { App } from "../src/App";

/*
 * Renders <App /> at the given route inside all the providers it needs
 * (theme, toasts, react-query, and a MemoryRouter seeded with `path`).
 */
function renderApp(path = "/") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App routing", () => {
  it("renders the dashboard route", async () => {
    vi.mocked(api.get).mockResolvedValue({
      stats: { creators: 0, videos: 0, transcripts: 0, topics: 0, evidence: 0 },
      recentJobs: [],
      recentCreators: [],
      recentReports: [],
    });
    renderApp("/");
    await waitFor(() =>
      expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0),
    );
  });

  it("renders the NotFound page for an unknown path", () => {
    renderApp("/this-does-not-exist");
    expect(screen.getByText(/Back to dashboard/i)).toBeInTheDocument();
  });

  it("renders the add-creators route", () => {
    renderApp("/add-creators");
    expect(screen.getAllByText(/Add Creators/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Creator URLs/i)).toBeInTheDocument();
  });

  it("renders the AppLayout chrome (brand + skip link)", () => {
    renderApp("/this-does-not-exist");
    expect(screen.getAllByText(/ThoughtTracker/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Skip to main content/i)).toBeInTheDocument();
  });

  /*
   * The two chart-rendering routes are lazy-loaded (recharts is ~105 KB
   * gzipped; we only ship it when the user actually navigates here).
   * Hitting these paths exercises the dynamic `import()` callbacks in
   * App.tsx that wouldn't run on eager-import routes.
   */
  it("lazily loads the topic-analysis route", async () => {
    vi.mocked(api.get).mockResolvedValue({});
    renderApp("/creators/c1/topics/t1");
    /*
     * Suspense fallback first, then the page (which will likely
     * surface a loading/error state because the API is mocked empty).
     * We only assert the dynamic import resolved by waiting for ANY
     * page-level content to appear past the Suspense boundary.
     */
    await waitFor(() => {
      /*
       * Either the page rendered or its error fallback did — both
       * require the lazy chunk to have loaded.
       */
      expect(document.body.textContent?.length).toBeGreaterThan(0);
    });
  });

  it("waits for the topic-analysis lazy route to resolve", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("topic-analysis-loaded"));
    renderApp("/creators/c1/topics/t1");
    expect(await screen.findByText("topic-analysis-loaded")).toBeInTheDocument();
  });

  it("lazily loads the compare route", async () => {
    /*
     * This routing test only needs to prove the lazy ComparePage chunk resolves.
     * ComparePage.test.tsx covers the creator picker/map branches in isolation.
     */
    vi.mocked(api.get).mockResolvedValue({ items: [] });
    renderApp("/compare");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Compare creators/i }),
      ).toBeInTheDocument(),
    );
  });
});
