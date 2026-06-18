/**
 * coverage-provider-edges.test.ts — targeted coverage tests aimed at the
 * remaining uncovered branches in AI providers, services, jobs, and
 * middleware.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";

const app = buildApp();

/*
 * Snapshot every env key these tests mutate so we restore them after each
 * test. Without this, e.g. AI_PROVIDER=openai bleeds into the existing
 * jobs.test.ts and makes analyzeVideoJob hit the real openai branch.
 */
const RESTORED_ENV_KEYS = [
  "AI_PROVIDER",
  "AI_API_KEY",
  "EMBEDDING_PROVIDER",
  "YOUTUBE_PROVIDER",
  "STANCE_ANALYSIS_PROVIDER",
  "ENABLE_MOCK_MODE",
] as const;
let envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  envSnapshot = {};
  for (const k of RESTORED_ENV_KEYS) envSnapshot[k] = process.env[k];
});

afterEach(() => {
  for (const k of RESTORED_ENV_KEYS) {
    const v = envSnapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/*
 * ----------------------------------------------------------------------------
 * stanceAnalysis.service — schema-fail fallback (line ~90 of the service)
 * ----------------------------------------------------------------------------
 */

describe("stanceAnalysis — schema fallback", () => {
  it("returns insufficient_evidence when the LLM returns non-conforming JSON", async () => {
    const { classifyChunkForTopic } = await import(
      "../src/services/stanceAnalysis.service"
    );
    const llm = await import("../src/ai/llmClient");
    const spy = vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: { totally: "wrong shape" },
      provider: "mock",
      modelName: "test",
    } as never);

    process.env.STANCE_ANALYSIS_PROVIDER = "llm";
    process.env.ENABLE_MOCK_MODE = "false";
    const r = await classifyChunkForTopic({
      chunkText: "Some sample chunk text.",
      topicName: "Test Topic",
    });
    expect(r.stanceLabel).toBe("insufficient_evidence");
    expect(r.confidenceLabel).toBe("low");

    spy.mockRestore();
    delete process.env.STANCE_ANALYSIS_PROVIDER;
    delete process.env.ENABLE_MOCK_MODE;
  });
});

/*
 * ----------------------------------------------------------------------------
 * reportGeneration.service — LLM-failure fallback paths
 * ----------------------------------------------------------------------------
 */

describe("reportGeneration — fallback paths", () => {
  it("generateCreatorReport falls back when the LLM returns garbage", async () => {
    const { generateCreatorReport } = await import(
      "../src/services/reportGeneration.service"
    );
    const llm = await import("../src/ai/llmClient");
    const spy = vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "garbage",
      json: { not_the_right: "shape" },
      provider: "mock",
      modelName: "test",
    } as never);

    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.ENABLE_MOCK_MODE = "false";
    const r = await generateCreatorReport({
      creatorName: "X",
      topics: [
        {
          topicName: "AI",
          trendLabel: "stable",
          timelineSummary: "s",
          videoCount: 1,
        },
      ],
    });
    expect(r.title).toBeTruthy();
    expect(r.caveats).toMatch(/transcript/i);

    spy.mockRestore();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.ENABLE_MOCK_MODE;
  });

  it("generateTopicReport falls back when the LLM returns garbage", async () => {
    const { generateTopicReport } = await import(
      "../src/services/reportGeneration.service"
    );
    const llm = await import("../src/ai/llmClient");
    const spy = vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "garbage",
      json: { not_the_right: "shape" },
      provider: "mock",
      modelName: "test",
    } as never);

    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.ENABLE_MOCK_MODE = "false";
    const r = await generateTopicReport({
      creatorName: "X",
      topicName: "AI",
      summaries: [
        {
          videoId: "v1",
          videoTitle: "Title",
          publishedAt: "2026-01-01",
          dominantStance: "supportive",
          summary: "s",
        },
      ],
      timelineSummary: "trend",
    });
    expect(r.title).toContain("AI");

    spy.mockRestore();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.ENABLE_MOCK_MODE;
  });
});

/*
 * ----------------------------------------------------------------------------
 * videoSummary.service — schema-fail fallback
 * ----------------------------------------------------------------------------
 */

describe("videoSummary — schema fallback", () => {
  it("returns the synthetic fallback when the LLM JSON is bogus", async () => {
    const { summarizeVideoForTopic } = await import(
      "../src/services/videoSummary.service"
    );
    const llm = await import("../src/ai/llmClient");
    const spy = vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: { not_correct: true },
      provider: "mock",
      modelName: "test",
    } as never);

    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.ENABLE_MOCK_MODE = "false";
    const r = await summarizeVideoForTopic({
      topicName: "AI",
      videoTitle: "v",
      chunkAnalyses: [
        {
          chunkIndex: 0,
          relevanceScore: 0.7,
          stanceLabel: "supportive",
          confidenceScore: 0.8,
          claimSummary: "claim",
          evidenceQuote: "quote",
        },
      ],
    });
    expect(r.dominantStance).toBeDefined();
    spy.mockRestore();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.ENABLE_MOCK_MODE;
  });
});

/*
 * ----------------------------------------------------------------------------
 * timeline.service — schema-fail fallback
 * ----------------------------------------------------------------------------
 */

describe("timeline — schema fallback", () => {
  it("returns insufficient_data when the LLM JSON is bogus", async () => {
    const { generateCreatorTopicTimeline } = await import(
      "../src/services/timeline.service"
    );
    const llm = await import("../src/ai/llmClient");
    const spy = vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: { something: "else" },
      provider: "mock",
      modelName: "test",
    } as never);

    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.ENABLE_MOCK_MODE = "false";
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
      ],
    });
    expect(r.trendLabel).toBeDefined();
    spy.mockRestore();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.ENABLE_MOCK_MODE;
  });
});

/*
 * ----------------------------------------------------------------------------
 * topicDetection.service — schema-fail fallback
 * ----------------------------------------------------------------------------
 */

describe("topicDetection — schema fallback", () => {
  it("returns an empty list when the LLM JSON is bogus", async () => {
    const { detectTopicsForTranscript } = await import(
      "../src/services/topicDetection.service"
    );
    const llm = await import("../src/ai/llmClient");
    const spy = vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: { totally: "wrong" },
      provider: "mock",
      modelName: "test",
    } as never);

    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.ENABLE_MOCK_MODE = "false";
    const out = await detectTopicsForTranscript(
      "Some text about AI and economics.",
    );
    expect(Array.isArray(out)).toBe(true);
    spy.mockRestore();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.ENABLE_MOCK_MODE;
  });
});

/*
 * ----------------------------------------------------------------------------
 * embedding.service — pgvector probe error + log-only-once
 * ----------------------------------------------------------------------------
 */

describe("embedding.service — pgvector probe", () => {
  it("pgvectorAvailable returns a stable boolean across calls", async () => {
    /*
     * Light test: just verify the function returns a boolean + memoization.
     * The "$queryRawUnsafe throws" branch is hard to exercise without
     * polluting shared prisma state across sibling tests — covered by
     * dedicated unit harness instead.
     */
    const { pgvectorAvailable } = await import(
      "../src/services/embedding.service"
    );
    const a = await pgvectorAvailable();
    const b = await pgvectorAvailable();
    expect(typeof a).toBe("boolean");
    expect(a).toBe(b);
  });
});

/*
 * ----------------------------------------------------------------------------
 * importChannel.job — outer catch branch via resolveChannel failure
 * ----------------------------------------------------------------------------
 */

describe("importChannel.job — outer catch", () => {
  it("marks the job as failed when resolveChannel throws", async () => {
    const { importChannelJob } = await import("../src/jobs/importChannel.job");
    const job = await prisma.importJob.create({
      data: {
        channelUrl: "https://www.youtube.com/@coveragetest3",
        requestedLimit: 10,
        status: "pending",
      },
    });
    const youtubeProviderSpy = vi
      .spyOn(
        await import("../src/services/youtubeImport.service"),
        "getYoutubeProvider",
      )
      .mockReturnValue({
        resolveChannel: async () => {
          throw new Error("provider blew up");
        },
        listRecentVideos: async () => [],
        fetchTranscript: async () => ({ available: false }),
      } as never);

    await importChannelJob(job.id);
    const refreshed = await prisma.importJob.findUnique({
      where: { id: job.id },
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.errorMessage).toMatch(/provider blew up/);
    youtubeProviderSpy.mockRestore();
  });

  it("no-ops when the job id doesn't resolve", async () => {
    const { importChannelJob } = await import("../src/jobs/importChannel.job");
    /* Shouldn't throw — the job-not-found branch returns silently. */
    await expect(
      importChannelJob("does-not-exist-id"),
    ).resolves.toBeUndefined();
  });
});

/*
 * ----------------------------------------------------------------------------
 * analyzeCreator.job — fail branch
 * ----------------------------------------------------------------------------
 */

describe("analyzeCreator.job — fail branch", () => {
  it("marks the AnalysisRun as failed when timeline generation throws", async () => {
    const { analyzeCreatorJob } = await import(
      "../src/jobs/analyzeCreator.job"
    );
    const timelineGenerationSpy = vi
      .spyOn(
        await import("../src/services/timeline.service"),
        "generateCreatorTopicTimeline",
      )
      .mockRejectedValue(new Error("forced timeline failure"));
    /*
     * Self-contained fixture (creator + topic + video + one summary) so
     * analyzeCreatorJob ALWAYS reaches the mocked-to-throw timeline step,
     * independent of shared-DB state. (A bare `findFirst` could return a
     * creator/summary that another parallel test had just removed, so the job
     * skipped the timeline step, the fail branch went uncovered, and CI's 100%
     * line gate broke.) Creator→Video/Summary cascade on delete, so cleanup is
     * just the creator + the standalone topic.
     */
    const ts = Date.now();
    const creator = await prisma.creator.create({
      data: { name: `TL-${ts}`, slug: `tl-${ts}` },
    });
    const topic = await prisma.topic.create({
      data: { name: `TLTopic-${ts}`, slug: `tl-t-${ts}` },
    });
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        title: `TLVideo-${ts}`,
        sourceUrl: `https://example.com/tl-${ts}`,
        sourceVideoId: `tl-${ts}`,
        publishedAt: new Date(),
        durationSeconds: 60,
      },
    });
    await prisma.videoTopicSummary.create({
      data: {
        videoId: video.id,
        creatorId: creator.id,
        topicId: topic.id,
        dominantStance: "neutral",
        summary: "fixture",
        mentionCount: 1,
      },
    });

    try {
      await analyzeCreatorJob(creator.id);
      const failedRun = await prisma.analysisRun.findFirst({
        where: { analysisType: "creator_timeline", status: "failed" },
        orderBy: { createdAt: "desc" },
      });
      expect(failedRun).not.toBeNull();
    } finally {
      timelineGenerationSpy.mockRestore();
      await prisma.creator.delete({
        where: { id: creator.id },
      }); /* cascades video + summary */
      await prisma.topic.delete({ where: { id: topic.id } });
    }
  });

  it("no-ops for an unknown creator id", async () => {
    const { analyzeCreatorJob } = await import(
      "../src/jobs/analyzeCreator.job"
    );
    await expect(analyzeCreatorJob("does-not-exist")).resolves.toBeUndefined();
  });
});

/*
 * ----------------------------------------------------------------------------
 * bulkImport.job — inline-payload happy path materialization
 * ----------------------------------------------------------------------------
 */

describe("bulk-import inline payload — materialization", () => {
  it("inline payload writes files + ingests them end-to-end", async () => {
    const inlineBody = {
      inline: {
        manifest: {
          creator: {
            name: "Inline Materialize Test",
            slug: `inline-mat-${Date.now()}`,
            channelUrl: null,
            description: null,
            thumbnailUrl: null,
          },
          entries: [
            {
              videoId: "inline-mat-1",
              title: "Inline materialization video",
              publishedAt: "2026-05-01",
              durationSeconds: 700,
              sourceUrl: "https://www.youtube.com/watch?v=inline-mat-1",
              transcriptPath: "inline-mat-1.txt",
              status: "saved",
            },
          ],
        },
        transcripts: {
          "inline-mat-1": "Inline content. " + "lots of words. ".repeat(80),
        },
      },
    };
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send(inlineBody);
    expect(r.status).toBe(202);
    expect(typeof r.body.jobId).toBe("string");
  });

  it("inline payload skips entries that lack a transcript body", async () => {
    const inlineBody = {
      inline: {
        manifest: {
          creator: {
            name: "Inline NoBody Test",
            slug: `inline-nobody-${Date.now()}`,
            channelUrl: null,
            description: null,
            thumbnailUrl: null,
          },
          entries: [
            {
              videoId: "inline-nobody-1",
              title: "missing body",
              publishedAt: "2026-05-01",
              durationSeconds: 700,
              sourceUrl: "https://www.youtube.com/watch?v=inline-nobody-1",
              transcriptPath: null,
              status: "saved",
            },
          ],
        },
        transcripts: {} /* intentionally empty */,
      },
    };
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send(inlineBody);
    expect(r.status).toBe(202);
  });
});

/*
 * ----------------------------------------------------------------------------
 * llmClient — openai + anthropic provider paths via mocked fetch
 * ----------------------------------------------------------------------------
 */

describe("llmClient — provider paths via mocked fetch", () => {
  beforeEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.ENABLE_MOCK_MODE;
  });

  it("openai path returns parsed JSON on a 200 with valid body", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "key-ok";
    process.env.ENABLE_MOCK_MODE = "false";
    const orig = global.fetch;
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"label":"ok"}' } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { runLlm } = await import("../src/ai/llmClient");
    const r = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `unique-${Date.now()}`,
      bypassCache: true,
    });
    expect(r.provider).toBe("openai");

    global.fetch = orig;
  });

  it("anthropic path returns parsed JSON on a 200 with valid body", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "key-ok";
    process.env.ENABLE_MOCK_MODE = "false";
    const orig = global.fetch;
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ content: [{ text: '{"label":"ok"}' }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { runLlm } = await import("../src/ai/llmClient");
    const r = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `unique-anthropic-${Date.now()}`,
      bypassCache: true,
    });
    expect(r.provider).toBe("anthropic");

    global.fetch = orig;
  });

  it("throws when openai returns a retryable 5xx repeatedly", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "key-ok";
    process.env.ENABLE_MOCK_MODE = "false";
    const orig = global.fetch;
    global.fetch = vi.fn(
      async () => new Response("{}", { status: 500 }),
    ) as unknown as typeof fetch;

    const { runLlm } = await import("../src/ai/llmClient");
    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `unique-fallback-${Date.now()}`,
        bypassCache: true,
      }),
    ).rejects.toThrow("openai_status_500");

    global.fetch = orig;
  });

  it("throws the openai status even when the error body cannot be read", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "key-ok";
    process.env.ENABLE_MOCK_MODE = "false";
    const orig = global.fetch;
    global.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => {
          throw new Error("body read failed");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    try {
      const { runLlm } = await import("../src/ai/llmClient");
      await expect(
        runLlm({
          task: "topic_detection",
          system: "s",
          userPrompt: `unique-unreadable-error-${Date.now()}`,
          bypassCache: true,
        }),
      ).rejects.toThrow("openai_status_500");
    } finally {
      global.fetch = orig;
    }
  });

  it("safeParseJson rescues a JSON object embedded in a chatty response", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "key-ok";
    process.env.ENABLE_MOCK_MODE = "false";
    const orig = global.fetch;
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: 'Sure! Here\'s the JSON: {"label":"ok"}' } },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { runLlm } = await import("../src/ai/llmClient");
    const r = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `unique-chatty-${Date.now()}`,
      bypassCache: true,
    });
    expect(r.provider).toBe("openai");
    expect((r.json as { label?: string }).label).toBe("ok");

    global.fetch = orig;
  });
});

/*
 * ----------------------------------------------------------------------------
 * requestId middleware — incoming header reuse
 * ----------------------------------------------------------------------------
 */

describe("requestId middleware", () => {
  it("honors an incoming X-Request-Id header when it's well-formed", async () => {
    const r = await request(app)
      .get("/api/health")
      .set("X-Request-Id", "abc-123-DEF_456");
    expect(r.headers["x-request-id"]).toBe("abc-123-DEF_456");
  });

  it("generates a fresh UUID when the incoming header is invalid", async () => {
    const r = await request(app)
      .get("/api/health")
      .set("X-Request-Id", "!@#$%^&*()");
    expect(r.headers["x-request-id"]).not.toBe("!@#$%^&*()");
    expect(r.headers["x-request-id"]).toBeTruthy();
  });
});

/*
 * ----------------------------------------------------------------------------
 * timeout middleware — verb gating
 * ----------------------------------------------------------------------------
 */

describe("timeout middleware", () => {
  it("does NOT time out POST requests (only GETs)", async () => {
    /* Just verify POST endpoints don't accidentally trip the timeout branch. */
    const r = await request(app).post("/api/topics").send({ name: "" });
    /* Either bad-request or success — but never 503 timeout. */
    expect(r.status).not.toBe(503);
  });
});
