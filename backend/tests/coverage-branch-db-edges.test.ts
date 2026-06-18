/**
 * coverage-branch-db-edges.test.ts — branch-only coverage for code paths
 * that need real DB rows in specific shapes (null publishedAt, null
 * summaries, single-sided date filters, tied sort keys, etc).
 *
 * Each test seeds a precise fixture, exercises an *untaken branch arm*,
 * and tears the fixture down. No source is changed.
 *
 * Targets (file:line):
 * - controllers/videos: 42/43 (`from`/`to` only), 51 (topicId filter)
 * - controllers/evidence: 28/29/30 (`from`/`to`/`page` present arms)
 * - controllers/creators: 243 (tied videoCount → mentionCount tiebreak),
 * 297/299 (null publishedAt + earlier-date no-update arm), 319 (`: ""`)
 * - controllers/dashboard: 88-92 (`?? "mock"` provider fallbacks)
 * - controllers/transcripts: 116 (`cleanedText ?? cleanTranscriptText`)
 * - controllers/importJobs: 67 (`String(value ?? "")` segment guard)
 * - services/chartData: 43/92 (`publishedAt ?? createdAt`)
 * - services/creatorComparison: 209 (`publishedAt ?? createdAt`)
 * - services/evidence: 52/53 (`from`/`to` only)
 * - services/embedding: 80 (`if (useNative)` false arm)
 * - jobs/analyzeCreator: 59 (null summary), 72/73 (empty dates `?? null`)
 * - jobs/generateReport: 56/57/134 (null summary, missing count map key)
 * - jobs/bulkImport: 204/261/262/275/276 (null publishedAt/duration/desc)
 * - jobs/analyzeVideo: 116 (`cleanedText ?? rawText`)
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { jobRunner } from "../src/jobs/jobRunner";
import { chunkTranscriptJob } from "../src/jobs/chunkTranscript.job";

const app = buildApp();

/* Track ids to delete after each test so fixtures don't leak across the suite. */
const createdCreatorIds: string[] = [];
const createdTopicIds: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of createdCreatorIds.splice(0)) {
    await prisma.creator.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdTopicIds.splice(0)) {
    await prisma.topic.delete({ where: { id } }).catch(() => undefined);
  }
});

beforeAll(async () => {
  await prisma.creator.findFirst(); /* sanity-check the DB is reachable */
});

/* Seeds a creator + topic + one video (publishedAt optionally null) + one summary, returning the ids. */
async function seedSummaryFixture(args: {
  label: string;
  publishedAt: Date | null;
  dominantStance?: string;
  mentionCount?: number;
  summary?: string | null;
}): Promise<{ creatorId: string; topicId: string; videoId: string }> {
  const suffix = `${args.label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creator = await prisma.creator.create({
    data: {
      name: `Branch ${suffix}`,
      slug: `branch-${suffix}`,
      creatorType: "youtube_channel",
    },
  });
  createdCreatorIds.push(creator.id);
  const topic = await prisma.topic.create({
    data: {
      name: `Branch Topic ${suffix}`,
      slug: `branch-topic-${suffix}`,
      source: "system_default",
    },
  });
  createdTopicIds.push(topic.id);
  const video = await prisma.video.create({
    data: {
      creatorId: creator.id,
      platform: "youtube",
      sourceVideoId: `branch-video-${suffix}`,
      sourceUrl: `https://www.example.com/branch-video-${suffix}`,
      title: "Branch fixture video",
      transcriptStatus: "available",
      analysisStatus: "completed",
      publishedAt: args.publishedAt,
    },
  });
  await prisma.videoTopicSummary.create({
    data: {
      videoId: video.id,
      creatorId: creator.id,
      topicId: topic.id,
      dominantStance: args.dominantStance ?? "supportive",
      confidenceScore: 0.8,
      confidenceLabel: "high",
      mentionCount: args.mentionCount ?? 2,
      summary:
        args.summary === undefined ? "Branch fixture summary." : args.summary,
      notableEvidence: [],
    },
  });
  return { creatorId: creator.id, topicId: topic.id, videoId: video.id };
}

/*
 * ----------------------------------------------------------------------------
 * videos.controller — single-sided date filters + topicId filter
 * ----------------------------------------------------------------------------
 */

describe("videos.controller — filter ternary arms", () => {
  it("accepts a `from`-only date filter (line 43 `: {}` arm)", async () => {
    const r = await request(app)
      .get("/api/videos")
      .query({ from: "2020-01-01", pageSize: 1 });
    expect(r.status).toBe(200);
  });

  it("accepts a `to`-only date filter (line 42 `: {}` arm)", async () => {
    const r = await request(app)
      .get("/api/videos")
      .query({ to: "2099-12-31", pageSize: 1 });
    expect(r.status).toBe(200);
  });

  it("accepts a topicId-only summary filter (line 51 `topicId` arm)", async () => {
    const fixture = await seedSummaryFixture({
      label: "vid-topic",
      publishedAt: new Date("2026-01-01"),
    });
    const r = await request(app)
      .get("/api/videos")
      .query({ topicId: fixture.topicId, pageSize: 5 });
    expect(r.status).toBe(200);
  });
});

/*
 * ----------------------------------------------------------------------------
 * evidence.controller — from/to/page present arms
 * ----------------------------------------------------------------------------
 */

describe("evidence.controller — query param present arms", () => {
  it("threads from/to/page string params through (lines 28/29/30)", async () => {
    const r = await request(app).get("/api/evidence").query({
      from: "2020-01-01",
      to: "2099-12-31",
      page: "1",
      pageSize: "5",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });
});

/*
 * ----------------------------------------------------------------------------
 * creators.controller — aggregate tiebreak + null publishedAt + compare guard
 * ----------------------------------------------------------------------------
 */

describe("creators.controller — aggregate + overview branch arms", () => {
  it("breaks a videoCount tie by mentionCount in aggregateTopTopics (line 243)", async () => {
    /*
     * Two topics, each with exactly one video summary (videoCount == 1) but
     * different mentionCount → the `|| b.mentionCount - a.mentionCount`
     * secondary comparator decides the order.
     */
    const suffix = `tie-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `Tie ${suffix}`,
        slug: `tie-${suffix}`,
        creatorType: "youtube_channel",
      },
    });
    createdCreatorIds.push(creator.id);
    const topics = await Promise.all(
      [0, 1].map((i) =>
        prisma.topic.create({
          data: {
            name: `Tie Topic ${suffix}-${i}`,
            slug: `tie-topic-${suffix}-${i}`,
            source: "system_default",
          },
        }),
      ),
    );
    for (const t of topics) createdTopicIds.push(t.id);
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `tie-video-${suffix}`,
        sourceUrl: `https://www.example.com/tie-${suffix}`,
        title: "Tie fixture",
        transcriptStatus: "available",
        analysisStatus: "completed",
        publishedAt: new Date("2026-01-01"),
      },
    });
    await prisma.videoTopicSummary.createMany({
      data: topics.map((t, i) => ({
        videoId: video.id,
        creatorId: creator.id,
        topicId: t.id,
        dominantStance: "supportive",
        confidenceScore: 0.8,
        confidenceLabel: "high",
        mentionCount:
          i === 0 ? 1 : 9 /* equal videoCount, different mentionCount */,
        summary: "tie",
        notableEvidence: [],
      })),
    });
    /* aggregateTopTopics runs inside the /overview endpoint. */
    const r = await request(app).get(`/api/creators/${creator.id}/overview`);
    expect(r.status).toBe(200);
    expect(r.body.topTopics.length).toBe(2);
    /* Higher mentionCount sorts first when videoCount ties. */
    expect(r.body.topTopics[0].mentionCount).toBe(9);
  });

  it("getCreatorTopics handles a null publishedAt summary (line 297 false arm)", async () => {
    const fixture = await seedSummaryFixture({
      label: "topics-nullpub",
      publishedAt: null,
    });
    const r = await request(app).get(
      `/api/creators/${fixture.creatorId}/topics`,
    );
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items[0].firstPublishedAt).toBeNull();
  });

  it("getCreatorTopics keeps the earliest/latest dates across multiple videos (line 299 no-update arm)", async () => {
    /*
     * Two videos for one topic with descending publish dates so the second
     * (earlier) video does NOT update lastPublishedAt → the `pub > cur.last`
     * branch on line 299 is taken as false.
     */
    const suffix = `dates-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `Dates ${suffix}`,
        slug: `dates-${suffix}`,
        creatorType: "youtube_channel",
      },
    });
    createdCreatorIds.push(creator.id);
    const topic = await prisma.topic.create({
      data: {
        name: `Dates Topic ${suffix}`,
        slug: `dates-topic-${suffix}`,
        source: "system_default",
      },
    });
    createdTopicIds.push(topic.id);
    const dates = [
      new Date("2026-06-01"),
      new Date("2026-01-01"),
    ]; /* later first, earlier second */
    for (let i = 0; i < dates.length; i += 1) {
      const v = await prisma.video.create({
        data: {
          creatorId: creator.id,
          platform: "youtube",
          sourceVideoId: `dates-video-${suffix}-${i}`,
          sourceUrl: `https://www.example.com/dates-${suffix}-${i}`,
          title: `Dates fixture ${i}`,
          transcriptStatus: "available",
          analysisStatus: "completed",
          publishedAt: dates[i],
        },
      });
      await prisma.videoTopicSummary.create({
        data: {
          videoId: v.id,
          creatorId: creator.id,
          topicId: topic.id,
          dominantStance: "supportive",
          confidenceScore: 0.8,
          confidenceLabel: "high",
          mentionCount: 1,
          summary: "dates",
          notableEvidence: [],
        },
      });
    }
    const r = await request(app).get(`/api/creators/${creator.id}/topics`);
    expect(r.status).toBe(200);
    const item = r.body.items[0];
    expect(new Date(item.firstPublishedAt).getTime()).toBe(dates[1].getTime());
    expect(new Date(item.lastPublishedAt).getTime()).toBe(dates[0].getTime());
  });

  it('compareCreators handles a non-string creatorIds query (line 319 `: ""` arm)', async () => {
    /*
     * Passing creatorIds as an array makes `typeof === "string"` false →
     * the `: ""` arm runs → raw="" → ids resolve to [] → the comparison
     * service rejects fewer-than-2 ids with a 400. Either way the `: ""`
     * branch executed, which is the coverage target.
     */
    const r = await request(app)
      .get("/api/creators/compare")
      .query({ creatorIds: ["a", "b"] });
    expect(r.status).toBe(400);
  });
});

/*
 * ----------------------------------------------------------------------------
 * dashboard.controller — provider `?? "mock"` fallbacks
 * ----------------------------------------------------------------------------
 */

describe("dashboard.controller — system status provider fallbacks", () => {
  it("falls back to 'mock' labels when provider envs are unset (lines 88-92)", async () => {
    const keys = [
      "AI_PROVIDER",
      "EMBEDDING_PROVIDER",
      "YOUTUBE_PROVIDER",
      "STANCE_ANALYSIS_PROVIDER",
    ];
    const snapshot: Record<string, string | undefined> = {};
    for (const k of keys) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const r = await request(app).get("/api/system/status");
      expect(r.status).toBe(200);
      expect(r.body.env.aiProvider).toBe("local");
      expect(r.body.env.embeddingProvider).toBe("ml");
      expect(r.body.env.youtubeProvider).toBe("youtube");
      expect(r.body.env.stanceProvider).toBe("custom_ml");
      expect(r.body.env).not.toHaveProperty("mockMode");
    } finally {
      for (const k of keys) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
      }
    }
  });
});

/*
 * ----------------------------------------------------------------------------
 * transcripts.controller — rechunk uses rawText when cleanedText is null
 * ----------------------------------------------------------------------------
 */

describe("transcripts.controller — rechunk cleanedText fallback (line 116)", () => {
  it("rechunks from rawText when cleanedText is null", async () => {
    const suffix = `rechunk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `Rechunk ${suffix}`,
        slug: `rechunk-${suffix}`,
        creatorType: "youtube_channel",
      },
    });
    createdCreatorIds.push(creator.id);
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `rechunk-video-${suffix}`,
        sourceUrl: `https://www.example.com/rechunk-${suffix}`,
        title: "Rechunk fixture",
        transcriptStatus: "available",
        analysisStatus: "pending",
      },
    });
    const raw =
      "Raw transcript text for rechunk. " + "Sentence here. ".repeat(40);
    const transcript = await prisma.transcript.create({
      data: {
        videoId: video.id,
        sourceType: "manual_paste",
        language: "en",
        rawText: raw,
        cleanedText:
          null /* forces the job's `?? cleanTranscriptText(rawText)` arm */,
        wordCount: raw.split(/\s+/).length,
      },
    });
    /*
     * H15: rechunk is async now (202 + queued); the cleanedText-null fallback
     * lives in chunkTranscriptJob. Drain, then assert chunks were written.
     */
    const r = await request(app).post(
      `/api/videos/${video.id}/transcript/rechunk`,
    );
    expect(r.status).toBe(202);
    await jobRunner.drain();
    const chunkCount = await prisma.transcriptChunk.count({
      where: { transcriptId: transcript.id },
    });
    expect(chunkCount).toBeGreaterThan(0);
  });

  it("rechunks from existing chunks when the hosted snapshot omits duplicate transcript text", async () => {
    const suffix = `hosted-rechunk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `Hosted Rechunk ${suffix}`,
        slug: `hosted-rechunk-${suffix}`,
        creatorType: "youtube_channel",
      },
    });
    createdCreatorIds.push(creator.id);
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `hosted-rechunk-video-${suffix}`,
        sourceUrl: `https://www.example.com/hosted-rechunk-${suffix}`,
        title: "Hosted rechunk fixture",
        transcriptStatus: "available",
        analysisStatus: "pending",
      },
    });
    const transcript = await prisma.transcript.create({
      data: {
        videoId: video.id,
        sourceType: "youtube_auto",
        language: "en",
        rawText:
          "[Hosted snapshot: full transcript text is stored in ordered TranscriptChunk rows.]",
        cleanedText: null,
        wordCount: 120,
      },
    });
    const chunkText =
      "Chunk-sourced hosted transcript text. " +
      "This real chunk content should survive rechunking. ".repeat(35);
    await prisma.transcriptChunk.create({
      data: {
        transcriptId: transcript.id,
        videoId: video.id,
        chunkIndex: 0,
        text: chunkText,
        tokenCount: chunkText.split(/\s+/).length,
      },
    });
    const enqueueSpy = vi
      .spyOn(jobRunner, "enqueue")
      .mockImplementation(() => undefined);

    await chunkTranscriptJob(video.id);

    expect(enqueueSpy).toHaveBeenCalledWith(
      `analyzeVideo:${video.id}`,
      expect.any(Function),
    );
    const rebuiltChunks = await prisma.transcriptChunk.findMany({
      where: { transcriptId: transcript.id },
      orderBy: { chunkIndex: "asc" },
    });
    const rebuiltText = rebuiltChunks.map((chunk) => chunk.text).join("\n");
    expect(rebuiltChunks.length).toBeGreaterThan(0);
    expect(rebuiltText).toContain("Chunk-sourced hosted transcript text");
    expect(rebuiltText).not.toContain("[Hosted snapshot:");
  });

  it("marks hosted-snapshot rechunk failed when neither transcript text nor chunks exist", async () => {
    const suffix = `hosted-rechunk-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `Hosted Rechunk Empty ${suffix}`,
        slug: `hosted-rechunk-empty-${suffix}`,
        creatorType: "youtube_channel",
      },
    });
    createdCreatorIds.push(creator.id);
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `hosted-rechunk-empty-video-${suffix}`,
        sourceUrl: `https://www.example.com/hosted-rechunk-empty-${suffix}`,
        title: "Hosted rechunk empty fixture",
        transcriptStatus: "available",
        analysisStatus: "pending",
      },
    });
    await prisma.transcript.create({
      data: {
        videoId: video.id,
        sourceType: "youtube_auto",
        language: "en",
        rawText:
          "[Hosted snapshot: full transcript text is stored in ordered TranscriptChunk rows.]",
        cleanedText: null,
        wordCount: 0,
      },
    });

    await chunkTranscriptJob(video.id);

    const updated = await prisma.video.findUniqueOrThrow({
      where: { id: video.id },
      select: { analysisStatus: true },
    });
    expect(updated.analysisStatus).toBe("failed");
  });
});

/*
 * ----------------------------------------------------------------------------
 * importJobs.controller — safeInlinePathSegment `?? ""` arm
 * ----------------------------------------------------------------------------
 */

describe("importJobs.controller — inline segment null guard (line 67)", () => {
  it('rejects an inline entry whose videoId is missing (String(undefined ?? "") → 400)', async () => {
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({
        inline: {
          manifest: {
            creator: {
              name: "Null Seg",
              slug: "null-seg-fixture",
              channelUrl: null,
              description: null,
              thumbnailUrl: null,
            },
            entries: [
              {
                /* videoId intentionally omitted → safeInlinePathSegment(undefined) */
                title: "Missing id",
                sourceUrl: "https://www.youtube.com/watch?v=x",
                transcriptPath: "x.txt",
                status: "saved",
              },
            ],
          },
          transcripts: { x: "body " + "word ".repeat(80) },
        },
      });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/transcripts key|videoId|letters/i);
  });
});

/*
 * ----------------------------------------------------------------------------
 * chartData.service — publishedAt ?? createdAt (lines 43, 92)
 * ----------------------------------------------------------------------------
 */

describe("chartData.service — null publishedAt falls back to createdAt", () => {
  it("getStanceOverTime + getTopicFrequency bucket by createdAt when publishedAt is null", async () => {
    const fixture = await seedSummaryFixture({
      label: "chart-nullpub",
      publishedAt: null,
      mentionCount: 3,
    });
    const { getStanceOverTime, getTopicFrequency } = await import(
      "../src/services/chartData.service"
    );
    const stance = await getStanceOverTime({ creatorId: fixture.creatorId });
    expect(stance.length).toBeGreaterThan(0); /* line 43 `?? createdAt` */
    const freq = await getTopicFrequency({ creatorId: fixture.creatorId });
    expect(freq.points.length).toBeGreaterThan(0); /* line 92 `?? createdAt` */
  });
});

/*
 * ----------------------------------------------------------------------------
 * creatorComparison.service — publishedAt ?? createdAt (line 209)
 * ----------------------------------------------------------------------------
 */

describe("creatorComparison.service — null publishedAt in timeline overlay", () => {
  it("buckets a null-publishedAt summary by createdAt (line 209)", async () => {
    /*
     * getCreatorComparison requires at least 2 creators; both get a
     * null-publishedAt summary so the timeline overlay hits the `?? createdAt`.
     */
    const a = await seedSummaryFixture({
      label: "compare-nullpub-a",
      publishedAt: null,
    });
    const b = await seedSummaryFixture({
      label: "compare-nullpub-b",
      publishedAt: null,
    });
    const { getCreatorComparison } = await import(
      "../src/services/creatorComparison.service"
    );
    const data = await getCreatorComparison([a.creatorId, b.creatorId]);
    expect(data.creators.length).toBe(2);
  });
});

/*
 * ----------------------------------------------------------------------------
 * evidence.service — single-sided date filters (lines 52/53)
 * ----------------------------------------------------------------------------
 */

describe("evidence.service — single-sided date filter arms", () => {
  it("listEvidence with `from` only (line 53 `: {}` arm)", async () => {
    const { listEvidence } = await import("../src/services/evidence.service");
    const r = await listEvidence({ from: "2020-01-01" });
    expect(Array.isArray(r.items)).toBe(true);
  });

  it("listEvidence with `to` only (line 52 `: {}` arm)", async () => {
    const { listEvidence } = await import("../src/services/evidence.service");
    const r = await listEvidence({ to: "2099-12-31" });
    expect(Array.isArray(r.items)).toBe(true);
  });
});

/*
 * ----------------------------------------------------------------------------
 * embedding.service — `if (useNative)` false arm (line 80)
 * ----------------------------------------------------------------------------
 */

describe("embedding.service — pgvector-unavailable skips the native dual-write (line 80)", () => {
  it("generateEmbeddingsForChunks writes only the JSON column when pgvector is absent", async () => {
    const fixture = await seedSummaryFixture({
      label: "embed-nonative",
      publishedAt: new Date("2026-01-01"),
    });
    /* Attach a transcript + chunk to embed. */
    const transcript = await prisma.transcript.create({
      data: {
        videoId: fixture.videoId,
        sourceType: "manual_paste",
        language: "en",
        rawText: "Embeddable chunk text about a topic.",
        cleanedText: "Embeddable chunk text about a topic.",
        wordCount: 6,
      },
    });
    const chunk = await prisma.transcriptChunk.create({
      data: {
        transcriptId: transcript.id,
        videoId: fixture.videoId,
        chunkIndex: 0,
        text: "Embeddable chunk text about a topic.",
        tokenCount: 6,
      },
    });
    const embeddingService = await import("../src/services/embedding.service");
    /*
     * Force the no-pgvector path: reset the memoized probe and stub the SQL
     * probe to report the extension missing → `useNative` is false (line 80).
     */
    embeddingService.__resetPgvectorCacheForTests();
    const probeSpy = vi
      .spyOn(prisma, "$queryRawUnsafe")
      .mockResolvedValueOnce([] as unknown as never);
    try {
      const result = await embeddingService.generateEmbeddingsForChunks([
        chunk.id,
      ]);
      expect(result.generated).toBe(1);
      const row = await prisma.embedding.findUnique({
        where: { chunkId: chunk.id },
      });
      expect(row).not.toBeNull();
    } finally {
      probeSpy.mockRestore();
      embeddingService.__resetPgvectorCacheForTests();
    }
  });

  it("generateEmbeddingsForChunks attempts the native vector dual-write when pgvector is present", async () => {
    const fixture = await seedSummaryFixture({
      label: "embed-native",
      publishedAt: new Date("2026-01-01"),
    });
    const transcript = await prisma.transcript.create({
      data: {
        videoId: fixture.videoId,
        sourceType: "manual_paste",
        language: "en",
        rawText: "Native embeddable chunk text about a topic.",
        cleanedText: "Native embeddable chunk text about a topic.",
        wordCount: 7,
      },
    });
    const chunk = await prisma.transcriptChunk.create({
      data: {
        transcriptId: transcript.id,
        videoId: fixture.videoId,
        chunkIndex: 0,
        text: "Native embeddable chunk text about a topic.",
        tokenCount: 7,
      },
    });
    const embeddingService = await import("../src/services/embedding.service");
    embeddingService.__resetPgvectorCacheForTests();
    const probeSpy = vi
      .spyOn(prisma, "$queryRawUnsafe")
      .mockResolvedValueOnce([{ extname: "vector" }] as unknown as never);
    const executeSpy = vi
      .spyOn(prisma, "$executeRawUnsafe")
      .mockResolvedValue(undefined as never);
    try {
      const result = await embeddingService.generateEmbeddingsForChunks([
        chunk.id,
      ]);
      expect(result.generated).toBe(1);
      expect(executeSpy).toHaveBeenCalledWith(
        'UPDATE "Embedding" SET vector = $1::vector WHERE id = $2',
        expect.stringMatching(/^\[/),
        expect.any(String),
      );
      expect(executeSpy).toHaveBeenCalledWith(
        'UPDATE "Embedding" SET "vectorJson" = NULL WHERE id = $1',
        expect.any(String),
      );
      expect(probeSpy).toHaveBeenCalled();
    } finally {
      executeSpy.mockRestore();
      probeSpy.mockRestore();
      embeddingService.__resetPgvectorCacheForTests();
    }
  });
});

/*
 * ----------------------------------------------------------------------------
 * analyzeCreator.job — null summary + empty-dates `?? null` arms
 * ----------------------------------------------------------------------------
 */

describe("analyzeCreator.job — null-summary + empty-dates arms", () => {
  it("handles a summary with a null `summary` and a video with null publishedAt", async () => {
    /*
     * null summary → line 59 `s.summary ?? ""`; null publishedAt for every
     * summary → dates array empty → lines 72/73 `dates[...] ?? null`.
     */
    const fixture = await seedSummaryFixture({
      label: "creatorjob-nulls",
      publishedAt: null,
      summary: null,
    });
    const { analyzeCreatorJob } = await import(
      "../src/jobs/analyzeCreator.job"
    );
    await analyzeCreatorJob(fixture.creatorId);
    const rows = await prisma.creatorTopicTimeline.findMany({
      where: { creatorId: fixture.creatorId },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].dateStart).toBeNull();
    expect(rows[0].dateEnd).toBeNull();
  });
});

/*
 * ----------------------------------------------------------------------------
 * generateReport.job — null summary + missing count-map key arms
 * ----------------------------------------------------------------------------
 */

describe("generateReport.job — null-summary + empty-count arms", () => {
  it("creator + topic reports tolerate null timeline/summary rows", async () => {
    /*
     * Fixture topic has a videoTopicSummary with a null `summary` (line 134 in
     * the topic report) AND a timeline with a null summary (line 56).
     */
    const fixture = await seedSummaryFixture({
      label: "reportjob-nulls",
      publishedAt: new Date("2026-01-01"),
      summary: null,
    });
    await prisma.creatorTopicTimeline.create({
      data: {
        creatorId: fixture.creatorId,
        topicId: fixture.topicId,
        trendLabel: "stable",
        summary: null,
        evidence: [],
      },
    });
    /*
     * A SECOND topic that has a timeline but NO videoTopicSummary → its id is
     * absent from countByTopic → line 57 `?? 0` fallback arm.
     */
    const orphanTopic = await prisma.topic.create({
      data: {
        name: `Report Orphan ${Date.now()}`,
        slug: `report-orphan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        source: "system_default",
      },
    });
    createdTopicIds.push(orphanTopic.id);
    await prisma.creatorTopicTimeline.create({
      data: {
        creatorId: fixture.creatorId,
        topicId: orphanTopic.id,
        trendLabel: "stable",
        summary: "orphan timeline",
        evidence: [],
      },
    });
    const { generateCreatorReportJob, generateTopicReportJob } = await import(
      "../src/jobs/generateReport.job"
    );
    const creatorReportId = await generateCreatorReportJob(fixture.creatorId);
    expect(creatorReportId).toBeTruthy();
    const topicReportId = await generateTopicReportJob(
      fixture.creatorId,
      fixture.topicId,
    );
    expect(topicReportId).toBeTruthy();
  });
});

/*
 * ----------------------------------------------------------------------------
 * bulkImport.job — null publishedAt/duration/description on create + update
 * ----------------------------------------------------------------------------
 */

describe("bulkImport.job — null metadata on create and re-import (update) paths", () => {
  /* Writes a manifest folder for the bulk worker; description omitted to hit line 204. */
  async function writeNullMetaFolder(
    slug: string,
    videoId: string,
  ): Promise<string> {
    const folder = await fs.mkdtemp(
      path.join(os.tmpdir(), `tt-branch-${slug}-`),
    );
    await fs.writeFile(
      path.join(folder, `${videoId}.txt`),
      `# Title\n\n${"Body sentence. ".repeat(60)}\n`,
    );
    const manifest = {
      creator: {
        name: `Branch Bulk ${slug}`,
        slug: `branch-bulk-${slug}`,
        channelUrl: `https://www.youtube.com/@${slug}`,
        /* description intentionally omitted → line 204 `?? null` */
        thumbnailUrl: null,
      },
      entries: [
        {
          videoId,
          title: "Null-meta video",
          publishedAt: null /* line 261/275 `: null` arm */,
          durationSeconds: null /* line 262/276 `?? null` arm */,
          sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
          transcriptPath: `${videoId}.txt`,
          status: "saved",
        },
      ],
      writtenAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(folder, "_manifest.json"),
      JSON.stringify(manifest),
    );
    return folder;
  }

  it("imports then re-imports a saved video with null publishedAt/duration/description", async () => {
    const { bulkImportJob } = await import("../src/jobs/bulkImport.job");
    const slug = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const videoId = `branch-null-${slug}`;
    const folder = await writeNullMetaFolder(slug, videoId);
    try {
      const job1 = await prisma.importJob.create({
        data: {
          channelUrl: "branch-bulk",
          requestedLimit: 10,
          status: "pending",
        },
      });
      await bulkImportJob(job1.id, folder); /* create path: lines 204/275/276 */
      const job2 = await prisma.importJob.create({
        data: {
          channelUrl: "branch-bulk",
          requestedLimit: 10,
          status: "pending",
        },
      });
      await bulkImportJob(job2.id, folder); /* update path: lines 261/262 */
      const video = await prisma.video.findUnique({
        where: {
          platform_sourceVideoId: {
            platform: "youtube",
            sourceVideoId: videoId,
          },
        },
      });
      expect(video).not.toBeNull();
      expect(video!.publishedAt).toBeNull();
      expect(video!.durationSeconds).toBeNull();
    } finally {
      await fs
        .rm(folder, { recursive: true, force: true })
        .catch(() => undefined);
      await prisma.creator.deleteMany({
        where: { slug: { startsWith: "branch-bulk-" } },
      });
    }
  });
});

/*
 * ----------------------------------------------------------------------------
 * analyzeVideo.job — cleanedText ?? rawText (line 116)
 * ----------------------------------------------------------------------------
 */

describe("analyzeVideo.job — null cleanedText falls back to rawText (line 116)", () => {
  it("analyzes a video whose transcript has a null cleanedText", async () => {
    const suffix = `avjob-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `AVJob ${suffix}`,
        slug: `avjob-${suffix}`,
        creatorType: "youtube_channel",
      },
    });
    createdCreatorIds.push(creator.id);
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `avjob-video-${suffix}`,
        sourceUrl: `https://www.example.com/avjob-${suffix}`,
        title: "AVJob fixture",
        transcriptStatus: "available",
        analysisStatus: "pending",
      },
    });
    const raw = [
      "Artificial intelligence is the central subject of this segment.",
      "I believe we should embrace artificial intelligence where it improves work.",
    ].join(" ");
    const transcript = await prisma.transcript.create({
      data: {
        videoId: video.id,
        sourceType: "manual_paste",
        language: "en",
        rawText: raw,
        cleanedText: null /* line 116 `?? video.transcript.rawText` */,
        wordCount: raw.split(/\s+/).length,
      },
    });
    await prisma.transcriptChunk.create({
      data: {
        transcriptId: transcript.id,
        videoId: video.id,
        chunkIndex: 0,
        text: raw,
        tokenCount: raw.split(/\s+/).length,
      },
    });
    const { analyzeVideoJob } = await import("../src/jobs/analyzeVideo.job");
    await analyzeVideoJob(video.id);
    const after = await prisma.video.findUnique({ where: { id: video.id } });
    expect(after!.analysisStatus).toBe("completed");
  });
});
