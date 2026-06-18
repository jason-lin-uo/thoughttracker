/**
 * Shared test helpers used across multiple test files.
 *
 * Underscore prefix so vitest's `tests/**\/*.test.ts` include glob
 * doesn't try to run this as a test file.
 */

/**
 * `createTimeoutTracker()` — tracks `setTimeout` handles so an `afterEach`
 * can clear them between tests.
 *
 * Why we need it: tests that exercise `requestTimeout` (or any other
 * middleware that 503s early) typically schedule a fake-slow response
 * via `setTimeout(() => res.json(...), 500)`. When the timeout fires
 * AFTER the timeout middleware already sent its 503, calling
 * `res.json` on a closed response throws "Cannot set headers after
 * they are sent" as an UNHANDLED EXCEPTION — which vitest treats as
 * a test-suite failure separate from the test that scheduled it,
 * contaminating later test files.
 *
 * Usage:
 * ```ts
 * const timers = createTimeoutTracker();
 * afterEach(() => timers.clear());
 *
 * it("...", () => {
 * app.get("/slow", (_req, res) => {
 * timers.add(setTimeout(() => res.json({ ok: true }), 500));
 * });
 * });
 * ```
 */
import { prisma } from "../src/config/prisma";

/* Returns an add/clear pair for tracking and tearing down pending setTimeout handles. */
export function createTimeoutTracker() {
  let pending: NodeJS.Timeout[] = [];
  return {
    add(timer: NodeJS.Timeout): NodeJS.Timeout {
      pending.push(timer);
      return timer;
    },
    clear(): void {
      for (const t of pending) clearTimeout(t);
      pending = [];
    },
  };
}

/* Seeds a full creator/topic/video/transcript/chunk/analysis/report graph for evidence-detail tests. */
export async function createEvidenceDetailFixture(label: string): Promise<{
  analysisId: string;
  creatorId: string;
  reportId: string;
  transcriptId: string;
  topicId: string;
  videoId: string;
}> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creator = await prisma.creator.create({
    data: {
      name: `Evidence ${suffix}`,
      slug: `evidence-${suffix}`,
      creatorType: "youtube_channel",
    },
  });
  const topic = await prisma.topic.create({
    data: {
      name: `Evidence Topic ${suffix}`,
      slug: `evidence-topic-${suffix}`,
      source: "system_default",
    },
  });
  const video = await prisma.video.create({
    data: {
      creatorId: creator.id,
      platform: "youtube",
      sourceVideoId: `evidence-video-${suffix}`,
      sourceUrl: `https://www.example.com/evidence-video-${suffix}`,
      title: "Evidence fixture video",
      transcriptStatus: "available",
      analysisStatus: "completed",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    },
  });
  const transcript = await prisma.transcript.create({
    data: {
      videoId: video.id,
      sourceType: "manual_paste",
      language: "en",
      rawText: "Previous chunk. Main evidence chunk. Next chunk.",
      cleanedText: "Previous chunk. Main evidence chunk. Next chunk.",
      wordCount: 7,
    },
  });
  await prisma.transcriptChunk.createMany({
    data: [
      {
        transcriptId: transcript.id,
        videoId: video.id,
        chunkIndex: 0,
        text: "Previous context chunk.",
        tokenCount: 3,
      },
      {
        transcriptId: transcript.id,
        videoId: video.id,
        chunkIndex: 1,
        text: "Main evidence chunk with a supportive claim.",
        tokenCount: 7,
      },
      {
        transcriptId: transcript.id,
        videoId: video.id,
        chunkIndex: 2,
        text: "Next context chunk.",
        tokenCount: 3,
      },
    ],
  });
  const chunk = await prisma.transcriptChunk.findUniqueOrThrow({
    where: {
      transcriptId_chunkIndex: { transcriptId: transcript.id, chunkIndex: 1 },
    },
  });
  const analysis = await prisma.chunkTopicAnalysis.create({
    data: {
      chunkId: chunk.id,
      videoId: video.id,
      creatorId: creator.id,
      topicId: topic.id,
      relevanceScore: 0.9,
      stanceLabel: "supportive",
      confidenceScore: 0.91,
      confidenceLabel: "high",
      claimSummary: "The speaker supports the fixture topic.",
      rationale: "Fixture rationale.",
      evidenceQuote: "supportive claim",
    },
  });

  await prisma.videoTopicSummary.create({
    data: {
      videoId: video.id,
      creatorId: creator.id,
      topicId: topic.id,
      dominantStance: "supportive",
      confidenceScore: 0.91,
      confidenceLabel: "high",
      mentionCount: 1,
      summary:
        "The fixture video discusses the topic with supportive evidence.",
      notableEvidence: [{ quote: "supportive claim", chunkId: chunk.id }],
    },
  });

  const report = await prisma.report.create({
    data: {
      creatorId: creator.id,
      topicId: topic.id,
      reportType: "topic_summary",
      title: `Evidence report ${suffix}`,
      summary: "Fixture report summary.",
      caveats: "Based on transcript data.",
    },
  });

  return {
    analysisId: analysis.id,
    creatorId: creator.id,
    reportId: report.id,
    transcriptId: transcript.id,
    topicId: topic.id,
    videoId: video.id,
  };
}

/* Tears down the evidence-detail fixture by deleting its creator (and optional topic), ignoring missing rows. */
export async function deleteEvidenceDetailFixture(args: {
  creatorId: string;
  topicId?: string;
}): Promise<void> {
  await prisma.creator
    .delete({ where: { id: args.creatorId } })
    .catch(() => undefined);
  if (args.topicId) {
    await prisma.topic
      .delete({ where: { id: args.topicId } })
      .catch(() => undefined);
  }
}

/* Seeds a creator with one topic and two videos plus per-video topic summaries for creator-topic-summary tests. */
export async function createCreatorTopicSummaryFixture(label: string): Promise<{
  creatorId: string;
  topicId: string;
  videoIds: string[];
}> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creator = await prisma.creator.create({
    data: {
      name: `Topic Summary ${suffix}`,
      slug: `topic-summary-${suffix}`,
      creatorType: "youtube_channel",
    },
  });
  const topic = await prisma.topic.create({
    data: {
      name: `Topic Summary ${suffix}`,
      slug: `topic-summary-topic-${suffix}`,
      source: "system_default",
    },
  });
  const videos = await Promise.all(
    [0, 1].map((index) =>
      prisma.video.create({
        data: {
          creatorId: creator.id,
          platform: "youtube",
          sourceVideoId: `topic-summary-video-${suffix}-${index}`,
          sourceUrl: `https://www.example.com/topic-summary-video-${suffix}-${index}`,
          title: `Topic summary fixture ${index + 1}`,
          transcriptStatus: "available",
          analysisStatus: "completed",
          publishedAt: new Date(Date.UTC(2026, index, 1)),
        },
      }),
    ),
  );

  await prisma.videoTopicSummary.createMany({
    data: videos.map((video, index) => ({
      videoId: video.id,
      creatorId: creator.id,
      topicId: topic.id,
      dominantStance: index === 0 ? "supportive" : "neutral",
      confidenceScore: 0.86 - index * 0.05,
      confidenceLabel: "high",
      mentionCount: 3 - index,
      summary: `Fixture summary ${index + 1} for ${topic.name}.`,
      notableEvidence: [
        { quote: "central topic fixture", chunkId: `fixture-${index}` },
      ],
    })),
  });

  return {
    creatorId: creator.id,
    topicId: topic.id,
    videoIds: videos.map((video) => video.id),
  };
}

/* Tears down the creator-topic-summary fixture by deleting its creator and topic, ignoring missing rows. */
export async function deleteCreatorTopicSummaryFixture(args: {
  creatorId: string;
  topicId: string;
}): Promise<void> {
  await prisma.creator
    .delete({ where: { id: args.creatorId } })
    .catch(() => undefined);
  await prisma.topic
    .delete({ where: { id: args.topicId } })
    .catch(() => undefined);
}
