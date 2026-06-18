import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { NotFoundError, BadRequestError } from "../utils/errors";
import {
  cleanTranscriptText,
  countWords,
} from "../services/transcript.service";
import { jobRunner } from "../jobs/jobRunner";
import { chunkTranscriptJob } from "../jobs/chunkTranscript.job";

const ManualTranscriptSchema = z.object({
  rawText: z.string().min(20),
  language: z.string().default("en"),
  sourceType: z.enum(["manual_paste", "manual_upload"]).default("manual_paste"),
});

/**
 * GET /api/videos/:videoId/transcript — return a video's transcript, 404
 * if none exists. When `?includeChunks=true` the chunk rows are eager-
 * loaded in chunkIndex order (so the client can render the segmented view)
 * instead of just the transcript metadata + text.
 */
export async function getVideoTranscript(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const includeChunks = req.query.includeChunks === "true";
    const transcript = await prisma.transcript.findUnique({
      where: { videoId: req.params.videoId },
      include: includeChunks
        ? { chunks: { orderBy: { chunkIndex: "asc" } } }
        : undefined,
    });
    if (!transcript) throw new NotFoundError("Transcript not found");
    res.json(transcript);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/videos/:videoId/transcript/manual — store a user-pasted
 * transcript when the automatic fetcher couldn't retrieve one (audit H15).
 *
 * Cleans whitespace and persists the transcript SYNCHRONOUSLY (so we can
 * validate the video + return the transcript id), but moves the potentially
 * dozens-of-round-trips chunking loop onto the jobRunner via
 * chunkTranscriptJob, which also enqueues the follow-up analysis. The handler
 * returns 202 + `{ transcriptId, status: "queued" }` immediately; the client
 * polls the video's `analysisStatus` (pending → processing → completed) the
 * same way the analyzeVideo path is polled. Used when YouTube's auto-caption
 * was absent or the video is a podcast with no captions.
 */
export async function postManualTranscript(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = ManualTranscriptSchema.safeParse(req.body);
    if (!parsed.success)
      throw new BadRequestError(
        "Invalid manual transcript",
        parsed.error.flatten(),
      );

    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
    });
    if (!video) throw new NotFoundError("Video not found");

    const cleaned = cleanTranscriptText(parsed.data.rawText);
    const transcript = await prisma.transcript.upsert({
      where: { videoId: video.id },
      update: {
        sourceType: parsed.data.sourceType,
        language: parsed.data.language,
        rawText: parsed.data.rawText,
        cleanedText: cleaned,
        wordCount: countWords(cleaned),
        segments: Prisma.JsonNull,
      },
      create: {
        videoId: video.id,
        sourceType: parsed.data.sourceType,
        language: parsed.data.language,
        rawText: parsed.data.rawText,
        cleanedText: cleaned,
        wordCount: countWords(cleaned),
      },
    });

    /*
     * Flip status up front so the UI immediately reflects "queued for
     * analysis" while the background job chunks + analyzes.
     */
    await prisma.video.update({
      where: { id: video.id },
      data: { transcriptStatus: "manual", analysisStatus: "pending" },
    });

    /*
     * Off-request chunking (+ analysis enqueue inside the job). See
     * chunkTranscriptJob.
     */
    jobRunner.enqueue(`chunkTranscript:${video.id}`, () =>
      chunkTranscriptJob(video.id),
    );

    res.status(202).json({ transcriptId: transcript.id, status: "queued" });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/videos/:videoId/transcript/rechunk — re-runs chunking on the
 * existing cleaned text (audit H15). Useful after a chunking config change
 * (e.g. switching chunk size).
 *
 * Validates the video has a transcript, then ENQUEUES chunkTranscriptJob
 * (which re-chunks off the request path and enqueues a follow-up analysis
 * job) and returns 202 + `{ status: "queued" }`. The chunking itself no
 * longer runs inline in the request.
 */
export async function rechunkTranscript(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
      include: { transcript: true },
    });
    if (!video) throw new NotFoundError("Video not found");
    if (!video.transcript)
      throw new BadRequestError("Video has no transcript yet");

    await prisma.video.update({
      where: { id: video.id },
      data: { analysisStatus: "pending" },
    });

    /*
     * The background job reads the transcript's cleanedText (falling back to
     * rawText when cleanedText is null) and re-chunks off the request path.
     */
    jobRunner.enqueue(`chunkTranscript:${video.id}`, () =>
      chunkTranscriptJob(video.id),
    );

    res.status(202).json({ status: "queued" });
  } catch (err) {
    next(err);
  }
}
