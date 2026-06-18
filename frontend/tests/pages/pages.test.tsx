import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Mock the api module up-front so every page-under-test sees the stubbed
 * versions. Individual tests configure responses via vi.mocked(api.get/post).
 */
vi.mock("../../src/lib/api", () => {
  return {
    api: { get: vi.fn(), post: vi.fn() },
    ApiError: class ApiError extends Error {
      status: number;
      details?: unknown;
      constructor(s: number, m: string, d?: unknown) {
        super(m);
        this.status = s;
        this.details = d;
      }
    },
  };
});

import { ApiError, api } from "../../src/lib/api";
import { DashboardPage } from "../../src/pages/DashboardPage";
import { ImportsPage } from "../../src/pages/ImportsPage";
import { AddCreatorsPage } from "../../src/pages/AddCreatorsPage";
import { ImportJobDetailPage } from "../../src/pages/ImportJobDetailPage";
import { CreatorsPage } from "../../src/pages/CreatorsPage";
import { CreatorOverviewPage } from "../../src/pages/CreatorOverviewPage";
import { VideosPage } from "../../src/pages/VideosPage";
import { VideoDetailPage } from "../../src/pages/VideoDetailPage";
import { TopicsPage } from "../../src/pages/TopicsPage";
import { TopicAnalysisPage } from "../../src/pages/TopicAnalysisPage";
import { EvidencePage } from "../../src/pages/EvidencePage";
import { EvidenceDetailPage } from "../../src/pages/EvidenceDetailPage";
import { ReportsPage } from "../../src/pages/ReportsPage";
import { ReportDetailPage } from "../../src/pages/ReportDetailPage";
import { NotFoundPage } from "../../src/pages/NotFoundPage";
/* Shared provider-stack render helpers (de-duplicated, audit §9). */
import { renderPage, renderWithRoute } from "./_render";

const sampleCreator = {
  id: "c1",
  name: "Alice",
  slug: "alice",
  description: "creator bio",
  thumbnailUrl: null,
  creatorType: "youtube",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  videoCount: 3,
  transcriptCount: 2,
  topicCount: 1,
  lastImportedAt: "2026-01-03T00:00:00Z",
};

const sampleTopic = {
  id: "t1",
  name: "Climate",
  slug: "climate",
  description: "Climate",
};

const sampleVideo = {
  id: "v1",
  creatorId: "c1",
  title: "Hello World",
  description: "intro",
  publishedAt: "2026-01-01T00:00:00Z",
  durationSeconds: 600,
  thumbnailUrl: null,
  sourceUrl: "https://example.com/v1",
  sourceVideoId: "v1",
  transcriptStatus: "available" as const,
  analysisStatus: "completed" as const,
  creator: { id: "c1", name: "Alice", slug: "alice" },
  _count: { chunks: 5, videoSummaries: 2 },
};

const sampleReport = {
  id: "r1",
  creatorId: "c1",
  topicId: null,
  reportType: "creator_summary" as const,
  title: "Alice — Summary",
  summary: "Stuff and things.",
  caveats: "Be cautious.",
  evidence: {
    sections: [
      { heading: "Findings", body: "Lead line\n- first point\n- second point" },
      {
        heading: "In their own words",
        bullets: [
          {
            quote: "foldables are becoming real everyday phones.",
            citation:
              "So This is Peak Foldable transcript (Feb 1, 2026, supportive)",
            videoId: "v1",
          },
        ],
      },
    ],
    evidence: [{ videoId: "v1", note: "evidence note" }],
  },
  createdAt: "2026-01-04T00:00:00Z",
  creator: { id: "c1", name: "Alice", slug: "alice" },
};

const sampleJob = {
  id: "job1",
  channelUrl: "https://www.youtube.com/@example",
  requestedLimit: 10,
  status: "completed" as const,
  totalVideosFound: 10,
  totalVideosImported: 9,
  totalTranscriptsImported: 8,
  totalFailed: 1,
  errorMessage: null,
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:10:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  creator: { id: "c1", name: "Alice", slug: "alice" },
};

const sampleAnalysis = {
  id: "an1",
  chunkId: "ck1",
  videoId: "v1",
  creatorId: "c1",
  topicId: "t1",
  relevanceScore: 0.8,
  stanceLabel: "supportive" as const,
  confidenceScore: 0.9,
  confidenceLabel: "high" as const,
  claimSummary: "claim",
  rationale: "rationale",
  evidenceQuote: "quote",
  createdAt: "2026-01-01T00:00:00Z",
  creator: { id: "c1", name: "Alice", slug: "alice" },
  topic: sampleTopic,
  video: {
    id: "v1",
    title: "Hello World",
    sourceUrl: "https://example.com/v1",
    publishedAt: "2026-01-01T00:00:00Z",
    thumbnailUrl: null,
  },
  chunk: { id: "ck1", chunkIndex: 0, startSeconds: 0, endSeconds: 30 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

/*
 * -----------------------------------------------------------------------------
 * DashboardPage
 * -----------------------------------------------------------------------------
 */
describe("DashboardPage", () => {
  const sampleFeaturedInsight = {
    creatorId: "c1",
    creatorName: "Alice",
    topicId: "t1",
    topicName: "Climate",
    trendLabel: "gradual_shift" as const,
    summary: "Her stance drifted over the year.",
  };

  it("shows the empty state when there are no creators", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      stats: { creators: 0, videos: 0, transcripts: 0, topics: 0, evidence: 0 },
      featuredInsight: null,
      recentJobs: [],
      recentCreators: [],
      recentReports: [],
    });
    renderPage(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getByText(/No data yet/i)).toBeInTheDocument(),
    );
  });

  it("features the analyzed insight even when there are NO reports", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      stats: { creators: 2, videos: 5, transcripts: 4, topics: 3, evidence: 7 },
      featuredInsight: sampleFeaturedInsight,
      recentJobs: [sampleJob],
      recentCreators: [{ ...sampleCreator, _count: { videos: 3 } }],
      recentReports: [],
    });
    renderPage(<DashboardPage />);
    /* Hero headline is derived from the timeline insight, not a report. */
    await waitFor(() =>
      expect(
        screen.getByText(/Alice's stance on Climate has been shifting/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Her stance drifted over the year\./i),
    ).toBeInTheDocument();
    /* It links to the topic-analysis page (report-independent). */
    expect(
      screen.getByRole("link", {
        name: /Alice's stance on Climate has been shifting/i,
      }),
    ).toHaveAttribute("href", "/creators/c1/topics/t1");
  });

  it("renders the spotlight hero (non-shift glyph) for a steady trend", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      stats: { creators: 2, videos: 5, transcripts: 4, topics: 3, evidence: 7 },
      featuredInsight: {
        ...sampleFeaturedInsight,
        trendLabel: "stable" as const,
      },
      recentJobs: [sampleJob],
      recentCreators: [{ ...sampleCreator, _count: { videos: 3 } }],
      recentReports: [],
    });
    renderPage(<DashboardPage />);
    /* A "stable" trend frames as a spotlight, and the hero still anchors with a glyph. */
    await waitFor(() =>
      expect(screen.getByText(/steady line on Climate/i)).toBeInTheDocument(),
    );
  });

  it("shows stats + recent items when populated", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      stats: { creators: 2, videos: 5, transcripts: 4, topics: 3, evidence: 7 },
      featuredInsight: sampleFeaturedInsight,
      recentJobs: [sampleJob],
      recentCreators: [{ ...sampleCreator, _count: { videos: 3 } }],
      recentReports: [sampleReport],
    });
    renderPage(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/Alice/i).length).toBeGreaterThan(0),
    );
    /* The report still appears in the recent-reports list below the hero. */
    expect(screen.getByText("Alice — Summary")).toBeInTheDocument();
  });

  it("renders an error state when the dashboard query fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    renderPage(<DashboardPage />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("retries the dashboard query from its error state", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error("temporary dashboard failure"))
      .mockResolvedValueOnce({
        stats: {
          creators: 0,
          videos: 0,
          transcripts: 0,
          topics: 0,
          evidence: 0,
        },
        featuredInsight: null,
        recentJobs: [],
        recentCreators: [],
        recentReports: [],
      });

    renderPage(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getByText("temporary dashboard failure")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() =>
      expect(screen.getByText(/No data yet/i)).toBeInTheDocument(),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
  });
});

/*
 * -----------------------------------------------------------------------------
 * ImportsPage
 * -----------------------------------------------------------------------------
 */
describe("ImportsPage", () => {
  it("renders empty + Add Creators handoff without posting from the history page", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [] });

    renderPage(<ImportsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Add a creator/i)).toBeInTheDocument(),
    );

    expect(screen.getByRole("link", { name: /Add Creators/i })).toHaveAttribute(
      "href",
      "/add-creators",
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("lists existing jobs", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [sampleJob] });
    renderPage(<ImportsPage />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });

  it("renders an error state when jobs query fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("nope"));
    renderPage(<ImportsPage />);
    await waitFor(() => expect(screen.getByText("nope")).toBeInTheDocument());
  });
});

/*
 * -----------------------------------------------------------------------------
 * AddCreatorsPage
 * -----------------------------------------------------------------------------
 */
describe("AddCreatorsPage", () => {
  it("starts disabled and shows the queued-jobs empty state", () => {
    renderPage(<AddCreatorsPage />);
    expect(
      screen.getByRole("button", { name: /Start onboarding/i }),
    ).toBeDisabled();
    expect(screen.getByText(/Admin controls locked/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reset all reports/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Creator URLs/i)).toBeDisabled();
    expect(screen.getByText(/Queued jobs will appear/i)).toBeInTheDocument();
  });

  it("shows the report reset panel only after unlock and posts with the admin PIN", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        deleted: 9,
        report: {
          id: "starter-report",
          title:
            "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
          summary: "Starter summary",
          creatorId: "mkbhd-id",
          topicId: "foldable-id",
          reportType: "topic_summary",
        },
      });

    renderPage(<AddCreatorsPage />);
    expect(
      screen.queryByRole("button", { name: /Reset all reports/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    await user.click(screen.getByRole("button", { name: /Reset all reports/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/reports/reset-starter",
        undefined,
        { headers: { "X-Admin-Pin": "2468" } },
      ),
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(
      screen.getByText(
        /Report library reset: MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs/i,
      ),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("locks admin controls again when report reset is rejected", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new ApiError(403, "Admin PIN required"));

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    await user.click(screen.getByRole("button", { name: /Reset all reports/i }));

    await waitFor(() =>
      expect(screen.getByText(/Admin controls locked/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /Reset all reports/i }),
    ).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("starts the full onboarding pipeline for unique creator URLs", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        status: "started",
        processId: 123,
        statusPath: "reports/metrics/add_creator_pipeline_status.json",
        logDir: "logs",
      });

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    expect(screen.getByText(/Admin controls unlocked/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Creator URLs/i), {
      target: {
        value:
          "https://www.youtube.com/@alpha\nhttps://www.youtube.com/@beta\nhttps://www.youtube.com/@alpha",
      },
    });
    await user.selectOptions(
      screen.getByLabelText(/Videos per creator/i),
      "50",
    );
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/creator-onboarding/verify-pin",
      undefined,
      { headers: { "X-Admin-Pin": "2468" } },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/creator-onboarding/run",
      {
        channelUrls: [
          "https://www.youtube.com/@alpha",
          "https://www.youtube.com/@beta",
        ],
        requestedLimit: 50,
      },
      { headers: { "X-Admin-Pin": "2468" } },
    );
    expect(screen.getByText("Queued 2 of 2 creators.")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /reports\/metrics\/add_creator_pipeline_status\.json/i,
      ),
    ).toHaveLength(2);
  });

  it("chunks full pipeline submissions to the backend batch limit", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        status: "started",
        processId: 123,
        statusPath: "batch-one.json",
        logDir: "logs",
      })
      .mockResolvedValueOnce({
        status: "started",
        processId: 124,
        statusPath: "batch-two.json",
        logDir: "logs",
      });

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    fireEvent.change(screen.getByLabelText(/Creator URLs/i), {
      target: {
        value: Array.from(
          { length: 11 },
          (_, index) => `https://www.youtube.com/@creator${index}`,
        ).join("\n"),
      },
    });
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() =>
      expect(screen.getByText("Queued 11 of 11 creators.")).toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.post).mock.calls[1]?.[1]).toMatchObject({
      channelUrls: Array.from(
        { length: 10 },
        (_, index) => `https://www.youtube.com/@creator${index}`,
      ),
    });
    expect(vi.mocked(api.post).mock.calls[2]?.[1]).toMatchObject({
      channelUrls: ["https://www.youtube.com/@creator10"],
    });
  });

  it("falls back to import jobs when the full pipeline is unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(
        new ApiError(
          503,
          "Creator onboarding pipeline script is not available",
        ),
      )
      .mockResolvedValueOnce({ jobId: "job-a", status: "pending" });

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    fireEvent.change(screen.getByLabelText(/Creator URLs/i), {
      target: { value: "https://www.youtube.com/@alpha\nnot a channel" },
    });
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() =>
      expect(screen.getByText("Queued 1 of 2 creators.")).toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/creator-onboarding/run",
      {
        channelUrls: ["https://www.youtube.com/@alpha"],
        requestedLimit: 25,
      },
      { headers: { "X-Admin-Pin": "2468" } },
    );
    expect(screen.getByText("Creator URL looks invalid.")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("reports invalid URLs without calling the API", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ ok: true });

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    fireEvent.change(screen.getByLabelText(/Creator URLs/i), {
      target: { value: "not a channel" },
    });
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() =>
      expect(screen.getByText("Queued 0 of 1 creators.")).toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/creator-onboarding/verify-pin",
      undefined,
      { headers: { "X-Admin-Pin": "2468" } },
    );
    expect(screen.getByText("Creator URL looks invalid.")).toBeInTheDocument();
  });

  it("renders non-Error rejections as row errors", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ ok: true });
    vi.mocked(api.post).mockRejectedValueOnce("offline");

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "2468" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    fireEvent.change(screen.getByLabelText(/Creator URLs/i), {
      target: { value: "https://www.youtube.com/@alpha" },
    });
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() =>
      expect(screen.getByText("offline")).toBeInTheDocument(),
    );
  });

  it("stops the onboarding batch after a forbidden PIN response", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new ApiError(403, "Admin PIN required"));

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "wrong" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));
    fireEvent.change(screen.getByLabelText(/Creator URLs/i), {
      target: {
        value: "https://www.youtube.com/@alpha\nhttps://www.youtube.com/@beta",
      },
    });
    await user.click(screen.getByRole("button", { name: /Start onboarding/i }));

    await waitFor(() =>
      expect(screen.getByText("Queued 0 of 2 creators.")).toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Admin PIN required")).toHaveLength(2);
  });

  it("keeps the form locked when PIN verification fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(403, "Admin PIN required"),
    );

    renderPage(<AddCreatorsPage />);
    fireEvent.change(screen.getByLabelText(/Admin PIN/i), {
      target: { value: "1234" },
    });
    await user.click(screen.getByRole("button", { name: /Unlock/i }));

    await waitFor(() =>
      expect(screen.getByText(/Admin controls locked/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Creator URLs/i)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Start onboarding/i }),
    ).toBeDisabled();
  });
});

/*
 * -----------------------------------------------------------------------------
 * ImportJobDetailPage
 * -----------------------------------------------------------------------------
 */
describe("ImportJobDetailPage", () => {
  it("renders job + items", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(sampleJob)
      .mockResolvedValueOnce({
        items: [
          {
            id: "it1",
            sourceVideoId: "v1",
            sourceUrl: "https://example.com/v1",
            title: "Hello World",
            publishedAt: "2026-01-01T00:00:00Z",
            status: "analysis_completed",
            transcriptStatus: "available",
            analysisStatus: "completed",
            errorMessage: null,
            video: {
              id: "v1",
              title: "Hello World",
              transcriptStatus: "available",
              analysisStatus: "completed",
              publishedAt: "2026-01-01T00:00:00Z",
              sourceUrl: "https://example.com/v1",
              thumbnailUrl: null,
            },
          },
        ],
      });
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/job1");
    await waitFor(() =>
      expect(screen.getAllByText("Hello World").length).toBeGreaterThan(0),
    );
  });

  it("renders error state when job query fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("job missing"));
    renderWithRoute("/imports/:jobId", ImportJobDetailPage, "/imports/bad");
    await waitFor(() =>
      expect(screen.getByText("job missing")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * CreatorsPage
 * -----------------------------------------------------------------------------
 */
describe("CreatorsPage", () => {
  it("renders cards when populated", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [sampleCreator] });
    renderPage(<CreatorsPage />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });

  it("shows the empty state when no creators", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [] });
    renderPage(<CreatorsPage />);
    await waitFor(() =>
      expect(screen.getByText(/No creators yet/i)).toBeInTheDocument(),
    );
  });

  it("typing in search input re-queries", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ items: [sampleCreator] });
    renderPage(<CreatorsPage />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/Search creators/i);
    await user.type(input, "ali");
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
  });

  it("renders error state on failure", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("creator-fail"));
    renderPage(<CreatorsPage />);
    await waitFor(() =>
      expect(screen.getByText("creator-fail")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * TopicsPage
 * -----------------------------------------------------------------------------
 */
describe("TopicsPage", () => {
  const climate = {
    id: "t1",
    name: "Climate Policy",
    slug: "climate-policy",
    description: "Climate stuff",
    createdAt: "2026-01-01T00:00:00Z",
    _count: { videoSummaries: 12, chunkAnalyses: 40 },
  };
  const vaccines = {
    id: "t2",
    name: "Vaccines",
    slug: "vaccines",
    description: null,
    createdAt: "2026-03-01T00:00:00Z",
    _count: { videoSummaries: 5, chunkAnalyses: 9 },
  };

  it("renders topics with coverage counts and a videos deep-link", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [climate, vaccines] });
    renderPage(<TopicsPage />);
    await waitFor(() =>
      expect(screen.getByText("Climate Policy")).toBeInTheDocument(),
    );
    expect(screen.getByText("12 videos · 40 mentions")).toBeInTheDocument();
    expect(screen.getByText("Climate stuff")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 topics")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Climate Policy/i }),
    ).toHaveAttribute("href", "/videos?topicId=t1");
  });

  it("filters by name and shows a no-matches message", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ items: [climate, vaccines] });
    renderPage(<TopicsPage />);
    await waitFor(() =>
      expect(screen.getByText("Vaccines")).toBeInTheDocument(),
    );

    const input = screen.getByLabelText(/Filter topics/i);
    await user.type(input, "clim");
    expect(screen.getByText("Climate Policy")).toBeInTheDocument();
    expect(screen.queryByText("Vaccines")).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "zzz");
    await waitFor(() =>
      expect(
        screen.getByText(/No topics match your filter/i),
      ).toBeInTheDocument(),
    );
  });

  it("applies every sort option without crashing", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ items: [climate, vaccines] });
    renderPage(<TopicsPage />);
    await waitFor(() =>
      expect(screen.getByText("Climate Policy")).toBeInTheDocument(),
    );

    const select = screen.getByLabelText(/Sort/i);
    for (const label of [
      "Z → A",
      "Most videos",
      "Fewest videos",
      "Most mentions",
      "Fewest mentions",
      "Newest",
      "Oldest",
      "A → Z",
    ]) {
      await user.selectOptions(select, label);
      expect(screen.getByText("Climate Policy")).toBeInTheDocument();
    }
  });

  it("shows the empty state when there are no topics", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [] });
    renderPage(<TopicsPage />);
    await waitFor(() =>
      expect(screen.getByText(/No topics yet/i)).toBeInTheDocument(),
    );
  });

  it("renders error state on failure and retries on click", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new Error("topics-fail"));
    renderPage(<TopicsPage />);
    await waitFor(() =>
      expect(screen.getByText("topics-fail")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Try again/i }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});

/*
 * -----------------------------------------------------------------------------
 * CreatorOverviewPage
 * -----------------------------------------------------------------------------
 */
describe("CreatorOverviewPage", () => {
  it("renders creator details + stat cards + top topics", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      creator: sampleCreator,
      stats: {
        videoCount: 3,
        transcriptCount: 2,
        topicCount: 1,
        evidenceCount: 4,
      },
      topTopics: [
        {
          topicId: "t1",
          name: "Climate",
          slug: "climate",
          videoCount: 3,
          mentionCount: 7,
          dominantStance: "supportive",
        },
      ],
      recentVideos: [sampleVideo],
      latestReport: sampleReport,
      recentImport: sampleJob,
    });
    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Climate")).toBeInTheDocument();
  });

  it("clicking Re-run kicks off analysis mutation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      creator: sampleCreator,
      stats: {
        videoCount: 0,
        transcriptCount: 0,
        topicCount: 0,
        evidenceCount: 0,
      },
      topTopics: [],
      recentVideos: [],
      latestReport: null,
      recentImport: null,
    });
    vi.mocked(api.post).mockResolvedValue({ ok: true });

    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const rerun = screen.getByRole("button", { name: /Re-run/i });
    await user.click(rerun);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });

  it("renders error state on overview failure", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("overview-fail"));
    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() =>
      expect(screen.getByText("overview-fail")).toBeInTheDocument(),
    );
  });

  /*
   * Silent-mutation regression guard (audit §9): the page's mutations are
   * wired through useApiCall, so a failed report-generation must surface an
   * error toast — a regression to a raw silent useMutation would fail this.
   */
  it("toasts on a failed Generate-report mutation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      creator: sampleCreator,
      stats: {
        videoCount: 0,
        transcriptCount: 0,
        topicCount: 0,
        evidenceCount: 0,
      },
      topTopics: [],
      recentVideos: [],
      latestReport: null,
      recentImport: null,
    });
    vi.mocked(api.post).mockRejectedValue(new Error("report blew up"));

    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    await user.click(
      screen.getByRole("button", { name: /Generate creator report/i }),
    );
    /* The error toast renders the mutation error message. */
    await waitFor(() =>
      expect(screen.getByText("report blew up")).toBeInTheDocument(),
    );
  });

  it("toasts a success message after a successful re-analysis mutation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      creator: sampleCreator,
      stats: {
        videoCount: 0,
        transcriptCount: 0,
        topicCount: 0,
        evidenceCount: 0,
      },
      topTopics: [],
      recentVideos: [],
      latestReport: null,
      recentImport: null,
    });
    vi.mocked(api.post).mockResolvedValue({ ok: true });

    renderWithRoute(
      "/creators/:creatorId",
      CreatorOverviewPage,
      "/creators/c1",
    );
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Re-run/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/we'll refresh this view as results land/i),
      ).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * VideosPage
 * -----------------------------------------------------------------------------
 */
describe("VideosPage", () => {
  it("renders results when populated", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/videos")
        return {
          items: [sampleVideo],
          page: 1,
          pageSize: 12,
          total: 1,
          totalPages: 1,
        };
      return {};
    });
    renderPage(<VideosPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Hello World").length).toBeGreaterThan(0),
    );
  });

  it("shows empty state when no videos", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [] };
      if (path === "/topics") return { items: [] };
      if (path === "/videos")
        return { items: [], page: 1, pageSize: 12, total: 0, totalPages: 0 };
      return {};
    });
    renderPage(<VideosPage />);
    await waitFor(() =>
      expect(screen.getByText(/No videos/i)).toBeInTheDocument(),
    );
  });

  it("renders error state", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/videos") throw new Error("v-error");
      return { items: [] };
    });
    renderPage(<VideosPage />);
    await waitFor(() =>
      expect(screen.getByText("v-error")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * VideoDetailPage
 * -----------------------------------------------------------------------------
 */
describe("VideoDetailPage", () => {
  it("renders detail + summaries", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...sampleVideo,
      videoSummaries: [
        {
          id: "vs1",
          videoId: "v1",
          topicId: "t1",
          creatorId: "c1",
          dominantStance: "supportive",
          confidenceScore: 0.9,
          confidenceLabel: "high",
          mentionCount: 4,
          summary: "topic summary",
          topic: sampleTopic,
        },
      ],
      transcript: {
        id: "tx1",
        wordCount: 1000,
        language: "en",
        sourceType: "automatic",
      },
      _count: { chunks: 5 },
    });
    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("Hello World")).toBeInTheDocument(),
    );
    expect(screen.getByText("topic summary")).toBeInTheDocument();
  });

  it("renders error state on failure", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("video-fail"));
    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("video-fail")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * TopicAnalysisPage
 * -----------------------------------------------------------------------------
 * The redesigned analyst-console TopicAnalysisPage builds everything from the
 * single `/analysis` payload (no separate chart endpoints). These summaries
 * give the console two dated videos with notable-evidence pull-quotes plus one
 * evidence row, so the verdict / trajectory / ribbon / heatmap / stats /
 * evidence sections all have data to render and filter.
 */
const consoleAnalysis = {
  creator: sampleCreator,
  topic: sampleTopic,
  timeline: null,
  summaries: [
    {
      id: "s1",
      videoId: "v1",
      topicId: "t1",
      creatorId: "c1",
      dominantStance: "supportive" as const,
      confidenceScore: 0.92,
      confidenceLabel: "high" as const,
      mentionCount: 2,
      summary: "supportive summary",
      notableEvidence: [
        { quote: "A supportive verbatim quote.", chunkIndex: 1 },
      ],
      video: {
        id: "v1",
        title: "Episode One",
        publishedAt: "2026-03-02T00:00:00Z",
        sourceUrl: "https://example.com/v1",
        thumbnailUrl: null,
      },
    },
    {
      id: "s2",
      videoId: "v2",
      topicId: "t1",
      creatorId: "c1",
      dominantStance: "mixed" as const,
      confidenceScore: 0.8,
      confidenceLabel: "high" as const,
      mentionCount: 1,
      summary: "mixed summary",
      notableEvidence: [],
      video: {
        id: "v2",
        title: "Episode Two",
        publishedAt: "2026-05-20T00:00:00Z",
        sourceUrl: "https://example.com/v2",
        thumbnailUrl: null,
      },
    },
  ],
  topEvidence: [
    {
      ...sampleAnalysis,
      id: "ev1",
      stanceLabel: "supportive" as const,
      evidenceQuote: "Evidence quote one.",
      claimSummary: "Claim one",
      video: {
        id: "v1",
        title: "Episode One",
        sourceUrl: "https://example.com/v1",
        publishedAt: "2026-03-02T00:00:00Z",
        thumbnailUrl: null,
      },
    },
  ],
  report: null,
};

describe("TopicAnalysisPage (analyst console)", () => {
  it("renders the verdict, trajectory, ribbon, heatmap, stats, and evidence", async () => {
    vi.mocked(api.get).mockResolvedValue(consoleAnalysis);

    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );

    /*
     * Title + the verdict hero (supportive leads 1-of-2 each, supportive wins
     * the tie via canonical order → "Leans supportive").
     */
    await waitFor(() =>
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Leans/i)).toBeInTheDocument();
    /*
     * The section eyebrows (exact text, so they don't collide with the subtitle
     * which also contains the substring "stance trajectory").
     */
    expect(screen.getByText("Stance trajectory")).toBeInTheDocument();
    expect(screen.getByText("Overall balance")).toBeInTheDocument();
    expect(
      screen.getByText("Per-video stance heatmap · oldest → newest"),
    ).toBeInTheDocument();
    /* The counter shows both videos in range by default. */
    expect(screen.getByText(/showing 2 of 2 videos/i)).toBeInTheDocument();
    /* One evidence row's claim is visible. */
    expect(screen.getByText("Claim one")).toBeInTheDocument();
  });

  it("renders error state with a retry on analysis failure", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => consoleAnalysis);
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.endsWith("/analysis")) {
        /* First call rejects; the retry resolves so the button has an effect. */
        if (refetch.mock.calls.length === 0) {
          refetch();
          throw new Error("analysis-fail");
        }
        return consoleAnalysis;
      }
      return {};
    });
    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText("analysis-fail")).toBeInTheDocument(),
    );
    /* The ErrorState now carries a retry button (audit: onRetry on every state). */
    await user.click(screen.getByRole("button", { name: /try again/i }));
  });

  it("filters every view when a date-range preset is chosen", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(consoleAnalysis);
    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText(/showing 2 of 2 videos/i)).toBeInTheDocument(),
    );

    /* "Last 30d" (relative to the May 20 max) drops the March video, leaving 1. */
    await user.click(screen.getByRole("button", { name: /Last 30d/i }));
    await waitFor(() =>
      expect(screen.getByText(/showing 1 of 2 videos/i)).toBeInTheDocument(),
    );
    /*
     * With only the mixed video left, the verdict meta now reads "of 1 videos"
     * (a unique string in the verdict hero) — confirming the recompute.
     */
    expect(screen.getByText(/of 1 videos/i)).toBeInTheDocument();
  });

  it("filters when the start date input is edited directly (custom range)", async () => {
    vi.mocked(api.get).mockResolvedValue(consoleAnalysis);
    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText(/showing 2 of 2 videos/i)).toBeInTheDocument(),
    );

    /*
     * Set the start input past the March video → only the May video remains,
     * exercising the page's `handleRangeChange` (custom-range) path.
     */
    const start = screen.getByLabelText(/start date/i) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(start, "2026-04-01");
    start.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() =>
      expect(screen.getByText(/showing 1 of 2 videos/i)).toBeInTheDocument(),
    );
  });

  it("opens the episode modal from a trajectory dot and closes on the close button", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(consoleAnalysis);
    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );

    /*
     * Both the trajectory dot and the heatmap cell expose the same labeled
     * button for Episode One; clicking either opens the modal with that
     * episode's verbatim pull-quote.
     */
    const dots = screen.getAllByRole("button", {
      name: /Episode One: .*supportive/i,
    });
    await user.click(dots[0]);
    const dialog = await screen.findByRole("dialog");
    expect(
      screen.getByText(/A supportive verbatim quote\./),
    ).toBeInTheDocument();

    /*
     * Close via the modal's in-card close button (scoped to the dialog so it's
     * not confused with the backdrop button, which shares the "Close" label).
     */
    await user.click(within(dialog).getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("posts when Generate topic report is clicked and links a present report", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      ...consoleAnalysis,
      report: {
        id: "rep-9",
        creatorId: "c1",
        topicId: "t1",
        reportType: "topic_summary",
        title: "Climate Topic Report",
        summary: "report body",
        caveats: "",
        evidence: null,
        createdAt: "2026-06-01T00:00:00Z",
      },
    });
    vi.mocked(api.post).mockResolvedValue({ ok: true });

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
    ).toHaveAttribute("href", "/reports/rep-9");

    await user.click(
      screen.getByRole("button", { name: /Generate topic report/i }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/reports/creator/c1/topic/t1/generate",
      ),
    );
  });

  it("shows empty-range copy when the date window holds no videos", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...consoleAnalysis,
      summaries: [],
      topEvidence: [],
    });
    renderWithRoute(
      "/creators/:creatorId/topics/:topicId",
      TopicAnalysisPage,
      "/creators/c1/topics/t1",
    );
    await waitFor(() =>
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );
    /* No dated points → the verdict hero degrades to "No data in range". */
    expect(screen.getByText(/No data in range/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/No videos in this date range/i).length,
    ).toBeGreaterThan(0);
  });
});

/*
 * -----------------------------------------------------------------------------
 * EvidencePage
 * -----------------------------------------------------------------------------
 */
describe("EvidencePage", () => {
  it("renders evidence cards", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/evidence")
        return {
          items: [sampleAnalysis],
          page: 1,
          pageSize: 12,
          total: 1,
          totalPages: 1,
        };
      return {};
    });
    renderPage(<EvidencePage />);
    await waitFor(() => expect(screen.getByText(/claim/i)).toBeInTheDocument());
  });

  it("renders empty state", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/evidence")
        return { items: [], page: 1, pageSize: 12, total: 0, totalPages: 0 };
      return { items: [] };
    });
    renderPage(<EvidencePage />);
    await waitFor(() =>
      expect(screen.getByText(/No evidence/i)).toBeInTheDocument(),
    );
  });

  it("renders error state", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/evidence") throw new Error("ev-fail");
      return { items: [] };
    });
    renderPage(<EvidencePage />);
    await waitFor(() =>
      expect(screen.getByText("ev-fail")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * EvidenceDetailPage
 * -----------------------------------------------------------------------------
 */
describe("EvidenceDetailPage", () => {
  it("renders detail with chunk text + related evidence", async () => {
    vi.mocked(api.get).mockResolvedValue({
      analysis: {
        ...sampleAnalysis,
        creator: sampleCreator,
        topic: sampleTopic,
        video: sampleVideo,
        chunk: {
          id: "ck1",
          chunkIndex: 0,
          text: "chunk body text",
          startSeconds: 0,
          endSeconds: 30,
        },
      },
      previousChunk: null,
      nextChunk: {
        id: "ck2",
        chunkIndex: 1,
        text: "next chunk text",
        startSeconds: 30,
        endSeconds: 60,
      },
      relatedEvidence: [{ ...sampleAnalysis, chunk: { chunkIndex: 1 } }],
    });
    renderWithRoute(
      "/evidence/:analysisId",
      EvidenceDetailPage,
      "/evidence/an1",
    );
    await waitFor(() =>
      expect(screen.getByText(/chunk body text/i)).toBeInTheDocument(),
    );
  });

  it("renders error state", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("ev-detail-fail"));
    renderWithRoute(
      "/evidence/:analysisId",
      EvidenceDetailPage,
      "/evidence/an1",
    );
    await waitFor(() =>
      expect(screen.getByText("ev-detail-fail")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * ReportsPage
 * -----------------------------------------------------------------------------
 */
describe("ReportsPage", () => {
  it("renders report cards", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/reports") return { items: [sampleReport] };
      return {};
    });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );
  });

  it("renders empty state", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/reports") return { items: [] };
      return { items: [] };
    });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText(/No reports/i)).toBeInTheDocument(),
    );
  });

  it("renders error state", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/reports") throw new Error("reports-fail");
      return { items: [] };
    });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("reports-fail")).toBeInTheDocument(),
    );
  });

  const twoReports = [
    sampleReport,
    { ...sampleReport, id: "r2", title: "Bob — Summary" },
  ];
  function mockTwoReports() {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/reports") return { items: twoReports };
      return {};
    });
  }

  it("deletes a single report via its per-card delete button", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    vi.mocked(api.post).mockResolvedValue({ deleted: 1 });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /Delete report: Alice — Summary/i }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/reports/bulk-delete", {
        ids: ["r1"],
      }),
    );
  });

  it("selects multiple reports and deletes the selection", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    vi.mocked(api.post).mockResolvedValue({ deleted: 2 });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Bob — Summary")).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("checkbox", { name: /Select report: Alice — Summary/i }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Select report: Bob — Summary/i }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /^Delete selected$/i }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/reports/bulk-delete", {
        ids: ["r1", "r2"],
      }),
    );
  });

  it("select-all toggles every report, and toggling off clears it", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    vi.mocked(api.post).mockResolvedValue({ deleted: 2 });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Bob — Summary")).toBeInTheDocument(),
    );

    const selectAll = screen.getByRole("checkbox", { name: /Select all/i });
    await user.click(selectAll);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(selectAll);
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("deletes all reports after confirmation", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    vi.mocked(api.post).mockResolvedValue({ deleted: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /^Delete all$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/reports/bulk-delete", {
        all: true,
      }),
    );
    confirmSpy.mockRestore();
  });

  it("does NOT delete all when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    vi.mocked(api.post).mockResolvedValue({ deleted: 0 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /^Delete all$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("changing a filter resets the current selection", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("checkbox", { name: /Select report: Alice — Summary/i }),
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Type/i), "creator_summary");
    await waitFor(() =>
      expect(screen.getByText("0 selected")).toBeInTheDocument(),
    );
  });

  it("changing the sort re-queries with the new sort key", async () => {
    const user = userEvent.setup();
    mockTwoReports();
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByLabelText(/Sort/i), "title_asc");
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/reports",
        expect.objectContaining({ sort: "title_asc" }),
      ),
    );
  });

  it("paginates: Next/Prev advance the page and re-query", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(
      async (path: string, params?: Record<string, unknown>) => {
        if (path === "/creators") return { items: [sampleCreator] };
        if (path === "/topics") return { items: [sampleTopic] };
        if (path === "/reports") {
          return {
            items: [sampleReport],
            page: (params?.page as number) ?? 1,
            pageSize: 12,
            total: 20,
            totalPages: 2,
          };
        }
        return {};
      },
    );
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/reports",
        expect.objectContaining({ page: 2, pageSize: 12 }),
      ),
    );

    await user.click(screen.getByRole("button", { name: /Prev/i }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/reports",
        expect.objectContaining({ page: 1, pageSize: 12 }),
      ),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * ReportDetailPage
 * -----------------------------------------------------------------------------
 */
describe("ReportDetailPage", () => {
  it("renders report sections", async () => {
    vi.mocked(api.get).mockResolvedValue(sampleReport);
    renderWithRoute("/reports/:reportId", ReportDetailPage, "/reports/r1");
    await waitFor(() =>
      expect(screen.getByText("Alice — Summary")).toBeInTheDocument(),
    );
    expect(screen.getByText("Findings")).toBeInTheDocument();
    /* A bullet line renders as a list item, a non-bullet line as a paragraph. */
    expect(screen.getByText("first point")).toBeInTheDocument();
    expect(screen.getByText("Lead line")).toBeInTheDocument();
    expect(
      screen.getByText('"foldables are becoming real everyday phones."'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "So This is Peak Foldable transcript (Feb 1, 2026, supportive)",
      }),
    ).toHaveAttribute("href", "/videos/v1");
  });

  it("renders error state", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("report-fail"));
    renderWithRoute("/reports/:reportId", ReportDetailPage, "/reports/r1");
    await waitFor(() =>
      expect(screen.getByText("report-fail")).toBeInTheDocument(),
    );
  });
});

/*
 * -----------------------------------------------------------------------------
 * NotFoundPage
 * -----------------------------------------------------------------------------
 */
describe("NotFoundPage", () => {
  it("renders the not-found content + back link", () => {
    renderPage(<NotFoundPage />);
    expect(screen.getByText(/back to dashboard/i)).toBeInTheDocument();
  });
});
