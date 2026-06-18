import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { NotFoundError } from "../utils/errors";
import { jobRunner } from "../jobs/jobRunner";
import { analyzeVideoJob } from "../jobs/analyzeVideo.job";
import { analyzeCreatorJob } from "../jobs/analyzeCreator.job";

/**
 * POST /api/analysis/videos/:videoId/run — kick off per-video analysis.
 * Enqueues an `analyze_video` job (chunking → embedding →
 * stance per chunk → per-topic summary). Idempotency-Key-aware so
 * "Re-run analysis" double-clicks don't double-enqueue.
 */
export async function runVideoAnalysis(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
    });
    if (!video) throw new NotFoundError("Video not found");
    await prisma.video.update({
      where: { id: video.id },
      data: { analysisStatus: "pending" },
    });
    jobRunner.enqueue(`analyzeVideo:${video.id}`, () =>
      analyzeVideoJob(video.id),
    );
    res.status(202).json({ status: "queued" });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/analysis/creators/:creatorId/run — kick off a creator-wide
 * re-analysis. Iterates the creator's videos and enqueues an
 * `analyze_video` job for each. Useful after a topic-taxonomy update
 * or stance-classifier swap.
 */
export async function runCreatorAnalysis(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    /*
     * Resolve id-OR-slug (consistent with the other creator endpoints) so a
     * human-readable deep-link like /creators/<slug>/run doesn't 404.
     */
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ id: req.params.creatorId }, { slug: req.params.creatorId }],
      },
    });
    if (!creator) throw new NotFoundError("Creator not found");
    jobRunner.enqueue(`analyzeCreator:${creator.id}`, () =>
      analyzeCreatorJob(creator.id),
    );
    res.status(202).json({ status: "queued" });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analysis-runs/:analysisRunId — fetch a single analysis run row
 * (status, provider, timing, error). 404 if the id doesn't resolve. Used
 * to poll the progress of a queued analysis.
 */
export async function getAnalysisRun(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const run = await prisma.analysisRun.findUnique({
      where: { id: req.params.analysisRunId },
    });
    if (!run) throw new NotFoundError("Analysis run not found");
    res.json(run);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/creators/:creatorId/topics/:topicId/timeline — return the
 * stance-over-time timeline for one creator+topic (with topic and creator
 * joined). Responds with `{ timeline: null }` rather than 404 when no
 * timeline has been generated yet, so the client can render an empty state.
 *
 * The creator and topic path params are resolved by id-OR-slug (consistent
 * with the other creator/topic endpoints) so a human-readable deep-link like
 * /creators/<slug>/topics/<slug>/timeline resolves instead of silently
 * returning `{ timeline: null }` for a slug that never matches the
 * id-keyed composite unique.
 */
export async function getCreatorTopicTimeline(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const [creator, topic] = await resolveCreatorAndTopic(
      req.params.creatorId,
      req.params.topicId,
    );
    /*
     * 404 when the creator/topic doesn't resolve at all — a slug that maps to
     * nothing is a genuine not-found, not an empty timeline.
     */
    if (!creator) throw new NotFoundError("Creator not found");
    if (!topic) throw new NotFoundError("Topic not found");

    const tl = await prisma.creatorTopicTimeline.findUnique({
      where: {
        creatorId_topicId: { creatorId: creator.id, topicId: topic.id },
      },
      include: { topic: true, creator: true },
    });
    if (!tl) {
      res.json({ timeline: null });
      return;
    }
    res.json({ timeline: tl });
  } catch (err) {
    next(err);
  }
}

/**
 * resolveCreatorAndTopic — resolve a creator + topic path-param pair where
 * each may be either an id or a slug, in a single parallel round-trip.
 *
 * Returns a `[creator | null, topic | null]` tuple of the thin `{ id }`
 * projections; callers 404 on a null. Centralizes the id-or-slug `findFirst`
 * the analysis endpoints share so deep-links by slug resolve consistently.
 */
async function resolveCreatorAndTopic(
  creatorIdOrSlug: string,
  topicIdOrSlug: string,
): Promise<[{ id: string } | null, { id: string } | null]> {
  return Promise.all([
    prisma.creator.findFirst({
      where: { OR: [{ id: creatorIdOrSlug }, { slug: creatorIdOrSlug }] },
      select: { id: true },
    }),
    prisma.topic.findFirst({
      where: { OR: [{ id: topicIdOrSlug }, { slug: topicIdOrSlug }] },
      select: { id: true },
    }),
  ]);
}

/**
 * GET /api/creators/:creatorId/topics/:topicId/analysis — assemble the
 * full creator+topic analysis view in one response.
 *
 * Runs six queries in parallel: creator, topic, the timeline, the per-video
 * summaries (oldest-first), the top 8 evidence chunks (relevance >= 0.5,
 * ranked by confidence then relevance), and the latest topic-summary
 * report. 404s if the creator or topic is missing; otherwise returns all
 * six pieces for the topic detail page.
 */
export async function getCreatorTopicAnalysis(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    /*
     * Resolve id-or-slug for BOTH path params FIRST and 404 if either is
     * missing. Previously this used `findUnique({ id })` for both, so a
     * human-readable deep-link like /creators/<slug>/topics/<slug>/analysis
     * 404'd "Creator not found" on refresh. Resolving up front also means the
     * five aggregate queries below run against concrete ids.
     */
    const [creatorRef, topicRef] = await resolveCreatorAndTopic(
      req.params.creatorId,
      req.params.topicId,
    );
    if (!creatorRef) throw new NotFoundError("Creator not found");
    if (!topicRef) throw new NotFoundError("Topic not found");
    const creatorId = creatorRef.id;
    const topicId = topicRef.id;

    const [creator, topic, timeline, summaries, topEvidence, report] =
      await Promise.all([
        prisma.creator.findUnique({ where: { id: creatorId } }),
        prisma.topic.findUnique({ where: { id: topicId } }),
        prisma.creatorTopicTimeline.findUnique({
          where: { creatorId_topicId: { creatorId, topicId } },
        }),
        prisma.videoTopicSummary.findMany({
          where: { creatorId, topicId },
          include: {
            video: {
              select: {
                id: true,
                title: true,
                publishedAt: true,
                sourceUrl: true,
                thumbnailUrl: true,
              },
            },
          },
          orderBy: { video: { publishedAt: "asc" } },
        }),
        prisma.chunkTopicAnalysis.findMany({
          where: { creatorId, topicId, relevanceScore: { gte: 0.5 } },
          include: {
            chunk: {
              select: {
                chunkIndex: true,
                startSeconds: true,
                endSeconds: true,
              },
            },
            video: {
              select: {
                id: true,
                title: true,
                publishedAt: true,
                sourceUrl: true,
              },
            },
          },
          orderBy: [{ confidenceScore: "desc" }, { relevanceScore: "desc" }],
          /*
           * No `take` cap — return ALL evidence for this (creator, topic) so the
           * UI can paginate the COMPLETE list (it was capped at 8, which hid most
           * of it). Bounded in practice — the most-covered topic has ~1.7k rows
           * (avg ~100), so the payload stays reasonable; if a topic ever dwarfs
           * that, server-side pagination is the V2 move.
           */
        }),
        prisma.report.findFirst({
          where: { creatorId, topicId, reportType: "topic_summary" },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    res.json({
      creator,
      topic,
      timeline,
      summaries,
      topEvidence,
      report,
    });
  } catch (err) {
    next(err);
  }
}
