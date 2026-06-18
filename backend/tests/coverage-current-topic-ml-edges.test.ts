import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Request, Response } from "express";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { bulkImportJob } from "../src/jobs/bulkImport.job";
import { analyzeVideoJob } from "../src/jobs/analyzeVideo.job";
import { generateCreatorReportJob } from "../src/jobs/generateReport.job";
import { jobRunner } from "../src/jobs/jobRunner";
import {
  createCreatorTopicSummaryFixture,
  deleteCreatorTopicSummaryFixture,
} from "./testHelpers";

const app = buildApp();
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

const ENV_KEYS = [
  "AI_PROVIDER",
  "ENABLE_MOCK_MODE",
  "EMBEDDING_PROVIDER",
  "MIN_STANCE_CONFIDENCE",
  "ML_CLASSIFIER_TIMEOUT_MS",
  "ML_CLASSIFIER_URL",
  "STANCE_ANALYSIS_PROVIDER",
  "TOPIC_ASSIGNMENT_PROVIDER",
  "TOPIC_RELEVANCE_PROVIDER",
  "TOPIC_RERANKER_DISPLAY_TIERS",
  "TOPIC_RERANKER_LABELS_PATH",
  "TOPIC_RERANKER_LIMIT",
  "TOPIC_RERANKER_MIN_SCORE",
] as const;

let envSnapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  envSnapshot = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/* Seeds a creator, video, transcript, and a single chunk; returns their ids for coverage tests. */
async function createVideoWithChunk(
  label: string,
  text: string,
): Promise<{
  creatorId: string;
  videoId: string;
  chunkId: string;
}> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creator = await prisma.creator.create({
    data: {
      name: `Coverage Creator ${suffix}`,
      slug: `coverage-creator-${suffix}`,
      creatorType: "youtube_channel",
    },
  });
  const video = await prisma.video.create({
    data: {
      creatorId: creator.id,
      platform: "youtube",
      sourceVideoId: `coverage-video-${suffix}`,
      sourceUrl: `https://www.example.com/coverage-video-${suffix}`,
      title: `Coverage Video ${suffix}`,
      transcriptStatus: "available",
      analysisStatus: "pending",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    },
  });
  const transcript = await prisma.transcript.create({
    data: {
      videoId: video.id,
      sourceType: "manual_paste",
      language: "en",
      rawText: text,
      cleanedText: text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    },
  });
  const chunk = await prisma.transcriptChunk.create({
    data: {
      transcriptId: transcript.id,
      videoId: video.id,
      chunkIndex: 0,
      text,
      tokenCount: text.split(/\s+/).filter(Boolean).length,
    },
  });
  return { creatorId: creator.id, videoId: video.id, chunkId: chunk.id };
}

/* Writes a single curated-reranker labels row to a temp labels.jsonl and returns its path. */
function writeCuratedLabels(row: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-current-curated-"));
  const labelsPath = path.join(dir, "labels.jsonl");
  fs.writeFileSync(labelsPath, JSON.stringify(row));
  return labelsPath;
}

/* Stubs globalThis.fetch to return a 200 response whose text() yields the given JSON body. */
function mockMlFetch(body: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response) as typeof fetch;
}

describe("current backend coverage edges - topic detection", () => {
  it("uses the default curated-reranker labels path when no explicit path is configured", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    delete process.env.TOPIC_RERANKER_LABELS_PATH;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: `default-path-${Date.now()}`,
      transcriptText:
        "No controlled topic anchor is present in this plain text.",
    });

    expect(topics[0]).toEqual(
      expect.objectContaining({
        slug: "bitcoin-crypto-and-digital-assets",
        relevanceScore: 0.9,
      }),
    );
  });

  it("sorts multiple curated topics and accepts rows without displayTier", async () => {
    const labelsPath = writeCuratedLabels({
      chunkId: "chunk-multi-curated",
      decision: "keep_current",
      selectedTopics: [
        { topicSlug: "ai_societal_impact", confidence: 0.2 },
        { topicSlug: "ai_model_competition", confidence: 0.9 },
      ],
    });
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    process.env.TOPIC_RERANKER_LABELS_PATH = labelsPath;
    process.env.TOPIC_RERANKER_DISPLAY_TIERS = "showcase,usable";

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-multi-curated",
      transcriptText:
        "Ignored because the curated labels provide the topic set.",
    });

    expect(topics.map((topic) => topic.slug)).toEqual([
      "ai_model_competition",
      "ai_societal_impact",
    ]);
  });

  it("covers controlled-topic sorting, alias blocklists, and generic alias filtering", async () => {
    const { detectTopicsForTranscript, extractTopicEvidenceQuote } =
      await import("../src/services/topicDetection.service");

    const sorted = await detectTopicsForTranscript(
      "Artificial intelligence is central here. AI model competition between ChatGPT and Claude is also central.",
    );
    expect(sorted.length).toBeGreaterThanOrEqual(2);

    const bloodBrain = await detectTopicsForTranscript(
      "The blood brain barrier is discussed along with white matter and cognitive function.",
    );
    expect(
      bloodBrain.some(
        (topic) => topic.slug === "blood_brain_barrier_and_cognitive_health",
      ),
    ).toBe(true);

    expect(
      extractTopicEvidenceQuote(
        { slug: "not_in_taxonomy", name: "Brain" },
        "Brain is a generic word.",
      ),
    ).toBeUndefined();
  });
});

describe("current backend coverage edges - ML client timeouts", () => {
  /*
   * Runs an ML-client call under fake timers with a fetch that only rejects on AbortController abort,
   * pumping pending timers until the call settles so timeout/abort paths execute.
   */
  async function withAbortDrivenFetch<T>(
    run: (client: typeof import("../src/ai/mlClassifierClient")) => Promise<T>,
  ): Promise<T> {
    vi.useFakeTimers();
    vi.resetModules();
    process.env.ML_CLASSIFIER_TIMEOUT_MS = "5";
    process.env.ML_CLASSIFIER_URL = "http://timeout-ml.local";
    globalThis.fetch = vi.fn((_, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }) as typeof fetch;

    const client = await import("../src/ai/mlClassifierClient");
    let done = false;
    /* Kick off the call and flip `done` once it settles, so the timer-pumping loop can stop. */
    const promise = run(client).finally(() => {
      done = true;
    });
    for (let i = 0; i < 20 && !done; i += 1) {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    }
    expect(done).toBe(true);
    return await promise;
  }

  it("fires the real AbortController timeout callbacks for every ML endpoint", async () => {
    /* Drive predictStance through its abort/timeout path. */
    const stance = await withAbortDrivenFetch((client) =>
      client.predictStance({ topic: "AI", text: "AI text" }),
    );
    expect(stance.ok).toBe(false);
    if (!stance.ok) expect(stance.error).toBe("TIMEOUT");

    /* Drive predictTopicRelevance through its abort/timeout path. */
    const relevance = await withAbortDrivenFetch((client) =>
      client.predictTopicRelevance({ topic: "AI", text: "AI text" }),
    );
    expect(relevance.ok).toBe(false);
    if (!relevance.ok) expect(relevance.error).toBe("TIMEOUT");

    /* Drive predictTopicCandidates through its abort/timeout path. */
    const candidates = await withAbortDrivenFetch((client) =>
      client.predictTopicCandidates({ text: "AI text" }),
    );
    expect(candidates.ok).toBe(false);
    if (!candidates.ok) expect(candidates.error).toBe("TIMEOUT");

    /* Drive healthCheck through its abort/timeout path. */
    const health = await withAbortDrivenFetch((client) =>
      client.healthCheck("http://timeout-ml.local"),
    );
    expect(health.reachable).toBe(false);
  }, 20_000);

  it("retries plain network Errors for topic relevance and topic candidate calls", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network lost")) as typeof fetch;
    const { predictTopicRelevance, predictTopicCandidates } = await import(
      "../src/ai/mlClassifierClient"
    );

    const relevance = await predictTopicRelevance({
      topic: "AI",
      text: "AI text",
    });
    expect(relevance.ok).toBe(false);
    if (!relevance.ok) expect(relevance.error).toBe("NETWORK_ERROR");

    const candidates = await predictTopicCandidates({ text: "AI text" });
    expect(candidates.ok).toBe(false);
    if (!candidates.ok) expect(candidates.error).toBe("NETWORK_ERROR");
  }, 20_000);
});

describe("current backend coverage edges - controllers and shared services", () => {
  it("creator overview/topics sort multiple topics", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: { name: `Sort Creator ${suffix}`, slug: `sort-creator-${suffix}` },
    });
    const [topicA, topicB] = await Promise.all([
      prisma.topic.create({
        data: {
          name: `Sort Topic A ${suffix}`,
          slug: `sort-topic-a-${suffix}`,
        },
      }),
      prisma.topic.create({
        data: {
          name: `Sort Topic B ${suffix}`,
          slug: `sort-topic-b-${suffix}`,
        },
      }),
    ]);
    const videos = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.video.create({
          data: {
            creatorId: creator.id,
            platform: "youtube",
            sourceVideoId: `sort-video-${suffix}-${index}`,
            sourceUrl: `https://www.example.com/sort-video-${suffix}-${index}`,
            title: `Sort video ${index}`,
            transcriptStatus: "available",
            analysisStatus: "completed",
            publishedAt: new Date(Date.UTC(2026, index, 1)),
          },
        }),
      ),
    );
    await prisma.videoTopicSummary.createMany({
      data: [
        {
          videoId: videos[0].id,
          creatorId: creator.id,
          topicId: topicA.id,
          dominantStance: "supportive",
          mentionCount: 3,
        },
        {
          videoId: videos[1].id,
          creatorId: creator.id,
          topicId: topicA.id,
          dominantStance: "neutral",
          mentionCount: 2,
        },
        {
          videoId: videos[2].id,
          creatorId: creator.id,
          topicId: topicB.id,
          dominantStance: "opposed",
          mentionCount: 10,
        },
      ],
    });

    try {
      const overview = await request(app).get(
        `/api/creators/${creator.id}/overview`,
      );
      expect(overview.status).toBe(200);
      expect(
        overview.body.topTopics.map((topic: { slug: string }) => topic.slug)[0],
      ).toBe(topicA.slug);

      const topics = await request(app).get(
        `/api/creators/${creator.id}/topics`,
      );
      expect(topics.status).toBe(200);
      expect(
        topics.body.items.map((topic: { slug: string }) => topic.slug)[0],
      ).toBe(topicA.slug);
    } finally {
      await prisma.creator
        .delete({ where: { id: creator.id } })
        .catch(() => undefined);
      await prisma.topic
        .delete({ where: { id: topicA.id } })
        .catch(() => undefined);
      await prisma.topic
        .delete({ where: { id: topicB.id } })
        .catch(() => undefined);
    }
  });

  it("rechunk returns 400 for an existing video with no transcript", async () => {
    const creator = await prisma.creator.create({
      data: {
        name: `No Transcript ${Date.now()}`,
        slug: `no-transcript-${Date.now()}`,
      },
    });
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `no-transcript-video-${Date.now()}`,
        sourceUrl: `https://www.example.com/no-transcript-video-${Date.now()}`,
        title: "No transcript video",
      },
    });
    try {
      const response = await request(app).post(
        `/api/videos/${video.id}/transcript/rechunk`,
      );
      expect(response.status).toBe(400);
    } finally {
      await prisma.creator
        .delete({ where: { id: creator.id } })
        .catch(() => undefined);
    }
  });

  it("dominantStance returns the empty-tally fallback for records and maps", async () => {
    const { dominantStance } = await import("../src/utils/stance");
    expect(dominantStance({})).toBe("insufficient_evidence");
    expect(dominantStance(new Map())).toBe("insufficient_evidence");
  });

  it("creator comparison sorts shared topics and skips null stance scores", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creators = await Promise.all(
      [0, 1].map((index) =>
        prisma.creator.create({
          data: {
            name: `Compare ${suffix}-${index}`,
            slug: `compare-${suffix}-${index}`,
          },
        }),
      ),
    );
    const [topicA, topicB] = await Promise.all([
      prisma.topic.create({
        data: {
          name: `Compare Topic A ${suffix}`,
          slug: `compare-topic-a-${suffix}`,
        },
      }),
      prisma.topic.create({
        data: {
          name: `Compare Topic B ${suffix}`,
          slug: `compare-topic-b-${suffix}`,
        },
      }),
    ]);
    const videos = await Promise.all(
      creators.flatMap((creator, creatorIndex) =>
        [0, 1].map((topicIndex) =>
          prisma.video.create({
            data: {
              creatorId: creator.id,
              platform: "youtube",
              sourceVideoId: `compare-video-${suffix}-${creatorIndex}-${topicIndex}`,
              sourceUrl: `https://www.example.com/compare-video-${suffix}-${creatorIndex}-${topicIndex}`,
              title: `Compare video ${creatorIndex}-${topicIndex}`,
              publishedAt: new Date(Date.UTC(2026, topicIndex, 1)),
            },
          }),
        ),
      ),
    );
    await prisma.videoTopicSummary.createMany({
      data: [
        {
          videoId: videos[0].id,
          creatorId: creators[0].id,
          topicId: topicA.id,
          dominantStance: "supportive",
          mentionCount: 7,
        },
        {
          videoId: videos[2].id,
          creatorId: creators[1].id,
          topicId: topicA.id,
          dominantStance: "opposed",
          mentionCount: 6,
        },
        {
          videoId: videos[1].id,
          creatorId: creators[0].id,
          topicId: topicB.id,
          dominantStance: "unclear",
          mentionCount: 1,
        },
        {
          videoId: videos[3].id,
          creatorId: creators[1].id,
          topicId: topicB.id,
          dominantStance: "neutral",
          mentionCount: 1,
        },
      ],
    });

    try {
      const { getCreatorComparison } = await import(
        "../src/services/creatorComparison.service"
      );
      /* Compare the two seeded creators to assert shared topics and timeline output. */
      const comparison = await getCreatorComparison(
        creators.map((creator) => creator.id),
      );
      expect(comparison.sharedTopics.map((topic) => topic.topicId)[0]).toBe(
        topicA.id,
      );
      expect(comparison.timeline.points.length).toBeGreaterThan(0);
    } finally {
      await prisma.creator
        .delete({ where: { id: creators[0].id } })
        .catch(() => undefined);
      await prisma.creator
        .delete({ where: { id: creators[1].id } })
        .catch(() => undefined);
      await prisma.topic
        .delete({ where: { id: topicA.id } })
        .catch(() => undefined);
      await prisma.topic
        .delete({ where: { id: topicB.id } })
        .catch(() => undefined);
    }
  });
});

describe("current backend coverage edges - jobs", () => {
  it("bulk import no-ops for an unknown import job id", async () => {
    await expect(
      bulkImportJob("missing-job-id", os.tmpdir()),
    ).resolves.toBeUndefined();
  });

  it("bulk import caps transcript header stripping at five lines", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-header-cap-"));
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(
      path.join(dir, "header-cap.txt"),
      [
        "# one",
        "# two",
        "# three",
        "# four",
        "# five",
        "# sixth line should remain in body",
        "real transcript body ".repeat(30),
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(dir, "_manifest.json"),
      JSON.stringify({
        creator: { name: `Header Cap ${suffix}`, slug: `header-cap-${suffix}` },
        entries: [
          {
            videoId: `header-cap-video-${suffix}`,
            title: "Header cap video",
            publishedAt: "2026-01-01",
            durationSeconds: 60,
            sourceUrl: `https://www.example.com/header-cap-${suffix}`,
            transcriptPath: "header-cap.txt",
            status: "saved",
          },
        ],
      }),
    );
    const job = await prisma.importJob.create({
      data: { channelUrl: `bulk:${dir}`, requestedLimit: 0, status: "pending" },
    });

    await bulkImportJob(job.id, dir);
    await jobRunner.drain();
    const video = await prisma.video.findFirst({
      where: { sourceVideoId: `header-cap-video-${suffix}` },
      include: { transcript: true, creator: true },
    });

    expect(video?.transcript?.rawText).toContain(
      "# sixth line should remain in body",
    );
    if (video?.creatorId)
      await prisma.creator
        .delete({ where: { id: video.creatorId } })
        .catch(() => undefined);
    await prisma.importJob
      .delete({ where: { id: job.id } })
      .catch(() => undefined);
  });

  it("generateCreatorReportJob maps timeline topics and video counts", async () => {
    const fixture = await createCreatorTopicSummaryFixture(
      "creator-report-coverage",
    );
    await prisma.creatorTopicTimeline.create({
      data: {
        creatorId: fixture.creatorId,
        topicId: fixture.topicId,
        trendLabel: "stable",
        summary: "The topic is stable over time.",
        evidence: [{ quote: "stable" }],
      },
    });

    try {
      const reportId = await generateCreatorReportJob(fixture.creatorId);
      expect(reportId).toBeTruthy();
      if (reportId)
        await prisma.report
          .delete({ where: { id: reportId } })
          .catch(() => undefined);
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("analyzeCreatorJob marks its run failed when a real timeline fixture throws", async () => {
    const fixture = await createCreatorTopicSummaryFixture(
      "creator-failure-coverage",
    );
    const timelineSpy = vi
      .spyOn(
        await import("../src/services/timeline.service"),
        "generateCreatorTopicTimeline",
      )
      .mockRejectedValue(new Error("forced timeline fixture failure"));

    try {
      const { analyzeCreatorJob } = await import(
        "../src/jobs/analyzeCreator.job"
      );
      await analyzeCreatorJob(fixture.creatorId);
      const failedRun = await prisma.analysisRun.findFirst({
        where: {
          analysisType: "creator_timeline",
          status: "failed",
          errorMessage: { contains: "forced timeline fixture failure" },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(failedRun).not.toBeNull();
    } finally {
      timelineSpy.mockRestore();
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("analyzeVideoJob covers empty, missing, low-value, and low-confidence evidence filters", async () => {
    process.env.AI_PROVIDER = "local";
    process.env.ENABLE_MOCK_MODE = "false";
    process.env.EMBEDDING_PROVIDER = "ml";
    process.env.TOPIC_RELEVANCE_PROVIDER = "heuristic";

    const unrelated = await createVideoWithChunk(
      "unrelated-reranker",
      "This chunk talks only about a keyboard case and has no central AI language.",
    );
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    mockMlFetch({
      topics: [{ topicSlug: "ai_societal_impact", confidence: 0.9 }],
      modelVersion: "coverage-reranker",
    });
    await analyzeVideoJob(unrelated.videoId);

    const missingEvidence = await createVideoWithChunk(
      "missing-evidence",
      "This chunk talks about a plain keyboard case and no matching controlled topic phrase.",
    );
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    process.env.TOPIC_RERANKER_LABELS_PATH = writeCuratedLabels({
      chunkId: missingEvidence.chunkId,
      decision: "keep_current",
      displayTier: "usable",
      selectedTopics: [{ topicSlug: "ai_societal_impact", confidence: 0.9 }],
    });
    await analyzeVideoJob(missingEvidence.videoId);

    const lowValue = await createVideoWithChunk(
      "low-value-evidence",
      "This segment is an ad read rather than a substantive discussion.",
    );
    process.env.TOPIC_RERANKER_LABELS_PATH = writeCuratedLabels({
      chunkId: lowValue.chunkId,
      decision: "keep_current",
      displayTier: "usable",
      selectedTopics: [
        {
          topicSlug: "ai_societal_impact",
          confidence: 0.9,
          evidenceQuote: "sponsor code link in the description",
        },
      ],
    });
    await analyzeVideoJob(lowValue.videoId);

    const lowConfidence = await createVideoWithChunk(
      "low-confidence-evidence",
      "Artificial intelligence is the topic in this segment.",
    );
    await prisma.embedding.create({
      data: {
        chunkId: lowConfidence.chunkId,
        embeddingModel: "coverage-preseeded",
        vectorJson: Array.from({ length: 768 }, () => 0.01),
      },
    });
    process.env.TOPIC_RERANKER_LABELS_PATH = writeCuratedLabels({
      chunkId: lowConfidence.chunkId,
      decision: "keep_current",
      displayTier: "usable",
      selectedTopics: [
        {
          topicSlug: "ai_societal_impact",
          confidence: 0.9,
          evidenceQuote: "Artificial intelligence is the topic",
        },
      ],
    });
    process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";
    process.env.MIN_STANCE_CONFIDENCE = "0.95";
    mockMlFetch({
      predictedLabel: "neutral",
      confidence: 0.2,
      labelScores: {
        supportive: 0.1,
        opposed: 0.1,
        neutral: 0.2,
        mixed: 0.1,
        unclear: 0.6,
      },
      modelVersion: "coverage-stance",
    });
    await analyzeVideoJob(lowConfidence.videoId);

    const minBelowZero = await createVideoWithChunk(
      "min-below-zero",
      "Artificial intelligence is the topic in this segment.",
    );
    process.env.MIN_STANCE_CONFIDENCE = "-1";
    process.env.TOPIC_RERANKER_LABELS_PATH = writeCuratedLabels({
      chunkId: minBelowZero.chunkId,
      decision: "keep_current",
      displayTier: "usable",
      selectedTopics: [
        {
          topicSlug: "ai_societal_impact",
          confidence: 0.9,
          evidenceQuote: "Artificial intelligence is the topic",
        },
      ],
    });
    mockMlFetch({
      predictedLabel: "neutral",
      confidence: 0.9,
      labelScores: {
        supportive: 0,
        opposed: 0,
        neutral: 0.9,
        mixed: 0,
        unclear: 0.1,
      },
      modelVersion: "coverage-stance-min-below",
    });
    await analyzeVideoJob(minBelowZero.videoId);

    const minAboveOne = await createVideoWithChunk(
      "min-above-one",
      "Artificial intelligence is the topic in this segment.",
    );
    process.env.MIN_STANCE_CONFIDENCE = "2";
    process.env.TOPIC_RERANKER_LABELS_PATH = writeCuratedLabels({
      chunkId: minAboveOne.chunkId,
      decision: "keep_current",
      displayTier: "usable",
      selectedTopics: [
        {
          topicSlug: "ai_societal_impact",
          confidence: 0.9,
          evidenceQuote: "Artificial intelligence is the topic",
        },
      ],
    });
    mockMlFetch({
      predictedLabel: "neutral",
      confidence: 0.9,
      labelScores: {
        supportive: 0,
        opposed: 0,
        neutral: 0.9,
        mixed: 0,
        unclear: 0.1,
      },
      modelVersion: "coverage-stance-min-above",
    });
    await analyzeVideoJob(minAboveOne.videoId);

    for (const creatorId of [
      unrelated.creatorId,
      missingEvidence.creatorId,
      lowValue.creatorId,
      lowConfidence.creatorId,
      minBelowZero.creatorId,
      minAboveOne.creatorId,
    ]) {
      await prisma.creator
        .delete({ where: { id: creatorId } })
        .catch(() => undefined);
    }
  }, 30_000);

  it("analyzeVideoJob is idempotent per (chunk, topic): a re-run upserts, not duplicates", async () => {
    process.env.AI_PROVIDER = "local";
    process.env.ENABLE_MOCK_MODE = "false";
    process.env.EMBEDDING_PROVIDER = "ml";
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    process.env.TOPIC_RELEVANCE_PROVIDER = "heuristic";

    const fixture = await createVideoWithChunk(
      "existing-analysis",
      "Artificial intelligence is the topic in this segment.",
    );
    process.env.TOPIC_RERANKER_LABELS_PATH = writeCuratedLabels({
      chunkId: fixture.chunkId,
      decision: "keep_current",
      displayTier: "usable",
      selectedTopics: [
        {
          topicSlug: "ai_societal_impact",
          confidence: 0.9,
          evidenceQuote: "Artificial intelligence is the topic",
        },
      ],
    });

    try {
      /*
       * Run analysis twice; the (chunkId, topicId) @@unique + upsert means the
       * second run REPLACES rather than duplicating the chunk-topic analysis.
       */
      await analyzeVideoJob(fixture.videoId);
      await analyzeVideoJob(fixture.videoId);
      const rows = await prisma.chunkTopicAnalysis.findMany({
        where: { chunkId: fixture.chunkId, topicId: { not: undefined } },
      });
      const byTopic = new Map<string, number>();
      for (const r of rows)
        byTopic.set(r.topicId, (byTopic.get(r.topicId) ?? 0) + 1);
      for (const count of byTopic.values()) expect(count).toBe(1);
    } finally {
      await prisma.creator
        .delete({ where: { id: fixture.creatorId } })
        .catch(() => undefined);
    }
  });
});

describe("current backend coverage edges - small utilities", () => {
  it("llmBudget uses default USD cap when the env var is absent", async () => {
    const { llmBudget } = await import("../src/ai/llmBudget");
    delete process.env.LLM_DAILY_USD_CAP;
    expect(llmBudget.shouldAllowCall()).toEqual({ allowed: true });
  });

  it("idempotency evicts expired direct-middleware entries", async () => {
    const { idempotencyMiddleware, resetIdempotencyStoreForTests } =
      await import("../src/middleware/idempotency");
    resetIdempotencyStoreForTests();
    Date.now = () => 1_000;

    /* Builds a minimal Express-like request carrying an idempotency-key header. */
    const buildReq = () =>
      ({
        method: "POST",
        path: "/api/test-idempotency",
        header: (key: string) =>
          key.toLowerCase() === "idempotency-key" ? "ttl-key" : undefined,
      }) as Request;
    /*
     * Builds a minimal Express-like response with spies for status/setHeader/
     * json and a no-op `on` (the idempotency middleware now registers a
     * "finish" listener to release an in-flight claim).
     */
    const buildRes = () => {
      const res = {
        statusCode: 201,
        setHeader: vi.fn(),
        on: vi.fn(),
        status(n: number) {
          res.statusCode = n;
          return res;
        },
        json: vi.fn(() => res),
        /* The middleware now wraps res.send in addition to res.json. */
        send: vi.fn(() => res),
      };
      return res as unknown as Response;
    };

    const firstRes = buildRes();
    await new Promise<void>((resolve) =>
      idempotencyMiddleware(buildReq(), firstRes, () => {
        firstRes.json({ ok: "first" });
        resolve();
      }),
    );

    Date.now = () => 62_000;
    let nextCalled = false;
    await new Promise<void>((resolve) =>
      idempotencyMiddleware(buildReq(), buildRes(), () => {
        nextCalled = true;
        resolve();
      }),
    );

    expect(nextCalled).toBe(true);
  });

  it("custom ML stance synthesizes + clamps relevance from a VALID confidence", async () => {
    const { classifyChunkForTopic } = await import(
      "../src/services/stanceAnalysis.service"
    );
    process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";
    process.env.ML_CLASSIFIER_URL = "http://test-ml.local";

    /*
     * Low-ish (but valid, in-range) confidence: relevance = confidence + 0.1,
     * un-clamped (0.1 + 0.1 = 0.2). The ML client now REJECTS out-of-[0,1]
     * confidences, so a negative confidence would degrade to the LLM path
     * rather than reaching buildCustomMlResult.
     */
    mockMlFetch({
      predictedLabel: "neutral",
      confidence: 0.1,
      labelScores: {
        supportive: 0,
        opposed: 0,
        neutral: 0.1,
        mixed: 0,
        unclear: 0,
      },
      modelVersion: "coverage-low",
    });
    const low = await classifyChunkForTopic({
      chunkText: "Artificial intelligence has tradeoffs.",
      topicName: "Artificial Intelligence",
    });
    expect(low.relevanceScore).toBeCloseTo(0.2, 5);

    /* High valid confidence: confidence + 0.1 = 1.05 → clamped to 1. */
    mockMlFetch({
      predictedLabel: "supportive",
      confidence: 0.95,
      labelScores: {
        supportive: 0.95,
        opposed: 0,
        neutral: 0,
        mixed: 0,
        unclear: 0,
      },
      modelVersion: "coverage-high",
    });
    const high = await classifyChunkForTopic({
      chunkText: "Artificial intelligence is useful.",
      topicName: "Artificial Intelligence",
    });
    expect(high.relevanceScore).toBe(1);
  });
});
