import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import {
  CreatorCard,
  VideoCard,
  TopicCard,
  ReportCard,
  EvidenceCard,
} from "../../src/components/Cards";

/* Wraps UI in a BrowserRouter so the cards' <Link>s have a routing context. */
const wrap = (ui: React.ReactNode) => <BrowserRouter>{ui}</BrowserRouter>;

describe("CreatorCard", () => {
  it("renders name + slug + counts + last-imported", () => {
    render(
      wrap(
        <CreatorCard
          creator={{
            id: "c1",
            name: "Atlas",
            slug: "atlas",
            description: "desc",
            creatorType: "youtube_channel",
            thumbnailUrl: "http://x/img.png",
            videoCount: 3,
            transcriptCount: 2,
            topicCount: 5,
            lastImportedAt: new Date().toISOString(),
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01",
          }}
        />,
      ),
    );
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("@atlas")).toBeInTheDocument();
    expect(screen.getByText("desc")).toBeInTheDocument();
  });

  it("renders initial fallback when no thumbnail", () => {
    render(
      wrap(
        <CreatorCard
          creator={{
            id: "c2",
            name: "Beta",
            slug: "beta",
            description: null,
            creatorType: "youtube_channel",
            thumbnailUrl: null,
            videoCount: 0,
            transcriptCount: 0,
            topicCount: 0,
            lastImportedAt: null,
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01",
          }}
        />,
      ),
    );
    expect(screen.getByText("BE")).toBeInTheDocument();
  });
});

describe("VideoCard", () => {
  it("renders title + creator + status badges", () => {
    render(
      wrap(
        <VideoCard
          video={{
            id: "v1",
            creatorId: "c1",
            title: "My Video",
            description: null,
            publishedAt: "2025-01-15",
            durationSeconds: 600,
            thumbnailUrl: "http://x/t.png",
            sourceUrl: "https://yt/v1",
            sourceVideoId: "v1",
            transcriptStatus: "available",
            analysisStatus: "completed",
            creator: { id: "c1", name: "Atlas", slug: "atlas" },
          }}
        />,
      ),
    );
    expect(screen.getByText("My Video")).toBeInTheDocument();
    expect(screen.getByText(/Atlas/)).toBeInTheDocument();
  });

  it("renders without a thumbnail", () => {
    render(
      wrap(
        <VideoCard
          video={{
            id: "v2",
            creatorId: "c1",
            title: "No Thumb",
            description: null,
            publishedAt: null,
            durationSeconds: null,
            thumbnailUrl: null,
            sourceUrl: "https://yt/v2",
            sourceVideoId: "v2",
            transcriptStatus: "unavailable",
            analysisStatus: "pending",
          }}
        />,
      ),
    );
    expect(screen.getByText("No Thumb")).toBeInTheDocument();
  });
});

describe("TopicCard", () => {
  it("renders name + counts + stance badge", () => {
    render(
      wrap(
        <TopicCard
          topic={{ id: "t1", name: "AI", slug: "ai" }}
          videoCount={5}
          mentionCount={12}
          dominantStance="supportive"
          to="/creators/c1/topics/t1"
        />,
      ),
    );
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

describe("ReportCard", () => {
  it("renders type + title + summary + creator", () => {
    render(
      wrap(
        <ReportCard
          report={{
            id: "r1",
            creatorId: "c1",
            topicId: null,
            reportType: "creator_summary",
            title: "Big Report",
            summary: "this is a summary",
            caveats: "watch out",
            evidenceJson: null,
            createdAt: "2025-01-01",
            creator: { id: "c1", name: "Atlas", slug: "atlas" },
          }}
        />,
      ),
    );
    expect(screen.getByText("Big Report")).toBeInTheDocument();
    expect(screen.getByText("this is a summary")).toBeInTheDocument();
  });

  it("omits the creator byline when no creator is hydrated", () => {
    /* Exercises the empty-string arm of `report.creator?.name ? … : ""`. */
    render(
      wrap(
        <ReportCard
          report={{
            id: "r2",
            creatorId: "c1",
            topicId: null,
            reportType: "topic_brief",
            title: "Authorless Report",
            summary: "no byline here",
            caveats: "watch out",
            evidenceJson: null,
            createdAt: "2025-01-01",
          }}
        />,
      ),
    );
    expect(screen.getByText("Authorless Report")).toBeInTheDocument();
    /* Footer holds only the formatted date, never a "· " byline separator. */
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

describe("EvidenceCard", () => {
  it("renders all the parts when fully populated", () => {
    render(
      wrap(
        <EvidenceCard
          evidence={{
            id: "e1",
            chunkId: "ch1",
            videoId: "v1",
            creatorId: "c1",
            topicId: "t1",
            relevanceScore: 0.8,
            stanceLabel: "opposed",
            confidenceScore: 0.7,
            confidenceLabel: "high",
            claimSummary: "claims X",
            rationale: "because Y",
            evidenceQuote: "I disagree.",
            createdAt: "2025-01-01",
            creator: { id: "c1", name: "Atlas", slug: "atlas" },
            topic: { id: "t1", name: "AI", slug: "ai", description: null },
            video: {
              id: "v1",
              title: "Vid",
              sourceUrl: "https://yt/v1",
              publishedAt: "2025-01-01",
              thumbnailUrl: null,
            },
            chunk: {
              id: "ch1",
              chunkIndex: 0,
              startSeconds: null,
              endSeconds: null,
            },
          }}
        />,
      ),
    );
    expect(screen.getByText(/I disagree/)).toBeInTheDocument();
    expect(screen.getByText("claims X")).toBeInTheDocument();
    expect(screen.getByText("because Y")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("renders with minimal data", () => {
    render(
      wrap(
        <EvidenceCard
          evidence={{
            id: "e2",
            chunkId: "ch2",
            videoId: "v2",
            creatorId: "c2",
            topicId: "t2",
            relevanceScore: 0.5,
            stanceLabel: "neutral",
            confidenceScore: 0.5,
            confidenceLabel: "medium",
            claimSummary: null,
            rationale: null,
            evidenceQuote: null,
            createdAt: "2025-01-01",
          }}
        />,
      ),
    );
    /* Doesn't crash, renders something */
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("renders the topic as plain text (not a dead link) when no creator is hydrated", () => {
    /*
     * Topic present (so the topic chip renders) but creator absent — the
     * topic-analysis route needs both ids, so we must NOT emit a link. This
     * exercises the non-link arm that replaced the old dead `href="#"`.
     */
    render(
      wrap(
        <EvidenceCard
          evidence={{
            id: "e3",
            chunkId: "ch3",
            videoId: "v3",
            creatorId: "c3",
            topicId: "t3",
            relevanceScore: 0.6,
            stanceLabel: "mixed",
            confidenceScore: 0.6,
            confidenceLabel: "low",
            claimSummary: null,
            rationale: null,
            evidenceQuote: null,
            createdAt: "2025-01-01",
            topic: {
              id: "t3",
              name: "Energy",
              slug: "energy",
              description: null,
            },
          }}
        />,
      ),
    );
    /* The topic name is still shown… */
    expect(screen.getByText(/#Energy/)).toBeInTheDocument();
    /* …but NOT as a link (no dead `#` href). */
    expect(
      screen.queryByRole("link", { name: /#Energy/ }),
    ).not.toBeInTheDocument();
  });
});
