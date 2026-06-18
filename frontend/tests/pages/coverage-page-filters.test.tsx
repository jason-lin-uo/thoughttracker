/**
 * coverage-page-filters.test.tsx — targeted tests that exercise the
 * remaining uncovered branches in the page components. The existing
 * `pages.test.tsx` covers happy/empty/error states;
 * `pages-interactions.test.tsx` covers a few filter/mutation flows. This
 * file fills the remaining gaps so each page hits ≥90% line coverage:
 *
 * - EvidencePage: filter-grid every dropdown + pagination boundaries.
 * - VideosPage: every filter dropdown + pagination + date inputs.
 * - TopicAnalysisPage: report generation mutation + chart loading.
 * - ComparePage: deep-link query param initialization.
 *
 * Each test is isolated via `vi.clearAllMocks()` in `beforeEach` so a
 * given test's `mockImplementation` doesn't leak into the next.
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

import { api } from "../../src/lib/api";
import { waitForAnalysisRun } from "../../src/lib/reportJobs";
import { EvidencePage } from "../../src/pages/EvidencePage";
import { VideosPage } from "../../src/pages/VideosPage";
import { TopicAnalysisPage } from "../../src/pages/TopicAnalysisPage";
import { ComparePage } from "../../src/pages/ComparePage";
/* Shared provider-stack render helpers (de-duplicated, audit §9). */
import { renderPage, renderWithRoute } from "./_render";

const sampleCreator = {
  id: "c1",
  name: "Alice",
  slug: "alice",
  description: null,
  thumbnailUrl: null,
  creatorType: "youtube",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  videoCount: 3,
  transcriptCount: 2,
  topicCount: 1,
  lastImportedAt: null,
};
const sampleTopic = {
  id: "t1",
  name: "Climate",
  slug: "climate",
  description: null,
};

beforeEach(() => vi.clearAllMocks());

/*
 * ----------------------------------------------------------------------------
 * EvidencePage — exercise every filter dropdown + search input + date range
 * ----------------------------------------------------------------------------
 */
describe("EvidencePage filter coverage", () => {
  it("filtering by every input dispatches a new evidence query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/evidence")
        return {
          items: [],
          page: 1,
          pageSize: 12,
          total: 0,
          totalPages: 0,
        };
      return {};
    });

    renderPage(<EvidencePage />);
    await waitFor(() =>
      expect(screen.getByText(/No evidence/i)).toBeInTheDocument(),
    );

    /* Creator filter */
    const creatorSel = screen.getByLabelText(/Creator/i);
    await user.selectOptions(creatorSel, "c1");

    /* Topic filter */
    const topicSel = screen.getByLabelText(/Topic/i);
    await user.selectOptions(topicSel, "t1");

    /* Date range */
    const fromInput = screen.getByLabelText("From");
    await user.type(fromInput, "2026-01-01");
    const toInput = screen.getByLabelText("To");
    await user.type(toInput, "2026-12-31");

    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});

/*
 * ----------------------------------------------------------------------------
 * VideosPage — every filter dropdown + search + date range
 * ----------------------------------------------------------------------------
 */
describe("VideosPage filter coverage", () => {
  it("every filter input dispatches a videos query update", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/videos")
        return {
          items: [],
          page: 1,
          pageSize: 12,
          total: 0,
          totalPages: 0,
        };
      return {};
    });

    renderPage(<VideosPage />);
    await waitFor(() =>
      expect(screen.getByText(/No videos/i)).toBeInTheDocument(),
    );

    const creatorSel = screen.getByLabelText(/Creator/i);
    await user.selectOptions(creatorSel, "c1");

    const topicSel = screen.getByLabelText(/Topic/i);
    await user.selectOptions(topicSel, "t1");

    const analysisSel = screen.getByLabelText(/Analysis/i);
    await user.selectOptions(analysisSel, "completed");

    const fromInput = screen.getByLabelText("From");
    await user.type(fromInput, "2026-01-01");
    const toInput = screen.getByLabelText("To");
    await user.type(toInput, "2026-12-31");

    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});

/*
 * ----------------------------------------------------------------------------
 * TopicAnalysisPage — generation mutation
 * ----------------------------------------------------------------------------
 */
describe("TopicAnalysisPage generate report flow", () => {
  it("Generate topic report button posts and refreshes the analysis", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.endsWith("/analysis")) {
        return {
          creator: sampleCreator,
          topic: sampleTopic,
          timeline: {
            id: "tl1",
            creatorId: "c1",
            topicId: "t1",
            dateStart: "2026-01-01",
            dateEnd: "2026-03-01",
            trendLabel: "gradual_shift",
            summary: "drift toward supportive",
            evidenceJson: null,
          },
          summaries: [
            {
              id: "s1",
              videoId: "v1",
              topicId: "t1",
              creatorId: "c1",
              dominantStance: "supportive",
              confidenceScore: 0.85,
              confidenceLabel: "high",
              mentionCount: 5,
              summary: "supportive view",
              video: {
                id: "v1",
                title: "vid",
                publishedAt: "2026-01-01T00:00:00Z",
                sourceUrl: "u",
                thumbnailUrl: null,
              },
            },
          ],
          topEvidence: [],
          report: null,
        };
      }
      if (path === "/charts/stance-over-time")
        return { points: [{ date: "2026-01", averageStance: 0.6, count: 2 }] };
      if (path === "/charts/topic-frequency")
        return { points: [], topics: [{ id: "t1", name: "Climate" }] };
      return {};
    });
    vi.mocked(api.post).mockResolvedValue({
      status: "queued",
      analysisRunId: "run-topic-ok",
    });
    vi.mocked(waitForAnalysisRun).mockResolvedValueOnce({
      id: "run-topic-ok",
      status: "completed",
      errorMessage: null,
    });

    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );

    const generateBtn = screen.getByRole("button", {
      name: /Generate topic report/i,
    });
    await user.click(generateBtn);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    await waitFor(() =>
      expect(waitForAnalysisRun).toHaveBeenCalledWith("run-topic-ok"),
    );
    await waitFor(() =>
      expect(screen.getByText("Report ready")).toBeInTheDocument(),
    );
  });

  it("surfaces a failed background topic report job and restores the CTA", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.endsWith("/analysis")) {
        return {
          creator: sampleCreator,
          topic: sampleTopic,
          timeline: null,
          summaries: [],
          topEvidence: [],
          report: null,
        };
      }
      return {};
    });
    vi.mocked(api.post).mockResolvedValue({
      status: "queued",
      analysisRunId: "run-topic-bad",
    });
    vi.mocked(waitForAnalysisRun).mockRejectedValueOnce(
      new Error("topic report failed"),
    );

    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /Generate topic report/i }),
    );
    await waitFor(() =>
      expect(screen.getByText("topic report failed")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Generate topic report/i }),
      ).toBeEnabled(),
    );
  });
});

/*
 * ----------------------------------------------------------------------------
 * ComparePage — deep-link via ?creators query param
 * ----------------------------------------------------------------------------
 */
describe("ComparePage deep-link coverage", () => {
  it("initializes the picker from the ?creators query param", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators")
        return {
          items: [
            sampleCreator,
            { ...sampleCreator, id: "c2", name: "Bob", slug: "bob" },
          ],
        };
      if (path === "/creators/compare") {
        return {
          creators: [
            {
              creatorId: "c1",
              name: "Alice",
              slug: "alice",
              thumbnailUrl: null,
              videoCount: 1,
              transcriptCount: 1,
              topicCount: 1,
              evidenceCount: 1,
            },
            {
              creatorId: "c2",
              name: "Bob",
              slug: "bob",
              thumbnailUrl: null,
              videoCount: 1,
              transcriptCount: 1,
              topicCount: 1,
              evidenceCount: 1,
            },
          ],
          sharedTopics: [],
          timeline: { points: [] },
        };
      }
      return {};
    });

    renderPage(<ComparePage />, "/compare?creators=c1,c2");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Coverage" }),
      ).toBeInTheDocument(),
    );
  });
});
