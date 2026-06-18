import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import {
  createCreatorTopicSummaryFixture,
  createEvidenceDetailFixture,
  deleteCreatorTopicSummaryFixture,
  deleteEvidenceDetailFixture,
} from "./testHelpers";

const app = buildApp();

let creatorId = "";
let topicId = "";
let videoId = "";
let primaryFixture: Awaited<ReturnType<typeof createEvidenceDetailFixture>>;

beforeAll(async () => {
  primaryFixture = await createEvidenceDetailFixture("api-primary");
  creatorId = primaryFixture.creatorId;
  topicId = primaryFixture.topicId;
  videoId = primaryFixture.videoId;
});

afterAll(async () => {
  if (primaryFixture) {
    await deleteEvidenceDetailFixture(primaryFixture);
  }
});

describe("health + system status", () => {
  it("GET /api/health → 200", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /api/system/status surfaces budget + cache + providers", async () => {
    const res = await request(app).get("/api/system/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.env.aiProvider).toBeDefined();
    expect(res.body.llm.budget).toMatchObject({
      callsMade: expect.any(Number),
      estimatedUsd: expect.any(Number),
    });
    expect(res.body.llm.cache).toMatchObject({
      size: expect.any(Number),
      hits: expect.any(Number),
      misses: expect.any(Number),
    });
  });
});

describe("dashboard", () => {
  it("returns stats + recent jobs/creators/reports", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.stats.creators).toBeGreaterThan(0);
    expect(res.body.stats.videos).toBeGreaterThan(0);
    expect(Array.isArray(res.body.recentJobs)).toBe(true);
    expect(Array.isArray(res.body.recentCreators)).toBe(true);
    expect(Array.isArray(res.body.recentReports)).toBe(true);
  });
});

describe("creators", () => {
  it("lists creators with aggregated counts", async () => {
    const res = await request(app).get("/api/creators");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const c of res.body.items) {
      expect(c).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        slug: expect.any(String),
        videoCount: expect.any(Number),
        transcriptCount: expect.any(Number),
        topicCount: expect.any(Number),
      });
    }
  });

  it("returns a creator overview", async () => {
    const res = await request(app).get(`/api/creators/${creatorId}/overview`);
    expect(res.status).toBe(200);
    expect(res.body.creator.id).toBe(creatorId);
    expect(res.body.stats).toMatchObject({
      videoCount: expect.any(Number),
      transcriptCount: expect.any(Number),
    });
    expect(Array.isArray(res.body.topTopics)).toBe(true);
    expect(Array.isArray(res.body.recentVideos)).toBe(true);
  });

  it("returns creator topics with stance aggregation", async () => {
    const fixture =
      await createCreatorTopicSummaryFixture("api-creator-topics");
    try {
      const res = await request(app).get(
        `/api/creators/${fixture.creatorId}/topics`,
      );
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const t of res.body.items) {
        expect(t.dominantStance).toMatch(
          /^(supportive|opposed|neutral|mixed|unclear|insufficient_evidence)$/,
        );
      }
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("404s on unknown creator", async () => {
    const res = await request(app).get("/api/creators/does-not-exist/overview");
    expect(res.status).toBe(404);
  });
});

describe("videos", () => {
  it("paginates the video list", async () => {
    const res = await request(app).get("/api/videos").query({ pageSize: 5 });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.items.length);
    expect(res.body.page).toBe(1);
  });

  it("filters by creator", async () => {
    const res = await request(app).get("/api/videos").query({ creatorId });
    expect(res.status).toBe(200);
    for (const v of res.body.items) expect(v.creatorId).toBe(creatorId);
  });

  it("returns video detail with transcript + summaries", async () => {
    const res = await request(app).get(`/api/videos/${videoId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(videoId);
    expect(Array.isArray(res.body.videoSummaries)).toBe(true);
  });

  it("returns transcript with chunks", async () => {
    const res = await request(app)
      .get(`/api/videos/${videoId}/transcript`)
      .query({ includeChunks: "true" });
    expect(res.status).toBe(200);
    expect(res.body.wordCount).toBeGreaterThan(0);
    expect(Array.isArray(res.body.chunks)).toBe(true);
  });
});

describe("topic analysis + charts", () => {
  it("returns full topic analysis payload", async () => {
    const res = await request(app).get(
      `/api/creators/${creatorId}/topics/${topicId}/analysis`,
    );
    expect(res.status).toBe(200);
    expect(res.body.creator.id).toBe(creatorId);
    expect(res.body.topic.id).toBe(topicId);
    expect(Array.isArray(res.body.summaries)).toBe(true);
    expect(Array.isArray(res.body.topEvidence)).toBe(true);
  });

  it("stance-over-time returns valid time series", async () => {
    const res = await request(app)
      .get("/api/charts/stance-over-time")
      .query({ creatorId, topicId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.points)).toBe(true);
    for (const p of res.body.points) {
      expect(p.date).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof p.count).toBe("number");
    }
  });

  it("stance-over-time requires creatorId", async () => {
    const res = await request(app).get("/api/charts/stance-over-time");
    expect(res.status).toBe(400);
  });

  it("topic-frequency returns stacked-bar data", async () => {
    const res = await request(app)
      .get("/api/charts/topic-frequency")
      .query({ creatorId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.points)).toBe(true);
    expect(Array.isArray(res.body.topics)).toBe(true);
  });
});

describe("evidence", () => {
  it("lists evidence with confidence + stance", async () => {
    const fixture = await createEvidenceDetailFixture("api-evidence-list");
    try {
      const res = await request(app)
        .get("/api/evidence")
        .query({ pageSize: 5 });
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const e of res.body.items) {
        expect(e.stanceLabel).toBeDefined();
        expect(e.confidenceLabel).toMatch(/^(low|medium|high)$/);
        expect(e.relevanceScore).toBeGreaterThanOrEqual(0.4);
      }
    } finally {
      await deleteEvidenceDetailFixture(fixture);
    }
  });

  it("returns evidence detail with previous/next chunk", async () => {
    const fixture = await createEvidenceDetailFixture("api-evidence-detail");
    try {
      const res = await request(app).get(`/api/evidence/${fixture.analysisId}`);
      expect(res.status).toBe(200);
      expect(res.body.analysis.id).toBe(fixture.analysisId);
      expect(res.body.analysis.chunk).toBeDefined();
      expect(Array.isArray(res.body.relatedEvidence)).toBe(true);
    } finally {
      await deleteEvidenceDetailFixture(fixture);
    }
  });

  it("filters evidence by stance label", async () => {
    const fixture = await createEvidenceDetailFixture("api-evidence-filter");
    try {
      const res = await request(app)
        .get("/api/evidence")
        .query({ stanceLabel: "supportive", pageSize: 3 });
      expect(res.status).toBe(200);
      for (const e of res.body.items) expect(e.stanceLabel).toBe("supportive");
    } finally {
      await deleteEvidenceDetailFixture(fixture);
    }
  });
});

describe("reports", () => {
  it("lists reports filtered by creator", async () => {
    const fixture = await createCreatorTopicSummaryFixture("api-report-list");
    try {
      await prisma.report.create({
        data: {
          creatorId: fixture.creatorId,
          reportType: "creator_summary",
          title: "Fixture report",
          summary: "Fixture report summary.",
          caveats: "Based on transcript data.",
        },
      });
      const res = await request(app)
        .get("/api/reports")
        .query({ creatorId: fixture.creatorId });
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("returns report detail with caveats", async () => {
    const fixture = await createCreatorTopicSummaryFixture("api-report-detail");
    try {
      const report = await prisma.report.create({
        data: {
          creatorId: fixture.creatorId,
          reportType: "creator_summary",
          title: "Fixture report detail",
          summary: "Fixture report detail summary.",
          caveats: "Based on transcript data.",
        },
      });
      const res = await request(app).get(`/api/reports/${report.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(report.id);
      expect(res.body.caveats).toMatch(/transcript data/i);
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });
});

describe("search", () => {
  it("/api/search returns multi-entity hits", async () => {
    const res = await request(app).get("/api/search").query({ q: "disagree" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      creators: expect.any(Array),
      videos: expect.any(Array),
      topics: expect.any(Array),
      evidence: expect.any(Array),
    });
  });

  it("/api/search requires q", async () => {
    const res = await request(app).get("/api/search");
    expect(res.status).toBe(400);
  });

});

describe("import jobs", () => {
  it("validates request body", async () => {
    const res = await request(app)
      .post("/api/import-jobs/youtube-channel")
      .send({ channelUrl: "", requestedLimit: 10 });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported limit", async () => {
    const res = await request(app)
      .post("/api/import-jobs/youtube-channel")
      .send({ channelUrl: "https://youtube.com/@x", requestedLimit: 7 });
    expect(res.status).toBe(400);
  });
});

describe("manual transcript", () => {
  it("rejects too-short input", async () => {
    const res = await request(app)
      .post(`/api/videos/${videoId}/transcript/manual`)
      .send({ rawText: "too short" });
    expect(res.status).toBe(400);
  });
});

describe("topics", () => {
  it("lists topics with counts", async () => {
    const res = await request(app).get("/api/topics");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("creates a user topic", async () => {
    const res = await request(app)
      .post("/api/topics")
      .send({ name: "Test Topic " + Date.now(), description: "from test" });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("user_created");
  });
});
