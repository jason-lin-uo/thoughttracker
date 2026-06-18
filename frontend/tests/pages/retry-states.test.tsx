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

import { api } from "../../src/lib/api";
import { renderPage, renderWithRoute } from "./_render";
import { VideosPage } from "../../src/pages/VideosPage";
import { EvidencePage } from "../../src/pages/EvidencePage";
import { ComparePage } from "../../src/pages/ComparePage";
import { ReportsPage } from "../../src/pages/ReportsPage";
import { VideoDetailPage } from "../../src/pages/VideoDetailPage";
import { EvidenceDetailPage } from "../../src/pages/EvidenceDetailPage";
import { ImportJobDetailPage } from "../../src/pages/ImportJobDetailPage";
import { ReportDetailPage } from "../../src/pages/ReportDetailPage";

/**
 * onRetry coverage (audit §7: "onRetry on every ErrorState").
 *
 * Each page below now renders its `ErrorState` WITH a retry button wired to
 * the failing query's `refetch`. These tests fail the query, click "Try
 * again", and assert the page re-issues the request — exercising the
 * `onRetry={() => query.refetch()}` arrow on every page the audit flagged.
 */
beforeEach(() => vi.clearAllMocks());

/** Count how many times `api.get` was called for a given path substring. */
function callsFor(path: string): number {
  return vi.mocked(api.get).mock.calls.filter(([p]) => String(p).includes(path))
    .length;
}

describe("ErrorState retry wiring", () => {
  it("VideosPage retries the videos query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/videos") throw new Error("v-fail");
      return { items: [] };
    });
    renderPage(<VideosPage />);
    await waitFor(() => expect(screen.getByText("v-fail")).toBeInTheDocument());
    const before = callsFor("/videos");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(callsFor("/videos")).toBeGreaterThan(before));
  });

  it("EvidencePage retries the evidence query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/evidence") throw new Error("ev-fail");
      return { items: [] };
    });
    renderPage(<EvidencePage />);
    await waitFor(() =>
      expect(screen.getByText("ev-fail")).toBeInTheDocument(),
    );
    const before = callsFor("/evidence");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(callsFor("/evidence")).toBeGreaterThan(before));
  });

  it("ReportsPage retries the reports query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/reports") throw new Error("rep-fail");
      return { items: [] };
    });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("rep-fail")).toBeInTheDocument(),
    );
    const before = callsFor("/reports");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(callsFor("/reports")).toBeGreaterThan(before));
  });

  it("ComparePage retries the creators-list query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") throw new Error("creators-fail");
      return {};
    });
    renderPage(<ComparePage />);
    await waitFor(() =>
      expect(screen.getByText("creators-fail")).toBeInTheDocument(),
    );
    const before = callsFor("/creators");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(callsFor("/creators")).toBeGreaterThan(before));
  });

  it("ComparePage retries the compare query (deep-linked selection)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators")
        return {
          items: [
            {
              id: "c1",
              name: "Alice",
              slug: "a",
              videoCount: 1,
              transcriptCount: 1,
              topicCount: 1,
            },
            {
              id: "c2",
              name: "Bob",
              slug: "b",
              videoCount: 1,
              transcriptCount: 1,
              topicCount: 1,
            },
          ],
        };
      if (path === "/creators/compare") throw new Error("compare-fail");
      return {};
    });
    /* Deep-link two creators so the compare query fires immediately. */
    renderPage(<ComparePage />, "/compare?creators=c1,c2");
    await waitFor(() =>
      expect(screen.getByText("compare-fail")).toBeInTheDocument(),
    );
    const before = callsFor("/creators/compare");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(callsFor("/creators/compare")).toBeGreaterThan(before),
    );
  });

  it("VideoDetailPage retries the video query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new Error("vd-fail"));
    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("vd-fail")).toBeInTheDocument(),
    );
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("EvidenceDetailPage retries the detail query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new Error("ed-fail"));
    renderWithRoute(
      "/evidence/:analysisId",
      EvidenceDetailPage,
      "/evidence/an1",
    );
    await waitFor(() =>
      expect(screen.getByText("ed-fail")).toBeInTheDocument(),
    );
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("ImportJobDetailPage retries the job query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new Error("job-fail"));
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job1");
    await waitFor(() =>
      expect(screen.getByText("job-fail")).toBeInTheDocument(),
    );
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("VideoDetailPage retries the transcript query when it fails", async () => {
    const user = userEvent.setup();
    /*
     * Video resolves with an available transcript (so the transcript query is
     * enabled), but the transcript fetch fails → its own ErrorState + retry.
     */
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/videos/v1")
        return {
          id: "v1",
          creatorId: "c1",
          title: "Hello",
          description: null,
          publishedAt: "2026-01-01T00:00:00Z",
          durationSeconds: 60,
          thumbnailUrl: null,
          sourceUrl: "u",
          sourceVideoId: "v1",
          transcriptStatus: "available",
          analysisStatus: "completed",
          videoSummaries: [],
          _count: { chunks: 0 },
        };
      if (path === "/videos/v1/transcript") throw new Error("tx-fail");
      return {};
    });
    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("tx-fail")).toBeInTheDocument(),
    );
    const before = callsFor("/videos/v1/transcript");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(callsFor("/videos/v1/transcript")).toBeGreaterThan(before),
    );
  });

  it("ImportJobDetailPage retries the items query when it fails", async () => {
    const user = userEvent.setup();
    /*
     * Job resolves (completed → no polling), but the items query fails → the
     * items-section ErrorState + retry.
     */
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/import-jobs/job1")
        return {
          id: "job1",
          channelUrl: "https://x",
          requestedLimit: 10,
          status: "completed",
          totalVideosFound: 1,
          totalVideosImported: 1,
          totalTranscriptsImported: 1,
          totalFailed: 0,
          errorMessage: null,
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T00:01:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          creator: null,
        };
      if (path === "/import-jobs/job1/items") throw new Error("items-fail");
      return {};
    });
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job1");
    await waitFor(() =>
      expect(screen.getByText("items-fail")).toBeInTheDocument(),
    );
    const before = callsFor("/import-jobs/job1/items");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(callsFor("/import-jobs/job1/items")).toBeGreaterThan(before),
    );
  });

  it("ReportDetailPage retries the report query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new Error("rd-fail"));
    renderWithRoute("/reports/:reportId", ReportDetailPage, "/reports/r1");
    await waitFor(() =>
      expect(screen.getByText("rd-fail")).toBeInTheDocument(),
    );
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before),
    );
  });
});
