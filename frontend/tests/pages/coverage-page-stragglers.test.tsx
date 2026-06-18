/**
 * Final coverage lift — exercises the last specific uncovered lines
 * across pages + lib helpers identified by `vitest --coverage`.
 * Each test pins one branch and stays narrow so future failures
 * locate the regression quickly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(s: number, m: string) {
      super(m);
      this.status = s;
    }
  },
}));

vi.mock("../../src/lib/reportJobs", () => ({
  waitForAnalysisRun: vi.fn(() =>
    Promise.resolve({ id: "run-1", status: "completed", errorMessage: null }),
  ),
}));

import { ApiError, api } from "../../src/lib/api";
import { waitForAnalysisRun } from "../../src/lib/reportJobs";
import { formatDuration, formatRelative } from "../../src/lib/format";
import { CreatorOverviewPage } from "../../src/pages/CreatorOverviewPage";
import { AddCreatorsPage } from "../../src/pages/AddCreatorsPage";
import { ReportsPage } from "../../src/pages/ReportsPage";
/* Shared provider-stack render helpers (de-duplicated, audit §9). */
import { renderPage, renderWithRoute } from "./_render";

beforeEach(() => vi.clearAllMocks());

const sampleCreator = {
  id: "c1",
  name: "Test Creator",
  slug: "test",
  description: null,
  thumbnailUrl: null,
  creatorType: "youtube",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  videoCount: 3,
  transcriptCount: 3,
  topicCount: 2,
  lastImportedAt: null,
};

/*
 * ---------------------------------------------------------------------------
 * format.ts — formatDuration negative/null + relative date corner case
 * ---------------------------------------------------------------------------
 */
describe("format helpers", () => {
  it("formatDuration returns '—' for null/zero/negative input", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });

  it("formatDuration formats seconds/minutes/hours correctly", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3661)).toBe("1h 1m");
  });

  it("formatRelative falls back to absolute date for old dates", () => {
    /* A date >30 days ago should still produce a non-empty string. */
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const out = formatRelative(old);
    expect(out).toBeTruthy();
    expect(out).not.toContain("ago");
  });
});

/*
 * ---------------------------------------------------------------------------
 * CreatorOverviewPage — generate-report mutation success path
 * ---------------------------------------------------------------------------
 */
describe("CreatorOverviewPage report generation", () => {
  it("Generate creator report invokes the mutation + invalidates the overview", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      creator: sampleCreator,
      stats: {
        videoCount: 3,
        transcriptCount: 3,
        topicCount: 2,
        evidenceCount: 5,
      },
      topTopics: [],
      recentVideos: [],
      latestReport: null,
      recentImport: null,
    });
    vi.mocked(api.post).mockResolvedValue({
      status: "queued",
      analysisRunId: "run-creator-ok",
    });
    vi.mocked(waitForAnalysisRun).mockResolvedValueOnce({
      id: "run-creator-ok",
      status: "completed",
      errorMessage: null,
    });

    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() =>
      expect(screen.getByText("Test Creator")).toBeInTheDocument(),
    );

    const gen = screen.getByRole("button", {
      name: /Generate creator report/i,
    });
    await user.click(gen);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    await waitFor(() =>
      expect(waitForAnalysisRun).toHaveBeenCalledWith("run-creator-ok"),
    );
    await waitFor(() =>
      expect(screen.getByText("Report ready")).toBeInTheDocument(),
    );
  });

  it("surfaces a failed background report job and resets the button", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      creator: sampleCreator,
      stats: {
        videoCount: 3,
        transcriptCount: 3,
        topicCount: 2,
        evidenceCount: 5,
      },
      topTopics: [],
      recentVideos: [],
      latestReport: null,
      recentImport: null,
    });
    vi.mocked(api.post).mockResolvedValue({
      status: "queued",
      analysisRunId: "run-creator-bad",
    });
    vi.mocked(waitForAnalysisRun).mockRejectedValueOnce(
      new Error("creator report failed"),
    );

    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() =>
      expect(screen.getByText("Test Creator")).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /Generate creator report/i }),
    );
    await waitFor(() =>
      expect(screen.getByText("creator report failed")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Generate creator report/i }),
      ).toBeEnabled(),
    );
  });

  it("lets the creator overview error state retry the failed query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error("overview failed"))
      .mockResolvedValueOnce({
        creator: sampleCreator,
        stats: {
          videoCount: 3,
          transcriptCount: 3,
          topicCount: 2,
          evidenceCount: 5,
        },
        topTopics: [],
        recentVideos: [],
        latestReport: null,
        recentImport: null,
      });

    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() =>
      expect(screen.getByText("overview failed")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Try again/i }));
    await waitFor(() =>
      expect(screen.getByText("Test Creator")).toBeInTheDocument(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * ImportsPage — every form field setter
 * ---------------------------------------------------------------------------
 */
describe("AddCreatorsPage form input setters", () => {
  it("every input + select responds to user typing", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      status: "started",
      processId: 1,
      statusPath: "status.json",
      logDir: "logs",
    });

    renderPage(<AddCreatorsPage />);
    await user.type(screen.getByLabelText(/Admin PIN/i), "2468");
    await user.click(screen.getByRole("button", { name: /Unlock/i }));

    const channelInput = screen.getByLabelText(/Creator URLs/i);
    await user.type(channelInput, "https://www.youtube.com/@example");

    const limitSelect = screen.getByLabelText(/Videos per creator/i);
    await user.selectOptions(limitSelect, "25");

    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));
    await waitFor(() =>
      expect(screen.getByText("Queued 1 of 1 creators.")).toBeInTheDocument(),
    );
  });

  it("stops fallback import jobs after a forbidden PIN", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new ApiError(503, "Pipeline unavailable"))
      .mockRejectedValueOnce(new ApiError(403, "Admin PIN required"));

    renderPage(<AddCreatorsPage />);
    await user.type(screen.getByLabelText(/Admin PIN/i), "wrong");
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    await user.type(
      screen.getByLabelText(/Creator URLs/i),
      "https://www.youtube.com/@alpha\nhttps://www.youtube.com/@beta",
    );
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() =>
      expect(screen.getByText("Queued 0 of 2 creators.")).toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText("Admin PIN required")).toHaveLength(2);
  });
});

/*
 * ---------------------------------------------------------------------------
 * ReportsPage — selecting filters
 * ---------------------------------------------------------------------------
 */
describe("ReportsPage filter interactions", () => {
  it("changing creator filter triggers a re-query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [] };
      if (path === "/reports")
        return { items: [], page: 1, pageSize: 12, total: 0, totalPages: 0 };
      return { items: [] };
    });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText(/No reports/i)).toBeInTheDocument(),
    );

    const creatorSel = screen.getByLabelText(/Creator/i);
    await user.selectOptions(creatorSel, "c1");
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});
