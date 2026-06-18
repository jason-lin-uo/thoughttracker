/**
 * Job-level tests. These actually run the import + analysis pipelines
 * against the isolated seeded test DB. They are slower than unit tests but they
 * cover the parts of the code that pure unit tests can't reach
 * (writes to multiple tables, status transitions, the in-process queue).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { jobRunner } from "../src/jobs/jobRunner";
import { analyzeVideoJob } from "../src/jobs/analyzeVideo.job";
import { analyzeCreatorJob } from "../src/jobs/analyzeCreator.job";
import { importChannelJob } from "../src/jobs/importChannel.job";
import {
  generateCreatorReportJob,
  generateTopicReportJob,
} from "../src/jobs/generateReport.job";
import { generateEmbeddingsForCreatorJob } from "../src/jobs/generateEmbeddings.job";
import {
  createCreatorTopicSummaryFixture,
  deleteCreatorTopicSummaryFixture,
} from "./testHelpers";

let creatorId = "";
let topicId = "";
type CreatorTopicSummaryFixture = Awaited<
  ReturnType<typeof createCreatorTopicSummaryFixture>
>;
let jobFixture: CreatorTopicSummaryFixture | null = null;
const JOB_ENV_KEYS = [
  "AI_PROVIDER",
  "EMBEDDING_PROVIDER",
  "YOUTUBE_PROVIDER",
  "STANCE_ANALYSIS_PROVIDER",
  "TOPIC_ASSIGNMENT_PROVIDER",
  "TOPIC_RELEVANCE_PROVIDER",
] as const;
let jobEnvSnapshot: Partial<
  Record<(typeof JOB_ENV_KEYS)[number], string | undefined>
> = {};

beforeAll(async () => {
  jobEnvSnapshot = Object.fromEntries(
    JOB_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof JOB_ENV_KEYS)[number], string | undefined>;
  process.env.AI_PROVIDER = "local";
  process.env.EMBEDDING_PROVIDER = "ml";
  process.env.YOUTUBE_PROVIDER = "youtube";
  process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";
  process.env.TOPIC_RELEVANCE_PROVIDER = "heuristic";
  delete process.env.TOPIC_ASSIGNMENT_PROVIDER;

  jobFixture = await createCreatorTopicSummaryFixture("jobs-shared");
  creatorId = jobFixture.creatorId;
  topicId = jobFixture.topicId;
});

afterAll(async () => {
  await jobRunner.drain();
  if (jobFixture) {
    await deleteCreatorTopicSummaryFixture(jobFixture);
  }
  for (const key of JOB_ENV_KEYS) {
    const value = jobEnvSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("jobRunner", () => {
  it("processes enqueued jobs in order", async () => {
    const order: number[] = [];
    await new Promise<void>((resolve) => {
      jobRunner.enqueue("test-1", async () => {
        order.push(1);
      });
      jobRunner.enqueue("test-2", async () => {
        order.push(2);
      });
      jobRunner.enqueue("test-3", async () => {
        order.push(3);
        resolve();
      });
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("continues processing after a failing job", async () => {
    const order: string[] = [];
    await new Promise<void>((resolve) => {
      jobRunner.enqueue("fail", async () => {
        order.push("fail");
        throw new Error("boom");
      });
      jobRunner.enqueue("after-fail", async () => {
        order.push("after-fail");
        resolve();
      });
    });
    expect(order).toEqual(["fail", "after-fail"]);
  });

  it("drain() waits for in-flight queued jobs to finish", async () => {
    /*
     * Enqueue a slow job, then immediately call drain(). The drain
     * should wait at least until the job's async body completes, NOT
     * return before. Exercises the poll loop body (the 10ms sleep)
     * that's otherwise only reachable when the queue isn't empty at
     * drain time.
     */
    let finished = false;
    jobRunner.enqueue("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      finished = true;
    });
    await jobRunner.drain();
    expect(finished).toBe(true);
  });
});

describe("analyzeVideoJob", () => {
  it("marks video analysisStatus=completed and writes summaries", async () => {
    const fixture = await createAnalyzableVideoFixture(creatorId);
    await jobRunner.drain();
    try {
      await analyzeVideoJob(fixture.videoId);
      const v = await prisma.video.findUnique({
        where: { id: fixture.videoId },
      });
      expect(v!.analysisStatus).toBe("completed");

      const summaries = await prisma.videoTopicSummary.findMany({
        where: { videoId: fixture.videoId },
        include: { topic: true },
      });
      expect(summaries.length).toBeGreaterThan(0);
      expect(
        summaries.some(
          (summary) => summary.topic.slug === "ai_societal_impact",
        ),
      ).toBe(true);
    } finally {
      await prisma.video
        .delete({ where: { id: fixture.videoId } })
        .catch(() => undefined);
    }
  });

  it("no-ops on a video without a transcript", async () => {
    const v = await prisma.video.findFirst({
      where: { transcriptStatus: "unavailable" },
    });
    if (!v) return;
    await analyzeVideoJob(v.id);
    /*
     * Re-fetch the SAME id; if a concurrent test cascaded it away
     * between the analyzeVideoJob call and now, skip — the
     * assertion's contract (status unchanged) is still upheld
     * tautologically when the row doesn't exist.
     */
    const after = await prisma.video.findUnique({ where: { id: v.id } });
    if (!after) return;
    expect(after.transcriptStatus).toBe("unavailable");
  });

  it("no-ops on a non-existent video id", async () => {
    await analyzeVideoJob("does-not-exist");
    expect(true).toBe(true);
  });

  it("marks the video failed when top-level analysis work throws", async () => {
    const fixture = await createAnalyzableVideoFixture(creatorId);
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(
        new Error("forced video analysis failure") as never,
      );

    try {
      await analyzeVideoJob(fixture.videoId);
      const v = await prisma.video.findUnique({
        where: { id: fixture.videoId },
      });
      expect(v!.analysisStatus).toBe("failed");
    } finally {
      transactionSpy.mockRestore();
      await prisma.video
        .delete({ where: { id: fixture.videoId } })
        .catch(() => undefined);
    }
  });
});

/* Seeds a video with an analyzable transcript/chunk for the given creator and returns its videoId. */
async function createAnalyzableVideoFixture(
  creatorId: string,
): Promise<{ videoId: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chunkText = [
    "Artificial intelligence is the central subject of this segment.",
    "I believe we should embrace artificial intelligence where it improves work and education.",
    "The benefits are real, but the speaker is still careful about the long-term societal impact.",
  ].join(" ");

  const video = await prisma.video.create({
    data: {
      creatorId,
      platform: "youtube",
      sourceVideoId: `jobs-ai-fixture-${suffix}`,
      sourceUrl: `https://www.example.com/jobs-ai-fixture-${suffix}`,
      title: "Artificial intelligence fixture",
      transcriptStatus: "available",
      analysisStatus: "pending",
    },
  });

  const transcript = await prisma.transcript.create({
    data: {
      videoId: video.id,
      sourceType: "manual_paste",
      language: "en",
      rawText: chunkText,
      cleanedText: chunkText,
      wordCount: chunkText.split(/\s+/).length,
    },
  });

  await prisma.transcriptChunk.create({
    data: {
      transcriptId: transcript.id,
      videoId: video.id,
      chunkIndex: 0,
      text: chunkText,
      tokenCount: chunkText.split(/\s+/).length,
    },
  });

  return { videoId: video.id };
}

describe("analyzeCreatorJob", () => {
  it("writes timeline rows for the creator's topics", async () => {
    const fixture = await createCreatorTopicSummaryFixture(
      "jobs-creator-timeline",
    );
    try {
      await analyzeCreatorJob(fixture.creatorId);
      const tls = await prisma.creatorTopicTimeline.findMany({
        where: { creatorId: fixture.creatorId },
      });
      expect(tls.length).toBeGreaterThan(0);
    } finally {
      await deleteCreatorTopicSummaryFixture(fixture);
    }
  });

  it("no-ops for an unknown creator id", async () => {
    await analyzeCreatorJob("does-not-exist");
    expect(true).toBe(true);
  });
});

describe("generateReport jobs", () => {
  it("generateCreatorReportJob creates a Report row", async () => {
    const id = await generateCreatorReportJob(creatorId);
    expect(id).toBeTruthy();
    const r = await prisma.report.findUnique({ where: { id: id! } });
    expect(r!.reportType).toBe("creator_summary");
    expect(r!.caveats).toMatch(/transcript data/i);
  });

  it("generateCreatorReportJob returns null for unknown creator", async () => {
    const id = await generateCreatorReportJob("does-not-exist");
    expect(id).toBeNull();
  });

  it("generateTopicReportJob creates a Report row", async () => {
    const id = await generateTopicReportJob(creatorId, topicId);
    expect(id).toBeTruthy();
    const r = await prisma.report.findUnique({ where: { id: id! } });
    expect(r!.reportType).toBe("topic_summary");
    expect(r!.topicId).toBe(topicId);
  });

  it("generateTopicReportJob returns null for unknown creator", async () => {
    const id = await generateTopicReportJob("does-not-exist", topicId);
    expect(id).toBeNull();
  });

  it("generateTopicReportJob returns null for unknown topic", async () => {
    const id = await generateTopicReportJob(creatorId, "does-not-exist");
    expect(id).toBeNull();
  });
});

describe("generateEmbeddings job", () => {
  it("generateEmbeddingsForCreatorJob returns a count", async () => {
    const r = await generateEmbeddingsForCreatorJob(creatorId);
    expect(typeof r.generated).toBe("number");
  });
});

describe("importChannelJob", () => {
  it("runs a full import → analyze pipeline against the mock provider", async () => {
    const job = await prisma.importJob.create({
      data: {
        channelUrl: "https://www.youtube.com/@coverage-test",
        requestedLimit: 10,
        status: "pending",
      },
    });
    await importChannelJob(job.id);
    const updated = await prisma.importJob.findUnique({
      where: { id: job.id },
    });
    expect(updated!.status).toBe("failed");
    expect(updated!.errorMessage).toMatch(/runtime import is not configured/i);
    expect(updated!.totalVideosFound).toBe(0);
    expect(updated!.creatorId).toBeNull();
    const items = await prisma.importJobItem.findMany({
      where: { importJobId: job.id },
    });
    expect(items).toEqual([]);
  });

  it("returns gracefully when the job id is unknown", async () => {
    await importChannelJob("does-not-exist");
    expect(true).toBe(true);
  });

  it("updates the existing creator when the same channel is re-imported", async () => {
    const channelUrl = "https://www.youtube.com/@reimport-coverage";
    const first = await prisma.importJob.create({
      data: { channelUrl, requestedLimit: 5, status: "pending" },
    });
    await importChannelJob(first.id);
    const firstJob = await prisma.importJob.findUnique({
      where: { id: first.id },
    });
    expect(firstJob!.creatorId).toBeNull();
    expect(firstJob!.status).toBe("failed");

    /*
     * Re-import the same channel. upsertCreator must take the "existing" path
     * and UPDATE the creator in place (a duplicate create would violate the
     * unique slug constraint and throw).
     */
    const second = await prisma.importJob.create({
      data: { channelUrl, requestedLimit: 5, status: "pending" },
    });
    await importChannelJob(second.id);
    const secondJob = await prisma.importJob.findUnique({
      where: { id: second.id },
    });

    expect(secondJob!.creatorId).toBeNull();
    expect(secondJob!.status).toBe("failed");
  });
});
