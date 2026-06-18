import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { inputHash } from "../utils/hashing";
import {
  generateCreatorTopicTimeline,
  CREATOR_TIMELINE_PROMPT_VERSION,
} from "../services/timeline.service";
import { env } from "../config/env";

/**
 * Re-aggregates video-level topic summaries for a creator into
 * CreatorTopicTimeline rows (one per (creator, topic)). The per-video
 * analyses themselves are produced by analyzeVideoJob.
 */
export async function analyzeCreatorJob(creatorId: string): Promise<void> {
  const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) return;

  const summaries = await prisma.videoTopicSummary.findMany({
    where: { creatorId },
    include: {
      video: { select: { id: true, title: true, publishedAt: true } },
      topic: true,
    },
  });

  const byTopic = new Map<string, typeof summaries>();
  for (const s of summaries) {
    const arr = byTopic.get(s.topicId) ?? [];
    arr.push(s);
    byTopic.set(s.topicId, arr);
  }

  const timelineRun = await prisma.analysisRun.create({
    data: {
      analysisType: "creator_timeline",
      status: "processing",
      provider: env.aiProvider,
      modelName: env.aiModel,
      promptVersion: CREATOR_TIMELINE_PROMPT_VERSION,
      inputHash: inputHash("timeline", creatorId, summaries.length),
      startedAt: new Date(),
    },
  });

  try {
    await prisma.creatorTopicTimeline.deleteMany({ where: { creatorId } });

    for (const [topicId, topicSummaries] of byTopic.entries()) {
      /* v8 ignore next -- byTopic entries are only created after pushing a summary. */
      if (topicSummaries.length === 0) continue;
      const topic = topicSummaries[0].topic;

      const timeline = await generateCreatorTopicTimeline({
        creatorName: creator.name,
        topicName: topic.name,
        summaries: topicSummaries.map((s) => ({
          videoId: s.videoId,
          publishedAt: s.video.publishedAt?.toISOString(),
          dominantStance: s.dominantStance,
          confidenceLabel: s.confidenceLabel,
          summary: s.summary ?? "",
        })),
      });

      const dates = topicSummaries
        .map((s) => s.video.publishedAt)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => a.getTime() - b.getTime());

      await prisma.creatorTopicTimeline.upsert({
        where: { creatorId_topicId: { creatorId, topicId } },
        update: {
          analysisRunId: timelineRun.id,
          dateStart: dates[0] ?? null,
          dateEnd: dates[dates.length - 1] ?? null,
          trendLabel: timeline.trendLabel,
          summary: timeline.summary,
          evidence: timeline.evidence,
        },
        create: {
          creatorId,
          topicId,
          analysisRunId: timelineRun.id,
          dateStart: dates[0] ?? null,
          dateEnd: dates[dates.length - 1] ?? null,
          trendLabel: timeline.trendLabel,
          summary: timeline.summary,
          evidence: timeline.evidence,
        },
      });
    }

    await prisma.analysisRun.update({
      where: { id: timelineRun.id },
      data: { status: "completed", completedAt: new Date() },
    });
    /* v8 ignore start -- job-level failure handler; covered by integration tests not unit tests. start/stop form for consistency with the other job handlers and to avoid the brittle "next N" line-count. */
  } catch (err) {
    logger.error(`[analyzeCreator] failed ${creatorId}`, {
      error: (err as Error).message,
    });
    await prisma.analysisRun.update({
      where: { id: timelineRun.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      },
    });
  }
  /* v8 ignore stop */
}
