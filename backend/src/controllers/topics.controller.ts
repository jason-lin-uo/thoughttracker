import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { BadRequestError } from "../utils/errors";
import { slugify } from "../utils/slugify";

const CreateTopicSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});

/**
 * GET /api/topics — returns every topic in the taxonomy, sorted
 * alphabetically. Each row carries `_count.videoSummaries` and
 * `_count.chunkAnalyses` so the UI can show how heavily a topic is
 * represented across the corpus without firing a second query per row.
 */
export async function listTopics(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const topics = await prisma.topic.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { videoSummaries: true, chunkAnalyses: true } },
      },
      /*
       * The controlled taxonomy is ~100 topics, but user-created topics are
       * unbounded; cap the listing so the response can't grow without limit.
       */
      take: TOPICS_TAKE_CAP,
    });
    res.json({ items: topics });
  } catch (err) {
    next(err);
  }
}

/** Max topics returned in one listing (bounds the response). */
const TOPICS_TAKE_CAP = 500;

/**
 * POST /api/topics — creates (or upserts by slug) a user-defined topic.
 *
 * Validation: Zod schema requires `name` ≥ 2 chars; description is
 * optional. On invalid input we throw `BadRequestError` with the
 * flattened Zod errors so the client can surface field-level
 * validation messages.
 *
 * Idempotency: the upsert keys on `slug` (derived from `name`) so
 * resubmitting the same name doesn't create duplicates — it refreshes
 * the description instead. The created/updated topic's `source` is
 * marked `user_created` to distinguish from taxonomy-seeded topics.
 */
export async function createTopic(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = CreateTopicSchema.safeParse(req.body);
    if (!parsed.success)
      throw new BadRequestError("Invalid topic", parsed.error.flatten());
    const slug = slugify(parsed.data.name);
    const topic = await prisma.topic.upsert({
      where: { slug },
      update: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      },
      create: {
        name: parsed.data.name,
        slug,
        description: parsed.data.description ?? null,
        source: "user_created",
      },
    });
    res.status(201).json(topic);
  } catch (err) {
    next(err);
  }
}
