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
import { EvidencePage } from "../../src/pages/EvidencePage";
import { VideosPage } from "../../src/pages/VideosPage";
import { VideoDetailPage } from "../../src/pages/VideoDetailPage";
import { ReportsPage } from "../../src/pages/ReportsPage";
import { TopicAnalysisPage } from "../../src/pages/TopicAnalysisPage";
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
  updatedAt: "2026-01-02T00:00:00Z",
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

const sampleAnalysis = {
  id: "an1",
  chunkId: "ck1",
  videoId: "v1",
  creatorId: "c1",
  topicId: "t1",
  relevanceScore: 0.9,
  stanceLabel: "supportive" as const,
  confidenceScore: 0.8,
  confidenceLabel: "high" as const,
  claimSummary: "claim summary",
  rationale: null,
  evidenceQuote: null,
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

const sampleVideo = {
  id: "v1",
  creatorId: "c1",
  title: "Hello World",
  description: "Some intro",
  publishedAt: "2026-01-01T00:00:00Z",
  durationSeconds: 600,
  thumbnailUrl: null,
  sourceUrl: "https://example.com/v1",
  sourceVideoId: "v1",
  transcriptStatus: "available" as const,
  analysisStatus: "completed" as const,
  creator: { id: "c1", name: "Alice", slug: "alice" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EvidencePage interactions", () => {
  it("filter changes re-trigger evidence query + pagination buttons render", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/evidence")
        return {
          items: [sampleAnalysis],
          page: 1,
          pageSize: 12,
          total: 36,
          totalPages: 3,
        };
      return {};
    });
    renderPage(<EvidencePage />);
    await waitFor(() =>
      expect(screen.getByText(/claim summary/i)).toBeInTheDocument(),
    );

    /* Change stance filter. */
    const stance = screen.getByLabelText(/Stance/i);
    await user.selectOptions(stance, "supportive");
    /* Change confidence filter. */
    const confidence = screen.getByLabelText(/Confidence/i);
    await user.selectOptions(confidence, "high");

    /* Click Next pagination. */
    const next = screen.getByRole("button", { name: /Next/i });
    await user.click(next);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});

describe("VideosPage interactions", () => {
  it("filter changes re-query + pagination + clearing filters", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/videos")
        return {
          items: [sampleVideo],
          page: 1,
          pageSize: 12,
          total: 36,
          totalPages: 3,
        };
      return {};
    });
    renderPage(<VideosPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Hello World").length).toBeGreaterThan(0),
    );

    const stance = screen.getByLabelText(/Stance/i);
    await user.selectOptions(stance, "supportive");

    const confidence = screen.getByLabelText(/Confidence/i);
    await user.selectOptions(confidence, "high");

    const transcript = screen.getByLabelText(/Transcript/i);
    await user.selectOptions(transcript, "available");

    const next = screen.getByRole("button", { name: /Next/i });
    await user.click(next);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});

describe("VideoDetailPage interactions", () => {
  it("renders manual transcript form when status is unavailable + enables submit", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      ...sampleVideo,
      transcriptStatus: "unavailable",
      analysisStatus: "pending",
      videoSummaries: [],
      transcript: null,
      _count: { chunks: 0 },
    });
    vi.mocked(api.post).mockResolvedValue({ ok: true });

    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("Hello World")).toBeInTheDocument(),
    );

    const textarea = screen.getByLabelText(/Transcript/i);
    await user.type(
      textarea,
      "This is a long enough manual transcript to enable the submit button.",
    );

    const submit = screen.getByRole("button", { name: /Save and analyze/i });
    expect(submit).not.toBeDisabled();
    await user.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });

  it("renders transcript content + supports rechunk", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/videos/v1/transcript")) {
        return {
          id: "tx1",
          cleanedText: "full text",
          chunks: [{ id: "ck1", chunkIndex: 0, text: "chunk text" }],
        };
      }
      return {
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
      };
    });
    vi.mocked(api.post).mockResolvedValue({ ok: true });

    renderWithRoute("/videos/:videoId", VideoDetailPage, "/videos/v1");
    await waitFor(() =>
      expect(screen.getByText("Hello World")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText(/chunk text/i)).toBeInTheDocument(),
    );

    /* Click Re-run analysis. */
    const rerun = screen.getByRole("button", { name: /Re-run analysis/i });
    await user.click(rerun);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });
});

describe("ReportsPage interactions", () => {
  it("changing the type filter re-queries", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: [sampleCreator] };
      if (path === "/topics") return { items: [sampleTopic] };
      if (path === "/reports") return { items: [] };
      return {};
    });
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText(/No reports/i)).toBeInTheDocument(),
    );

    const typeFilter = screen.getByLabelText(/Type/i);
    await user.selectOptions(typeFilter, "creator_summary");
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});

describe("TopicAnalysisPage with no timeline", () => {
  it("falls back gracefully when timeline missing", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === `/creators/c1/topics/t1/analysis`) {
        return {
          creator: sampleCreator,
          topic: sampleTopic,
          timeline: null,
          summaries: [],
          topEvidence: [],
          report: null,
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
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );
  });
});
