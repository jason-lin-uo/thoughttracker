/**
 * bulkImport.job — ingest a folder of pre-fetched YouTube transcripts.
 *
 * Why this exists
 * ---------------
 * The standard `importChannelJob` pulls metadata + transcripts from the
 * YouTube Data API + caption endpoint in one pass. That works in
 * production but has two problems for our portfolio demo:
 *
 * 1. The YouTube Data API needs a key (rate-limited, billable).
 * 2. YouTube's anonymous caption endpoint started requiring a "PO
 * token" in late 2024 (yt-dlp issue #12482), so we have to use
 * `youtube-transcript-api` instead — and that library lives in
 * Python, not the Node backend.
 *
 * The pragmatic path: a Python script (`thoughttracker-ml/scripts/
 * fetch_transcripts.py`) does the fetching, writes a manifest + .txt
 * files under `data/transcripts/<creator>/`, and we point THIS job at
 * the resulting folder. The job becomes a thin "read filesystem,
 * persist to DB, enqueue analysis" loop.
 *
 * Manifest schema
 * ---------------
 * The manifest is a JSON file at `<folder>/_manifest.json` with shape:
 *
 * {
 * "creator": { "name", "slug", "channelUrl"?, "description"?,
 * "thumbnailUrl"? },
 * "entries": [
 * { "videoId", "title", "publishedAt", "durationSeconds",
 * "sourceUrl", "thumbnailUrl"?, "transcriptPath",
 * "status": "saved" | "skipped" | "failed",
 * "skipReason"? }
 * ]
 * }
 *
 * Only entries with `status === "saved"` are imported; skipped /
 * failed entries are surfaced as `ImportJobItem` rows with the
 * matching status so the UI can show what was filtered out.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import {
  cleanTranscriptText,
  countWords,
} from "../services/transcript.service";
import { chunkTranscript } from "../services/chunking.service";
import { slugify } from "../utils/slugify";
import { jobRunner } from "./jobRunner";
import { analyzeVideoJob } from "./analyzeVideo.job";
import { analyzeCreatorJob } from "./analyzeCreator.job";

/**
 * Zod schema for the per-creator `_manifest.json` written by the Python fetch
 * script. Previously the manifest was `JSON.parse`d and cast straight to the
 * `BulkImportManifest` interface with NO runtime validation, so a malformed
 * manifest (missing `entries`, a non-string `status`, a number where a string
 * was expected) surfaced as an opaque crash deep inside the per-entry loop
 * rather than a clear "this manifest is invalid" failure. Validating up front
 * fails the job loudly with a precise message and guarantees the typed shape
 * the loop relies on.
 *
 * Kept deliberately lenient on OPTIONAL metadata (nullable/optional) so older
 * or partial manifests still parse — only the fields the import actually
 * depends on are required. `status` is constrained to the three values the
 * loop branches on; unknown extra keys are stripped (default Zod behavior).
 */
const BulkImportEntrySchema = z.object({
  videoId: z.string(),
  title: z.string(),
  publishedAt: z.string().nullable().optional().default(null),
  durationSeconds: z.number().nullable().optional().default(null),
  sourceUrl: z.string(),
  thumbnailUrl: z.string().nullable().optional(),
  /*
   * Relative to the manifest's parent (`data/`); nullable when there is no
   * transcript file (skipped/failed entries).
   */
  transcriptPath: z.string().nullable().optional().default(null),
  status: z.enum(["saved", "skipped", "failed"]),
  skipReason: z.string().nullable().optional(),
});

const BulkImportManifestSchema = z.object({
  creator: z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    channelUrl: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
  }),
  entries: z.array(BulkImportEntrySchema),
  writtenAt: z.string().optional(),
});

/**
 * Shape of one entry in the per-creator `_manifest.json` (inferred from the
 * Zod schema so the runtime check and the static type can never drift).
 */
export type BulkImportEntry = z.infer<typeof BulkImportEntrySchema>;
export type BulkImportManifest = z.infer<typeof BulkImportManifestSchema>;

/**
 * Stream-read a transcript .txt file. The fetch script writes a header
 * block at the top (title + URL on lines 1-2, then a blank line) — we
 * skip those so the transcript body starts cleanly.
 */
async function readTranscriptBody(absPath: string): Promise<string> {
  const raw = await fs.readFile(absPath, "utf-8");
  /* Drop leading "# title" / "# url" / blank lines. */
  const lines = raw.split("\n");
  let start = 0;
  while (
    start < lines.length &&
    (lines[start].startsWith("#") || lines[start].trim() === "")
  ) {
    start += 1;
    /*
     * Stop after a maximum of 5 header lines so we don't accidentally
     * eat an entire short transcript that begins with "#" by coincidence.
     */
    if (start >= 5) break;
  }
  return lines.slice(start).join("\n").trim();
}

/**
 * Resolve a manifest's `transcriptPath` against the folder we were told to
 * ingest, robust to NESTED layouts and safe against path traversal.
 *
 * `transcriptPath` is written relative to the `data/` directory the Python
 * script ran from, so it can be either a bare filename (`abc1.txt`) or a
 * nested path (`transcripts/<creator>/abc1.txt`). The previous implementation
 * used `path.basename` only — it threw away any subdirectories, so two videos
 * living in different sub-folders but sharing a filename collided, and a
 * genuinely nested folder layout couldn't be ingested at all.
 *
 * Resolution strategy (first existing candidate wins):
 * 1. The relative path joined onto the ingest folder, AS-IS, preserving any
 * nesting (`<folder>/transcripts/<creator>/abc1.txt`).
 * 2. The bare filename directly inside the folder (`<folder>/abc1.txt`) —
 * the common case when the caller already pointed at the per-creator
 * folder, kept for back-compat.
 *
 * EVERY candidate is confined to `folderAbsolutePath`: we resolve it and
 * reject anything whose `path.relative(folder, candidate)` escapes via `..`
 * or re-roots to an absolute path. A manifest is semi-trusted (it can be the
 * inline form a user POSTed), so a `transcriptPath` of `../../etc/passwd`
 * must NOT read outside the contained ingest folder. When no candidate exists
 * we fall back to (2) so the caller surfaces a clean "file missing" error
 * (handled as `transcript_unavailable`) rather than silently reading elsewhere.
 *
 * Synchronous `existsSync` is fine here: this runs in the import job, not a
 * request handler, and only touches a handful of files per video.
 */
function resolveTranscriptPath(
  folderAbsolutePath: string,
  manifestRelPath: string,
): string {
  const root = path.resolve(folderAbsolutePath);

  /* True only when `candidate` is the root itself or a descendant of it. */
  const isContained = (candidate: string): boolean => {
    const rel = path.relative(root, candidate);
    return (
      candidate === root || (!rel.startsWith("..") && !path.isAbsolute(rel))
    );
  };

  const candidates = [
    /* 1. As-is, preserving nesting. `path.resolve` normalizes any `..`. */
    path.resolve(root, manifestRelPath),
    /* 2. Bare filename inside the folder (legacy / flat layout). */
    path.resolve(root, path.basename(manifestRelPath)),
  ];

  for (const candidate of candidates) {
    if (isContained(candidate) && existsSync(candidate)) return candidate;
  }

  /*
   * Nothing exists yet (or every candidate escaped the root): return the
   * contained flat-layout path so the caller's read fails as "unavailable"
   * instead of touching anything outside the ingest folder.
   */
  return path.resolve(root, path.basename(manifestRelPath));
}

/**
 * Ingest a folder of pre-fetched transcripts.
 *
 * Steps:
 * 1. Read + Zod-validate `<folder>/_manifest.json`.
 * 2. Upsert the Creator + SourceChannel.
 * 3. For each `status === "saved"` entry: upsert Video, read the
 * .txt, persist Transcript + chunks, mark
 * ImportJobItem.status = "transcript_imported".
 * For each `status === "skipped" | "failed"` entry: create an
 * ImportJobItem row with the matching status + skipReason so the
 * UI can show what was filtered out.
 * 4. Enqueue per-video analysis jobs + a creator-wide finalization job.
 * 5. ONLY THEN mark the ImportJob terminal (completed / completed_with_errors)
 * — so a "completed" status always means analysis was also scheduled.
 *
 * Errors at the per-video level are recorded on the ImportJobItem and
 * counted in `totalFailed`, but never abort the whole job — partial
 * imports are useful.
 */
export async function bulkImportJob(
  jobId: string,
  folderAbsolutePath: string,
): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "processing", startedAt: new Date() },
  });

  try {
    /* ---- 1. Read manifest ------------------------------------------------- */
    const manifestPath = path.join(folderAbsolutePath, "_manifest.json");
    let parsedJson: unknown;
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `bulk_import_manifest_unreadable: ${manifestPath} — ${(err as Error).message}`,
      );
    }

    /*
     * Runtime-validate the manifest with Zod (was an untyped cast). A missing
     * creator block surfaces as the historical `missing_creator` message (the
     * controller + tests assert on it); any other schema problem becomes a
     * precise, aggregated `manifest_invalid` error instead of a deep crash.
     */
    const validated = BulkImportManifestSchema.safeParse(parsedJson);
    if (!validated.success) {
      const missingCreator = validated.error.issues.some(
        (issue) => issue.path[0] === "creator",
      );
      if (missingCreator)
        throw new Error("bulk_import_manifest_missing_creator");
      throw new Error(
        `bulk_import_manifest_invalid: ${JSON.stringify(validated.error.flatten().fieldErrors)}`,
      );
    }
    const manifest: BulkImportManifest = validated.data;

    /* ---- 2. Upsert Creator + SourceChannel -------------------------------- */
    const creator = await prisma.creator.upsert({
      where: { slug: manifest.creator.slug },
      update: {
        name: manifest.creator.name,
        description: manifest.creator.description ?? null,
        thumbnailUrl: manifest.creator.thumbnailUrl ?? null,
      },
      create: {
        name: manifest.creator.name,
        slug: manifest.creator.slug,
        description: manifest.creator.description ?? null,
        thumbnailUrl: manifest.creator.thumbnailUrl ?? null,
        creatorType: "youtube_channel",
      },
    });

    let sourceChannel = null;
    if (manifest.creator.channelUrl) {
      /*
       * Use a deterministic slug-backed channel id for manifest imports where
       * the transcript snapshot does not include YouTube's internal channel id.
       */
      const channelId = `slug:${manifest.creator.slug}`;
      sourceChannel = await prisma.sourceChannel.upsert({
        where: { platform_channelId: { platform: "youtube", channelId } },
        update: {
          title: manifest.creator.name,
          handle: manifest.creator.slug,
          lastImportedAt: new Date(),
        },
        create: {
          creatorId: creator.id,
          platform: "youtube",
          channelUrl: manifest.creator.channelUrl,
          channelId,
          handle: manifest.creator.slug,
          title: manifest.creator.name,
          description: manifest.creator.description ?? null,
          thumbnailUrl: manifest.creator.thumbnailUrl ?? null,
          lastImportedAt: new Date(),
        },
      });
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        creatorId: creator.id,
        sourceChannelId: sourceChannel?.id ?? null,
        totalVideosFound: manifest.entries.length,
      },
    });

    /* ---- 3. Per entry ----------------------------------------------------- */
    let imported = 0;
    let transcripts = 0;
    let skipped = 0;
    let failed = 0;
    /*
     * Videos re-listed from disk that were already analyzed and so were left
     * untouched (no re-chunk, no re-analysis) — the incremental-refresh path.
     */
    let unchanged = 0;
    const videoIdsToAnalyze: string[] = [];

    for (const entry of manifest.entries) {
      const item = await prisma.importJobItem.create({
        data: {
          importJobId: jobId,
          sourceVideoId: entry.videoId,
          sourceUrl: entry.sourceUrl,
          title: entry.title,
          publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null,
          status: "pending",
          errorMessage: entry.skipReason ?? null,
        },
      });

      if (entry.status !== "saved" || !entry.transcriptPath) {
        /* Skipped / failed entries get a single row to surface in the UI. */
        await prisma.importJobItem.update({
          where: { id: item.id },
          data: {
            status:
              entry.status === "failed" ? "failed" : "transcript_unavailable",
            transcriptStatus:
              entry.status === "failed" ? "failed" : "unavailable",
          },
        });
        if (entry.status === "failed") failed += 1;
        else skipped += 1;
        continue;
      }

      try {
        const video = await prisma.video.upsert({
          where: {
            platform_sourceVideoId: {
              platform: "youtube",
              sourceVideoId: entry.videoId,
            },
          },
          update: {
            title: entry.title,
            publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null,
            durationSeconds: entry.durationSeconds ?? null,
            thumbnailUrl: entry.thumbnailUrl ?? null,
            creatorId: creator.id,
            sourceChannelId: sourceChannel?.id ?? null,
          },
          create: {
            creatorId: creator.id,
            sourceChannelId: sourceChannel?.id ?? null,
            platform: "youtube",
            sourceVideoId: entry.videoId,
            sourceUrl: entry.sourceUrl,
            title: entry.title,
            description: null,
            publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null,
            durationSeconds: entry.durationSeconds ?? null,
            thumbnailUrl: entry.thumbnailUrl ?? null,
            transcriptStatus: "pending",
            analysisStatus: "pending",
          },
        });
        /*
         * Incremental-refresh fast path: an entry re-listed from disk
         * (skipReason "already_on_disk") was NOT re-fetched, so its transcript
         * is byte-identical to what's stored. If the video is ALSO already
         * analysisStatus="completed", its chunks + analysis are still valid —
         * skip the re-chunk and the (expensive ML) re-analysis and leave the
         * existing data untouched (don't even count it as a new import). This
         * keeps a routine refresh cheap instead of recomputing a creator's
         * whole back-catalog. New videos, not-yet-completed videos
         * (pending/failed → re-tried), and re-fetched (changed) transcripts all
         * fall through and are processed normally.
         */
        if (
          entry.skipReason === "already_on_disk" &&
          video.analysisStatus === "completed"
        ) {
          await prisma.importJobItem.update({
            where: { id: item.id },
            data: {
              videoId: video.id,
              transcriptStatus: "available",
              status: "transcript_imported",
            },
          });
          unchanged += 1;
          continue;
        }

        imported += 1;
        await prisma.importJobItem.update({
          where: { id: item.id },
          data: { videoId: video.id, status: "metadata_imported" },
        });

        /* Read transcript file, clean, persist. */
        const transcriptFilePath = resolveTranscriptPath(
          folderAbsolutePath,
          entry.transcriptPath,
        );
        const rawText = await readTranscriptBody(transcriptFilePath);
        if (!rawText) {
          await prisma.video.update({
            where: { id: video.id },
            data: { transcriptStatus: "unavailable" },
          });
          await prisma.importJobItem.update({
            where: { id: item.id },
            data: {
              transcriptStatus: "unavailable",
              status: "transcript_unavailable",
            },
          });
          skipped += 1;
          continue;
        }
        const cleaned = cleanTranscriptText(rawText);

        const transcript = await prisma.transcript.upsert({
          where: { videoId: video.id },
          update: {
            sourceType: "youtube_auto",
            language: "en",
            rawText,
            cleanedText: cleaned,
            segments: undefined,
            wordCount: countWords(cleaned),
          },
          create: {
            videoId: video.id,
            sourceType: "youtube_auto",
            language: "en",
            rawText,
            cleanedText: cleaned,
            segments: undefined,
            wordCount: countWords(cleaned),
          },
        });

        /* Chunk it. */
        await prisma.transcriptChunk.deleteMany({
          where: { transcriptId: transcript.id },
        });
        const chunks = chunkTranscript({ text: cleaned });
        for (const c of chunks) {
          await prisma.transcriptChunk.create({
            data: {
              transcriptId: transcript.id,
              videoId: video.id,
              chunkIndex: c.chunkIndex,
              text: c.text,
              startSeconds: c.startSeconds,
              endSeconds: c.endSeconds,
              tokenCount: c.tokenCount,
            },
          });
        }

        await prisma.video.update({
          where: { id: video.id },
          data: { transcriptStatus: "available" },
        });
        await prisma.importJobItem.update({
          where: { id: item.id },
          data: {
            transcriptStatus: "available",
            status: "transcript_imported",
          },
        });
        transcripts += 1;
        videoIdsToAnalyze.push(video.id);
      } catch (err) {
        failed += 1;
        const message = (err as Error).message;
        logger.error("[bulk-import] item failed", {
          videoId: entry.videoId,
          error: message,
        });
        await prisma.importJobItem.update({
          where: { id: item.id },
          data: { status: "failed", errorMessage: message.slice(0, 500) },
        });
      }
    }

    /*
     * ---- 4. Enqueue analysis FIRST ----------------------------------------
     * Enqueue the per-video + creator-finalization jobs BEFORE flipping the
     * ImportJob to a terminal status. Previously the job was marked
     * `completed` and THEN analysis was enqueued, so for a window the status
     * claimed "done" while the analysis pipeline hadn't even been scheduled —
     * and if the process died between the two steps, the job looked complete
     * but no analysis would ever run. Enqueue-then-finalize makes the terminal
     * status mean "ingest done AND analysis scheduled".
     */
    for (const videoId of videoIdsToAnalyze) {
      jobRunner.enqueue(`analyze:${videoId}`, async () => {
        await analyzeVideoJob(videoId);
      });
    }
    /* Creator-wide finalization (rolls up timelines etc). */
    jobRunner.enqueue(`analyze-creator:${creator.id}`, async () => {
      await analyzeCreatorJob(creator.id);
    });

    /* ---- 5. Persist totals + complete (now that analysis is scheduled) ---- */
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        totalVideosImported: imported,
        totalTranscriptsImported: transcripts,
        totalFailed: failed,
        completedAt: new Date(),
        /*
         * Three-way: nothing failed → "completed"; a mix → "completed_with_errors";
         * EVERYTHING failed (nothing imported) → "failed". The old 2-way reported
         * an all-failed import as "completed_with_errors", overstating success.
         * (Analysis runs async after this, so this reflects import outcomes only.)
         */
        status:
          failed === 0
            ? "completed"
            : imported + unchanged > 0
              ? "completed_with_errors"
              : "failed",
      },
    });

    logger.info("[bulk-import] done", {
      jobId,
      creator: creator.name,
      imported,
      transcripts,
      unchanged,
      skipped,
      failed,
    });
  } catch (err) {
    const message = (err as Error).message;
    logger.error("[bulk-import] job failed", { jobId, error: message });
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: message.slice(0, 500),
        completedAt: new Date(),
      },
    });
  }
}

/*
 * Re-export so the controller can reference it without a separate import
 * of `slugify` for downstream use.
 */
export { slugify };
