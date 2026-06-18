import { prisma } from "../config/prisma";
import { parsePagination, buildPageResult } from "../utils/pagination";
import { parseDateParam } from "../utils/dates";
import { MIN_EVIDENCE_RELEVANCE } from "../utils/constants";
import type { StanceLabel, ConfidenceLabel, Prisma } from "@prisma/client";

export interface EvidenceFilters {
  creatorId?: string;
  topicId?: string;
  videoId?: string;
  stanceLabel?: StanceLabel;
  confidenceLabel?: ConfidenceLabel;
  search?: string;
  from?: string;
  to?: string;
  page?: number | string;
  pageSize?: number | string;
}

/**
 * listEvidence — paginated, filtered list of `ChunkTopicAnalysis`
 * rows for the Evidence Explorer page. Honors creator/topic/stance/
 * confidence/text-search/date filters; sorts by relevance score
 * descending so the highest-signal evidence shows up first.
 */
export async function listEvidence(filters: EvidenceFilters) {
  const { skip, take, page, pageSize } = parsePagination(filters, {
    pageSize: 20,
  });

  const where: Prisma.ChunkTopicAnalysisWhereInput = {
    relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE },
  };
  if (filters.creatorId) where.creatorId = filters.creatorId;
  if (filters.topicId) where.topicId = filters.topicId;
  if (filters.videoId) where.videoId = filters.videoId;
  if (filters.stanceLabel) where.stanceLabel = filters.stanceLabel;
  if (filters.confidenceLabel) where.confidenceLabel = filters.confidenceLabel;
  if (filters.search) {
    where.OR = [
      { evidenceQuote: { contains: filters.search, mode: "insensitive" } },
      { claimSummary: { contains: filters.search, mode: "insensitive" } },
      { rationale: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  const dateFrom = parseDateParam(filters.from);
  /* "end" → a date-only `to` is treated as inclusive through end-of-day UTC. */
  const dateTo = parseDateParam(filters.to, "end");
  if (dateFrom || dateTo) {
    where.video = {
      publishedAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    };
  }

  const [items, total] = await Promise.all([
    prisma.chunkTopicAnalysis.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, slug: true } },
        topic: { select: { id: true, name: true, slug: true } },
        video: {
          select: {
            id: true,
            title: true,
            sourceUrl: true,
            publishedAt: true,
            thumbnailUrl: true,
          },
        },
        chunk: {
          select: {
            id: true,
            chunkIndex: true,
            startSeconds: true,
            endSeconds: true,
          },
        },
      },
      orderBy: [{ confidenceScore: "desc" }, { relevanceScore: "desc" }],
      skip,
      take,
    }),
    prisma.chunkTopicAnalysis.count({ where }),
  ]);

  return buildPageResult(items, total, page, pageSize);
}

/**
 * getEvidenceDetail — assemble the provenance bundle for one analysis
 * row: the chunk itself, the previous + next chunks for context, full
 * creator/topic/video metadata, and related evidence from the same
 * (creator, topic). Used by the EvidenceDetail page.
 */
export async function getEvidenceDetail(analysisId: string) {
  const analysis = await prisma.chunkTopicAnalysis.findUnique({
    where: { id: analysisId },
    include: {
      creator: true,
      topic: true,
      video: true,
      chunk: true,
    },
  });
  if (!analysis) return null;

  /*
   * Fetch the genuinely adjacent context chunks by ORDERING, not by
   * `chunkIndex ± 1` arithmetic. Chunk indices are not guaranteed
   * contiguous: an oversized segment split (chunking.service H10) or a
   * re-chunk that dropped an empty window can leave gaps (…, 4, 6, 7, …),
   * and `chunkIndex - 1` would then silently miss the real neighbor (e.g.
   * index 4's previous is 6, not the non-existent 5). Instead we ask for
   * the highest-indexed chunk strictly BELOW the current one (previous) and
   * the lowest-indexed chunk strictly ABOVE it (next), so we always land on
   * whatever is actually next to it regardless of gaps.
   */
  const [previousChunk, nextChunk] = await Promise.all([
    prisma.transcriptChunk.findFirst({
      where: {
        videoId: analysis.videoId,
        chunkIndex: { lt: analysis.chunk.chunkIndex },
      },
      orderBy: { chunkIndex: "desc" },
    }),
    prisma.transcriptChunk.findFirst({
      where: {
        videoId: analysis.videoId,
        chunkIndex: { gt: analysis.chunk.chunkIndex },
      },
      orderBy: { chunkIndex: "asc" },
    }),
  ]);

  const relatedEvidence = await prisma.chunkTopicAnalysis.findMany({
    where: {
      /*
       * Same (creator, topic) — across ALL the creator's videos, per the
       * docstring contract — NOT `videoId`, which restricted "related" to the
       * current video and hid the creator's other evidence on this topic.
       */
      creatorId: analysis.creatorId,
      topicId: analysis.topicId,
      id: { not: analysis.id },
      relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE },
    },
    orderBy: { confidenceScore: "desc" },
    take: 5,
    include: { chunk: { select: { chunkIndex: true } } },
  });

  return {
    analysis,
    previousChunk,
    nextChunk,
    relatedEvidence,
  };
}
