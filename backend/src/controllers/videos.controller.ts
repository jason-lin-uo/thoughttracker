import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { NotFoundError } from "../utils/errors";
import { parsePagination, buildPageResult } from "../utils/pagination";
import { parseDateParam } from "../utils/dates";
import { parseEnumParam } from "../utils/enums";
import { $Enums } from "@prisma/client";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/videos — paginated, filtered list of videos. Filters:
 * creatorId, topicId, search (title), transcriptStatus, analysisStatus,
 * stanceLabel, confidenceLabel, from + to ISO date range. Sorted
 * newest-first; default page size 20 (see parsePagination).
 */
export async function listVideos(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { skip, take, page, pageSize } = parsePagination(req.query, {
      pageSize: 20,
    });
    const q = req.query;

    /*
     * Validate enum query params up front so a bogus value is a 400, not a
     * Prisma error → 500 (parseEnumParam throws BadRequestError on a bad value).
     */
    const transcriptStatus = parseEnumParam(
      typeof q.transcriptStatus === "string" ? q.transcriptStatus : undefined,
      $Enums.TranscriptStatus,
      "transcriptStatus",
    );
    const analysisStatus = parseEnumParam(
      typeof q.analysisStatus === "string" ? q.analysisStatus : undefined,
      $Enums.AnalysisStatus,
      "analysisStatus",
    );
    const stanceLabel = parseEnumParam(
      typeof q.stanceLabel === "string" ? q.stanceLabel : undefined,
      $Enums.StanceLabel,
      "stanceLabel",
    );
    const confidenceLabel = parseEnumParam(
      typeof q.confidenceLabel === "string" ? q.confidenceLabel : undefined,
      $Enums.ConfidenceLabel,
      "confidenceLabel",
    );

    const where: Prisma.VideoWhereInput = {};
    if (typeof q.creatorId === "string") where.creatorId = q.creatorId;
    if (typeof q.search === "string" && q.search) {
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { description: { contains: q.search, mode: "insensitive" } },
      ];
    }
    if (transcriptStatus) where.transcriptStatus = transcriptStatus;
    if (analysisStatus) where.analysisStatus = analysisStatus;

    const dateFrom = parseDateParam(q.from);
    /* "end" → a date-only `to` is inclusive through end-of-day UTC. */
    const dateTo = parseDateParam(q.to, "end");
    if (dateFrom || dateTo) {
      where.publishedAt = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      };
    }

    /* Filter by topic / stance / confidence requires joining video summaries */
    if (typeof q.topicId === "string" || stanceLabel || confidenceLabel) {
      where.videoSummaries = {
        some: {
          ...(typeof q.topicId === "string" ? { topicId: q.topicId } : {}),
          ...(stanceLabel ? { dominantStance: stanceLabel } : {}),
          ...(confidenceLabel ? { confidenceLabel } : {}),
        },
      };
    }

    const [items, total] = await Promise.all([
      prisma.video.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, slug: true } },
          _count: { select: { chunks: true, videoSummaries: true } },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      prisma.video.count({ where }),
    ]);

    res.json(buildPageResult(items, total, page, pageSize));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/videos/:videoId — full video detail including the creator
 * summary, per-topic video summaries, transcript metadata, and
 * `_count` of chunks. Used by VideoDetailPage; 404 on miss.
 */
export async function getVideo(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
      include: {
        creator: true,
        sourceChannel: true,
        transcript: {
          select: {
            id: true,
            language: true,
            wordCount: true,
            sourceType: true,
          },
        },
        videoSummaries: { include: { topic: true } },
        _count: { select: { chunks: true } },
      },
    });
    if (!video) throw new NotFoundError("Video not found");
    res.json(video);
  } catch (err) {
    next(err);
  }
}
