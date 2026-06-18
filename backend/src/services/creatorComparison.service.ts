import { prisma } from "../config/prisma";
import { monthKey } from "../utils/dates";
import { BadRequestError, NotFoundError } from "../utils/errors";
import { dominantStance, STANCE_SCORE } from "../utils/stance";
import { MIN_EVIDENCE_RELEVANCE } from "../utils/constants";
import type { StanceLabel } from "@prisma/client";

export interface CreatorCompareStats {
  creatorId: string;
  name: string;
  slug: string;
  thumbnailUrl: string | null;
  videoCount: number;
  transcriptCount: number;
  topicCount: number;
  evidenceCount: number;
}

export interface CreatorCompareTopicRow {
  topicId: string;
  name: string;
  slug: string;
  perCreator: Array<{
    creatorId: string;
    dominantStance: StanceLabel | "insufficient_evidence";
    mentionCount: number;
    videoCount: number;
  }>;
}

export interface CreatorCompareTimelinePoint {
  date: string;
  /** key = creatorId, value = mean stance score for the month (null = no data). */
  values: Record<string, number | null>;
}

export interface CreatorComparison {
  creators: CreatorCompareStats[];
  sharedTopics: CreatorCompareTopicRow[];
  timeline: {
    points: CreatorCompareTimelinePoint[];
  };
}

/**
 * Build a side-by-side comparison between 2-5 creators.
 *
 * Returns:
 * - per-creator stats (video/transcript/topic/evidence counts)
 * - shared topics: every topic where ≥2 of the input creators have a summary,
 * together with each creator's dominant stance + mention/video counts
 * - timeline: monthly average stance per creator (overlay-ready)
 *
 * Throws when fewer than 2 creators are passed (caller should reject earlier).
 */
export async function getCreatorComparison(
  creatorIdsOrSlugs: string[],
): Promise<CreatorComparison> {
  if (creatorIdsOrSlugs.length < 2) {
    throw new BadRequestError("creatorIds must include at least 2 ids");
  }
  if (creatorIdsOrSlugs.length > 5) {
    throw new BadRequestError("creatorIds must include at most 5 ids");
  }

  const found = await prisma.creator.findMany({
    where: {
      OR: [
        { id: { in: creatorIdsOrSlugs } },
        { slug: { in: creatorIdsOrSlugs } },
      ],
    },
  });

  /*
   * Preserve the caller's order so the UI lays out cards in the order they
   * were selected.
   */
  const byCreatorIdOrSlug = new Map<string, (typeof found)[number]>();
  for (const c of found) {
    byCreatorIdOrSlug.set(c.id, c);
    byCreatorIdOrSlug.set(c.slug, c);
  }

  /*
   * Validate that EVERY requested id/slug resolved to a creator. Previously an
   * unknown id silently produced a 200 with an empty payload (and a partial
   * unknown was silently dropped from the comparison), which masked a typo'd
   * deep-link as "these creators just share nothing". Surface a clear 404
   * listing the unresolved keys instead.
   */
  const unresolved = creatorIdsOrSlugs.filter((k) => !byCreatorIdOrSlug.has(k));
  if (unresolved.length > 0) {
    throw new NotFoundError(`Unknown creator(s): ${unresolved.join(", ")}`);
  }
  const orderedCreators = creatorIdsOrSlugs
    .map((k) => byCreatorIdOrSlug.get(k))
    .filter((c): c is (typeof found)[number] => Boolean(c));
  const seen = new Set<string>();
  /*
   * De-duplicate by creator id while preserving request order, so passing
   * the same creator twice (or once by id and once by slug) compares once.
   */
  const uniqueCreators = orderedCreators.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  /*
   * De-duplication can leave <2 DISTINCT creators even though ≥2 keys were
   * passed — e.g. the same creator supplied by both its id and its slug.
   * Comparing a creator with itself is meaningless, so reject with a clear 400
   * rather than rendering a degenerate one-column "comparison".
   */
  if (uniqueCreators.length < 2) {
    throw new BadRequestError(
      "Comparison needs at least 2 distinct creators (the request resolved to fewer — e.g. the same creator passed by both its id and its slug).",
    );
  }
  /* The de-duplicated id list drives all the aggregate queries below. */
  const creatorIds = uniqueCreators.map((c) => c.id);

  const [videoCounts, transcriptCounts, evidenceCounts, summaries] =
    await Promise.all([
      prisma.video.groupBy({
        by: ["creatorId"],
        where: { creatorId: { in: creatorIds } },
        _count: { _all: true },
      }),
      prisma.transcript.groupBy({
        by: ["videoId"],
        where: { video: { creatorId: { in: creatorIds } } },
      }),
      prisma.chunkTopicAnalysis.groupBy({
        by: ["creatorId"],
        where: {
          creatorId: { in: creatorIds },
          relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE },
        },
        _count: { _all: true },
      }),
      prisma.videoTopicSummary.findMany({
        where: { creatorId: { in: creatorIds } },
        include: {
          topic: { select: { id: true, name: true, slug: true } },
          video: { select: { publishedAt: true } },
        },
      }),
    ]);

  /* Transcript count is per-creator; collapse the videoId-keyed result. */
  const transcriptByCreator = new Map<string, number>();
  const videos = await prisma.video.findMany({
    where: { id: { in: transcriptCounts.map((t) => t.videoId) } },
    select: { id: true, creatorId: true },
  });
  /*
   * Map each videoId back to its creatorId so the per-video transcript
   * groupBy can be rolled up into a per-creator transcript count.
   */
  const videoCreator = new Map(videos.map((v) => [v.id, v.creatorId]));
  for (const t of transcriptCounts) {
    const creatorId = videoCreator.get(t.videoId);
    /* v8 ignore next -- transcript groupBy videoIds are fetched immediately above. */
    if (!creatorId) continue;
    transcriptByCreator.set(
      creatorId,
      (transcriptByCreator.get(creatorId) ?? 0) + 1,
    );
  }

  /* Per-topic per-creator aggregation. */
  type TopicAggregation = {
    name: string;
    slug: string;
    perCreator: Map<
      string,
      {
        stanceTally: Map<StanceLabel, number>;
        mentionCount: number;
        videoCount: number;
      }
    >;
  };
  const topicMap = new Map<string, TopicAggregation>();
  for (const s of summaries) {
    const t = topicMap.get(s.topicId) ?? {
      name: s.topic.name,
      slug: s.topic.slug,
      perCreator: new Map(),
    };
    const current = t.perCreator.get(s.creatorId) ?? {
      stanceTally: new Map<StanceLabel, number>(),
      mentionCount: 0,
      videoCount: 0,
    };
    current.stanceTally.set(
      s.dominantStance,
      (current.stanceTally.get(s.dominantStance) ?? 0) + 1,
    );
    current.mentionCount += s.mentionCount;
    current.videoCount += 1;
    t.perCreator.set(s.creatorId, current);
    topicMap.set(s.topicId, t);
  }

  const sharedTopics: CreatorCompareTopicRow[] = Array.from(topicMap.entries())
    .filter(([, t]) => t.perCreator.size >= 2)
    .map(([topicId, t]) => ({
      topicId,
      name: t.name,
      slug: t.slug,
      perCreator: creatorIds.map((creatorId) => {
        const current = t.perCreator.get(creatorId);
        if (!current) {
          return {
            creatorId,
            dominantStance: "insufficient_evidence" as const,
            mentionCount: 0,
            videoCount: 0,
          };
        }
        return {
          creatorId,
          dominantStance: dominantStance(current.stanceTally),
          mentionCount: current.mentionCount,
          videoCount: current.videoCount,
        };
      }),
    }))
    .sort(
      (a, b) =>
        b.perCreator.reduce((s, p) => s + p.mentionCount, 0) -
        a.perCreator.reduce((s, p) => s + p.mentionCount, 0),
    );

  /* Timeline overlay. */
  const monthBuckets = new Map<
    string,
    Map<string, { sum: number; count: number }>
  >();
  for (const s of summaries) {
    const date = s.video.publishedAt ?? s.createdAt;
    const key = monthKey(date);
    const score = STANCE_SCORE[s.dominantStance];
    if (score === null) continue;
    const month = monthBuckets.get(key) ?? new Map();
    const current = month.get(s.creatorId) ?? { sum: 0, count: 0 };
    current.sum += score;
    current.count += 1;
    month.set(s.creatorId, current);
    monthBuckets.set(key, month);
  }

  const timelinePoints: CreatorCompareTimelinePoint[] = Array.from(
    monthBuckets.entries(),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, perCreator]) => {
      const values: Record<string, number | null> = {};
      for (const creatorId of creatorIds) {
        const current = perCreator.get(creatorId);
        values[creatorId] =
          current && current.count > 0
            ? Math.round((current.sum / current.count) * 100) / 100
            : null;
      }
      return { date, values };
    });

  /*
   * Index the groupBy arrays + summaries once so the per-creator loop
   * below is O(C) instead of O(C * (V + E + S)) — the previous .find()
   * and .filter() inside .map() ran a linear scan per creator.
   */
  const videoCountByCreator = new Map(
    videoCounts.map((v) => [v.creatorId, v._count._all]),
  );
  const evidenceCountByCreator = new Map(
    evidenceCounts.map((e) => [e.creatorId, e._count._all]),
  );
  const topicSetByCreator = new Map<string, Set<string>>();
  for (const s of summaries) {
    const set = topicSetByCreator.get(s.creatorId) ?? new Set<string>();
    set.add(s.topicId);
    topicSetByCreator.set(s.creatorId, set);
  }

  /* Build per-creator stats list in caller order. */
  const creators: CreatorCompareStats[] = uniqueCreators.map((c) => ({
    creatorId: c.id,
    name: c.name,
    slug: c.slug,
    thumbnailUrl: c.thumbnailUrl,
    videoCount: videoCountByCreator.get(c.id) ?? 0,
    transcriptCount: transcriptByCreator.get(c.id) ?? 0,
    topicCount: topicSetByCreator.get(c.id)?.size ?? 0,
    evidenceCount: evidenceCountByCreator.get(c.id) ?? 0,
  }));

  return {
    creators,
    sharedTopics,
    timeline: { points: timelinePoints },
  };
}
