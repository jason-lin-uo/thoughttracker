import type { Request, Response, NextFunction } from "express";
import { listEvidence, getEvidenceDetail } from "../services/evidence.service";
import { $Enums } from "@prisma/client";
import { NotFoundError } from "../utils/errors";
import { parseEnumParam } from "../utils/enums";

/**
 * GET /api/evidence — paginated, filtered list of classified chunks.
 *
 * Filters: creator, topic, video, stance label, confidence label,
 * text search, ISO date range, page + pageSize for pagination.
 * Delegates to `listEvidence` in the service layer for the actual
 * query construction; this controller is just the query-param parser.
 *
 * Powers the Evidence Explorer page; sorted by relevance score so the
 * highest-signal chunks appear first.
 */
export async function listEvidenceController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const q = req.query;
    const result = await listEvidence({
      creatorId: typeof q.creatorId === "string" ? q.creatorId : undefined,
      topicId: typeof q.topicId === "string" ? q.topicId : undefined,
      videoId: typeof q.videoId === "string" ? q.videoId : undefined,
      /* Validate against the enum so a bogus value is a 400, not a 500. */
      stanceLabel: parseEnumParam(
        typeof q.stanceLabel === "string" ? q.stanceLabel : undefined,
        $Enums.StanceLabel,
        "stanceLabel",
      ),
      confidenceLabel: parseEnumParam(
        typeof q.confidenceLabel === "string" ? q.confidenceLabel : undefined,
        $Enums.ConfidenceLabel,
        "confidenceLabel",
      ),
      search: typeof q.search === "string" ? q.search : undefined,
      from: typeof q.from === "string" ? q.from : undefined,
      to: typeof q.to === "string" ? q.to : undefined,
      page: typeof q.page === "string" ? q.page : undefined,
      pageSize: typeof q.pageSize === "string" ? q.pageSize : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/evidence/:analysisId — full provenance bundle for one
 * classified chunk: the chunk itself, its previous + next chunk for
 * context, full creator/topic/video metadata, and related evidence
 * from the same (creator, topic). 404 if the id doesn't resolve.
 *
 * This endpoint exists because the strongest objection to AI stance
 * classifiers is "did the AI invent this citation?" — surrounding the
 * main chunk with its neighbors proves the quote is real text from a
 * real transcript at a real timestamp.
 */
export async function getEvidenceDetailController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const detail = await getEvidenceDetail(req.params.analysisId);
    if (!detail) throw new NotFoundError("Evidence not found");
    res.json(detail);
  } catch (err) {
    next(err);
  }
}
