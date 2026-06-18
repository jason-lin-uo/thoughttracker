import { describe, it, expect, beforeAll } from "vitest";
import {
  cleanTranscriptText,
  countWords,
} from "../src/services/transcript.service";
import { chunkTranscript } from "../src/services/chunking.service";
import {
  detectTopicsForTranscript,
  upsertTopicsBySlug,
  DEFAULT_TOPIC_TAXONOMY,
} from "../src/services/topicDetection.service";
import { classifyChunkForTopic } from "../src/services/stanceAnalysis.service";
import { summarizeVideoForTopic } from "../src/services/videoSummary.service";
import { generateCreatorTopicTimeline } from "../src/services/timeline.service";
import {
  generateCreatorReport,
  generateTopicReport,
} from "../src/services/reportGeneration.service";
import {
  generateEmbeddingsForChunks,
  generateEmbeddingsForCreator,
  pgvectorAvailable,
} from "../src/services/embedding.service";
import {
  getStanceOverTime,
  getTopicFrequency,
} from "../src/services/chartData.service";
import {
  listEvidence,
  getEvidenceDetail,
} from "../src/services/evidence.service";
import { getCreatorComparison } from "../src/services/creatorComparison.service";
import {
  getYoutubeProvider,
  validateChannelUrl,
} from "../src/services/youtubeImport.service";
import { prisma } from "../src/config/prisma";
import {
  createCreatorTopicSummaryFixture,
  createEvidenceDetailFixture,
  deleteCreatorTopicSummaryFixture,
  deleteEvidenceDetailFixture,
} from "./testHelpers";

let creatorId = "";
let topicId = "";
let videoId = "";
let evidenceId = "";

beforeAll(async () => {
  /*
   * Pick a creator that actually HAS a video (the DB can accumulate
   * video-less fixture creators from bulk-import tests; a bare
   * `creator.findFirst()` could return one of those and leave `videoId`
   * null). Resolving via a video guarantees a creator+video pair.
   */
  const video = await prisma.video.findFirst({ include: { creator: true } });
  if (!video) throw new Error("Run `npm run db:seed` first.");
  videoId = video.id;
  creatorId = video.creatorId;
  const topic = await prisma.topic.findFirst();
  topicId = topic!.id;
  const ev = await prisma.chunkTopicAnalysis.findFirst({
    where: { relevanceScore: { gte: 0.4 } },
  });
  evidenceId = ev!.id;
});

describe("transcript.service", () => {
  it("cleanTranscriptText normalises CRLF + whitespace", () => {
    const result = cleanTranscriptText("foo\r\n\r\n\r\nbar baz \n");
    expect(result).toBe("foo\n\nbar baz");
  });
  it("cleanTranscriptText replaces non-breaking spaces", () => {
    const result = cleanTranscriptText("a b c");
    expect(result).toContain("a b c");
  });
  it("countWords returns 0 for empty/falsy", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(null as unknown as string)).toBe(0);
  });
  it("countWords splits on whitespace", () => {
    expect(countWords("one two three\n\nfour")).toBe(4);
  });
});

describe("chunking.service", () => {
  it("chunks plain text into ~1000-word chunks", () => {
    /* Build a 2500-word string that should split into at least two chunks. */
    const words = Array.from({ length: 2500 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkTranscript({ text: words });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(1100);
    }
  });
  it("returns empty array for empty input", () => {
    expect(chunkTranscript({ text: "" })).toEqual([]);
  });
  it("uses segments when provided", () => {
    /* Build 500 timestamped segments to exercise the segment-based chunking path. */
    const segments = Array.from({ length: 500 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 2,
      text: `seg ${i} words go here a bit longer to add up`,
    }));
    const chunks = chunkTranscript({ text: "ignored", segments });
    expect(chunks[0].startSeconds).toBeGreaterThanOrEqual(0);
    expect(chunks[0].endSeconds).not.toBeNull();
  });
});

describe("topicDetection.service", () => {
  it("DEFAULT_TOPIC_TAXONOMY is a non-empty array of strings", () => {
    expect(DEFAULT_TOPIC_TAXONOMY.length).toBeGreaterThan(5);
  });
  it("detectTopicsForTranscript returns DetectedTopic[] in mock mode", async () => {
    const topics = await detectTopicsForTranscript(
      "I want to talk about artificial intelligence today. Artificial intelligence matters.",
    );
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0]?.slug).toBeTruthy();
  });
  it("upsertTopicsBySlug creates new topics + returns ids", async () => {
    const out = await upsertTopicsBySlug([
      {
        name: "Test Topic Coverage",
        slug: `test-topic-coverage-${Date.now()}`,
      },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].id).toBeTruthy();
  });
});

describe("stanceAnalysis.service", () => {
  it("classifyChunkForTopic returns the StanceClassificationResponse shape", async () => {
    const r = await classifyChunkForTopic({
      chunkText: "I support this and I am in favor of it.",
      topicName: "AI",
    });
    expect(r.stanceLabel).toBeDefined();
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(r.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("falls through provider switch on custom_ml with no service", async () => {
    process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";
    process.env.ML_CLASSIFIER_URL = "http://127.0.0.1:1";
    process.env.ML_CLASSIFIER_TIMEOUT_MS = "200";
    const r = await classifyChunkForTopic({
      chunkText: "I disagree.",
      topicName: "AI",
    });
    expect(r.stanceLabel).toBeDefined();
    delete process.env.STANCE_ANALYSIS_PROVIDER;
    delete process.env.ML_CLASSIFIER_URL;
    delete process.env.ML_CLASSIFIER_TIMEOUT_MS;
  });
});

describe("videoSummary + timeline + report services", () => {
  it("summarizeVideoForTopic returns valid shape", async () => {
    const r = await summarizeVideoForTopic({
      topicName: "AI",
      videoTitle: "v",
      chunkAnalyses: [
        {
          chunkIndex: 0,
          relevanceScore: 0.7,
          stanceLabel: "supportive",
          confidenceScore: 0.8,
          claimSummary: "c",
          evidenceQuote: "q",
        },
      ],
    });
    expect(r.dominantStance).toBeDefined();
  });

  it("generateCreatorTopicTimeline returns valid shape", async () => {
    const r = await generateCreatorTopicTimeline({
      creatorName: "C",
      topicName: "AI",
      summaries: [
        {
          videoId: "v1",
          publishedAt: "2024-01-01",
          dominantStance: "supportive",
          confidenceLabel: "high",
          summary: "s",
        },
        {
          videoId: "v2",
          publishedAt: "2024-06-01",
          dominantStance: "neutral",
          confidenceLabel: "medium",
          summary: "s",
        },
      ],
    });
    expect(r.trendLabel).toBeDefined();
  });

  it("generateCreatorReport returns full report shape", async () => {
    const r = await generateCreatorReport({
      creatorName: "C",
      topics: [
        {
          topicName: "AI",
          trendLabel: "stable",
          timelineSummary: "s",
          videoCount: 5,
        },
      ],
    });
    expect(r.title).toBeTruthy();
    expect(r.caveats).toMatch(/transcript data/i);
  });

  it("generateTopicReport returns full report shape", async () => {
    const r = await generateTopicReport({
      creatorName: "C",
      topicName: "AI",
      summaries: [
        {
          videoId: "v1",
          videoTitle: "T",
          publishedAt: "2024-01-01",
          dominantStance: "supportive",
          summary: "s",
        },
      ],
      timelineSummary: "trend up",
    });
    expect(r.title).toContain("AI");
  });
});

describe("embedding services", () => {
  it("pgvectorAvailable returns a boolean", async () => {
    const a = await pgvectorAvailable();
    expect(typeof a).toBe("boolean");
  });

  it("generateEmbeddingsForChunks is idempotent for existing chunks", async () => {
    const chunk = await prisma.transcriptChunk.findFirst();
    const r = await generateEmbeddingsForChunks([chunk!.id]);
    expect(r.generated).toBe(0); /* already embedded */
  });

  it("generateEmbeddingsForChunks no-ops for nonexistent chunk", async () => {
    const r = await generateEmbeddingsForChunks(["does-not-exist"]);
    expect(r.generated).toBe(0);
  });

  it("generateEmbeddingsForCreator returns count", async () => {
    const r = await generateEmbeddingsForCreator(creatorId);
    expect(r.generated).toBeGreaterThanOrEqual(0);
  });

});

describe("chartData.service", () => {
  it("getStanceOverTime returns time-series points", async () => {
    const r = await getStanceOverTime({ creatorId });
    expect(Array.isArray(r)).toBe(true);
  });

  it("getStanceOverTime narrows by topicId", async () => {
    const r = await getStanceOverTime({ creatorId, topicId });
    expect(Array.isArray(r)).toBe(true);
  });

  it("getTopicFrequency returns points + topics", async () => {
    const r = await getTopicFrequency({ creatorId });
    expect(Array.isArray(r.points)).toBe(true);
    expect(Array.isArray(r.topics)).toBe(true);
  });

  it("getStanceOverTime averages fixture summaries by month and skips unclear rows", async () => {
    const fixture = await createCreatorTopicSummaryFixture("chart-stance");
    try {
      await prisma.videoTopicSummary.updateMany({
        where: { creatorId: fixture.creatorId },
        data: { dominantStance: "supportive", mentionCount: 2 },
      });
      const extraVideo = await prisma.video.create({
        data: {
          creatorId: fixture.creatorId,
          platform: "youtube",
          sourceVideoId: `chart-stance-extra-${Date.now()}`,
          sourceUrl: "https://www.example.com/chart-stance-extra",
          title: "Unclear stance fixture",
          transcriptStatus: "available",
          analysisStatus: "completed",
          publishedAt: new Date("2026-01-15T00:00:00Z"),
        },
      });
      await prisma.videoTopicSummary.create({
        data: {
          videoId: extraVideo.id,
          creatorId: fixture.creatorId,
          topicId: fixture.topicId,
          dominantStance: "unclear",
          confidenceScore: 0.2,
          confidenceLabel: "low",
          mentionCount: 1,
          summary: "This row should not affect the stance average.",
          notableEvidence: [],
        },
      });

      const points = await getStanceOverTime({
        creatorId: fixture.creatorId,
        topicId: fixture.topicId,
      });
      expect(points).toContainEqual({
        date: "2026-01",
        averageStance: 1,
        count: 1,
      });
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("getTopicFrequency builds monthly topic totals from fixture summaries", async () => {
    const fixture = await createCreatorTopicSummaryFixture("chart-frequency");
    try {
      await prisma.videoTopicSummary.updateMany({
        where: { creatorId: fixture.creatorId },
        data: { mentionCount: 0 },
      });
      const empty = await getTopicFrequency({ creatorId: fixture.creatorId });
      expect(empty.points).toEqual([]);

      await prisma.videoTopicSummary.updateMany({
        where: { creatorId: fixture.creatorId },
        data: { mentionCount: 2 },
      });
      const result = await getTopicFrequency({ creatorId: fixture.creatorId });
      expect(result.topics).toEqual([
        expect.objectContaining({ id: fixture.topicId }),
      ]);
      expect(result.points.length).toBeGreaterThan(0);
      expect(Object.values(result.points[0].topics)[0]).toBeGreaterThan(0);
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });
});

describe("evidence.service", () => {
  it("listEvidence paginates", async () => {
    const r = await listEvidence({ pageSize: 5 });
    expect(r.items.length).toBeLessThanOrEqual(5);
    expect(r.total).toBeGreaterThanOrEqual(r.items.length);
  });

  it("listEvidence applies search filter", async () => {
    const r = await listEvidence({ search: "disagree", pageSize: 5 });
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("listEvidence applies stanceLabel filter", async () => {
    const r = await listEvidence({ stanceLabel: "supportive", pageSize: 5 });
    for (const e of r.items) expect(e.stanceLabel).toBe("supportive");
  });

  it("listEvidence applies date range filter", async () => {
    const r = await listEvidence({
      from: "1900-01-01",
      to: "1900-01-02",
      pageSize: 5,
    });
    expect(r.items.length).toBe(0);
  });

  it("listEvidence narrows by creatorId / topicId / videoId", async () => {
    const r = await listEvidence({ creatorId, topicId, videoId, pageSize: 5 });
    for (const e of r.items) {
      expect(e.creatorId).toBe(creatorId);
      expect(e.topicId).toBe(topicId);
    }
  });

  it("listEvidence applies confidenceLabel filter", async () => {
    const r = await listEvidence({ confidenceLabel: "high", pageSize: 3 });
    for (const e of r.items) expect(e.confidenceLabel).toBe("high");
  });

  it("getEvidenceDetail returns context", async () => {
    const fixture = await createEvidenceDetailFixture("service");
    try {
      const r = await getEvidenceDetail(fixture.analysisId);
      expect(r).not.toBeNull();
      expect(r!.analysis.id).toBe(fixture.analysisId);
      expect(Array.isArray(r!.relatedEvidence)).toBe(true);
    } finally {
      await deleteEvidenceDetailFixture(fixture);
    }
  });

  it("getEvidenceDetail returns null for unknown id", async () => {
    const r = await getEvidenceDetail("does-not-exist");
    expect(r).toBeNull();
  });
});

describe("youtubeImport.service", () => {
  it("getYoutubeProvider exposes a real-provider placeholder that fails clearly", async () => {
    process.env.YOUTUBE_PROVIDER = "youtube";
    process.env.YOUTUBE_API_KEY = "";
    const provider = getYoutubeProvider();
    await expect(
      provider.resolveChannel("https://www.youtube.com/@dev"),
    ).rejects.toThrow(/not configured/i);
  });

  it("validateChannelUrl accepts youtube URLs + handles + bare slugs", () => {
    expect(validateChannelUrl("https://youtube.com/@x")).toBe(true);
    expect(validateChannelUrl("https://www.youtube.com/channel/UC123")).toBe(
      true,
    );
    expect(validateChannelUrl("@handle")).toBe(true);
    expect(validateChannelUrl("plainhandle")).toBe(true);
  });

  it("validateChannelUrl rejects blank / weird input", () => {
    expect(validateChannelUrl("")).toBe(false);
  });

  it("getYoutubeProvider rejects runtime video listing until a real importer is configured", async () => {
    const provider = getYoutubeProvider();
    await expect(provider.listRecentVideos("UC_test", 3)).rejects.toThrow(
      /not configured/i,
    );
  });

  it("getYoutubeProvider rejects runtime transcript fetching until a real importer is configured", async () => {
    const provider = getYoutubeProvider();
    await expect(provider.fetchTranscript("video1")).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe("creatorComparison.service", () => {
  it("returns side-by-side stats + shared topics for 2 creators", async () => {
    const creators = await prisma.creator.findMany({ take: 2 });
    if (creators.length < 2) return; /* skip if seed only has one creator */
    const result = await getCreatorComparison([creators[0].id, creators[1].id]);
    expect(result.creators).toHaveLength(2);
    expect(result.creators[0].creatorId).toBe(creators[0].id);
    expect(result.creators[1].creatorId).toBe(creators[1].id);
    /* Stats fields present. */
    for (const c of result.creators) {
      expect(typeof c.videoCount).toBe("number");
      expect(typeof c.transcriptCount).toBe("number");
      expect(typeof c.topicCount).toBe("number");
      expect(typeof c.evidenceCount).toBe("number");
    }
    /* Shared topics: each row has one entry per input creator. */
    for (const row of result.sharedTopics) {
      expect(row.perCreator).toHaveLength(2);
    }
    /* Timeline points keyed by date with creator-indexed values. */
    for (const p of result.timeline.points) {
      expect(typeof p.date).toBe("string");
      expect(creators[0].id in p.values).toBe(true);
      expect(creators[1].id in p.values).toBe(true);
    }
  });

  it("preserves caller order even when input mixes id + slug", async () => {
    const creators = await prisma.creator.findMany({ take: 2 });
    if (creators.length < 2) return;
    const result = await getCreatorComparison([
      creators[1].slug,
      creators[0].id,
    ]);
    expect(result.creators[0].slug).toBe(creators[1].slug);
    expect(result.creators[1].creatorId).toBe(creators[0].id);
  });

  it("rejects fewer than 2 creators with a BadRequestError", async () => {
    await expect(getCreatorComparison(["only-one"])).rejects.toThrow(
      /at least 2 ids/,
    );
  });

  it("rejects more than 5 creators with a BadRequestError", async () => {
    await expect(
      getCreatorComparison(["a", "b", "c", "d", "e", "f"]),
    ).rejects.toThrow(/at most 5 ids/);
  });

  it("throws a NotFoundError listing unresolved ids (was a silent empty shape)", async () => {
    /*
     * Audit: unknown creator ids previously returned a 200 with an empty
     * payload; they now surface a clear 404 naming the unresolved keys.
     */
    await expect(
      getCreatorComparison(["does-not-exist-1", "does-not-exist-2"]),
    ).rejects.toThrow(/Unknown creator/);
  });

  it("throws when only SOME ids resolve (partial-unknown is not silently dropped)", async () => {
    const creators = await prisma.creator.findMany({ take: 1 });
    if (creators.length < 1) return;
    await expect(
      getCreatorComparison([creators[0].id, "definitely-not-a-real-creator"]),
    ).rejects.toThrow(/definitely-not-a-real-creator/);
  });

  it("dedupes when the same creator id appears twice", async () => {
    const creators = await prisma.creator.findMany({ take: 2 });
    if (creators.length < 2) return;
    const result = await getCreatorComparison([
      creators[0].id,
      creators[0].id,
      creators[1].id,
    ]);
    expect(result.creators).toHaveLength(2);
  });

  it("rejects when ids dedupe to fewer than 2 DISTINCT creators (same creator by id + slug)", async () => {
    const creators = await prisma.creator.findMany({ take: 1 });
    if (creators.length < 1) return;
    /*
     * The same creator passed by BOTH its id and its slug resolves to one
     * distinct creator; comparing a creator with itself is meaningless, so the
     * service rejects rather than rendering a degenerate one-column comparison.
     */
    await expect(
      getCreatorComparison([creators[0].id, creators[0].slug]),
    ).rejects.toThrow(/at least 2 distinct/);
  });
});
