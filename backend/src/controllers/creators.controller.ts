import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { NotFoundError } from "../utils/errors";
import { getCreatorComparison } from "../services/creatorComparison.service";
import { dominantStance } from "../utils/stance";
import { MIN_EVIDENCE_RELEVANCE } from "../utils/constants";

/**
 * GET /api/creators — list creators, optionally filtered by a `search`
 * query that matches name / slug / description (case-insensitive).
 *
 * For each creator it also returns video, transcript, and distinct-topic
 * counts plus the most recent import time. The transcript/topic counts are
 * computed with two batched aggregate queries (keyed by creatorId) rather
 * than per-creator queries, deliberately collapsing a former N+1.
 */
export async function listCreators(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const creators = await prisma.creator.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      include: {
        sourceChannels: { select: { lastImportedAt: true } },
        _count: {
          select: {
            videos: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    /*
     * Two DB-side aggregate queries up front instead of N per creator, and —
     * unlike the prior version — without materializing every transcript/summary
     * row in Node. `video.groupBy` counts videos-with-a-transcript per creator
     * (1:1 video↔transcript) so it equals the transcript count, and the topic
     * count comes from a distinct (creatorId, topicId) summary scan.
     */
    const creatorIds = creators.map((c) => c.id);
    const [transcriptGroups, topicRows] = await Promise.all([
      prisma.video.groupBy({
        by: ["creatorId"],
        where: { creatorId: { in: creatorIds }, transcript: { isNot: null } },
        _count: { _all: true },
      }),
      prisma.videoTopicSummary.findMany({
        where: { creatorId: { in: creatorIds } },
        select: { creatorId: true, topicId: true },
        distinct: ["creatorId", "topicId"],
      }),
    ]);

    const transcriptCountByCreator = new Map<string, number>();
    for (const g of transcriptGroups) {
      transcriptCountByCreator.set(g.creatorId, g._count._all);
    }
    const topicCountByCreator = new Map<string, number>();
    for (const row of topicRows) {
      topicCountByCreator.set(
        row.creatorId,
        (topicCountByCreator.get(row.creatorId) ?? 0) + 1,
      );
    }

    /*
     * Shape each creator into the list-item DTO, joining in the batched
     * counts and reducing source channels to the single latest import time.
     */
    const items = creators.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      thumbnailUrl: c.thumbnailUrl,
      videoCount: c._count.videos,
      transcriptCount: transcriptCountByCreator.get(c.id) ?? 0,
      topicCount: topicCountByCreator.get(c.id) ?? 0,
      lastImportedAt:
        c.sourceChannels
          .map((s) => s.lastImportedAt)
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      createdAt: c.createdAt,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/creators/:creatorId — fetch a single creator (resolvable by
 * either id or slug, so URLs can be human-readable) with its source
 * channels. 404 if neither id nor slug matches.
 */
export async function getCreator(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ id: req.params.creatorId }, { slug: req.params.creatorId }],
      },
      include: {
        sourceChannels: true,
      },
    });
    if (!creator) throw new NotFoundError("Creator not found");
    res.json(creator);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/creators/:creatorId/overview — assemble the creator detail
 * dashboard payload.
 *
 * Resolves the creator by id or slug (404 if absent), then runs the stat
 * queries in parallel (video/transcript counts, all topic summaries, the 6
 * most recent videos, the latest creator-summary report, and the latest
 * import job). Returns headline stats (including a relevance-gated evidence
 * count), the aggregated top topics, recent videos, and the latest
 * report/import for the page header.
 */
export async function getCreatorOverview(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ id: req.params.creatorId }, { slug: req.params.creatorId }],
      },
      include: { sourceChannels: true },
    });
    if (!creator) throw new NotFoundError("Creator not found");

    const [
      videoCount,
      transcriptCount,
      topicSummaries,
      recentVideos,
      latestReport,
      recentImport,
      evidenceCount,
    ] = await Promise.all([
      prisma.video.count({ where: { creatorId: creator.id } }),
      prisma.transcript.count({ where: { video: { creatorId: creator.id } } }),
      prisma.videoTopicSummary.findMany({
        where: { creatorId: creator.id },
        include: { topic: true },
      }),
      prisma.video.findMany({
        where: { creatorId: creator.id },
        orderBy: { publishedAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          thumbnailUrl: true,
          publishedAt: true,
          transcriptStatus: true,
          analysisStatus: true,
          durationSeconds: true,
          sourceUrl: true,
        },
      }),
      prisma.report.findFirst({
        where: { creatorId: creator.id, reportType: "creator_summary" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.importJob.findFirst({
        where: { creatorId: creator.id },
        orderBy: { createdAt: "desc" },
      }),
      /*
       * Count evidence in parallel with the queries above (one batched
       * round-trip) instead of as a separate sequential query afterward.
       */
      prisma.chunkTopicAnalysis.count({
        where: {
          creatorId: creator.id,
          relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE },
        },
      }),
    ]);

    const topTopics = aggregateTopTopics(topicSummaries);
    /*
     * Distinct topics this creator has covered — counted from the FULL summary
     * set, NOT `topTopics.length` (aggregateTopTopics caps its output at 8 for
     * the display cards, so the stat under-reported for prolific creators and
     * disagreed with the count shown elsewhere).
     */
    const topicCount = new Set(topicSummaries.map((s) => s.topicId)).size;

    res.json({
      creator,
      stats: {
        videoCount,
        transcriptCount,
        topicCount,
        evidenceCount,
      },
      topTopics,
      recentVideos,
      latestReport,
      recentImport,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Roll per-video topic summaries up into per-topic cards for the overview.
 *
 * Groups summaries by topicId, summing video and mention counts and
 * tallying each video's dominant stance. Returns ALL the creator's topics
 * ordered by video count (then mention count) — NOT a top-N slice; the
 * overview shows the creator's full topic coverage — each annotated with its
 * overall dominant stance (most frequent in the tally, "insufficient_evidence"
 * when empty).
 */
function aggregateTopTopics(
  summaries: Array<{
    topicId: string;
    topic: { id: string; name: string; slug: string };
    mentionCount: number;
    dominantStance: string;
  }>,
) {
  const map = new Map<
    string,
    {
      topicId: string;
      name: string;
      slug: string;
      videoCount: number;
      mentionCount: number;
      stanceTally: Record<string, number>;
    }
  >();

  for (const s of summaries) {
    const cur = map.get(s.topicId) ?? {
      topicId: s.topicId,
      name: s.topic.name,
      slug: s.topic.slug,
      videoCount: 0,
      mentionCount: 0,
      stanceTally: {},
    };
    cur.videoCount += 1;
    cur.mentionCount += s.mentionCount;
    cur.stanceTally[s.dominantStance] =
      (cur.stanceTally[s.dominantStance] ?? 0) + 1;
    map.set(s.topicId, cur);
  }

  return Array.from(map.values())
    .sort(
      (a, b) => b.videoCount - a.videoCount || b.mentionCount - a.mentionCount,
    )
    .map((t) => ({
      ...t,
      dominantStance:
        Object.entries(t.stanceTally).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        "insufficient_evidence",
    }));
}

/**
 * GET /api/creators/:creatorId/topics — list every topic the creator
 * discusses, aggregated across their videos.
 *
 * Groups the per-video topic summaries by topic, accumulating video count,
 * mention count, a stance tally, and the first/last published dates that
 * bound the topic's coverage. Returns the topics ordered by video count,
 * each with its dominant stance (resolved via the shared dominantStance
 * helper).
 */
export async function getCreatorTopics(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    /*
     * Resolve id-or-slug (other creator endpoints accept either; this one used
     * to filter by creatorId only, so slug URLs silently returned []).
     */
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ id: req.params.creatorId }, { slug: req.params.creatorId }],
      },
      select: { id: true },
    });
    if (!creator) throw new NotFoundError("Creator not found");

    const summaries = await prisma.videoTopicSummary.findMany({
      where: { creatorId: creator.id },
      include: { topic: true, video: { select: { publishedAt: true } } },
    });

    const map = new Map<
      string,
      {
        topicId: string;
        name: string;
        slug: string;
        videoCount: number;
        mentionCount: number;
        stanceTally: Record<string, number>;
        firstPublishedAt: Date | null;
        lastPublishedAt: Date | null;
      }
    >();
    for (const s of summaries) {
      const cur = map.get(s.topicId) ?? {
        topicId: s.topicId,
        name: s.topic.name,
        slug: s.topic.slug,
        videoCount: 0,
        mentionCount: 0,
        stanceTally: {},
        firstPublishedAt: null,
        lastPublishedAt: null,
      };
      cur.videoCount += 1;
      cur.mentionCount += s.mentionCount;
      cur.stanceTally[s.dominantStance] =
        (cur.stanceTally[s.dominantStance] ?? 0) + 1;
      const pub = s.video.publishedAt;
      if (pub) {
        if (!cur.firstPublishedAt || pub < cur.firstPublishedAt)
          cur.firstPublishedAt = pub;
        if (!cur.lastPublishedAt || pub > cur.lastPublishedAt)
          cur.lastPublishedAt = pub;
      }
      map.set(s.topicId, cur);
    }

    const items = Array.from(map.values())
      .sort((a, b) => b.videoCount - a.videoCount)
      .map((t) => ({ ...t, dominantStance: dominantStance(t.stanceTally) }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * Compare 2-5 creators side-by-side. Expects `creatorIds=c1,c2[,c3...]` query.
 */
export async function compareCreators(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const raw =
      typeof req.query.creatorIds === "string" ? req.query.creatorIds : "";
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await getCreatorComparison(ids);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
