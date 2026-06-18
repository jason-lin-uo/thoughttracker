import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { llmBudget, llmCache } from "../ai/llmBudget";
import { MIN_EVIDENCE_RELEVANCE } from "../utils/constants";
import {
  selectFeaturedTimeline,
  toFeaturedInsight,
} from "../services/dashboardInsight";

/**
 * GET /api/dashboard
 *
 * Aggregated overview powering the top-level Dashboard page:
 * - totals (creators / videos / transcripts / topics / evidence)
 * - featuredInsight: the hero card. Prefer the latest generated topic report
 * so the featured default report can headline the demo; fall back to the strongest
 * analyzed timeline when no report-backed topic is available. null only when
 * nothing has been analyzed yet. See services/dashboardInsight.ts.
 * - the 5 most-recent import jobs (with creator denormalised)
 * - the 6 most-recent creators (with video counts)
 * - the 5 most-recent reports (with creator + topic denormalised)
 *
 * The counts + recent lists are gathered in one Promise.all; fallback hero
 * report metadata is resolved in one small follow-up query when needed.
 */
export async function getDashboard(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const [
      creatorCount,
      videoCount,
      transcriptCount,
      topicCount,
      evidenceCount,
      recentJobs,
      recentCreators,
      recentReports,
      analyzedTimelines,
      topicVideoCounts,
      latestTopicReport,
    ] = await Promise.all([
      prisma.creator.count(),
      prisma.video.count(),
      prisma.transcript.count(),
      prisma.topic.count(),
      prisma.chunkTopicAnalysis.count({
        where: { relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE } },
      }),
      prisma.importJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { creator: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.creator.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { _count: { select: { videos: true } } },
      }),
      prisma.report.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          creator: { select: { id: true, name: true, slug: true } },
          topic: { select: { id: true, name: true, slug: true } },
        },
      }),
      /*
       * Featured-insight input: analyzed timelines with creator/topic names
       * joined. The dashboard prefers the latest topic report when it maps to
       * one of these timelines, then falls back to the strongest timeline.
       * Bounded take guards the payload.
       */
      prisma.creatorTopicTimeline.findMany({
        where: {
          summary: { not: null },
          trendLabel: { not: "insufficient_data" },
        },
        take: 300,
        include: {
          creator: { select: { name: true } },
          topic: { select: { name: true } },
        },
      }),
      /* Videos per (creator, topic): the credibility signal the selector ranks on. */
      prisma.videoTopicSummary.groupBy({
        by: ["creatorId", "topicId"],
        _count: { _all: true },
      }),
      prisma.report.findFirst({
        where: { reportType: "topic_summary", topicId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          summary: true,
          creatorId: true,
          topicId: true,
        },
      }),
    ]);

    /*
     * Attach each timeline's backing video count. A latest topic report wins
     * when it has a matching analyzed timeline, giving the admin reset flow a
     * predictable featured hero. Otherwise selectFeaturedTimeline picks the
     * strongest analyzed fallback.
     */
    const countByKey = new Map<string, number>();
    for (const row of topicVideoCounts) {
      countByKey.set(`${row.creatorId}:${row.topicId}`, row._count._all);
    }
    const timelineCandidates = analyzedTimelines.map((t) => ({
      ...t,
      videoCount: countByKey.get(`${t.creatorId}:${t.topicId}`) ?? 0,
    }));
    const reportTimeline = latestTopicReport?.topicId
      ? (timelineCandidates.find(
          (t) =>
            t.creatorId === latestTopicReport.creatorId &&
            t.topicId === latestTopicReport.topicId,
        ) ?? null)
      : null;
    const featuredTimeline =
      reportTimeline ?? selectFeaturedTimeline(timelineCandidates);
    /*
     * Resolve backing topic report metadata for the featured pair so the hero
     * links to the full report when one exists. If the feature came from the
     * latest report, reuse that report without another query.
     */
    const featuredReport = reportTimeline
      ? latestTopicReport
      : featuredTimeline
      ? await prisma.report.findFirst({
          where: {
            creatorId: featuredTimeline.creatorId,
            topicId: featuredTimeline.topicId,
            reportType: "topic_summary",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, summary: true },
        })
      : null;
    const featuredInsight = toFeaturedInsight(featuredTimeline, featuredReport);

    res.json({
      stats: {
        creators: creatorCount,
        videos: videoCount,
        transcripts: transcriptCount,
        topics: topicCount,
        evidence: evidenceCount,
      },
      featuredInsight,
      recentJobs,
      recentCreators,
      recentReports,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/system/status
 *
 * Liveness + observability snapshot for ops dashboards / readiness probes.
 * Surfaces:
 * - which real provider each external dependency is configured to use
 * - live LLM budget counters (callsMade, tokensIn/Out, USD estimate)
 * - LLM cache stats (size / hits / misses / hitRate)
 * - daily call + USD caps
 *
 * Read-only; safe to poll. No auth required (no secrets surfaced).
 *
 * Wrapped in try/catch so a hiccup while gathering the snapshot (a budget/cache
 * `snapshot()` throwing, an env read going sideways) degrades to a still-200
 * `{ ok: false, degraded: true }` payload rather than a 500. This endpoint
 * doubles as a readiness/liveness probe, and a load balancer treating a
 * transient blip as "service down" (5xx) would needlessly pull the pod from
 * rotation; reporting `ok: false` lets ops SEE the degradation without an
 * outage. Passing the error to `next` is avoided on purpose here: the whole
 * point is to never fail the probe.
 */
export function getSystemStatus(_req: Request, res: Response) {
  try {
    res.json({
      ok: true,
      service: "thoughttracker-backend",
      timestamp: new Date().toISOString(),
      env: {
        aiProvider: process.env.AI_PROVIDER ?? "local",
        embeddingProvider: process.env.EMBEDDING_PROVIDER ?? "ml",
        youtubeProvider: process.env.YOUTUBE_PROVIDER ?? "youtube",
        stanceProvider: process.env.STANCE_ANALYSIS_PROVIDER ?? "custom_ml",
      },
      llm: {
        budget: llmBudget.snapshot(),
        cache: llmCache.snapshot(),
        limits: {
          dailyCallCap: Number(process.env.LLM_DAILY_CALL_CAP ?? 5000),
          dailyUsdCap: Number(process.env.LLM_DAILY_USD_CAP ?? 5.0),
        },
      },
    });
  } catch (err) {
    /* Never 500 the status/liveness endpoint; surface degraded state at 200. */
    res.json({
      ok: false,
      degraded: true,
      service: "thoughttracker-backend",
      timestamp: new Date().toISOString(),
      error: (err as Error).message,
    });
  }
}
