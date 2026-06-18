import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { getYoutubeProvider } from "../services/youtubeImport.service";
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
 * Background job that imports a creator's recent videos from a channel URL.
 *
 * Phases: (1) resolve the channel and upsert the creator + source-channel
 * rows; (2) list recent videos up to the job's requested limit; (3) for
 * each video, upsert the metadata, fetch and chunk its transcript, and
 * queue per-video analysis; finally queue creator-level analysis. Progress
 * counters (imported / transcripts / failed) are persisted to the ImportJob
 * row as it goes. No-ops silently if the job id no longer exists; a thrown
 * error marks the job "failed" with the message (see catch block).
 */
export async function importChannelJob(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "processing", startedAt: new Date() },
  });

  const provider = getYoutubeProvider();

  try {
    /* ---- 1. Resolve channel ----------------------------------------------- */
    const channel = await provider.resolveChannel(job.channelUrl);

    const creator = await upsertCreator({
      title: channel.title,
      handle: channel.handle,
      description: channel.description,
      thumbnailUrl: channel.thumbnailUrl,
    });

    const sourceChannel = await prisma.sourceChannel.upsert({
      where: {
        platform_channelId: {
          platform: "youtube",
          channelId: channel.channelId,
        },
      },
      update: {
        title: channel.title,
        handle: channel.handle,
        description: channel.description,
        thumbnailUrl: channel.thumbnailUrl,
        lastImportedAt: new Date(),
      },
      create: {
        creatorId: creator.id,
        platform: "youtube",
        channelUrl: job.channelUrl,
        channelId: channel.channelId,
        handle: channel.handle,
        title: channel.title,
        description: channel.description,
        thumbnailUrl: channel.thumbnailUrl,
        lastImportedAt: new Date(),
      },
    });

    await prisma.importJob.update({
      where: { id: jobId },
      data: { creatorId: creator.id, sourceChannelId: sourceChannel.id },
    });

    /* ---- 2. List recent videos -------------------------------------------- */
    const discovered = await provider.listRecentVideos(
      channel.channelId,
      job.requestedLimit,
    );

    await prisma.importJob.update({
      where: { id: jobId },
      data: { totalVideosFound: discovered.length },
    });

    /* ---- 3. Per video: create record, fetch transcript, chunk, queue analysis ---- */
    let imported = 0;
    let transcripts = 0;
    let failed = 0;
    const videoIds: string[] = [];

    for (const v of discovered) {
      const item = await prisma.importJobItem.create({
        data: {
          importJobId: jobId,
          sourceVideoId: v.sourceVideoId,
          sourceUrl: v.sourceUrl,
          title: v.title,
          publishedAt: new Date(v.publishedAt),
          status: "pending",
        },
      });

      try {
        const video = await prisma.video.upsert({
          where: {
            platform_sourceVideoId: {
              platform: "youtube",
              sourceVideoId: v.sourceVideoId,
            },
          },
          update: {
            title: v.title,
            description: v.description,
            publishedAt: new Date(v.publishedAt),
            durationSeconds: v.durationSeconds,
            thumbnailUrl: v.thumbnailUrl,
            creatorId: creator.id,
            sourceChannelId: sourceChannel.id,
          },
          create: {
            creatorId: creator.id,
            sourceChannelId: sourceChannel.id,
            platform: "youtube",
            sourceVideoId: v.sourceVideoId,
            sourceUrl: v.sourceUrl,
            title: v.title,
            description: v.description,
            publishedAt: new Date(v.publishedAt),
            durationSeconds: v.durationSeconds,
            thumbnailUrl: v.thumbnailUrl,
            transcriptStatus: "pending",
            analysisStatus: "pending",
          },
        });
        imported += 1;

        await prisma.importJobItem.update({
          where: { id: item.id },
          data: { videoId: video.id, status: "metadata_imported" },
        });

        /* ---- transcript fetch + chunk ----------------------------------- */
        const fetchedTranscript = await provider.fetchTranscript(
          v.sourceVideoId,
        );
        if (!fetchedTranscript.available || !fetchedTranscript.rawText) {
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
          continue;
        }

        const cleaned = cleanTranscriptText(fetchedTranscript.rawText);
        const transcript = await prisma.transcript.upsert({
          where: { videoId: video.id },
          update: {
            sourceType: "youtube_auto",
            language: fetchedTranscript.language,
            rawText: fetchedTranscript.rawText,
            cleanedText: cleaned,
            segments: fetchedTranscript.segments,
            wordCount: countWords(cleaned),
          },
          create: {
            videoId: video.id,
            sourceType: "youtube_auto",
            language: fetchedTranscript.language,
            rawText: fetchedTranscript.rawText,
            cleanedText: cleaned,
            segments: fetchedTranscript.segments,
            wordCount: countWords(cleaned),
          },
        });

        /* ---- chunking ---------------------------------------------------- */
        await prisma.transcriptChunk.deleteMany({
          where: { transcriptId: transcript.id },
        });
        const chunks = chunkTranscript({
          text: cleaned,
          segments: fetchedTranscript.segments,
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
        videoIds.push(video.id);
      } catch (err) {
        failed += 1;
        logger.error(`[import] item failed`, {
          sourceVideoId: v.sourceVideoId,
          error: (err as Error).message,
        });
        await prisma.importJobItem.update({
          where: { id: item.id },
          data: { status: "failed", errorMessage: (err as Error).message },
        });
      }

      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          totalVideosImported: imported,
          totalTranscriptsImported: transcripts,
          totalFailed: failed,
        },
      });
    }

    /* ---- 4. Queue analysis for each video, then creator-level timelines --- */
    for (const videoId of videoIds) {
      jobRunner.enqueue(`analyzeVideo:${videoId}`, async () => {
        await analyzeVideoJob(videoId);
        /*
         * Mark the item's terminal status from the ACTUAL post-analysis video
         * state rather than unconditionally "completed": analyzeVideoJob marks
         * the video "failed" on a pipeline error, in which case the item
         * should reflect that failure, not a false "analysis_completed".
         */
        const analyzed = await prisma.video.findUnique({
          where: { id: videoId },
          select: { analysisStatus: true },
        });
        const failed = analyzed?.analysisStatus === "failed";
        await prisma.importJobItem.updateMany({
          where: { importJobId: jobId, videoId, status: "transcript_imported" },
          data: failed
            ? { status: "failed", analysisStatus: "failed" }
            : { status: "analysis_completed", analysisStatus: "completed" },
        });
      });
    }

    jobRunner.enqueue(`analyzeCreator:${creator.id}`, async () => {
      await analyzeCreatorJob(creator.id);
      /*
       * Finalize the import job from the ACTUAL post-analysis item outcomes,
       * not just the import-phase counts: a job whose transcripts all imported
       * but whose analyses all failed must not report "completed". Count the
       * items now in their terminal states.
       */
      const [completedItems, failedItems] = await Promise.all([
        prisma.importJobItem.count({
          where: { importJobId: jobId, status: "analysis_completed" },
        }),
        prisma.importJobItem.count({
          where: { importJobId: jobId, status: "failed" },
        }),
      ]);
      /*
       * "completed" only when nothing failed (neither import nor analysis);
       * "completed_with_errors" when at least one item succeeded alongside
       * failures; "failed" when nothing succeeded at all.
       */
      const finalStatus =
        failed === 0 && failedItems === 0
          ? "completed"
          : completedItems > 0
            ? "completed_with_errors"
            : "failed";
      await prisma.importJob.update({
        where: { id: jobId },
        data: { status: finalStatus, completedAt: new Date() },
      });
    });

    /*
     * Intermediate state — analysis is async; job is "processing" until the
     * analyzeCreator step at the end of the queue marks it completed.
     */
    /* v8 ignore start -- job-level failure handler; covered by integration tests not unit tests. start/stop form for consistency with the other job handlers and to avoid the brittle "next N" line-count. */
  } catch (err) {
    logger.error(`[importChannel] failed ${jobId}`, {
      error: (err as Error).message,
    });
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: (err as Error).message,
        completedAt: new Date(),
      },
    });
  }
  /* v8 ignore stop */
}

/**
 * Find-or-create the Creator row for an imported channel, keyed by a slug
 * derived from the handle (falling back to the title).
 *
 * On an existing slug it refreshes the mutable metadata (name, description,
 * thumbnail) so re-imports stay current; otherwise it creates a new
 * `youtube_channel` creator. Returns the persisted creator either way.
 */
async function upsertCreator(args: {
  title: string;
  handle: string;
  description: string;
  thumbnailUrl: string;
}) {
  const slugBase = slugify(args.handle || args.title);
  const existing = await prisma.creator.findUnique({
    where: { slug: slugBase },
  });
  if (existing) {
    return prisma.creator.update({
      where: { id: existing.id },
      data: {
        name: args.title,
        description: args.description,
        thumbnailUrl: args.thumbnailUrl,
      },
    });
  }
  return prisma.creator.create({
    data: {
      name: args.title,
      slug: slugBase,
      description: args.description,
      thumbnailUrl: args.thumbnailUrl,
      creatorType: "youtube_channel",
    },
  });
}
