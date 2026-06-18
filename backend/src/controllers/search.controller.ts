import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { BadRequestError } from "../utils/errors";
import { MIN_EVIDENCE_RELEVANCE } from "../utils/constants";

/**
 * GET /api/search?q= — keyword (LIKE) search across creators, videos,
 * topics, and evidence chunks. Returns the top 10 hits in each category
 * in a single payload so a global search bar can render unified results
 * without four separate round-trips.
 *
 * This is plain ILIKE matching against names, titles, descriptions, and
 * evidence quotes.
 *
 * Required: `q`. Empty/missing throws `BadRequestError` rather than
 * dumping an unfiltered list.
 */
export async function searchAll(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) throw new BadRequestError("q is required");

    const [creators, videos, topics, evidence] = await Promise.all([
      prisma.creator.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 10,
        select: { id: true, name: true, slug: true, thumbnailUrl: true },
      }),
      prisma.video.findMany({
        where: {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 10,
        select: {
          id: true,
          title: true,
          thumbnailUrl: true,
          publishedAt: true,
          creator: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.topic.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 10,
        select: { id: true, name: true, slug: true },
      }),
      prisma.chunkTopicAnalysis.findMany({
        where: {
          OR: [
            { evidenceQuote: { contains: q, mode: "insensitive" } },
            { claimSummary: { contains: q, mode: "insensitive" } },
          ],
          relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE },
        },
        take: 10,
        include: {
          topic: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, name: true, slug: true } },
          video: { select: { id: true, title: true } },
        },
        orderBy: { confidenceScore: "desc" },
      }),
    ]);

    res.json({ q, creators, videos, topics, evidence });
  } catch (err) {
    next(err);
  }
}
