/**
 * Behavioral tests for the second audit-remediation pass:
 * - H15: report generation + manual-transcript chunking are async (202 + poll).
 * - Slug resolution on the analysis + topic-report endpoints (deep-link 404 fix).
 * - Idempotency TOCTOU (409 on a concurrent in-flight key) + key length cap (400).
 * - validateEnv fail-fast (DATABASE_URL / FRONTEND_URL / provider enums).
 * - parseDateParam `to` end-of-day inclusivity.
 * - mlClassifierClient reads URL/timeout per call (env change takes effect).
 * - generateReport job markRunFailed on a vanished creator/topic (async-path orphan).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { jobRunner } from "../src/jobs/jobRunner";
import {
  idempotencyMiddleware,
  resetIdempotencyStoreForTests,
} from "../src/middleware/idempotency";
import { validateEnv } from "../src/config/env";
import { parseDateParam } from "../src/utils/dates";
import { chunkTranscriptJob } from "../src/jobs/chunkTranscript.job";
import {
  createCreatorTopicSummaryFixture,
  deleteCreatorTopicSummaryFixture,
} from "./testHelpers";

const app = buildApp();

/*
 * ---------------------------------------------------------------------------
 * Slug resolution — analysis + report endpoints accept id OR slug (deep-link).
 * ---------------------------------------------------------------------------
 */
describe("audit — analysis/report endpoints resolve creator+topic by id-or-slug", () => {
  let fixture: Awaited<ReturnType<typeof createCreatorTopicSummaryFixture>>;
  let creatorSlug = "";
  let topicSlug = "";

  beforeAll(async () => {
    fixture = await createCreatorTopicSummaryFixture("async-slug");
    const creator = await prisma.creator.findUniqueOrThrow({
      where: { id: fixture.creatorId },
      select: { slug: true },
    });
    const topic = await prisma.topic.findUniqueOrThrow({
      where: { id: fixture.topicId },
      select: { slug: true },
    });
    creatorSlug = creator.slug;
    topicSlug = topic.slug;
  });

  afterAll(async () => {
    if (fixture) await deleteCreatorTopicSummaryFixture(fixture);
  });

  it("GET /creators/:slug/topics/:slug/analysis resolves by slug (was 404 on deep-link)", async () => {
    const bySlug = await request(app).get(
      `/api/creators/${creatorSlug}/topics/${topicSlug}/analysis`,
    );
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.creator.id).toBe(fixture.creatorId);
    expect(bySlug.body.topic.id).toBe(fixture.topicId);
  });

  it("GET analysis 404s an unknown creator slug and an unknown topic slug", async () => {
    const badCreator = await request(app).get(
      `/api/creators/no-such-creator/topics/${topicSlug}/analysis`,
    );
    expect(badCreator.status).toBe(404);
    const badTopic = await request(app).get(
      `/api/creators/${creatorSlug}/topics/no-such-topic/analysis`,
    );
    expect(badTopic.status).toBe(404);
  });

  it("GET /creators/:slug/topics/:slug/timeline resolves by slug; 404s unknown", async () => {
    const bySlug = await request(app).get(
      `/api/creators/${creatorSlug}/topics/${topicSlug}/timeline`,
    );
    expect(bySlug.status).toBe(200);
    /* No timeline generated for the fixture → null (but the lookup resolved). */
    expect(bySlug.body).toHaveProperty("timeline");

    const badTopic = await request(app).get(
      `/api/creators/${creatorSlug}/topics/no-such-topic/timeline`,
    );
    expect(badTopic.status).toBe(404);
  });

  it("POST /reports/creator/:slug/topic/:slug/generate resolves both slugs (202)", async () => {
    const r = await request(app)
      .post(`/api/reports/creator/${creatorSlug}/topic/${topicSlug}/generate`)
      .set("X-Forwarded-For", "203.0.113.40");
    expect(r.status).toBe(202);
    expect(typeof r.body.analysisRunId).toBe("string");
    await jobRunner.drain();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Idempotency — key length cap (400) + concurrent in-flight claim (409).
 * ---------------------------------------------------------------------------
 */
describe("audit — idempotency length cap + TOCTOU claim", () => {
  afterEach(() => resetIdempotencyStoreForTests());

  function makeIdempotencyApp(handler: express.RequestHandler) {
    const a = express();
    a.use(express.json());
    a.use(idempotencyMiddleware);
    a.post("/x", handler);
    return a;
  }

  it("rejects an over-length Idempotency-Key with 400", async () => {
    const a = makeIdempotencyApp((_req, res) =>
      res.status(201).json({ ok: true }),
    );
    const r = await request(a)
      .post("/x")
      .set("Idempotency-Key", "k".repeat(201))
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("BAD_REQUEST");
  });

  it("a concurrent request with the same in-flight key gets 409 (not a second execution)", async () => {
    /*
     * Drive the middleware directly with fake req/res so we can hold the first
     * request "in flight" (claim registered, response not yet sent) while the
     * second arrives — supertest can't reliably express true in-process
     * overlap. The first call's next() runs but we DON'T send its response,
     * leaving the in-flight claim live; the second call must 409.
     */
    const req = () =>
      ({
        method: "POST",
        path: "/api/topics",
        header: (k: string) =>
          k.toLowerCase() === "idempotency-key" ? "concurrent" : undefined,
      }) as unknown as import("express").Request;
    const makeRes = () => {
      const res = {
        statusCode: 200,
        setHeader: () => undefined,
        on: () => res,
        status(n: number) {
          res.statusCode = n;
          return res;
        },
        json: (() => res) as (b?: unknown) => unknown,
        /* The middleware now wraps res.send too; expose it so the bind succeeds. */
        send: (() => res) as (b?: unknown) => unknown,
      };
      return res as unknown as import("express").Response & {
        statusCode: number;
      };
    };

    /*
     * First request: claims the key, next() fires — but we leave the response
     * un-sent so the claim stays in-flight.
     */
    let firstNext = false;
    const firstRes = makeRes();
    idempotencyMiddleware(req(), firstRes, () => {
      firstNext = true;
    });
    expect(firstNext).toBe(true);

    /* Second request with the same key: should 409 WITHOUT calling next(). */
    let secondNext = false;
    const secondRes = makeRes();
    idempotencyMiddleware(req(), secondRes, () => {
      secondNext = true;
    });
    expect(secondNext).toBe(false);
    expect(secondRes.statusCode).toBe(409);
  });

  it("captures + replays a res.send (non-JSON) body, not just res.json", async () => {
    const a = express();
    a.use(express.json());
    a.use(idempotencyMiddleware);
    let hits = 0;
    a.post("/x", (_req, res) => {
      hits += 1;
      /*
       * Respond with .send (a text body), which the middleware now wraps in
       * addition to .json — so the second identical request replays the cached
       * response verbatim instead of re-executing the handler.
       */
      res.status(200).send(`body-${hits}`);
    });
    const first = await request(a)
      .post("/x")
      .set("Idempotency-Key", "send-key")
      .send({});
    const second = await request(a)
      .post("/x")
      .set("Idempotency-Key", "send-key")
      .send({});
    expect(first.status).toBe(200);
    expect(first.text).toBe("body-1");
    /* Handler ran ONCE; the second response is a verbatim replay of the send body. */
    expect(hits).toBe(1);
    expect(second.text).toBe("body-1");
    expect(second.headers["idempotent-replay"]).toBe("true");
  });

  it("releases the claim on finish when the handler sends no body at all (allows a later retry)", async () => {
    const a = express();
    a.use(express.json());
    a.use(idempotencyMiddleware);
    let hits = 0;
    a.post("/x", (_req, res) => {
      hits += 1;
      /*
       * Bare res.end() — neither json() nor send() fire, so nothing is captured
       * and the in-flight claim is released by the finish handler, letting a
       * later retry execute again rather than being stuck behind a stale claim.
       */
      res.status(204).end();
    });
    await request(a).post("/x").set("Idempotency-Key", "no-body").send({});
    await request(a).post("/x").set("Idempotency-Key", "no-body").send({});
    expect(hits).toBe(2);
  });
});

/*
 * ---------------------------------------------------------------------------
 * validateEnv — fail fast on misconfiguration.
 * ---------------------------------------------------------------------------
 */
describe("audit — validateEnv", () => {
  /* Snapshot + restore the env vars validateEnv reads. */
  const KEYS = [
    "DATABASE_URL",
    "FRONTEND_URL",
    "CORS_ORIGIN",
    "NODE_ENV",
    "AI_PROVIDER",
    "EMBEDDING_PROVIDER",
    "STANCE_ANALYSIS_PROVIDER",
    "TOPIC_ASSIGNMENT_PROVIDER",
  ];
  let saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("passes for a valid configuration", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    process.env.FRONTEND_URL = "http://localhost:5173";
    process.env.AI_PROVIDER = "openai";
    process.env.EMBEDDING_PROVIDER = "ml";
    delete process.env.STANCE_ANALYSIS_PROVIDER;
    delete process.env.TOPIC_ASSIGNMENT_PROVIDER;
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    process.env.FRONTEND_URL = "http://localhost:5173";
    expect(() => validateEnv()).toThrow(/DATABASE_URL is required/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    process.env.DATABASE_URL = "mysql://localhost/db";
    process.env.FRONTEND_URL = "http://localhost:5173";
    expect(() => validateEnv()).toThrow(/postgres connection string/);
  });

  it("throws when FRONTEND_URL is required in production but missing", () => {
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.NODE_ENV = "production";
    delete process.env.FRONTEND_URL;
    delete process.env.CORS_ORIGIN;
    expect(() => validateEnv()).toThrow(/FRONTEND_URL.*required in production/);
  });

  it("throws when FRONTEND_URL is set but malformed", () => {
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.FRONTEND_URL = "not a url";
    expect(() => validateEnv()).toThrow(/not a valid URL/);
  });

  it("throws when a provider enum is invalid", () => {
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.FRONTEND_URL = "http://localhost:5173";
    process.env.AI_PROVIDER = "gpt5-turbo-max"; /* not in the allowed set */
    expect(() => validateEnv()).toThrow(/AI_PROVIDER=.*invalid/);
  });

  it("aggregates multiple problems into one message", () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";
    delete process.env.FRONTEND_URL;
    delete process.env.CORS_ORIGIN;
    process.env.EMBEDDING_PROVIDER = "bogus";
    try {
      validateEnv();
      throw new Error("expected validateEnv to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/DATABASE_URL/);
      expect(msg).toMatch(/FRONTEND_URL/);
      expect(msg).toMatch(/EMBEDDING_PROVIDER/);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * parseDateParam — `to` end-of-day inclusivity.
 * ---------------------------------------------------------------------------
 */
describe("audit — parseDateParam end boundary", () => {
  it("date-only `to` with boundary=end snaps to 23:59:59.999 UTC (inclusive)", () => {
    const d = parseDateParam("2026-03-01", "end");
    expect(d?.toISOString()).toBe("2026-03-01T23:59:59.999Z");
  });

  it("date-only `from` (default boundary) stays at start-of-day", () => {
    const d = parseDateParam("2026-03-01");
    expect(d?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("a value carrying an explicit time is left untouched even with boundary=end", () => {
    const d = parseDateParam("2026-03-01T08:30:00.000Z", "end");
    expect(d?.toISOString()).toBe("2026-03-01T08:30:00.000Z");
  });

  it("an invalid value is still rejected (undefined)", () => {
    expect(parseDateParam("nonsense", "end")).toBeUndefined();
    expect(parseDateParam(42 as unknown)).toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * mlClassifierClient — URL/timeout read per call (env change takes effect).
 * ---------------------------------------------------------------------------
 */
describe("audit — mlClassifierClient reads URL/timeout per call", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ML_CLASSIFIER_URL;
    delete process.env.ML_CLASSIFIER_TIMEOUT_MS;
  });

  it("uses a runtime-updated ML_CLASSIFIER_URL (not the module-load value)", async () => {
    const { predictStance } = await import("../src/ai/mlClassifierClient");
    const urls: string[] = [];
    globalThis.fetch = ((url: string) => {
      urls.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "neutral",
            confidence: 0.5,
            labelScores: {
              supportive: 0.1,
              opposed: 0.1,
              neutral: 0.5,
              mixed: 0.2,
              unclear: 0.1,
            },
            modelVersion: "v1",
          }),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    process.env.ML_CLASSIFIER_URL = "http://runtime-set.local";
    await predictStance({ topic: "ai", text: "x" });
    expect(urls[0]).toBe("http://runtime-set.local/predict");
  });

  it("rejects an out-of-[0,1] confidence as a bad shape (INTERNAL_ERROR)", async () => {
    const { predictStance } = await import("../src/ai/mlClassifierClient");
    process.env.ML_CLASSIFIER_URL = "http://test-ml.local";
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "supportive",
            confidence: 1.5 /* out of [0,1] → invalid */,
            labelScores: {
              supportive: 1.5,
              opposed: 0,
              neutral: 0,
              mixed: 0,
              unclear: 0,
            },
            modelVersion: "v1",
          }),
      } as unknown as Response)) as unknown as typeof fetch;
    const r = await predictStance({ topic: "ai", text: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("INTERNAL_ERROR");
  });
});

/*
 * ---------------------------------------------------------------------------
 * generateReport jobs — async-path orphan run is marked failed when the
 * creator/topic has vanished between enqueue and execution.
 * ---------------------------------------------------------------------------
 */
describe("audit — generateReport jobs mark a pre-created run failed on a vanished entity", () => {
  it("creator-report: unknown creator + existingRunId marks that run failed", async () => {
    const { generateCreatorReportJob } = await import(
      "../src/jobs/generateReport.job"
    );
    const run = await prisma.analysisRun.create({
      data: {
        analysisType: "creator_report",
        status: "processing",
        startedAt: new Date(),
      },
    });
    const result = await generateCreatorReportJob("does-not-exist", run.id);
    expect(result).toBeNull();
    const after = await prisma.analysisRun.findUnique({
      where: { id: run.id },
    });
    expect(after?.status).toBe("failed");
    expect(after?.errorMessage).toMatch(/Creator not found/);
    await prisma.analysisRun
      .delete({ where: { id: run.id } })
      .catch(() => undefined);
  });

  it("topic-report: unknown ids + existingRunId marks that run failed", async () => {
    const { generateTopicReportJob } = await import(
      "../src/jobs/generateReport.job"
    );
    const run = await prisma.analysisRun.create({
      data: {
        analysisType: "topic_report",
        status: "processing",
        startedAt: new Date(),
      },
    });
    const result = await generateTopicReportJob("nope", "nope", run.id);
    expect(result).toBeNull();
    const after = await prisma.analysisRun.findUnique({
      where: { id: run.id },
    });
    expect(after?.status).toBe("failed");
    expect(after?.errorMessage).toMatch(/Creator or topic not found/);
    await prisma.analysisRun
      .delete({ where: { id: run.id } })
      .catch(() => undefined);
  });
});

/*
 * ---------------------------------------------------------------------------
 * compareCreators — unknown ids 404 via the HTTP surface.
 * ---------------------------------------------------------------------------
 */
describe("audit — compareCreators 404s unknown ids", () => {
  it("GET /api/creators/compare with two unknown ids returns 404", async () => {
    const r = await request(app)
      .get("/api/creators/compare")
      .query({ creatorIds: "ghost-1,ghost-2" });
    expect(r.status).toBe(404);
  });
});

/*
 * ---------------------------------------------------------------------------
 * listTopics / listImportJobItems — caps + parent existence.
 * ---------------------------------------------------------------------------
 */
describe("audit — list caps + parent existence", () => {
  it("GET /api/import-jobs/:id/items 404s an unknown job (existence check)", async () => {
    const r = await request(app).get(
      "/api/import-jobs/definitely-missing/items",
    );
    expect(r.status).toBe(404);
  });

  it("GET /api/topics still returns the taxonomy (capped) list", async () => {
    const r = await request(app).get("/api/topics");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * chunkTranscriptJob — failure path flips the video to analysisStatus=failed.
 * ---------------------------------------------------------------------------
 */
describe("audit — chunkTranscriptJob marks the video failed on a chunk-write error", () => {
  it("flips analysisStatus to failed when chunk persistence throws", async () => {
    const suffix = `chunkfail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `ChunkFail ${suffix}`,
        slug: suffix,
        creatorType: "youtube_channel",
      },
    });
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `chunkfail-video-${suffix}`,
        sourceUrl: `https://www.example.com/${suffix}`,
        title: "Chunk fail fixture",
        transcriptStatus: "manual",
        analysisStatus: "pending",
      },
    });
    await prisma.transcript.create({
      data: {
        videoId: video.id,
        sourceType: "manual_paste",
        language: "en",
        rawText:
          "Some transcript text long enough to chunk. " + "word ".repeat(50),
        cleanedText:
          "Some transcript text long enough to chunk. " + "word ".repeat(50),
        wordCount: 60,
      },
    });

    /* Force the chunk write to throw so the job's catch runs. */
    const createSpy = vi
      .spyOn(prisma.transcriptChunk, "create")
      .mockRejectedValue(new Error("forced chunk-write failure"));
    try {
      await chunkTranscriptJob(video.id);
      const after = await prisma.video.findUnique({ where: { id: video.id } });
      expect(after?.analysisStatus).toBe("failed");
    } finally {
      createSpy.mockRestore();
      await prisma.creator
        .delete({ where: { id: creator.id } })
        .catch(() => undefined);
    }
  });
});
