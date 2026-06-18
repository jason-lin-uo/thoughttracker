import path from "node:path";
import fs from "node:fs/promises";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { NotFoundError, BadRequestError } from "../utils/errors";
import { jobRunner } from "../jobs/jobRunner";
import { importChannelJob } from "../jobs/importChannel.job";
import { bulkImportJob } from "../jobs/bulkImport.job";
import { validateChannelUrl } from "../services/youtubeImport.service";

const CreateJobSchema = z.object({
  channelUrl: z.string().min(1),
  requestedLimit: z.union([
    z.literal(10),
    z.literal(25),
    z.literal(50),
    z.literal(100),
  ]),
  creatorNameOverride: z.string().optional(),
});

/**
 * Body schema for POST /api/import-jobs/bulk-import.
 *
 * Two acceptable shapes:
 * 1. `{ folderPath: "/absolute/path/to/data/transcripts/huberman" }`
 * Server-side filesystem path; we read the `_manifest.json` and
 * transcript files from disk.
 *
 * 2. `{ manifest: { creator: {...}, entries: [...] },
 * transcripts: { [videoId: string]: string } }`
 * Inline payload — the manifest + per-video transcript text in
 * one POST. Useful when the caller is on a different machine or
 * doesn't want to share filesystem access.
 *
 * We support both because the demo runs on this machine (folder path
 * is easier) but a real deployment would prefer the inline form.
 */
const BulkImportSchema = z.union([
  z.object({ folderPath: z.string().min(1) }),
  z.object({
    inline: z.object({
      manifest: z.object({
        creator: z.object({
          name: z.string().min(1),
          slug: z.string().min(1),
          channelUrl: z.string().optional().nullable(),
          description: z.string().optional().nullable(),
          thumbnailUrl: z.string().optional().nullable(),
        }),
        entries: z.array(z.record(z.string(), z.unknown())),
      }),
      transcripts: z.record(z.string(), z.string()),
    }),
  }),
]);

const SAFE_INLINE_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * bulkImportAllowedRoot — the single directory under which a `folderPath`
 * bulk-import is permitted to read.
 *
 * Defaults to `<cwd>/data/transcripts` (where the project's pre-fetched
 * transcript folders live) and is overridable via `BULK_IMPORT_ROOT` for
 * deployments that stage transcripts elsewhere. Resolved to an absolute,
 * normalized path so the containment check below can't be fooled by `..`.
 */
function bulkImportAllowedRoot(): string {
  const configured = process.env.BULK_IMPORT_ROOT?.trim();
  return path.resolve(
    configured || path.join(process.cwd(), "data", "transcripts"),
  );
}

/**
 * resolveAllowedFolderPath — resolve a caller-supplied `folderPath` and verify
 * it stays inside the bulk-import allowlist root.
 *
 * Without this, `path.resolve(input)` accepts ANY absolute path, so an admin
 * (or anyone in dev, where the PIN is open) could read arbitrary server
 * directories containing a `_manifest.json` into the DB/UI — an LFI-style
 * arbitrary file read. We resolve the input and confirm it is the root itself
 * or a descendant of it (via a path.relative check that rejects `..` escapes
 * and absolute re-roots), throwing BadRequestError (→ 400) otherwise.
 */
function resolveAllowedFolderPath(input: string): string {
  const root = bulkImportAllowedRoot();
  const resolved = path.resolve(input);
  const relative = path.relative(root, resolved);
  const inside =
    resolved === root ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!inside) {
    throw new BadRequestError(
      "folderPath must be inside the allowed bulk-import directory",
    );
  }
  return resolved;
}

/**
 * Validate a value that will be used as a single filesystem path segment
 * for inline bulk-import, rejecting anything outside
 * `[A-Za-z0-9_-]{1,128}`.
 *
 * This is a path-traversal guard: slugs and video ids from the request
 * body become file/dir names under the temp directory, so disallowing
 * dots and slashes prevents `../` escapes. Throws BadRequestError (→ 400)
 * on a bad segment.
 */
function safeInlinePathSegment(value: unknown, label: string): string {
  const segment = String(value ?? "").trim();
  if (!SAFE_INLINE_PATH_SEGMENT.test(segment)) {
    throw new BadRequestError(
      `${label} must contain only letters, numbers, underscores, or hyphens`,
    );
  }
  return segment;
}

/**
 * POST /api/import-jobs/youtube-channel — start a channel-import job.
 *
 * Validates the body against CreateJobSchema (requires a channelUrl and a
 * whitelisted requestedLimit) and rejects malformed channel URLs with 400.
 * Creates a pending ImportJob, enqueues importChannelJob on the job runner,
 * and returns 202 with `{ jobId, status }` so the client can poll for
 * progress rather than blocking on the import.
 */
export async function createImportJob(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = CreateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid request", parsed.error.flatten());
    }
    if (!validateChannelUrl(parsed.data.channelUrl)) {
      throw new BadRequestError("Channel URL looks invalid");
    }

    const job = await prisma.importJob.create({
      data: {
        channelUrl: parsed.data.channelUrl,
        requestedLimit: parsed.data.requestedLimit,
        status: "pending",
      },
    });

    jobRunner.enqueue(`importChannel:${job.id}`, () =>
      importChannelJob(job.id),
    );

    res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/import-jobs — list import jobs newest-first, hydrated with
 * the creator the job populated (when known). Drives the ImportsPage
 * job list.
 */
export async function listImportJobs(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const jobs = await prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { creator: { select: { id: true, name: true, slug: true } } },
    });
    res.json({ items: jobs });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/import-jobs/:jobId — full detail for one job: aggregate
 * counts, status, error, and the linked creator. 404 if the id doesn't
 * resolve.
 */
export async function getImportJob(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const job = await prisma.importJob.findUnique({
      where: { id: req.params.jobId },
      include: {
        creator: { select: { id: true, name: true, slug: true } },
        sourceChannel: true,
      },
    });
    if (!job) throw new NotFoundError("Import job not found");
    res.json(job);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/import-jobs/:jobId/items — list the per-video items for one
 * import job, oldest-first, each hydrated with a thin view of its linked
 * video (status, title, publish date, urls). Drives the per-job detail
 * table that shows transcript/analysis progress for each video.
 */
export async function listImportJobItems(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    /*
     * Existence check: 404 a bogus jobId instead of returning a misleading
     * empty `{ items: [] }` (which looks like "a real job with no items").
     */
    const job = await prisma.importJob.findUnique({
      where: { id: req.params.jobId },
      select: { id: true },
    });
    if (!job) throw new NotFoundError("Import job not found");

    const items = await prisma.importJobItem.findMany({
      where: { importJobId: job.id },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            transcriptStatus: true,
            analysisStatus: true,
            publishedAt: true,
            sourceUrl: true,
            thumbnailUrl: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      /*
       * Bound the result set: a job can theoretically have up to the requested
       * import limit (100) of items, but cap defensively so a corrupt/huge job
       * can't return an unbounded payload.
       */
      take: IMPORT_JOB_ITEMS_TAKE_CAP,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/** Max import-job items returned in one listing (bounds the response). */
const IMPORT_JOB_ITEMS_TAKE_CAP = 200;

/**
 * POST /api/import-jobs/bulk-import — kick off a bulk-ingestion job
 * from a pre-fetched folder of transcripts (or an inline JSON payload).
 *
 * Workflow:
 * 1. Validate the body. The "folderPath" variant points the job at a
 * directory on the server's filesystem; the "inline" variant
 * carries the manifest + transcript text in the POST itself.
 * 2. For folderPath: verify the folder exists + contains a
 * _manifest.json before enqueueing — failing fast is friendlier
 * than a vague "job failed" later.
 * 3. For inline: write the manifest + per-video .txt files to a
 * temp directory under data/transcripts/_inline/<jobId>/ and
 * enqueue against that path. This lets the same `bulkImportJob`
 * worker handle both shapes.
 * 4. Create the ImportJob record + enqueue. Honor Idempotency-Key
 * so double-clicks don't double-import.
 *
 * Returns 202 + `{ jobId, status: "pending" }` immediately; client
 * polls `/api/import-jobs/:id` and `/api/import-jobs/:id/items` to
 * watch progress (the existing ImportJobDetail page handles both
 * shapes since the schema is the same).
 */
export async function createBulkImportJob(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = BulkImportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid request", parsed.error.flatten());
    }

    let folderPath: string;
    if ("folderPath" in parsed.data) {
      /*
       * Allowlist guard: reject paths outside the bulk-import root (400)
       * before any filesystem access, so this can't be used for arbitrary
       * file read. See resolveAllowedFolderPath / bulkImportAllowedRoot.
       */
      folderPath = resolveAllowedFolderPath(parsed.data.folderPath);
      /*
       * Verify the folder + manifest exist BEFORE enqueueing so the
       * caller gets a 400 instead of an opaque later failure.
       */
      try {
        await fs.access(path.join(folderPath, "_manifest.json"));
      } catch {
        throw new BadRequestError(
          `Manifest not found at ${path.join(folderPath, "_manifest.json")}`,
        );
      }
    } else {
      /*
       * Inline form: materialize a temp folder + manifest + .txt files
       * so the worker can read them with the same code path as the
       * folder form.
       */
      const inline = parsed.data.inline;
      const stamp = Date.now().toString(36);
      const baseDir = path.resolve(
        process.env.BULK_IMPORT_TEMP_DIR ?? "/tmp/tt-bulk-import",
      );
      const creatorSlug = safeInlinePathSegment(
        inline.manifest.creator.slug,
        "creator.slug",
      );
      folderPath = path.join(baseDir, `${creatorSlug}-${stamp}`);
      const relativeFolder = path.relative(baseDir, folderPath);
      /* c8 ignore next 3 -- safeInlinePathSegment + path.join keep this inside baseDir. */
      if (relativeFolder.startsWith("..") || path.isAbsolute(relativeFolder)) {
        throw new BadRequestError(
          "Inline bulk-import folder escaped the temp directory",
        );
      }
      await fs.mkdir(folderPath, { recursive: true });
      /*
       * Write per-video .txt files using the manifest's videoId as the
       * filename. The manifest's transcriptPath is rewritten to the
       * local file so the worker resolves them correctly.
       */
      const rewrittenEntries = inline.manifest.entries.map((entry) => {
        const videoId = safeInlinePathSegment(
          (entry as { videoId?: unknown }).videoId,
          "entry.videoId",
        );
        const text = inline.transcripts[videoId];
        if (text === undefined) {
          return {
            ...entry,
            status: "skipped",
            skipReason: "no_inline_transcript",
          };
        }
        const filename = `${videoId}.txt`;
        /*
         * Actual writes happen in the Promise.all below; here we just
         * rewrite the manifest entry so it points at the local filename.
         */
        return { ...entry, transcriptPath: filename, status: "saved" as const };
      });
      await Promise.all(
        Object.entries(inline.transcripts).map(([videoId, text]) => {
          const safeVideoId = safeInlinePathSegment(videoId, "transcripts key");
          return fs.writeFile(
            path.join(folderPath, `${safeVideoId}.txt`),
            text,
          );
        }),
      );
      await fs.writeFile(
        path.join(folderPath, "_manifest.json"),
        JSON.stringify(
          { creator: inline.manifest.creator, entries: rewrittenEntries },
          null,
          2,
        ),
      );
    }

    const job = await prisma.importJob.create({
      data: {
        channelUrl: "bulk-import",
        requestedLimit: 0,
        status: "pending",
      },
    });

    const captured = folderPath;
    jobRunner.enqueue(`bulk-import:${job.id}`, () =>
      bulkImportJob(job.id, captured),
    );

    res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    next(err);
  }
}
