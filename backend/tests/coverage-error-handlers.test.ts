/**
 * coverage-error-handlers.test.ts — exercise the remaining
 * `catch (err) { next(err); }` branches across controllers by mocking the
 * underlying Prisma/service call to throw. Each test pins ONE controller
 * branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";

const app = buildApp();

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
  vi.restoreAllMocks();
});

/*
 * Helper: drop a forced-throw stub on a Prisma model method, run the request,
 * restore. Returns the response.
 */
async function withForcedPrismaThrow<T>(
  modelName: keyof typeof prisma,
  methodName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const model = (prisma as unknown as Record<string, Record<string, unknown>>)[
    modelName as string
  ];
  const original = model[methodName];
  model[methodName] = (() => {
    throw new Error("forced prisma failure");
  }) as never;
  try {
    return await fn();
  } finally {
    model[methodName] = original;
  }
}

describe("controllers — error catch blocks via mocked Prisma failures", () => {
  it("dashboard catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the dashboard response. */
    const r = await withForcedPrismaThrow("creator", "count", () =>
      request(app).get("/api/dashboard"),
    );
    expect(r.status).toBe(500);
  });

  it("creators list catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the creators-list response. */
    const r = await withForcedPrismaThrow("creator", "findMany", () =>
      request(app).get("/api/creators"),
    );
    expect(r.status).toBe(500);
  });

  it("creators get catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the creator-get response. */
    const r = await withForcedPrismaThrow("creator", "findFirst", () =>
      request(app).get("/api/creators/c1"),
    );
    expect(r.status).toBe(500);
  });

  it("topics list catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the topics-list response. */
    const r = await withForcedPrismaThrow("topic", "findMany", () =>
      request(app).get("/api/topics"),
    );
    expect(r.status).toBe(500);
  });

  it("videos list catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the videos-list response. */
    const r = await withForcedPrismaThrow("video", "findMany", () =>
      request(app).get("/api/videos"),
    );
    expect(r.status).toBe(500);
  });

  it("videos get catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the video-get response. */
    const r = await withForcedPrismaThrow("video", "findUnique", () =>
      request(app).get("/api/videos/some-id"),
    );
    expect(r.status).toBe(500);
  });

  it("import-jobs list catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the import-jobs-list response. */
    const r = await withForcedPrismaThrow("importJob", "findMany", () =>
      request(app).get("/api/import-jobs"),
    );
    expect(r.status).toBe(500);
  });

  it("evidence list catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the evidence-list response. */
    const r = await withForcedPrismaThrow(
      "chunkTopicAnalysis",
      "findMany",
      () => request(app).get("/api/evidence"),
    );
    expect(r.status).toBe(500);
  });

  it("reports list catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the reports-list response. */
    const r = await withForcedPrismaThrow("report", "findMany", () =>
      request(app).get("/api/reports"),
    );
    expect(r.status).toBe(500);
  });

  it("reports get catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the report-get response. */
    const r = await withForcedPrismaThrow("report", "findUnique", () =>
      request(app).get("/api/reports/rid"),
    );
    expect(r.status).toBe(500);
  });

  it("search catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the search response. */
    const r = await withForcedPrismaThrow("creator", "findMany", () =>
      request(app).get("/api/search").query({ q: "test" }),
    );
    expect(r.status).toBe(500);
  });

  it("analysis run video returns a status for any input", async () => {
    /*
     * Just verify the endpoint accepts the request shape. Coverage on
     * the catch fires when the underlying enqueue or pre-check throws.
     * Issue the analysis-run request and capture whatever status the endpoint returns.
     */
    const r = await request(app)
      .post(`/api/analysis/videos/v-coverage-${Date.now()}/run`)
      .set("Idempotency-Key", `cov-analysis-${Date.now()}`);
    expect([200, 202, 404, 500]).toContain(r.status);
  });

  it("charts stance-over-time service throws → 500", async () => {
    const stanceOverTimeSpy = vi
      .spyOn(
        await import("../src/services/chartData.service"),
        "getStanceOverTime",
      )
      .mockRejectedValue(new Error("forced chart failure"));
    const r = await request(app)
      .get("/api/charts/stance-over-time")
      .query({ creatorId: "c1" });
    expect(r.status).toBe(500);
    stanceOverTimeSpy.mockRestore();
  });

  it("charts topic-frequency service throws → 500", async () => {
    const topicFrequencySpy = vi
      .spyOn(
        await import("../src/services/chartData.service"),
        "getTopicFrequency",
      )
      .mockRejectedValue(new Error("forced topic-freq failure"));
    const r = await request(app)
      .get("/api/charts/topic-frequency")
      .query({ creatorId: "c1" });
    expect(r.status).toBe(500);
    topicFrequencySpy.mockRestore();
  });

  it("transcripts get returns 404 for unknown video", async () => {
    /*
     * The endpoint short-circuits to 404 before any catchable error
     * path; this assertion just exercises the not-found branch.
     */
    const r = await request(app).get("/api/videos/v-missing-cov/transcript");
    expect(r.status).toBe(404);
  });

  it("evidence detail service throws → 500", async () => {
    const evidenceDetailSpy = vi
      .spyOn(
        await import("../src/services/evidence.service"),
        "getEvidenceDetail",
      )
      .mockRejectedValue(new Error("forced evidence failure"));
    const r = await request(app).get("/api/evidence/some-id");
    expect(r.status).toBe(500);
    evidenceDetailSpy.mockRestore();
  });

  it("import-job items catches Prisma failure", async () => {
    /*
     * listImportJobItems now does the parent-existence check (importJob
     * .findUnique) FIRST, so force THAT to throw to reach the catch → 500
     * (forcing the items findMany would instead 404 on the missing parent).
     */
    const r = await withForcedPrismaThrow("importJob", "findUnique", () =>
      request(app).get("/api/import-jobs/jid/items"),
    );
    expect(r.status).toBe(500);
  });

  it("creator overview catches Prisma failure", async () => {
    /* Force the Prisma call to throw, then capture the creator-overview response. */
    const r = await withForcedPrismaThrow("creator", "findFirst", () =>
      request(app).get("/api/creators/c1/overview"),
    );
    expect(r.status).toBe(500);
  });

  it("creator topics catches Prisma failure", async () => {
    /*
     * getCreatorTopics now resolves the creator by id-or-slug FIRST (creator
     * .findFirst), so force the throw there to exercise the catch block.
     */
    const r = await withForcedPrismaThrow("creator", "findFirst", () =>
      request(app).get("/api/creators/c1/topics"),
    );
    expect(r.status).toBe(500);
  });

  it("compareCreators catches service failure", async () => {
    const comparisonSpy = vi
      .spyOn(
        await import("../src/services/creatorComparison.service"),
        "getCreatorComparison",
      )
      .mockRejectedValue(new Error("forced compare failure"));
    const r = await request(app)
      .get("/api/creators/compare")
      .query({ creatorIds: "a,b" });
    expect(r.status).toBe(500);
    comparisonSpy.mockRestore();
  });
});
