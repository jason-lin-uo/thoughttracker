/**
 * Per-endpoint coverage tests. The `api.test.ts` suite covers golden paths;
 * this file targets specific lines / branches that integration tests don't
 * reach (uncommon filter combinations, edge cases, error paths).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { jobRunner } from "../src/jobs/jobRunner";
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
let evidenceId = "";
let reportId = "";
let primaryFixture: Awaited<ReturnType<typeof createEvidenceDetailFixture>>;

beforeAll(async () => {
  primaryFixture = await createEvidenceDetailFixture("controllers-primary");
  creatorId = primaryFixture.creatorId;
  topicId = primaryFixture.topicId;
  videoId = primaryFixture.videoId;
  evidenceId = primaryFixture.analysisId;
  reportId = primaryFixture.reportId;
});

afterAll(async () => {
  if (primaryFixture) {
    await deleteEvidenceDetailFixture(primaryFixture);
  }
});

describe("dashboard controller", () => {
  it("/api/dashboard returns full payload", async () => {
    const r = await request(app).get("/api/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.stats).toBeDefined();
    expect(Array.isArray(r.body.recentJobs)).toBe(true);
  });

  it("/api/dashboard features the latest topic report when one exists", async () => {
    const fixture = await createCreatorTopicSummaryFixture(
      "dashboard-report-feature",
    );
    try {
      await prisma.creatorTopicTimeline.create({
        data: {
          creatorId: fixture.creatorId,
          topicId: fixture.topicId,
          trendLabel: "stable",
          summary: "Timeline backing the report.",
        },
      });
      const report = await prisma.report.create({
        data: {
          creatorId: fixture.creatorId,
          topicId: fixture.topicId,
          reportType: "topic_summary",
          title: "Featured topic report",
          summary: "This report should drive the dashboard hero.",
          caveats: "Fixture caveat.",
          createdAt: new Date("2099-01-01T00:00:00Z"),
        },
      });

      const r = await request(app).get("/api/dashboard");

      expect(r.status).toBe(200);
      expect(r.body.featuredInsight.reportId).toBe(report.id);
      expect(r.body.featuredInsight.reportTitle).toBe("Featured topic report");
      expect(r.body.featuredInsight.summary).toBe(
        "This report should drive the dashboard hero.",
      );
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("/api/system/status surfaces all expected fields", async () => {
    const r = await request(app).get("/api/system/status");
    expect(r.status).toBe(200);
    expect(r.body.env.aiProvider).toBeDefined();
    expect(r.body.llm.budget).toBeDefined();
    expect(r.body.llm.cache).toBeDefined();
    expect(r.body.llm.limits).toBeDefined();
  });

  it("/api/health is reachable", async () => {
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
  });
});

describe("search controller", () => {
  it("/api/search returns entities", async () => {
    const r = await request(app).get("/api/search").query({ q: "disagree" });
    expect(r.status).toBe(200);
    expect(r.body.q).toBe("disagree");
    expect(Array.isArray(r.body.creators)).toBe(true);
    expect(Array.isArray(r.body.videos)).toBe(true);
    expect(Array.isArray(r.body.topics)).toBe(true);
    expect(Array.isArray(r.body.evidence)).toBe(true);
  });

  it("/api/search 400s on empty q", async () => {
    const r = await request(app).get("/api/search");
    expect(r.status).toBe(400);
  });

  it("/api/search matches creator names", async () => {
    const suffix = `atlas-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creator = await prisma.creator.create({
      data: {
        name: `Atlas Search ${suffix}`,
        slug: suffix,
        creatorType: "youtube_channel",
      },
    });
    try {
      const r = await request(app)
        .get("/api/search")
        .query({ q: "Atlas Search" });
      expect(r.body.creators).toEqual([
        expect.objectContaining({
          id: creator.id,
          name: expect.stringContaining("Atlas Search"),
        }),
      ]);
    } finally {
      await prisma.creator
        .delete({ where: { id: creator.id } })
        .catch(() => undefined);
    }
  });
});

describe("creators controller — filters + 404", () => {
  it("/api/creators with search filter", async () => {
    const r = await request(app)
      .get("/api/creators")
      .query({ search: "Atlas" });
    expect(r.status).toBe(200);
  });

  it("/api/creators/:id resolves by id", async () => {
    const r = await request(app).get(`/api/creators/${creatorId}`);
    expect(r.status).toBe(200);
  });

  it("/api/creators/:slug resolves by slug", async () => {
    const slug = (await prisma.creator.findFirst())!.slug;
    const r = await request(app).get(`/api/creators/${slug}`);
    expect(r.status).toBe(200);
  });

  it("/api/creators/:id returns 404", async () => {
    const r = await request(app).get("/api/creators/missing");
    expect(r.status).toBe(404);
  });

  it("/api/creators/:id/overview returns 404 for unknown", async () => {
    const r = await request(app).get("/api/creators/missing/overview");
    expect(r.status).toBe(404);
  });

  it("/api/creators/:id/overview aggregates fixture top topics", async () => {
    const fixture = await createCreatorTopicSummaryFixture("creator-overview");
    try {
      const r = await request(app).get(
        `/api/creators/${fixture.creatorId}/overview`,
      );
      expect(r.status).toBe(200);
      expect(r.body.topTopics).toEqual([
        expect.objectContaining({
          topicId: fixture.topicId,
          videoCount: 2,
          mentionCount: 5,
          dominantStance: "supportive",
        }),
      ]);
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("/api/creators/:id/topics aggregates fixture topic rows", async () => {
    const fixture = await createCreatorTopicSummaryFixture("creator-topics");
    try {
      const r = await request(app).get(
        `/api/creators/${fixture.creatorId}/topics`,
      );
      expect(r.status).toBe(200);
      expect(r.body.items).toEqual([
        expect.objectContaining({
          topicId: fixture.topicId,
          videoCount: 2,
          mentionCount: 5,
          dominantStance: "supportive",
        }),
      ]);
      expect(r.body.items[0].firstPublishedAt).toBeTruthy();
      expect(r.body.items[0].lastPublishedAt).toBeTruthy();
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("/api/creators/compare requires at least 2 ids", async () => {
    const r = await request(app)
      .get("/api/creators/compare")
      .query({ creatorIds: creatorId });
    expect(r.status).toBe(400);
  });

  it("/api/creators/compare rejects more than 5 ids", async () => {
    const r = await request(app)
      .get("/api/creators/compare")
      .query({ creatorIds: "a,b,c,d,e,f" });
    expect(r.status).toBe(400);
  });

  it("/api/creators/compare returns side-by-side payload for 2 creators", async () => {
    const creators = await prisma.creator.findMany({ take: 2 });
    if (creators.length < 2) return;
    const r = await request(app)
      .get("/api/creators/compare")
      .query({ creatorIds: `${creators[0].id},${creators[1].id}` });
    expect(r.status).toBe(200);
    expect(r.body.creators).toHaveLength(2);
    expect(r.body).toHaveProperty("sharedTopics");
    expect(r.body).toHaveProperty("timeline");
  });
});

describe("videos controller — filter permutations", () => {
  it("filters by transcriptStatus", async () => {
    const r = await request(app)
      .get("/api/videos")
      .query({ transcriptStatus: "available", pageSize: 3 });
    expect(r.status).toBe(200);
    for (const v of r.body.items) expect(v.transcriptStatus).toBe("available");
  });

  it("filters by analysisStatus", async () => {
    const r = await request(app)
      .get("/api/videos")
      .query({ analysisStatus: "completed", pageSize: 3 });
    expect(r.status).toBe(200);
  });

  it("filters by stanceLabel + confidenceLabel jointly", async () => {
    const r = await request(app).get("/api/videos").query({
      stanceLabel: "supportive",
      confidenceLabel: "high",
      pageSize: 3,
    });
    expect(r.status).toBe(200);
  });

  it("filters by date range", async () => {
    const r = await request(app)
      .get("/api/videos")
      .query({ from: "2020-01-01", to: "2099-12-31" });
    expect(r.status).toBe(200);
  });

  it("/api/videos/:id 404 for unknown id", async () => {
    const r = await request(app).get("/api/videos/missing");
    expect(r.status).toBe(404);
  });
});

describe("transcripts controller", () => {
  it("/api/videos/:id/transcript without chunks", async () => {
    const r = await request(app).get(`/api/videos/${videoId}/transcript`);
    expect(r.status).toBe(200);
  });

  it("/api/videos/:id/transcript with chunks", async () => {
    const r = await request(app)
      .get(`/api/videos/${videoId}/transcript`)
      .query({ includeChunks: "true" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.chunks)).toBe(true);
  });

  it("/api/videos/:id/transcript 404 for unknown video", async () => {
    const r = await request(app).get("/api/videos/missing/transcript");
    expect(r.status).toBe(404);
  });

  it("/api/videos/:id/transcript/manual 404 for unknown video", async () => {
    const r = await request(app)
      .post(`/api/videos/missing/transcript/manual`)
      .send({ rawText: "x".repeat(50) });
    expect(r.status).toBe(404);
  });

  it("/api/videos/:id/transcript/rechunk 404 for unknown video", async () => {
    const r = await request(app).post(`/api/videos/missing/transcript/rechunk`);
    expect(r.status).toBe(404);
  });

  it("/api/videos/:id/transcript/rechunk queues async re-chunk on a transcribed video", async () => {
    /*
     * H15: rechunk now enqueues the chunking + analysis off the request path
     * and returns 202 + { status: "queued" } instead of running inline (200).
     */
    const r = await request(app).post(
      `/api/videos/${videoId}/transcript/rechunk`,
    );
    expect(r.status).toBe(202);
    expect(r.body.status).toBe("queued");
    /*
     * Let the enqueued chunk job (and the analysis it enqueues) drain so it
     * doesn't race the next test's DB reads.
     */
    await jobRunner.drain();
  });
});

describe("analysis controller", () => {
  it("/api/analysis/videos/:id/run queues a job", async () => {
    const r = await request(app)
      .post(`/api/analysis/videos/${videoId}/run`)
      .set("X-Forwarded-For", "203.0.113.11");
    expect(r.status).toBe(202);
  });

  it("/api/analysis/videos/:id/run 404 for unknown video", async () => {
    const r = await request(app).post(`/api/analysis/videos/missing/run`);
    expect(r.status).toBe(404);
  });

  it("/api/analysis/creators/:id/run queues a job", async () => {
    const r = await request(app)
      .post(`/api/analysis/creators/${creatorId}/run`)
      .set("X-Forwarded-For", "203.0.113.12");
    expect(r.status).toBe(202);
  });

  it("/api/analysis/creators/:id/run 404 for unknown creator", async () => {
    const r = await request(app).post(`/api/analysis/creators/missing/run`);
    expect(r.status).toBe(404);
  });

  it("/api/analysis-runs/:id 404 for unknown run", async () => {
    const r = await request(app).get(`/api/analysis-runs/missing`);
    expect(r.status).toBe(404);
  });

  it("/api/creators/:id/topics/:tid/timeline returns null if absent", async () => {
    /*
     * Deterministically pick a topic the creator DOES NOT have a timeline
     * for, so we exercise the null-branch in the controller (not the
     * success path).
     */
    const topicWithoutTimeline = await prisma.topic.findFirst({
      where: {
        id: { not: topicId },
        timelines: { none: { creatorId } },
      },
    });
    if (!topicWithoutTimeline) return;
    const r = await request(app).get(
      `/api/creators/${creatorId}/topics/${topicWithoutTimeline.id}/timeline`,
    );
    expect(r.status).toBe(200);
    expect(r.body.timeline).toBeNull();
  });

  it("/api/creators/:id/topics/:tid/analysis 404 on unknown creator", async () => {
    const r = await request(app).get(
      `/api/creators/missing/topics/${topicId}/analysis`,
    );
    expect(r.status).toBe(404);
  });

  it("/api/creators/:id/topics/:tid/analysis 404 on unknown topic", async () => {
    const r = await request(app).get(
      `/api/creators/${creatorId}/topics/missing/analysis`,
    );
    expect(r.status).toBe(404);
  });
});

describe("reports controller — citation resolution", () => {
  it("GET /api/reports/:id resolves citation videoTitle/topic to deep-link ids", async () => {
    const suffix = `cite-${Date.now()}`;
    const creator = await prisma.creator.create({
      data: { name: `Cite ${suffix}`, slug: suffix },
    });
    const topic = await prisma.topic.create({
      data: {
        name: `Cite Topic ${suffix}`,
        slug: `t-${suffix}`,
        source: "system_default",
      },
    });
    const video = await prisma.video.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        sourceVideoId: `vid-${suffix}`,
        sourceUrl: `https://example.com/${suffix}`,
        title: `Cite Video ${suffix}`,
      },
    });
    const report = await prisma.report.create({
      data: {
        creatorId: creator.id,
        topicId: topic.id,
        reportType: "topic_summary",
        title: "Cite report",
        summary: "s",
        caveats: "c",
        evidence: {
          sections: [],
          evidence: [
            { videoTitle: `Cite Video ${suffix}`, note: "matches a video" },
            { topic: `Cite Topic ${suffix}`, note: "matches a topic" },
            { videoTitle: "No Such Video", note: "unmatched" },
          ],
        },
      },
    });

    const r = await request(app).get(`/api/reports/${report.id}`);
    expect(r.status).toBe(200);
    const cites = r.body.evidence.evidence as Array<{
      videoId?: string | null;
      topicId?: string | null;
    }>;
    expect(cites[0].videoId).toBe(video.id);
    expect(cites[1].topicId).toBe(topic.id);
    expect(cites[2].videoId).toBeNull();

    await prisma.report.delete({ where: { id: report.id } });
    await prisma.video.delete({ where: { id: video.id } });
    await prisma.topic.delete({ where: { id: topic.id } });
    await prisma.creator.delete({ where: { id: creator.id } });
  });
});

describe("reports controller — generation paths", () => {
  it("POST /api/reports/creator/:id/generate queues async generation (202 + analysisRunId)", async () => {
    /*
     * H15: generation now runs on the jobRunner; the endpoint returns 202 +
     * { status, analysisRunId } and the client polls the run + the report list.
     */
    const r = await request(app)
      .post(`/api/reports/creator/${creatorId}/generate`)
      .set("X-Forwarded-For", "203.0.113.13");
    expect(r.status).toBe(202);
    expect(r.body.status).toBe("queued");
    expect(typeof r.body.analysisRunId).toBe("string");

    /*
     * Drain the queue so the generation completes, then the run is completed
     * and a creator_summary report exists.
     */
    await jobRunner.drain();
    const run = await request(app).get(
      `/api/analysis-runs/${r.body.analysisRunId}`,
    );
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("completed");
    const report = await prisma.report.findFirst({
      where: { analysisRunId: r.body.analysisRunId },
    });
    expect(report?.reportType).toBe("creator_summary");
  });

  it("POST /api/reports/creator/:id/generate 404 for unknown", async () => {
    const r = await request(app).post(`/api/reports/creator/missing/generate`);
    expect(r.status).toBe(404);
  });

  it("POST /api/reports/creator/:id/topic/:tid/generate queues async generation", async () => {
    const r = await request(app)
      .post(`/api/reports/creator/${creatorId}/topic/${topicId}/generate`)
      .set("X-Forwarded-For", "203.0.113.14");
    expect(r.status).toBe(202);
    expect(typeof r.body.analysisRunId).toBe("string");
    await jobRunner.drain();
    const report = await prisma.report.findFirst({
      where: { analysisRunId: r.body.analysisRunId },
    });
    expect(report?.reportType).toBe("topic_summary");
  });

  it("POST /api/reports/creator/:id/topic/:tid/generate 404 for unknown topic", async () => {
    const r = await request(app)
      .post(`/api/reports/creator/${creatorId}/topic/missing/generate`)
      .set("X-Forwarded-For", "203.0.113.18");
    expect(r.status).toBe(404);
  });

  it("/api/reports filters by topicId + reportType", async () => {
    const r = await request(app)
      .get("/api/reports")
      .query({ topicId, reportType: "topic_summary" });
    expect(r.status).toBe(200);
  });

  it("/api/reports honors a sort key and ignores an unknown one", async () => {
    const sorted = await request(app)
      .get("/api/reports")
      .query({ sort: "title_asc" });
    expect(sorted.status).toBe(200);
    expect(Array.isArray(sorted.body.items)).toBe(true);

    /* An unknown sort falls back to the default newest-first (still 200). */
    const bogus = await request(app)
      .get("/api/reports")
      .query({ sort: "nonsense" });
    expect(bogus.status).toBe(200);
  });

  it("/api/reports/:id 404 for unknown report", async () => {
    const r = await request(app).get("/api/reports/missing");
    expect(r.status).toBe(404);
  });
});

describe("evidence controller", () => {
  it("/api/evidence with all filters", async () => {
    const r = await request(app).get("/api/evidence").query({
      creatorId,
      topicId,
      videoId,
      stanceLabel: "supportive",
      confidenceLabel: "high",
      search: "support",
      pageSize: 3,
    });
    expect(r.status).toBe(200);
  });

  it("/api/evidence/:id 404 for unknown", async () => {
    const r = await request(app).get("/api/evidence/missing");
    expect(r.status).toBe(404);
  });

  it("/api/evidence/:id returns previous/next/related", async () => {
    const fixture = await createEvidenceDetailFixture("controller");
    try {
      const r = await request(app).get(`/api/evidence/${fixture.analysisId}`);
      expect(r.status).toBe(200);
      expect(r.body.analysis.id).toBe(fixture.analysisId);
    } finally {
      await deleteEvidenceDetailFixture(fixture);
    }
  });
});

describe("embeddings controller", () => {
  it("POST /api/embeddings/creator/:id/generate queues a job", async () => {
    const r = await request(app)
      .post(`/api/embeddings/creator/${creatorId}/generate`)
      .set("X-Forwarded-For", "203.0.113.15");
    expect(r.status).toBe(202);
  });
});

describe("topics controller", () => {
  it("POST /api/topics 400 on missing name", async () => {
    const r = await request(app).post("/api/topics").send({});
    expect(r.status).toBe(400);
  });
});

describe("import jobs controller", () => {
  it("GET /api/import-jobs returns list", async () => {
    const r = await request(app).get("/api/import-jobs");
    expect(r.status).toBe(200);
  });

  it("GET /api/import-jobs/:id 404 for unknown", async () => {
    const r = await request(app).get("/api/import-jobs/missing");
    expect(r.status).toBe(404);
  });

  it("GET /api/import-jobs/:id/items returns array", async () => {
    const job = await prisma.importJob.findFirst();
    const r = await request(app).get(`/api/import-jobs/${job!.id}/items`);
    expect(r.status).toBe(200);
  });

  it("POST /api/import-jobs/youtube-channel 400 on invalid URL", async () => {
    const r = await request(app)
      .post("/api/import-jobs/youtube-channel")
      .send({ channelUrl: "***bad***", requestedLimit: 10 });
    expect(r.status).toBe(400);
  });

  it("POST /api/import-jobs/youtube-channel 202 on valid request", async () => {
    const r = await request(app)
      .post("/api/import-jobs/youtube-channel")
      .set("X-Forwarded-For", "203.0.113.16")
      .send({ channelUrl: "https://www.youtube.com/@a", requestedLimit: 10 });
    expect(r.status).toBe(202);
  });

  it("POST /api/import-jobs/youtube-channel requires the configured admin PIN", async () => {
    const previous = process.env.ADMIN_ONBOARDING_PIN;
    process.env.ADMIN_ONBOARDING_PIN = "2468";
    try {
      const rejected = await request(app)
        .post("/api/import-jobs/youtube-channel")
        .send({ channelUrl: "https://www.youtube.com/@a", requestedLimit: 10 });
      expect(rejected.status).toBe(403);

      const accepted = await request(app)
        .post("/api/import-jobs/youtube-channel")
        .set("X-Admin-Pin", "2468")
        .set("X-Forwarded-For", "203.0.113.17")
        .send({ channelUrl: "https://www.youtube.com/@a", requestedLimit: 10 });
      expect(accepted.status).toBe(202);
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_ONBOARDING_PIN;
      } else {
        process.env.ADMIN_ONBOARDING_PIN = previous;
      }
    }
  });
});

describe("404 fallback + structured shape", () => {
  it("Unknown route returns NOT_FOUND code", async () => {
    const r = await request(app).get("/api/this-route-does-not-exist");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("NOT_FOUND");
  });
});
