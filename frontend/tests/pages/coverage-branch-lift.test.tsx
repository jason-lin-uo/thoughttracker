/**
 * Branch-coverage lift — targets conditional/ternary arms that the
 * happy-path page tests don't visit: empty sub-lists, missing optional
 * fields, alternate data shapes, and a few interaction-driven error
 * states. Each test pins one or two specific branches and stays narrow so
 * a regression points straight back at the source line.
 *
 * Lines are already 100%; everything here is about BRANCH coverage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { ToastProvider } from "../../src/toast/ToastProvider";

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

import { ApiError, api } from "../../src/lib/api";
import { DashboardPage } from "../../src/pages/DashboardPage";
import { ImportJobDetailPage } from "../../src/pages/ImportJobDetailPage";
import { VideoDetailPage } from "../../src/pages/VideoDetailPage";
import { ReportDetailPage } from "../../src/pages/ReportDetailPage";
import { ComparePage } from "../../src/pages/ComparePage";
import { ImportsPage } from "../../src/pages/ImportsPage";
import { TopicAnalysisPage } from "../../src/pages/TopicAnalysisPage";
import { AddCreatorsPage } from "../../src/pages/AddCreatorsPage";
import { EvidenceDetailPage } from "../../src/pages/EvidenceDetailPage";
/*
 * Shared provider-stack render helpers (de-duplicated, audit §9). This file
 * still renders an inline ComparePage + Link case below, so it keeps the
 * provider imports too.
 */
import { renderPage, renderWithRoute } from "./_render";

beforeEach(() => vi.clearAllMocks());

/*
 * ---------------------------------------------------------------------------
 * DashboardPage — populated stats but every recent sub-list empty, plus a
 * creator card with a thumbnail and a job missing both creator name and
 * totalVideosFound (the `?? channelUrl` and `|| requestedLimit` arms).
 * ---------------------------------------------------------------------------
 */
describe("DashboardPage branch arms", () => {
  it("renders the per-section 'none' messages when every recent list is empty", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      stats: { creators: 3, videos: 5, transcripts: 4, topics: 2, evidence: 9 },
      recentJobs: [],
      recentCreators: [],
      recentReports: [],
    });
    renderPage(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getByText(/No import jobs yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/No creators yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No reports yet/i)).toBeInTheDocument();
  });

  it("renders a job channelUrl fallback + creator thumbnail + description", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      stats: { creators: 1, videos: 1, transcripts: 1, topics: 1, evidence: 1 },
      recentJobs: [
        {
          id: "job-x",
          channelUrl: "https://youtube.com/@noCreatorName",
          requestedLimit: 7,
          status: "completed",
          /*
           * No `creator` (→ channelUrl fallback) and totalVideosFound 0
           * (→ requestedLimit fallback).
           */
          totalVideosFound: 0,
          totalVideosImported: 0,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      recentCreators: [
        {
          id: "c1",
          name: "Thumbnailed",
          slug: "thumb",
          description: "has a bio",
          thumbnailUrl: "https://img/x.png",
          _count: { videos: 4 },
        },
      ],
      recentReports: [],
    });
    renderPage(<DashboardPage />);
    await waitFor(() =>
      expect(
        screen.getByText("https://youtube.com/@noCreatorName"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Thumbnailed")).toBeInTheDocument();
    expect(screen.getByText("has a bio")).toBeInTheDocument();
    /* requestedLimit (7) is rendered because totalVideosFound is 0. */
    expect(screen.getByText(/0 of 7 videos/i)).toBeInTheDocument();
  });
});

/*
 * ---------------------------------------------------------------------------
 * ImportJobDetailPage — the "missing optionals" shape: no creator (→ no
 * View-creator action), no started/completed timestamps (→ "None"), a
 * job-level errorMessage, items with null titles + per-item errors, and a
 * pending status that drives the refetchInterval branch.
 * ---------------------------------------------------------------------------
 */
describe("ImportJobDetailPage branch arms", () => {
  it("renders a creatorless, timestampless, errored job with sparse items", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/import-jobs/job1") {
        return {
          id: "job1",
          channelUrl: "https://youtube.com/@x",
          requestedLimit: 10,
          status: "completed_with_errors",
          totalVideosFound: 0 /* → strings.common.none */,
          totalVideosImported: 2,
          totalTranscriptsImported: 1,
          totalFailed: 1,
          errorMessage: "job blew up",
          startedAt: null /* → "None" */,
          completedAt: null /* → "None" */,
          creator: null /* → no View-creator action */,
        };
      }
      if (path === "/import-jobs/job1/items") {
        return {
          items: [
            {
              id: "it1",
              sourceVideoId: "src-1",
              sourceUrl: "https://example.com/1",
              title: null /* → sourceVideoId fallback */,
              publishedAt: "2026-01-01T00:00:00Z",
              status: "failed",
              transcriptStatus: "failed",
              analysisStatus: "failed",
              errorMessage: "item failed" /* → row error renders */,
              video: null /* → no Open link */,
            },
          ],
        };
      }
      return {};
    });
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job1");
    await waitFor(() =>
      expect(screen.getByText("job blew up")).toBeInTheDocument(),
    );
    /* null title falls back to sourceVideoId (rendered in desktop + mobile views). */
    expect(screen.getAllByText("src-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("item failed").length).toBeGreaterThan(0);
    /* No creator → the "View creator" action is absent. */
    expect(screen.queryByText(/View creator/i)).not.toBeInTheDocument();
  });

  it("renders the empty-items state when the job has no items", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/import-jobs/job2") {
        return {
          id: "job2",
          channelUrl: "https://youtube.com/@y",
          requestedLimit: 5,
          status: "completed",
          totalVideosFound: 5,
          totalVideosImported: 0,
          totalTranscriptsImported: 0,
          totalFailed: 0,
          errorMessage: null,
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T00:05:00Z",
          creator: { id: "c1", name: "Alice", slug: "alice" },
        };
      }
      if (path === "/import-jobs/job2/items") return { items: [] };
      return {};
    });
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job2");
    await waitFor(() =>
      expect(screen.getByText(/No items yet/i)).toBeInTheDocument(),
    );
  });

  it("renders an error state when the items query fails", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/import-jobs/job3") {
        return {
          id: "job3",
          channelUrl: "https://youtube.com/@z",
          requestedLimit: 5,
          status: "completed",
          totalVideosFound: 5,
          totalVideosImported: 0,
          totalTranscriptsImported: 0,
          totalFailed: 0,
          errorMessage: null,
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T00:05:00Z",
          creator: { id: "c1", name: "Alice", slug: "alice" },
        };
      }
      if (path === "/import-jobs/job3/items") throw new Error("items boom");
      return {};
    });
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job3");
    await waitFor(() =>
      expect(screen.getByText("items boom")).toBeInTheDocument(),
    );
  });

  it("keeps polling while the job + items are in progress", async () => {
    /*
     * A pending job with an in-progress item exercises the truthy arm of
     * both refetchInterval callbacks (job status pending; item not terminal).
     */
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/import-jobs/job4") {
        return {
          id: "job4",
          channelUrl: "https://youtube.com/@p",
          requestedLimit: 5,
          status: "pending",
          totalVideosFound: 5,
          totalVideosImported: 0,
          totalTranscriptsImported: 0,
          totalFailed: 0,
          errorMessage: null,
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: null,
          creator: { id: "c1", name: "Alice", slug: "alice" },
        };
      }
      if (path === "/import-jobs/job4/items") {
        return {
          items: [
            {
              id: "it1",
              sourceVideoId: "src-1",
              sourceUrl: "https://example.com/1",
              title: "Title",
              publishedAt: "2026-01-01T00:00:00Z",
              status: "metadata_imported" /* → still in progress */,
              transcriptStatus: "pending",
              analysisStatus: "pending",
              errorMessage: null,
              video: { id: "v1" },
            },
          ],
        };
      }
      return {};
    });
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job4");
    await waitFor(() =>
      expect(screen.getAllByText("Title").length).toBeGreaterThan(0),
    );
    /* The Open link renders because `item.video` is present. */
    expect(screen.getAllByText(/Open/i).length).toBeGreaterThan(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * VideoDetailPage — the unavailable-transcript path (manual paste form +
 * failing save), and the transcript-query error / cleanedText fallback.
 * ---------------------------------------------------------------------------
 */
describe("VideoDetailPage branch arms", () => {
  const baseVideo = {
    id: "v1",
    creatorId: "c1",
    title: "Hello World",
    description: null,
    publishedAt: "2026-01-01T00:00:00Z",
    durationSeconds: 600,
    thumbnailUrl: null,
    sourceUrl: "https://example.com/v1",
    sourceVideoId: "v1",
    analysisStatus: "pending" as const,
    creator: { id: "c1", name: "Alice", slug: "alice" },
    videoSummaries: [],
    transcript: null,
    _count: { chunks: 0 },
  };

  it("shows a save error when the manual transcript POST fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      ...baseVideo,
      transcriptStatus: "unavailable",
    });
    vi.mocked(api.post).mockRejectedValue(new Error("save failed"));

    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("Hello World")).toBeInTheDocument(),
    );

    const textarea = screen.getByLabelText(/Transcript/i);
    /* ≥20 chars so the Save button enables. */
    await user.type(textarea, "this is a manual transcript paste body");
    await user.click(screen.getByRole("button", { name: /Save/i }));
    /*
     * The failure now surfaces in BOTH the inline error AND the toast that
     * useApiCall fires, so match all occurrences rather than expecting one.
     */
    await waitFor(() =>
      expect(screen.getAllByText("save failed").length).toBeGreaterThan(0),
    );
  });

  it("renders the transcript-query error state", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/videos/v1") {
        return { ...baseVideo, transcriptStatus: "available" };
      }
      if (path === "/videos/v1/transcript") throw new Error("transcript boom");
      return {};
    });
    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("transcript boom")).toBeInTheDocument(),
    );
  });

  it("falls back to cleanedText when the transcript has no chunks", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/videos/v1") {
        return { ...baseVideo, transcriptStatus: "available" };
      }
      if (path === "/videos/v1/transcript") {
        /* No `chunks` array → the `?? cleanedText` arm renders. */
        return { id: "tx1", cleanedText: "whole cleaned transcript body" };
      }
      return {};
    });
    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(
        screen.getByText(/whole cleaned transcript body/i),
      ).toBeInTheDocument(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * ReportDetailPage — a topic+creator report (topic deep-link arm), a
 * topic-without-creator report (the "#" arm), and a report with no
 * evidenceJson (the `?? []` sections fallback).
 * ---------------------------------------------------------------------------
 */
describe("ReportDetailPage branch arms", () => {
  const base = {
    id: "r1",
    creatorId: "c1",
    reportType: "topic_brief" as const,
    title: "Topic Report",
    summary: "summary body",
    caveats: "be careful",
    createdAt: "2026-01-04T00:00:00Z",
  };
  const emptyAnalysis = {
    creator: { id: "c1", name: "Alice", slug: "alice" },
    topic: { id: "t1", name: "Climate", slug: "climate" },
    timeline: null,
    summaries: [],
    topEvidence: [],
    report: null,
  };

  it("links the topic via the creator when both are hydrated", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators/c1/topics/t1/analysis") return emptyAnalysis;
      return {
        ...base,
        topicId: "t1",
        evidenceJson: { sections: [{ heading: "H", body: "B" }] },
        creator: { id: "c1", name: "Alice", slug: "alice" },
        topic: { id: "t1", name: "Climate", slug: "climate" },
      };
    });
    renderWithRoute("/reports/:reportId", ReportDetailPage, "/reports/r1");
    await waitFor(() =>
      expect(screen.getByText("Topic Report")).toBeInTheDocument(),
    );
    const topicLink = screen.getByRole("link", { name: "Climate" });
    expect(topicLink).toHaveAttribute("href", "/creators/c1/topics/t1");
  });

  it("links the topic to '#' when the report has a topic but no creator", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators/c1/topics/t1/analysis") return emptyAnalysis;
      return {
        ...base,
        topicId: "t1",
        evidenceJson: null /* → `?? []` sections fallback */,
        topic: { id: "t1", name: "Energy", slug: "energy" },
      };
    });
    renderWithRoute("/reports/:reportId", ReportDetailPage, "/reports/r1");
    await waitFor(() =>
      expect(screen.getByText("Topic Report")).toBeInTheDocument(),
    );
    /*
     * react-router resolves the "#" target to the current path; the point is
     * that the `: "#"` arm ran (not the `/creators/c1/topics/t1` arm).
     */
    const topicLink = screen.getByRole("link", { name: "Energy" });
    expect(topicLink).toHaveAttribute("href", "/reports/r1");
  });

  it("renders structured bullets, source links, and the embedded stance chart", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/reports/r1") {
        return {
          ...base,
          topicId: "t1",
          evidence: {
            sections: [
              { heading: "Empty body" },
              {
                heading: "Narrative",
                body: "- First detailed point\nPlain reader sentence\nsection MUST feature hidden",
              },
              {
                heading: "Structured",
                bullets: [
                  "String bullet",
                  {
                    claim: "Object claim",
                    implication: "It adds context",
                    caveat: "With a caveat",
                  },
                  "return valid json",
                ],
              },
            ],
            evidence: [
              {
                videoId: "v1",
                videoTitle: "Video One",
                note: "Video-level citation",
              },
              { topicId: "t1", topic: "Climate", note: "Topic-level citation" },
            ],
          },
          creator: { id: "c1", name: "Alice", slug: "alice" },
          topic: { id: "t1", name: "Climate", slug: "climate" },
        };
      }
      if (path === "/creators/c1/topics/t1/analysis") {
        return {
          creator: { id: "c1", name: "Alice", slug: "alice" },
          topic: { id: "t1", name: "Climate", slug: "climate" },
          timeline: null,
          summaries: [
            {
              id: "summary-1",
              videoId: "v1",
              topicId: "t1",
              creatorId: "c1",
              dominantStance: "supportive",
              confidenceScore: 0.9,
              confidenceLabel: "high",
              mentionCount: 3,
              summary: "The creator is supportive.",
              notableEvidence: [
                {
                  quote: "Report trajectory quote.",
                  chunkIndex: 0,
                },
              ],
              video: {
                id: "v1",
                title: "Chart Source",
                publishedAt: "2026-01-01T00:00:00Z",
                sourceUrl: "https://example.com/video",
                thumbnailUrl: null,
              },
            },
          ],
          topEvidence: [],
          report: null,
        };
      }
      return {};
    });

    renderWithRoute("/reports/:reportId", ReportDetailPage, "/reports/r1");
    await waitFor(() =>
      expect(screen.getByText("First detailed point")).toBeInTheDocument(),
    );

    expect(screen.getByText("Plain reader sentence")).toBeInTheDocument();
    expect(
      screen.getByText(/Object claim It adds context With a caveat/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/section MUST feature/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/return valid json/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Video One" })).toHaveAttribute(
      "href",
      "/videos/v1",
    );

    const chartPoint = await screen.findByRole("button", {
      name: /Chart Source/i,
    });
    await user.click(chartPoint);
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText(/Report trajectory quote\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * EvidenceDetailPage — the source-video thumbnail arm and the previous-chunk
 * arm (the happy-path test supplies neither: thumbnailUrl null, previousChunk
 * null).
 * ---------------------------------------------------------------------------
 */
describe("EvidenceDetailPage branch arms", () => {
  it("renders the video thumbnail and the previous-chunk panel when present", async () => {
    vi.mocked(api.get).mockResolvedValue({
      analysis: {
        id: "an1",
        stanceLabel: "supportive",
        confidenceLabel: "high",
        relevanceScore: 0.8,
        confidenceScore: 0.9,
        claimSummary: "claim",
        rationale: "rationale",
        evidenceQuote: "quote",
        creator: { id: "c1", name: "Alice" },
        topic: { id: "t1", name: "Climate" },
        video: {
          id: "v1",
          title: "Hello World",
          sourceUrl: "https://example.com/v1",
          publishedAt: "2026-01-01T00:00:00Z",
          thumbnailUrl: "https://img/v1.png" /* → thumbnail <img> arm */,
        },
        chunk: { id: "ck1", chunkIndex: 1, text: "main chunk text" },
      },
      previousChunk: {
        id: "ck0",
        chunkIndex: 0,
        text: "previous chunk text",
      } /* → prev arm */,
      nextChunk: null,
      relatedEvidence: [],
    });
    const { container } = renderWithRoute(
      "/evidence/:analysisId",
      EvidenceDetailPage,
      "/evidence/an1",
    );
    await waitFor(() =>
      expect(screen.getByText(/main chunk text/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/previous chunk text/i)).toBeInTheDocument();
    expect(
      container.querySelector('img[src="https://img/v1.png"]'),
    ).not.toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * ComparePage — deep-link param sync (the `next` arm of the identity-stable
 * setSelected), creators-list error state, the `?? []` items fallback, and a
 * comparison creator card with a thumbnail.
 * ---------------------------------------------------------------------------
 */
describe("ComparePage branch arms", () => {
  const creators = [
    { id: "c1", name: "Alice", slug: "alice", thumbnailUrl: null },
    { id: "c2", name: "Bob", slug: "bob", thumbnailUrl: null },
  ];
  const comparison = {
    creators: [
      {
        creatorId: "c1",
        name: "Alice",
        slug: "alice",
        thumbnailUrl: "https://img/alice.png" /* → thumbnail <img> arm */,
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

  it("initializes from the ?creators deep-link and renders a thumbnail card", async () => {
    /*
     * Deep-link with both ids pre-selected → the compareQuery fires on mount,
     * and the effect's parsed `next` adopts the param. The thumbnail arm of
     * the comparison creator card also renders.
     */
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: creators };
      if (path === "/creators/compare") return comparison;
      return {};
    });
    const { container } = renderPage(
      <ComparePage />,
      "/compare?creators=c1,c2",
    );
    await waitFor(() =>
      expect(screen.getAllByText("Alice").length).toBeGreaterThan(0),
    );
    /*
     * alt="" makes the img presentational (no "img" role), so query by src —
     * its presence proves the `creator.thumbnailUrl ?` truthy arm rendered.
     */
    await waitFor(() =>
      expect(
        container.querySelector('img[src="https://img/alice.png"]'),
      ).not.toBeNull(),
    );
  });

  it("re-syncs the picker when the ?creators deep-link param changes", async () => {
    /*
     * Mount at one deep-link value, then navigate to a different one. The
     * sync effect's parsed `next` no longer matches `prev`, so it adopts
     * `next` — the previously-uncovered `: next` arm of the identity check.
     */
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: creators };
      if (path === "/creators/compare") return comparison;
      return {};
    });
    /* A sibling link that flips the deep-link param to a new selection. */
    function ChangeParamLink() {
      return <Link to="/compare?creators=c2,c1">change</Link>;
    }
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={["/compare?creators=c1,c2"]}>
              <ComparePage />
              <ChangeParamLink />
            </MemoryRouter>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Alice").length).toBeGreaterThan(0),
    );
    await user.click(screen.getByText("change"));
    /* Comparison still renders after the param-driven re-sync. */
    await waitFor(() =>
      expect(screen.getAllByText("Bob").length).toBeGreaterThan(0),
    );
  });

  it("renders an error state when the creators list query fails", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") throw new Error("creators boom");
      return {};
    });
    renderPage(<ComparePage />);
    await waitFor(() =>
      expect(screen.getByText("creators boom")).toBeInTheDocument(),
    );
  });

  it("handles a creators payload with no items array", async () => {
    /*
     * `/creators` resolves without `items` → the `?? []` map fallback runs
     * (no chips, just the pick-at-least-2 hint).
     */
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return {};
      return {};
    });
    renderPage(<ComparePage />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/at least 2 creators/i).length,
      ).toBeGreaterThan(0),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * ImportsPage — a job missing both creator and totalVideosFound, exercising
 * the `?? channelUrl` and `|| requestedLimit` fallback arms in the row.
 * ---------------------------------------------------------------------------
 */
describe("ImportsPage branch arms", () => {
  it("uses channelUrl + requestedLimit fallbacks for a sparse job row", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [
        {
          id: "job-x",
          channelUrl: "https://youtube.com/@sparse",
          requestedLimit: 9,
          status: "pending",
          totalVideosFound: 0 /* → requestedLimit fallback */,
          totalVideosImported: 0,
          createdAt: "2026-01-01T00:00:00Z",
          /* No `creator` → channelUrl fallback for the title. */
        },
      ],
    });
    renderPage(<ImportsPage />);
    /* channelUrl appears as both the title (creator fallback) and the meta line. */
    await waitFor(() =>
      expect(
        screen.getAllByText(/youtube\.com\/@sparse/i).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByText(/0\/9/)).toBeInTheDocument();
  });
});

/*
 * ---------------------------------------------------------------------------
 * TopicAnalysisPage — a topic with a generated report present (the truthy
 * `data.report ?` arm linking to the report).
 * ---------------------------------------------------------------------------
 */
describe("TopicAnalysisPage branch arms", () => {
  it("renders a link to the topic report when one exists", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators/c1/topics/t1/analysis") {
        return {
          creator: { id: "c1", name: "Alice", slug: "alice" },
          topic: {
            id: "t1",
            name: "Climate",
            slug: "climate",
            description: null,
          },
          timeline: null,
          summaries: [],
          topEvidence: [],
          report: {
            id: "rep-1",
            title: "Climate Topic Report",
            summary: "report summary",
            createdAt: "2026-01-05T00:00:00Z",
          },
        };
      }
      if (path === "/charts/stance-over-time") return { points: [] };
      if (path === "/charts/topic-frequency") return { points: [], topics: [] };
      return {};
    });
    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText("Climate Topic Report")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: /Climate Topic Report/i }),
    ).toHaveAttribute("href", "/reports/rep-1");
  });
});

/*
 * ---------------------------------------------------------------------------
 * AddCreatorsPage — an onboarding run succeeding WITHOUT a statusPath (the
 * `: run.status` arm) and a fallback import-jobs path that rejects with a
 * non-Error value (the `String(reason)` arm inside the fallback loop).
 * ---------------------------------------------------------------------------
 */
describe("AddCreatorsPage branch arms", () => {
  it("uses the bare status when an onboarding run returns no statusPath", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ ok: true });
    vi.mocked(api.post).mockResolvedValueOnce({
      status: "started",
      processId: 1,
      /* No statusPath → status string rendered as-is. */
      logDir: "logs",
    });
    renderPage(<AddCreatorsPage />);
    await user.type(screen.getByLabelText(/Admin PIN/i), "2468");
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    await user.type(
      screen.getByLabelText(/Creator URLs/i),
      "https://www.youtube.com/@solo",
    );
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));
    await waitFor(() =>
      expect(screen.getByText("Queued 1 of 1 creators.")).toBeInTheDocument(),
    );
    /* Bare status surfaced without a "status: path" suffix. */
    expect(screen.getByText("started")).toBeInTheDocument();
  });

  it("stringifies a non-Error rejection inside the import-jobs fallback", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      /* First call: onboarding pipeline unavailable → fall back to import jobs. */
      .mockRejectedValueOnce(
        new ApiError(
          503,
          "Creator onboarding pipeline script is not available",
        ),
      )
      /* Fallback import-job call rejects with a non-Error → String(reason) arm. */
      .mockRejectedValueOnce("network down");
    renderPage(<AddCreatorsPage />);
    await user.type(screen.getByLabelText(/Admin PIN/i), "2468");
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    await user.type(
      screen.getByLabelText(/Creator URLs/i),
      "https://www.youtube.com/@alpha",
    );
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));
    await waitFor(() =>
      expect(screen.getByText("network down")).toBeInTheDocument(),
    );
  });
});
