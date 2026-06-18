import type { Request, Response, NextFunction } from "express";
import {
  getStanceOverTime,
  getTopicFrequency,
} from "../services/chartData.service";
import { BadRequestError } from "../utils/errors";

/**
 * GET /api/charts/stance-over-time?creatorId=&topicId= — month-bucketed
 * mean stance score for one creator (and optionally one topic).
 *
 * Returns `{ points: StanceOverTimePoint[] }` where each point carries
 * `{ date: "YYYY-MM", averageStance: -1..1 | null, count }`. Drives the
 * single-creator StanceOverTimeChart and (when topicId is omitted)
 * the timeline panel on Creator Overview.
 *
 * Required: `creatorId`. Without it we throw `BadRequestError` rather
 * than returning empty — the chart isn't meaningful without a creator
 * filter.
 */
export async function stanceOverTime(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const creatorId =
      typeof req.query.creatorId === "string" ? req.query.creatorId : undefined;
    const topicId =
      typeof req.query.topicId === "string" ? req.query.topicId : undefined;
    if (!creatorId) throw new BadRequestError("creatorId is required");
    const points = await getStanceOverTime({ creatorId, topicId });
    res.json({ points });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/charts/topic-frequency?creatorId= — month-bucketed mention
 * counts per topic for one creator. Returns `{ points, topics }` where
 * `points[].topics[name]` is the mention count and `topics[]` is the
 * legend dictionary. Drives the stacked-bar TopicFrequencyChart on the
 * Topic Analysis page.
 */
export async function topicFrequency(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const creatorId =
      typeof req.query.creatorId === "string" ? req.query.creatorId : undefined;
    if (!creatorId) throw new BadRequestError("creatorId is required");
    const data = await getTopicFrequency({ creatorId });
    res.json(data);
  } catch (err) {
    next(err);
  }
}
