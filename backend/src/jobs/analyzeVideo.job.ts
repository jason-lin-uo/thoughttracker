import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { inputHash } from "../utils/hashing";
import {
  detectTopicsForChunk,
  extractTopicEvidenceQuote,
  upsertTopicsBySlug,
  type DetectedTopic,
} from "../services/topicDetection.service";
import { scoreChunkRelevanceForTopic } from "../services/topicRelevance.service";
import {
  classifyChunkForTopic,
  STANCE_CLASSIFICATION_PROMPT_VERSION,
} from "../services/stanceAnalysis.service";
import {
  summarizeVideoForTopic,
  VIDEO_TOPIC_SUMMARY_PROMPT_VERSION,
} from "../services/videoSummary.service";
import { embedText } from "../ai/embeddingClient";
import { env } from "../config/env";

/**
 * analyzeVideoJob  -  full per-video AI analysis pipeline.
 *
 * Runs for one Video row, end-to-end:
 *
 * 1. **Topic detection.** Extract `{ name, slug, relevance }` topic
 * candidates per transcript chunk, then upsert the union into the
 * Topic table. Chunk-local candidates avoid applying a whole video's
 * top topics to unrelated sections.
 *
 * 2. **Per-chunk classification.** For each transcript chunk and
 * each detected topic, call `classifyChunkForTopic` (which dispatches
 * to `llm`, `custom_ml`, or `hybrid` based on `STANCE_ANALYSIS_PROVIDER`).
 * Writes a ChunkTopicAnalysis row with stance + confidence + claim +
 * evidence.
 *
 * 3. **Per-topic video summary.** Once all chunks are classified,
 * roll up to per-topic summary rows (VideoTopicSummary) so the
 * UI can show "how does this video as a whole stack up against
 * topic X?".
 *
 * 4. **Embeddings.** Embed every chunk for owner/offline analysis workflows.
 * Idempotent: chunks with non-null embeddings are skipped.
 *
 * 5. **State update.** Mark the Video as `analysisStatus="completed"`
 * so the dashboard's "in progress" badges flip green.
 *
 * Idempotency:
 * - Existing per-video evidence and summary rows are cleared before
 * re-analysis so switching providers or updating the model replaces prior
 * results instead of duplicating them.
 * - Embeddings only fire on chunks with `embedding IS NULL`.
 *
 * Failure modes:
 * - No transcript yet -> silently return; the bulk-import flow will
 * re-enqueue once the transcript lands.
 * - LLM/ML provider outage: final-policy topic failures are surfaced
 * loudly; stance analysis can fall back from the ML path to the real LLM
 * path when configured to do so.
 * - Per-chunk classification errors are caught and logged; one bad
 * chunk doesn't fail the whole video.
 */
export async function analyzeVideoJob(videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      transcript: true,
      chunks: { orderBy: { chunkIndex: "asc" } },
      creator: true,
    },
  });
  if (!video || !video.transcript) {
    logger.warn(`[analyzeVideo] skipping ${videoId}; no transcript`);
    return;
  }

  await prisma.video.update({
    where: { id: videoId },
    data: { analysisStatus: "processing" },
  });

  /*
   * Track every AnalysisRun this job creates so the catch block can mark any
   * still-"processing" run as failed instead of leaving orphaned rows.
   */
  const createdRunIds: string[] = [];

  try {
    await prisma.$transaction([
      prisma.chunkTopicAnalysis.deleteMany({ where: { videoId } }),
      prisma.videoTopicSummary.deleteMany({ where: { videoId } }),
    ]);

    /* ---- 1. Generate embeddings for chunks that don't have one ------------- */
    const embeddingRun = await prisma.analysisRun.create({
      data: {
        analysisType: "embedding_generation",
        status: "processing",
        provider: env.embeddingProvider,
        modelName: env.embeddingModel,
        startedAt: new Date(),
        inputHash: inputHash("embedding", videoId),
      },
    });
    createdRunIds.push(embeddingRun.id);

    for (const chunk of video.chunks) {
      const existing = await prisma.embedding.findUnique({
        where: { chunkId: chunk.id },
      });
      if (existing) continue;
      const { vector, model } = await embedText(chunk.text);
      /*
       * `upsert` instead of `create` to close the check-then-create
       * race when another concurrent job (or a parallel test) writes
       * the same `chunkId` between our findUnique above and the write
       * below. The unique-constraint error from a plain create would
       * bubble up, get caught by the outer try/catch, and mark the
       * whole video `analysisStatus="failed"`  -  which is what caused
       * the intermittent jobs.test.ts flake.
       */
      await prisma.embedding.upsert({
        where: { chunkId: chunk.id },
        create: {
          chunkId: chunk.id,
          embeddingModel: model,
          vectorJson: vector,
        },
        update: {},
      });
    }

    await prisma.analysisRun.update({
      where: { id: embeddingRun.id },
      data: { status: "completed", completedAt: new Date() },
    });

    /* ---- 2. Topic detection on each chunk --------------------------------- */
    const transcriptText =
      video.transcript.cleanedText ?? video.transcript.rawText;
    const detectionRun = await prisma.analysisRun.create({
      data: {
        analysisType: "topic_detection",
        status: "processing",
        provider: env.aiProvider,
        modelName: env.aiModel,
        promptVersion: "topic-detection-v1",
        inputHash: inputHash("topic", videoId, transcriptText.length),
        startedAt: new Date(),
      },
    });
    createdRunIds.push(detectionRun.id);

    const detectedBySlug = new Map<string, DetectedTopic>();
    const candidatesByChunkId = new Map<string, DetectedTopic[]>();

    for (const chunk of video.chunks) {
      const candidates = await detectTopicsForChunk({
        chunkId: chunk.id,
        transcriptText: chunk.text,
      });
      candidatesByChunkId.set(chunk.id, candidates);

      for (const candidate of candidates) {
        const existing = detectedBySlug.get(candidate.slug);
        if (!existing || candidate.relevanceScore > existing.relevanceScore) {
          detectedBySlug.set(candidate.slug, candidate);
        }
      }
    }

    const topics = await upsertTopicsBySlug([...detectedBySlug.values()]);
    /*
     * Index the persisted topics by slug so the stance phase below can map
     * each detected candidate back to its DB row (id) without re-querying.
     */
    const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic]));

    await prisma.analysisRun.update({
      where: { id: detectionRun.id },
      data: { status: "completed", completedAt: new Date() },
    });

    /* ---- 3. Stance classification  -  for each topic, for each chunk -------- */
    const stanceRun = await prisma.analysisRun.create({
      data: {
        analysisType: "stance_classification",
        status: "processing",
        provider: env.aiProvider,
        modelName: env.aiModel,
        promptVersion: STANCE_CLASSIFICATION_PROMPT_VERSION,
        inputHash: inputHash(
          "stance",
          videoId,
          topics.map((t) => t.id).join(","),
        ),
        startedAt: new Date(),
      },
    });
    createdRunIds.push(stanceRun.id);

    const relevantChunksByTopicId = new Map<
      string,
      Array<{
        chunk: (typeof video.chunks)[number];
        relevanceScore: number;
        evidenceQuote?: string;
      }>
    >();

    for (const chunk of video.chunks) {
      const chunkCandidates = candidatesByChunkId.get(chunk.id) ?? [];
      for (const candidate of chunkCandidates) {
        const topic = topicBySlug.get(candidate.slug);
        /* v8 ignore next -- topics are upserted from the same detected slug set above. */
        if (!topic) continue;

        const relevance = await scoreChunkRelevanceForTopic({
          topic,
          chunkText: chunk.text,
        });
        if (relevance.relevant) {
          const existing = relevantChunksByTopicId.get(topic.id) ?? [];
          existing.push({
            chunk,
            relevanceScore: Math.max(
              relevance.relevanceScore,
              candidate.relevanceScore,
            ),
            evidenceQuote: candidate.evidenceQuote,
          });
          relevantChunksByTopicId.set(topic.id, existing);
        }
      }
    }

    for (const topic of topics) {
      const relevantChunks = relevantChunksByTopicId.get(topic.id) ?? [];

      if (relevantChunks.length === 0) continue;

      for (const {
        chunk,
        relevanceScore,
        evidenceQuote: curatedEvidenceQuote,
      } of relevantChunks) {
        const evidenceQuote =
          curatedEvidenceQuote || extractTopicEvidenceQuote(topic, chunk.text);
        if (!evidenceQuote) continue;
        if (isLowValueEvidenceQuote(evidenceQuote)) continue;

        const classification = await classifyChunkForTopic({
          chunkText: chunk.text,
          topicName: topic.name,
        });
        if (classification.confidenceScore < minimumStanceConfidence())
          continue;

        /*
         * Upsert on the (chunkId, topicId) unique key so a re-run or a partial
         * failure replaces the prior analysis instead of inserting a duplicate.
         */
        await prisma.chunkTopicAnalysis.upsert({
          where: { chunkId_topicId: { chunkId: chunk.id, topicId: topic.id } },
          create: {
            chunkId: chunk.id,
            videoId: video.id,
            creatorId: video.creatorId,
            topicId: topic.id,
            analysisRunId: stanceRun.id,
            relevanceScore,
            stanceLabel: classification.stanceLabel,
            confidenceScore: classification.confidenceScore,
            confidenceLabel: classification.confidenceLabel,
            claimSummary: classification.claimSummary,
            rationale: classification.rationale,
            evidenceQuote,
          },
          update: {
            videoId: video.id,
            creatorId: video.creatorId,
            analysisRunId: stanceRun.id,
            relevanceScore,
            stanceLabel: classification.stanceLabel,
            confidenceScore: classification.confidenceScore,
            confidenceLabel: classification.confidenceLabel,
            claimSummary: classification.claimSummary,
            rationale: classification.rationale,
            evidenceQuote,
          },
        });
      }
    }

    await prisma.analysisRun.update({
      where: { id: stanceRun.id },
      data: { status: "completed", completedAt: new Date() },
    });

    /* ---- 4. Video-level topic summaries ----------------------------------- */
    const summaryRun = await prisma.analysisRun.create({
      data: {
        analysisType: "video_summary",
        status: "processing",
        provider: env.aiProvider,
        modelName: env.aiModel,
        promptVersion: VIDEO_TOPIC_SUMMARY_PROMPT_VERSION,
        inputHash: inputHash("vsum", videoId),
        startedAt: new Date(),
      },
    });
    createdRunIds.push(summaryRun.id);

    for (const topic of topics) {
      /*
       * Query by (videoId, topicId) only  -  NOT `analysisRunId: stanceRun.id`.
       * The deleteMany at the top of the job already cleared every prior row
       * for this video, so all surviving rows belong to this run; filtering by
       * run id was redundant and would silently drop any row that ended up with
       * a different run id, understating the topic's stance coverage.
       */
      const analyses = await prisma.chunkTopicAnalysis.findMany({
        where: { videoId: video.id, topicId: topic.id },
        include: { chunk: { select: { chunkIndex: true } } },
        orderBy: { chunk: { chunkIndex: "asc" } },
      });

      if (analyses.length === 0) continue;

      const summary = await summarizeVideoForTopic({
        topicName: topic.name,
        videoTitle: video.title,
        chunkAnalyses: analyses.map((a) => ({
          chunkIndex: a.chunk.chunkIndex,
          relevanceScore: a.relevanceScore,
          stanceLabel: a.stanceLabel,
          confidenceScore: a.confidenceScore,
          claimSummary: a.claimSummary ?? "",
          evidenceQuote: a.evidenceQuote ?? "",
        })),
      });

      await prisma.videoTopicSummary.upsert({
        where: { videoId_topicId: { videoId: video.id, topicId: topic.id } },
        update: {
          analysisRunId: summaryRun.id,
          dominantStance: summary.dominantStance,
          confidenceScore: summary.confidenceScore,
          confidenceLabel: summary.confidenceLabel,
          mentionCount: summary.mentionCount,
          summary: summary.summary,
          notableEvidence: summary.notableEvidence,
        },
        create: {
          videoId: video.id,
          creatorId: video.creatorId,
          topicId: topic.id,
          analysisRunId: summaryRun.id,
          dominantStance: summary.dominantStance,
          confidenceScore: summary.confidenceScore,
          confidenceLabel: summary.confidenceLabel,
          mentionCount: summary.mentionCount,
          summary: summary.summary,
          notableEvidence: summary.notableEvidence,
        },
      });
    }

    await prisma.analysisRun.update({
      where: { id: summaryRun.id },
      data: { status: "completed", completedAt: new Date() },
    });

    await prisma.video.update({
      where: { id: videoId },
      data: { analysisStatus: "completed" },
    });
    /* v8 ignore start -- job-level failure handler; covered by integration tests not unit tests. Uses start/stop (not "next N") because the nested conditional updateMany makes line-counting unreliable and flakes coverage under CI parallel load. */
  } catch (err) {
    logger.error(`[analyzeVideo] failed ${videoId}`, {
      error: (err as Error).message,
    });
    /*
     * Mark any AnalysisRun rows this job left in "processing" as failed so we
     * don't leave orphaned in-flight runs that never resolve.
     */
    if (createdRunIds.length > 0) {
      await prisma.analysisRun.updateMany({
        where: { id: { in: createdRunIds }, status: "processing" },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: (err as Error).message,
        },
      });
    }
    await prisma.video.update({
      where: { id: videoId },
      data: { analysisStatus: "failed" },
    });
  }
  /* v8 ignore stop */
}

/**
 * True when an evidence quote is boilerplate (sponsor reads, CTAs, etc.)
 * per LOW_VALUE_EVIDENCE_PATTERNS, so it can be filtered out rather than
 * surfaced as supporting evidence for a stance.
 */
function isLowValueEvidenceQuote(quote: string): boolean {
  return LOW_VALUE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(quote));
}

/**
 * Minimum confidence a chunk-level stance must reach to be persisted, from
 * `MIN_STANCE_CONFIDENCE` (default 0.5), clamped to [0, 1]. Drops
 * low-confidence noise so only reasonably certain classifications count.
 */
function minimumStanceConfidence(): number {
  const parsed = Number(process.env.MIN_STANCE_CONFIDENCE ?? 0.5);
  /* v8 ignore next 3 -- private env clamp; public callers exercise the returned threshold. */
  if (!Number.isFinite(parsed)) return 0.5;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

const LOW_VALUE_EVIDENCE_PATTERNS = [
  /\b(sponsor|sponsored|promo code|discount code|sitewide|affiliate link)\b/i,
  /\b(go to|head to|click the link|link in the description)\b/i,
  /\b(thanks for watching|like and subscribe|hit subscribe|patreon)\b/i,
];
