import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { chunkTranscript } from "../services/chunking.service";
import { cleanTranscriptText } from "../services/transcript.service";
import { jobRunner } from "./jobRunner";
import { analyzeVideoJob } from "./analyzeVideo.job";

/**
 * chunkTranscriptJob — background re-chunking of a single video's transcript
 * (audit H15).
 *
 * Both the manual-transcript-paste and the re-chunk endpoints used to run the
 * chunking loop INLINE in the request handler: delete the old chunks, then a
 * sequential `await prisma.transcriptChunk.create(...)` per chunk. For a long
 * transcript that's dozens of serial round-trips holding the HTTP socket open.
 * This job moves that work off the request path so the controller can return a
 * 202 + a poll handle immediately.
 *
 * Steps (idempotent — safe to re-run):
 * 1. Load the video + its transcript. If either is gone (deleted between the
 * enqueue and now), log and bail without throwing.
 * 2. Delete any existing chunk rows for the transcript (so a re-chunk after
 * a config change replaces rather than duplicates).
 * 3. Rebuild chunks from the cleaned text (honoring segments when present)
 * and persist them.
 * 4. Mark the video `analysisStatus = "pending"` and enqueue the per-video
 * analysis job so stance/topic/summary work follows the new chunks.
 *
 * Errors are logged and swallowed by the jobRunner; we additionally flip the
 * video to `analysisStatus = "failed"` so the UI surfaces the failure rather
 * than spinning on "pending" forever.
 */
export async function chunkTranscriptJob(videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      transcript: true,
      chunks: { orderBy: { chunkIndex: "asc" } },
    },
  });
  /* v8 ignore next 4 -- defensive: the controller validates the video+transcript
 exist before enqueueing, so this only fires on a concurrent delete. */
  if (!video || !video.transcript) {
    logger.warn(`[chunkTranscript] skipping ${videoId}; no video/transcript`);
    return;
  }

  try {
    const transcript = video.transcript;
    const chunkingSource = selectChunkingSource({
      cleanedText: transcript.cleanedText,
      rawText: transcript.rawText,
      existingChunks: video.chunks.map((chunk) => chunk.text),
    });

    await prisma.transcriptChunk.deleteMany({
      where: { transcriptId: transcript.id },
    });
    const chunks = chunkTranscript({
      text: chunkingSource.text,
      /* Honor timestamped segments when present (rechunk path keeps them). */
      segments: chunkingSource.allowSegments
        ? ((transcript.segments as Array<{
            start: number;
            end: number;
            text: string;
          }> | null) ?? undefined)
        : undefined,
    });
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
      data: { analysisStatus: "pending" },
    });

    jobRunner.enqueue(`analyzeVideo:${video.id}`, () =>
      analyzeVideoJob(video.id),
    );
  } catch (err) {
    /*
     * A transient DB error mid-chunk-write shouldn't leave the video stuck on
     * "pending"; flip it to "failed" so the UI surfaces the failure.
     */
    logger.error(`[chunkTranscript] failed ${videoId}`, {
      error: (err as Error).message,
    });
    await prisma.video.update({
      where: { id: video.id },
      data: { analysisStatus: "failed" },
    });
  }
}

function selectChunkingSource(input: {
  cleanedText: string | null;
  rawText: string;
  existingChunks: string[];
}): { text: string; allowSegments: boolean } {
  const cleanedText = input.cleanedText?.trim();
  if (cleanedText && !isHostedSnapshotMarker(cleanedText)) {
    return { text: cleanedText, allowSegments: true };
  }

  const rawText = input.rawText.trim();
  if (rawText && !isHostedSnapshotMarker(rawText)) {
    return { text: cleanTranscriptText(rawText), allowSegments: true };
  }

  const chunkText = input.existingChunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .join("\n\n");
  if (chunkText) return { text: chunkText, allowSegments: false };

  throw new Error(
    "Transcript body is unavailable and no existing chunks can be reused.",
  );
}

function isHostedSnapshotMarker(text: string): boolean {
  return text.startsWith("[Hosted snapshot:");
}
