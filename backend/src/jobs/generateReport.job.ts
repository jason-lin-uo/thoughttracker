import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { inputHash } from "../utils/hashing";
import { env } from "../config/env";
import { MIN_EVIDENCE_RELEVANCE } from "../utils/constants";
import {
  cleanReportQuote,
  isUsableQuote,
  selectReportQuotes,
} from "../utils/reportText";
import { topicKeywords } from "../services/topicTaxonomy";
import { jobRunner } from "./jobRunner";
import { clearPublicReadCache } from "../middleware/publicReadCache";
import {
  generateCreatorReport,
  generateTopicReport,
  CREATOR_REPORT_PROMPT_VERSION,
  TOPIC_REPORT_PROMPT_VERSION,
} from "../services/reportGeneration.service";

/**
 * Background job that generates and persists a creator-level summary report.
 *
 * Loads the creator's per-topic timelines and the per-topic video counts,
 * records a processing `AnalysisRun`, calls generateCreatorReport, then
 * saves the result as a `creator_summary` Report and marks the run
 * completed. Returns the saved report id, or null when the creator is
 * missing or generation throws (the run is marked failed in that case).
 *
 * This synchronous variant remains the single source of truth for the
 * actual generation work; the async HTTP path (enqueueCreatorReportJob
 * below) layers a pre-created run + jobRunner on top of it so the request
 * can return a 202 + poll handle instead of holding the connection open
 * for the (potentially slow real-LLM) generation.
 *
 * When `existingRunId` is supplied the caller has already created the
 * processing `AnalysisRun` row (so it could hand the id back to the client
 * to poll); we reuse it rather than creating a second run. Otherwise we
 * create one ourselves, preserving the original inline behavior.
 */
export async function generateCreatorReportJob(
  creatorId: string,
  existingRunId?: string,
): Promise<string | null> {
  const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) {
    /*
     * The async path pre-creates a run before validation can re-check the
     * creator; mark that orphan failed so it never lingers in "processing".
     */
    if (existingRunId) await markRunFailed(existingRunId, "Creator not found");
    return null;
  }

  const timelines = await prisma.creatorTopicTimeline.findMany({
    where: { creatorId },
    include: { topic: true },
  });

  const topicVideoCounts = await prisma.videoTopicSummary.groupBy({
    by: ["topicId"],
    where: { creatorId },
    _count: { _all: true },
  });
  const countByTopic = new Map<string, number>();
  for (const t of topicVideoCounts) countByTopic.set(t.topicId, t._count._all);

  /*
   * Per-topic stance distribution, so the report can call out WHERE the creator
   * is actually opinionated (a high supportive/opposed share) vs. where they
   * stay neutral — turning the creator report from a topic list into "here's
   * what they have strong takes on, and where they don't".
   */
  const stanceRows = await prisma.videoTopicSummary.groupBy({
    by: ["topicId", "dominantStance"],
    where: { creatorId },
    _count: { _all: true },
  });
  const stanceByTopic = new Map<string, Map<string, number>>();
  for (const row of stanceRows) {
    const m = stanceByTopic.get(row.topicId) ?? new Map<string, number>();
    m.set(row.dominantStance, row._count._all);
    stanceByTopic.set(row.topicId, m);
  }
  /** Modal stance + the supportive/opposed ("opinionated") share for a topic. */
  function topicStance(topicId: string): {
    dominantStance: string;
    opinionatedShare: number;
  } {
    const m = stanceByTopic.get(topicId);
    if (!m || m.size === 0)
      return { dominantStance: "insufficient_evidence", opinionatedShare: 0 };
    let total = 0;
    let best = "insufficient_evidence";
    let bestN = -1;
    let opinionated = 0;
    for (const [stance, n] of m) {
      total += n;
      if (n > bestN) {
        bestN = n;
        best = stance;
      }
      if (stance === "supportive" || stance === "opposed") opinionated += n;
    }
    return {
      dominantStance: best,
      opinionatedShare: total ? opinionated / total : 0,
    };
  }

  /* Reuse the caller-created run (async path) or create one (inline path). */
  const run = existingRunId
    ? { id: existingRunId }
    : await prisma.analysisRun.create({
        data: {
          analysisType: "creator_report",
          status: "processing",
          provider: env.aiProvider,
          modelName: env.aiModel,
          promptVersion: CREATOR_REPORT_PROMPT_VERSION,
          inputHash: inputHash("creator_report", creatorId, timelines.length),
          startedAt: new Date(),
        },
      });

  try {
    const report = await generateCreatorReport({
      creatorName: creator.name,
      topics: timelines.map((t) => {
        const { dominantStance, opinionatedShare } = topicStance(t.topicId);
        return {
          topicName: t.topic.name,
          trendLabel: t.trendLabel,
          timelineSummary: t.summary ?? "",
          videoCount: countByTopic.get(t.topicId) ?? 0,
          dominantStance,
          opinionatedShare,
        };
      }),
    });

    const saved = await prisma.report.create({
      data: {
        creatorId,
        reportType: "creator_summary",
        title: report.title,
        summary: report.summary,
        caveats: report.caveats,
        evidence: { sections: report.sections, evidence: report.evidence },
        analysisRunId: run.id,
      },
    });

    await prisma.analysisRun.update({
      where: { id: run.id },
      data: { status: "completed", completedAt: new Date() },
    });
    clearPublicReadCache();
    return saved.id;
  } catch (err) {
    logger.error("[generateCreatorReport] failed", {
      error: (err as Error).message,
    });
    await markRunFailed(run.id, (err as Error).message);
    return null;
  }
}

/**
 * Background job that generates and persists a single creator+topic report.
 *
 * Fetches the creator, topic, the topic's per-video summaries (oldest
 * first), and the timeline in parallel; records a processing `AnalysisRun`;
 * calls generateTopicReport; then saves a `topic_summary` Report and marks
 * the run completed. Returns the saved report id, or null when the creator
 * or topic is missing or generation throws (run marked failed).
 *
 * Like the creator variant, `existingRunId` lets the async HTTP path reuse
 * a run it already created (and handed to the client) instead of creating a
 * second one. See enqueueTopicReportJob below.
 */
export async function generateTopicReportJob(
  creatorId: string,
  topicId: string,
  existingRunId?: string,
): Promise<string | null> {
  const [creator, topic, summaries, timeline] = await Promise.all([
    prisma.creator.findUnique({ where: { id: creatorId } }),
    prisma.topic.findUnique({ where: { id: topicId } }),
    prisma.videoTopicSummary.findMany({
      where: { creatorId, topicId },
      include: { video: true },
      orderBy: { video: { publishedAt: "asc" } },
    }),
    prisma.creatorTopicTimeline.findUnique({
      where: { creatorId_topicId: { creatorId, topicId } },
    }),
  ]);
  if (!creator || !topic) {
    if (existingRunId)
      await markRunFailed(existingRunId, "Creator or topic not found");
    return null;
  }

  /*
   * Representative verbatim quotes for this (creator, topic), highest-signal
   * first. These are what turn the report from an aggregate label-recap into a
   * grounded "here's what they actually said" digest — the report generator
   * weaves them in, so even a low-movement topic reads as substantive.
   */
  const evidence = await prisma.chunkTopicAnalysis.findMany({
    where: {
      creatorId,
      topicId,
      relevanceScore: { gte: MIN_EVIDENCE_RELEVANCE },
      evidenceQuote: { not: null },
    },
    include: { video: { select: { title: true, publishedAt: true } } },
    orderBy: [{ confidenceScore: "desc" }, { relevanceScore: "desc" }],
    /*
     * Over-fetch a wide candidate pool: cleaning drops fragments AND the
     * stratified selector below needs enough of EACH stance present to give the
     * minority view a fair shot, not just the top-confidence (dominant-skewed) rows.
     */
    take: 120,
  });

  /*
   * Clean each quote (decode entities, strip caption markers/ellipses) and drop
   * fragments, so the report quotes the creator in legible, substantial lines
   * rather than garbled mid-caption snippets. Confidence order is preserved.
   */
  const usableQuotes = evidence
    .map((e) => ({
      quote: cleanReportQuote(e.evidenceQuote ?? ""),
      stance: e.stanceLabel,
      videoId: e.videoId,
      videoTitle: e.video.title,
      publishedAt: e.video.publishedAt?.toISOString(),
      /* Stable evidence-row id so an inline citation can resolve back to this exact row. */
      analysisId: e.id,
    }))
    .filter((q) => isUsableQuote(q.quote));

  /*
   * Balance the set across stances so a mostly-one-sided topic still surfaces its
   * critical/mixed minority — that contrast is what lets the report read as an
   * analysis with tension rather than a one-sided recap. Lead with the stance the
   * headline asserts (the modal per-video stance) and score quotes for topical
   * relevance so off-topic / mis-tagged lines lose to on-topic ones.
   */
  const stanceCounts = new Map<string, number>();
  for (const s of summaries)
    stanceCounts.set(
      s.dominantStance,
      (stanceCounts.get(s.dominantStance) ?? 0) + 1,
    );
  const dominantStance = [...stanceCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const cleanedQuotes = selectReportQuotes(usableQuotes, {
    limit: 14,
    dominantStance,
    topicKeywords: topicKeywords(topic.slug, topic.name),
  });

  const run = existingRunId
    ? { id: existingRunId }
    : await prisma.analysisRun.create({
        data: {
          analysisType: "topic_report",
          status: "processing",
          provider: env.aiProvider,
          modelName: env.aiModel,
          promptVersion: TOPIC_REPORT_PROMPT_VERSION,
          inputHash: inputHash(
            "topic_report",
            creatorId,
            topicId,
            summaries.length,
          ),
          startedAt: new Date(),
        },
      });

  try {
    const report = await generateTopicReport({
      creatorName: creator.name,
      topicName: topic.name,
      timelineSummary: timeline?.summary ?? undefined,
      trendLabel: timeline?.trendLabel,
      summaries: summaries.map((s) => ({
        videoId: s.videoId,
        videoTitle: s.video.title,
        publishedAt: s.video.publishedAt?.toISOString(),
        dominantStance: s.dominantStance,
        summary: s.summary ?? "",
      })),
      quotes: cleanedQuotes,
    });

    const saved = await prisma.report.create({
      data: {
        creatorId,
        topicId,
        reportType: "topic_summary",
        title: report.title,
        summary: report.summary,
        caveats: report.caveats,
        evidence: { sections: report.sections, evidence: report.evidence },
        analysisRunId: run.id,
      },
    });

    await prisma.analysisRun.update({
      where: { id: run.id },
      data: { status: "completed", completedAt: new Date() },
    });
    clearPublicReadCache();
    return saved.id;
  } catch (err) {
    logger.error("[generateTopicReport] failed", {
      error: (err as Error).message,
    });
    await markRunFailed(run.id, (err as Error).message);
    return null;
  }
}

/**
 * markRunFailed — flip an AnalysisRun to `failed` with a completedAt + error
 * message. Centralized so every failure/early-exit path (including the async
 * path's orphaned pre-created run) resolves the run instead of leaving it
 * stuck in "processing" — the poll endpoint would otherwise never terminate.
 */
async function markRunFailed(
  runId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: { status: "failed", completedAt: new Date(), errorMessage },
  });
}

/**
 * enqueueCreatorReportJob — the ASYNC entry point used by the HTTP layer
 * (audit H15).
 *
 * Report generation can take seconds when a real LLM provider is configured;
 * running it inline holds the request socket open AND blocks the serial job
 * queue. Instead we:
 * 1. create the processing `AnalysisRun` row synchronously, so the
 * controller has a real id to hand back for polling;
 * 2. enqueue the heavy generation on the shared jobRunner (which executes
 * it serially, off the request path), passing the pre-created run id so
 * no second run is created;
 * 3. return the run id immediately so the controller can 202 + poll handle.
 *
 * The creator's existence is NOT pre-validated here (the controller already
 * resolved id-or-slug to a concrete creator id), but the job re-checks and
 * marks the run failed if it has since vanished. Returns the AnalysisRun id.
 */
export async function enqueueCreatorReportJob(
  creatorId: string,
): Promise<string> {
  const run = await prisma.analysisRun.create({
    data: {
      analysisType: "creator_report",
      status: "processing",
      provider: env.aiProvider,
      modelName: env.aiModel,
      promptVersion: CREATOR_REPORT_PROMPT_VERSION,
      inputHash: inputHash("creator_report", creatorId),
      startedAt: new Date(),
    },
  });
  jobRunner.enqueue(`generateCreatorReport:${creatorId}`, async () => {
    await generateCreatorReportJob(creatorId, run.id);
  });
  return run.id;
}

/**
 * enqueueTopicReportJob — async entry point for creator+topic report
 * generation (audit H15). Same shape as enqueueCreatorReportJob: pre-create
 * the run for a pollable id, enqueue the heavy generation with that run id,
 * and return the id immediately so the controller can 202.
 */
export async function enqueueTopicReportJob(
  creatorId: string,
  topicId: string,
): Promise<string> {
  const run = await prisma.analysisRun.create({
    data: {
      analysisType: "topic_report",
      status: "processing",
      provider: env.aiProvider,
      modelName: env.aiModel,
      promptVersion: TOPIC_REPORT_PROMPT_VERSION,
      inputHash: inputHash("topic_report", creatorId, topicId),
      startedAt: new Date(),
    },
  });
  jobRunner.enqueue(`generateTopicReport:${creatorId}:${topicId}`, async () => {
    await generateTopicReportJob(creatorId, topicId, run.id);
  });
  return run.id;
}
