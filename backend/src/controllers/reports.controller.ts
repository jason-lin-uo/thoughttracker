import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { NotFoundError, BadRequestError } from "../utils/errors";
import {
  enqueueCreatorReportJob,
  enqueueTopicReportJob,
} from "../jobs/generateReport.job";
import { $Enums, Prisma } from "@prisma/client";
import { parseEnumParam } from "../utils/enums";
import { parsePagination, buildPageResult } from "../utils/pagination";
import { resetReportsToStarter } from "../services/starterReport.service";

/**
 * Allowed sort options for the reports list → their Prisma `orderBy`. Kept as a
 * server-side allowlist (not a client-supplied field) so an unknown `sort`
 * harmlessly falls back to newest-first rather than erroring or injecting an
 * arbitrary order. Server-side because the list is paginated — a client sort
 * would only reorder the current page.
 */
const REPORT_SORTS: Record<string, Prisma.ReportOrderByWithRelationInput> = {
  date_desc: { createdAt: "desc" },
  date_asc: { createdAt: "asc" },
  title_asc: { title: "asc" },
  title_desc: { title: "desc" },
};
const DEFAULT_REPORT_SORT = "date_desc";

/**
 * Body schema for POST /api/reports/bulk-delete. Either delete a specific,
 * non-empty set of report ids (covers single + multi-select) OR every report
 * (`{ all: true }`, the "delete all" affordance). The two-shape union forces
 * the caller to be explicit — there is no "delete nothing" or accidental
 * "delete everything" from an empty/omitted body.
 */
const BulkDeleteReportsSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1)).min(1) }),
]);

/**
 * GET /api/reports — paginated list of generated reports filtered by creator,
 * topic, and/or report type. Drives the ReportsPage.
 *
 * Sortable via the `sort` query param against a server-side allowlist
 * (date_desc [default], date_asc, title_asc, title_desc); an unknown value
 * falls back to date_desc. Sorting is server-side BECAUSE the list is
 * paginated — a client-side sort would only reorder the current page.
 *
 * Paginated (skip/take + a parallel count → `{ items, page, totalPages, total }`)
 * like the videos/evidence lists, so a large report set (one per creator+topic
 * is possible) is fully browsable instead of silently capped — the old `take:
 * 50` hid everything past the 50th report.
 */
export async function listReports(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const q = req.query;
    const where: Record<string, unknown> = {};
    if (typeof q.creatorId === "string") where.creatorId = q.creatorId;
    if (typeof q.topicId === "string") where.topicId = q.topicId;
    /* Validate reportType against the enum so a bogus value is a 400, not 500. */
    const reportType = parseEnumParam(
      typeof q.reportType === "string" ? q.reportType : undefined,
      $Enums.ReportType,
      "reportType",
    );
    if (reportType) where.reportType = reportType;

    const sortKey =
      typeof q.sort === "string" && q.sort in REPORT_SORTS
        ? q.sort
        : DEFAULT_REPORT_SORT;
    const { skip, take, page, pageSize } = parsePagination(q, { pageSize: 12 });
    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: REPORT_SORTS[sortKey],
        skip,
        take,
        include: {
          creator: { select: { id: true, name: true, slug: true } },
          topic: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.report.count({ where }),
    ]);
    res.json(buildPageResult(reports, total, page, pageSize));
  } catch (err) {
    next(err);
  }
}

/** A report's citation, plus the deep-link ids we resolve for the frontend. */
interface ReportCitation {
  analysisId?: string;
  videoTitle?: string;
  topic?: string;
  note?: string;
  videoId?: string | null;
  topicId?: string | null;
}
interface ReportEvidenceJson {
  sections?: Array<{ heading: string; body?: string; bullets?: string[] }>;
  evidence?: ReportCitation[];
}

/**
 * resolveCitations — turn each report citation into a deep-link target so the
 * UI can link a source to its page: a topic report's `videoTitle` → the video
 * id (matched within the creator), a creator report's `topic` → the topic id.
 * Best-effort and non-mutating — unmatched citations get a null id and render
 * as plain text. Two batched reads (videos + topics) avoid an N+1.
 */
async function resolveCitations(
  evidence: ReportEvidenceJson | null,
  creatorId: string,
): Promise<ReportEvidenceJson | null> {
  const cites = evidence?.evidence;
  if (!cites?.length) return evidence;
  const analysisIds = cites
    .map((c) => c.analysisId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const needVideos =
    cites.some((c) => c.videoTitle || c.videoId) || analysisIds.length > 0;
  const needTopics = cites.some((c) => c.topic);
  const [videos, topics, analyses] = await Promise.all([
    needVideos
      ? prisma.video.findMany({
          where: { creatorId },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    needTopics
      ? prisma.topic.findMany({ select: { id: true, name: true } })
      : Promise.resolve([]),
    analysisIds.length > 0
      ? prisma.chunkTopicAnalysis.findMany({
          where: { id: { in: analysisIds }, creatorId },
          select: { id: true, video: { select: { id: true, title: true } } },
        })
      : Promise.resolve([]),
  ]);
  const videoByTitle = new Map(videos.map((v) => [v.title, v.id]));
  const videoById = new Map(videos.map((v) => [v.id, v.title]));
  const topicByName = new Map(topics.map((t) => [t.name, t.id]));
  const analysisById = new Map(analyses.map((a) => [a.id, a.video]));
  const resolved = cites.map((c) => {
    const analysisVideo = c.analysisId
      ? analysisById.get(c.analysisId)
      : undefined;
    const videoId =
      c.videoId ??
      analysisVideo?.id ??
      (c.videoTitle ? videoByTitle.get(c.videoTitle) : undefined);
    const videoTitle =
      c.videoTitle ??
      analysisVideo?.title ??
      (videoId ? videoById.get(videoId) : undefined);
    return {
      ...c,
      ...(videoId ? { videoId } : c.videoTitle ? { videoId: null } : {}),
      ...(videoTitle ? { videoTitle } : {}),
      ...(c.topic ? { topicId: topicByName.get(c.topic) ?? null } : {}),
    };
  });
  return { ...evidence, evidence: resolved };
}

/**
 * GET /api/reports/:reportId — fetch a single report by id, hydrated
 * with its `creator` and `topic` (if topic-scoped) for the byline, and with
 * each citation resolved to a deep-link target (video / topic id).
 * 404 if the id doesn't resolve.
 */
export async function getReport(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const report = await prisma.report.findUnique({
      where: { id: req.params.reportId },
      include: {
        creator: true,
        topic: true,
      },
    });
    if (!report) throw new NotFoundError("Report not found");
    const evidence = await resolveCitations(
      report.evidence as ReportEvidenceJson | null,
      report.creatorId,
    );
    res.json({ ...report, evidence });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/reports/bulk-delete — delete reports by id-set or all of them.
 *
 * Admin-gated (a destructive mutation). Accepts `{ ids: string[] }` (single or
 * multi-select) or `{ all: true }` (delete every report). Uses `deleteMany` so
 * an id that no longer exists is simply not counted rather than erroring, and
 * returns `{ deleted }` so the client can report how many were removed.
 */
export async function bulkDeleteReports(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = BulkDeleteReportsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        "Provide { all: true } or a non-empty ids array",
        parsed.error.flatten(),
      );
    }
    const where = "all" in parsed.data ? {} : { id: { in: parsed.data.ids } };
    const result = await prisma.report.deleteMany({ where });
    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/reports/reset-starter clears all generated reports and restores
 * the clean saved-report state used by fresh local and hosted installs.
 * Admin-gated and deterministic, so it does not call an LLM or spend API tokens.
 */
export async function resetReportsToStarterController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await resetReportsToStarter();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/reports/creator/:creatorId/generate - ASYNCHRONOUSLY generate a
 * creator-summary report (audit H15).
 *
 * Resolves the creator by id-or-slug (404 if unknown), then ENQUEUES the
 * generation on the shared jobRunner and returns 202 + `{ analysisRunId }`
 * immediately. A real-LLM generation can take seconds; running it inline
 * held the request socket open and blocked the serial job queue. The client
 * polls GET /api/analysis-runs/:analysisRunId (status processing to completed
 * /failed) and then GET /api/reports?creatorId=... for the finished report,
 * the same async+poll contract the analyzeVideo path already uses.
 */
export async function generateCreatorReportController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    /* Accept id-or-slug like the other creator endpoints. */
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ id: req.params.creatorId }, { slug: req.params.creatorId }],
      },
    });
    if (!creator) throw new NotFoundError("Creator not found");
    const analysisRunId = await enqueueCreatorReportJob(creator.id);
    res.status(202).json({ status: "queued", analysisRunId });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/reports/creator/:creatorId/topic/:topicId/generate —
 * ASYNCHRONOUSLY generate a creator+topic report (audit H15).
 *
 * Resolves BOTH the creator and the topic by id-or-slug (404 if either is
 * unknown — previously this endpoint resolved by id only, so a slug deep-link
 * 404'd on refresh), enqueues the generation, and returns 202 +
 * `{ analysisRunId }`. Same poll contract as the creator-report endpoint.
 */
export async function generateCreatorTopicReportController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    /*
     * Resolve id-or-slug for both creator and topic so deep-links / refreshes
     * using human-readable slugs don't 404 (consistent with the analysis and
     * creator-report endpoints).
     */
    const [creator, topic] = await Promise.all([
      prisma.creator.findFirst({
        where: {
          OR: [{ id: req.params.creatorId }, { slug: req.params.creatorId }],
        },
        select: { id: true },
      }),
      prisma.topic.findFirst({
        where: {
          OR: [{ id: req.params.topicId }, { slug: req.params.topicId }],
        },
        select: { id: true },
      }),
    ]);
    if (!creator) throw new NotFoundError("Creator not found");
    if (!topic) throw new NotFoundError("Topic not found");
    const analysisRunId = await enqueueTopicReportJob(creator.id, topic.id);
    res.status(202).json({ status: "queued", analysisRunId });
  } catch (err) {
    next(err);
  }
}
