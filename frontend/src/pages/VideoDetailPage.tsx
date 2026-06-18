import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApiCall } from "../hooks/useApiCall";
import type { Video, VideoTopicSummary } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  AiNote,
} from "../components/States";
import {
  TranscriptStatusBadge,
  AnalysisStatusBadge,
  StanceBadge,
  ConfidenceBadge,
} from "../components/Badges";
import { formatDate, formatDuration, humanizeLabel } from "../lib/format";
import { strings } from "../i18n/en";

type VideoWithSummaries = Video & {
  videoSummaries: Array<
    VideoTopicSummary & { topic: { id: string; name: string; slug: string } }
  >;
  transcript: {
    id: string;
    wordCount: number;
    language: string;
    sourceType: string;
  } | null;
  _count: { chunks: number };
};

/**
 * VideoDetailPage — drill-down for one video, route `/videos/:videoId`.
 *
 * Three modes depending on transcript state:
 * - Transcript available: render the full chunked transcript with
 * per-chunk headers + the per-topic summaries grid.
 * - Pending: show a loading state — the transcript fetcher hasn't run.
 * - Unavailable / failed: render a manual paste form. Users can paste
 * their own transcript text; submitting POSTs to
 * `/api/videos/:id/transcript/manual` which chunks it server-side and
 * queues analysis. Submit is disabled until ≥20 characters of text.
 *
 * Action buttons in the header:
 * - "Open on YouTube" — external link to the source video.
 * - "Re-chunk" — re-runs chunking on the existing transcript (handy
 * when chunking config changes).
 * - "Re-run analysis" — enqueues a per-video analysis job.
 */
export function VideoDetailPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const queryClient = useQueryClient();
  const [manualText, setManualText] = useState("");

  /*
   * Clear the manual-transcript draft when navigating to a different video —
   * the page component is reused across route changes, so without this a draft
   * typed for one video would still be in the box (and submit) on the next.
   */
  useEffect(() => {
    setManualText("");
  }, [videoId]);

  const videoQuery = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => api.get<VideoWithSummaries>(`/videos/${videoId}`),
  });

  const transcriptQuery = useQuery({
    queryKey: ["video-transcript", videoId, "chunks"],
    queryFn: () =>
      api.get<{
        id: string;
        cleanedText: string;
        chunks: Array<{ id: string; chunkIndex: number; text: string }>;
      }>(`/videos/${videoId}/transcript`, { includeChunks: "true" }),
    enabled:
      !!videoQuery.data &&
      videoQuery.data.transcriptStatus !== "unavailable" &&
      videoQuery.data.transcriptStatus !== "pending" &&
      videoQuery.data.transcriptStatus !== "failed",
  });

  /*
   * All three actions route through useApiCall for consistent toast feedback.
   * The manual-transcript form ALSO keeps its inline error (below) since that
   * error is contextual to the textarea; the toast is the app-wide signal.
   */
  const manualMutation = useApiCall(
    () =>
      api.post(`/videos/${videoId}/transcript/manual`, {
        rawText: manualText,
        language: "en",
        sourceType: "manual_paste",
      }),
    {
      successTitle: strings.toasts.transcriptSavedTitle,
      successMessage: strings.toasts.transcriptSavedBody,
      onSuccess: () => {
        setManualText("");
        queryClient.invalidateQueries({ queryKey: ["video", videoId] });
        queryClient.invalidateQueries({
          queryKey: ["video-transcript", videoId, "chunks"],
        });
      },
    },
  );

  /* Re-runs chunking on the existing transcript; toasts on success/failure. */
  const rechunkMutation = useApiCall(
    () => api.post(`/videos/${videoId}/transcript/rechunk`),
    {
      successTitle: strings.toasts.rechunkQueuedTitle,
      successMessage: strings.toasts.rechunkQueuedBody,
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["video-transcript", videoId, "chunks"],
        });
        /*
         * Also refresh the video query — the header shows `video._count.chunks`,
         * which re-chunking changes; without this the header count stays stale.
         */
        queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      },
    },
  );

  /* Enqueues a per-video re-analysis job; toasts on success/failure. */
  const reanalyzeMutation = useApiCall(
    () => api.post(`/analysis/videos/${videoId}/run`),
    {
      successTitle: strings.toasts.reanalysisQueuedTitle,
      successMessage: strings.toasts.reanalysisQueuedBody,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: ["video", videoId] }),
    },
  );

  if (videoQuery.isLoading) return <LoadingState />;
  if (videoQuery.isError)
    return (
      <ErrorState
        message={(videoQuery.error as Error).message}
        onRetry={() => videoQuery.refetch()}
      />
    );
  const video = videoQuery.data!;

  return (
    <div className="space-y-6">
      <PageHeader
        title={video.title}
        subtitle={
          <>
            {video.creator?.name && (
              <Link
                to={`/creators/${video.creator.id}`}
                className="hover:text-brand-700"
              >
                {video.creator.name}
              </Link>
            )}
            {" · "}
            {formatDate(video.publishedAt)} ·{" "}
            {formatDuration(video.durationSeconds)}
          </>
        }
        actions={
          <>
            <a
              href={video.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              ↗ {strings.videoDetail.openOnYouTube}
            </a>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => rechunkMutation.run()}
              disabled={rechunkMutation.isPending || !video.transcript}
            >
              {strings.videoDetail.rechunk}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => reanalyzeMutation.run()}
              disabled={reanalyzeMutation.isPending}
            >
              {reanalyzeMutation.isPending
                ? strings.videoDetail.queued
                : `↻ ${strings.videoDetail.rerunAnalysis}`}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TranscriptStatusBadge status={video.transcriptStatus} />
        <AnalysisStatusBadge status={video.analysisStatus} />
        {video.transcript && (
          <span className="meta-row">
            {video.transcript.wordCount} {strings.videoDetail.wordsLabel} ·{" "}
            {video._count.chunks} {strings.videoDetail.chunksLabel} ·{" "}
            {strings.videoDetail.transcriptSource[
              video.transcript.sourceType
            ] ?? humanizeLabel(video.transcript.sourceType)}
          </span>
        )}
      </div>

      {video.description && (
        <p className="text-sm text-ink-700 dark:text-ink-300 whitespace-pre-line">
          {video.description}
        </p>
      )}

      <section>
        <h2 className="section-h2">{strings.videoDetail.topicSummaries}</h2>
        {video.videoSummaries.length === 0 ? (
          <p className="empty-msg">{strings.videoDetail.noSummaries}</p>
        ) : (
          <>
            <AiNote className="mb-3" />
            <div className="grid sm:grid-cols-2 gap-3">
              {video.videoSummaries.map((s) => (
                <Link
                  key={s.id}
                  to={`/creators/${video.creatorId}/topics/${s.topicId}`}
                  className="card card-pad hover:border-brand-300 transition"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink-900 dark:text-ink-50">
                      {s.topic.name}
                    </p>
                    <span className="meta-row">
                      {s.mentionCount} {strings.videoDetail.mentions}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <StanceBadge stance={s.dominantStance} />
                    <ConfidenceBadge confidence={s.confidenceLabel} />
                  </div>
                  {s.summary && (
                    <p className="text-sm text-ink-600 dark:text-ink-400 mt-3">
                      {s.summary}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="section-h2">{strings.videoDetail.transcript}</h2>
        {video.transcriptStatus === "pending" ? (
          /*
           * Fetch is queued/in flight — a transcript is coming, so show a note
           * rather than the paste form (which is for when none will arrive).
           */
          <div className="card card-pad">
            <p className="text-sm text-ink-700 dark:text-ink-300">
              {strings.videoDetail.transcriptPending}
            </p>
          </div>
        ) : video.transcriptStatus === "unavailable" ||
          video.transcriptStatus === "failed" ? (
          <div className="card card-pad space-y-3">
            <p className="text-sm text-ink-700 dark:text-ink-300">
              {strings.videoDetail.manualTranscriptDescription}
            </p>
            <textarea
              aria-label={strings.videoDetail.transcript}
              className="input min-h-[160px] font-mono text-xs"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={strings.videoDetail.manualTranscriptPlaceholder}
            />
            <div className="flex items-center justify-end gap-2">
              {manualMutation.isError && (
                <p className="text-xs text-rose-600 mr-auto">
                  {(manualMutation.error as Error).message}
                </p>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={
                  manualMutation.isPending || manualText.trim().length < 20
                }
                onClick={() => manualMutation.run()}
              >
                {manualMutation.isPending
                  ? strings.videoDetail.saving
                  : strings.videoDetail.saveAndAnalyze}
              </button>
            </div>
          </div>
        ) : transcriptQuery.isLoading ? (
          <LoadingState />
        ) : transcriptQuery.isError ? (
          <ErrorState
            message={(transcriptQuery.error as Error).message}
            onRetry={() => transcriptQuery.refetch()}
          />
        ) : (
          <div className="card card-pad max-h-[500px] overflow-y-auto whitespace-pre-line text-sm text-ink-800 dark:text-ink-200 leading-relaxed font-mono">
            {transcriptQuery.data?.chunks
              ?.map(
                (c) =>
                  `[${strings.videoDetail.chunkPrefix} ${c.chunkIndex}]\n${c.text}\n\n`,
              )
              .join("") ?? transcriptQuery.data?.cleanedText}
          </div>
        )}
      </section>
    </div>
  );
}
