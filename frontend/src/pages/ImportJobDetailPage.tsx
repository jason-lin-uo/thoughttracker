import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ImportJob, ImportJobItem } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/States";
import { StatCard } from "../components/StatCard";
import {
  ImportStatusBadge,
  TranscriptStatusBadge,
  AnalysisStatusBadge,
} from "../components/Badges";
import { formatRelative, formatDate } from "../lib/format";
import { strings } from "../i18n/en";

/**
 * ImportJobDetailPage — live progress view for one import job, route
 * `/imports/:jobId`.
 *
 * Two queries: the job summary and the per-video items list. Both
 * `refetchInterval` adaptively — fast (2.5s) while the job is
 * pending/processing, then stops once the job reaches a terminal state.
 * This keeps the UI feeling alive during work without hammering the API.
 *
 * Body sections:
 * - Header with the channel URL, requested limit, and an aggregate
 * `ImportStatusBadge`.
 * - StatCards: videos found / imported / transcripts / failed.
 * - Per-item table: each row is one video with its source URL, title,
 * publish date, transcript + analysis status badges, and any error.
 */
export function ImportJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const jobQuery = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => api.get<ImportJob>(`/import-jobs/${jobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 2500 : false;
    },
  });

  const itemsQuery = useQuery({
    queryKey: ["import-job-items", jobId],
    queryFn: () =>
      api.get<{ items: ImportJobItem[] }>(`/import-jobs/${jobId}/items`),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const inProgress = items.some(
        (i) =>
          i.status === "pending" ||
          i.status === "metadata_imported" ||
          i.status === "transcript_imported",
      );
      /*
       * Keep polling while ANY item is in progress OR the job itself is still
       * running. Relying on item status alone wrongly stopped polling during
       * the window where the job is `processing` but items haven't been
       * written yet (the list is momentarily empty) — that gap left the view
       * permanently stale until a manual refresh.
       */
      const jobStatus = jobQuery.data?.status;
      const jobActive = jobStatus === "pending" || jobStatus === "processing";
      return inProgress || jobActive ? 2500 : false;
    },
  });

  if (jobQuery.isLoading) return <LoadingState />;
  if (jobQuery.isError)
    return (
      <ErrorState
        message={(jobQuery.error as Error).message}
        onRetry={() => jobQuery.refetch()}
      />
    );
  const job = jobQuery.data!;

  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.importJob.title}
        subtitle={job.channelUrl}
        actions={
          job.creator ? (
            <Link to={`/creators/${job.creator.id}`} className="btn-secondary">
              {strings.importJob.viewCreator} →
            </Link>
          ) : undefined
        }
      />

      <section className="stats-grid">
        <StatCard
          label={strings.importJob.statusLabel}
          value={<ImportStatusBadge status={job.status} />}
        />
        <StatCard
          label={strings.importJob.videosFound}
          value={job.totalVideosFound || strings.common.none}
          /*
           * Only show the "limit N" hint for channel imports that actually
           * carry a requested cap. Bulk/folder imports store requestedLimit=0
           * (no cap), which rendered a meaningless "limit 0" line.
           */
          hint={
            job.requestedLimit
              ? `${strings.imports.limit.toLowerCase()} ${job.requestedLimit}`
              : undefined
          }
        />
        <StatCard
          label={strings.importJob.imported}
          value={job.totalVideosImported}
        />
        <StatCard
          label={strings.importJob.transcripts}
          value={job.totalTranscriptsImported}
          hint={`${job.totalFailed} ${strings.importJob.failedCount}`}
        />
      </section>

      <section className="card card-pad text-sm text-ink-700 dark:text-ink-300 space-y-1">
        <p>
          <span className="text-ink-500 dark:text-ink-400">
            {strings.importJob.started}:
          </span>{" "}
          {job.startedAt
            ? formatDate(job.startedAt) + " · " + formatRelative(job.startedAt)
            : strings.common.none}
        </p>
        <p>
          <span className="text-ink-500 dark:text-ink-400">
            {strings.importJob.completed}:
          </span>{" "}
          {job.completedAt
            ? formatDate(job.completedAt) +
              " · " +
              formatRelative(job.completedAt)
            : strings.common.none}
        </p>
        {job.errorMessage && (
          <p className="text-rose-600">
            <span className="text-ink-500 dark:text-ink-400">
              {strings.importJob.error}:
            </span>{" "}
            {job.errorMessage}
          </p>
        )}
      </section>

      <section>
        <h2 className="section-h2">{strings.importJob.videosInImport}</h2>
        {itemsQuery.isLoading ? (
          <LoadingState />
        ) : itemsQuery.isError ? (
          <ErrorState
            message={(itemsQuery.error as Error).message}
            onRetry={() => itemsQuery.refetch()}
          />
        ) : itemsQuery.data!.items.length === 0 ? (
          <EmptyState
            title={strings.importJob.noItems}
            description={strings.importJob.noItemsDescription}
          />
        ) : (
          <>
            <div className="hidden md:block card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 dark:bg-ink-900 text-left text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  <tr>
                    <th className="px-4 py-3">{strings.videos.table.title}</th>
                    <th className="px-4 py-3">
                      {strings.videos.table.published}
                    </th>
                    <th className="px-4 py-3">{strings.common.status}</th>
                    <th className="px-4 py-3">
                      {strings.videos.table.transcript}
                    </th>
                    <th className="px-4 py-3">
                      {strings.videos.table.analysis}
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {itemsQuery.data!.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 max-w-md">
                        <p className="font-medium text-ink-900 dark:text-ink-50 truncate">
                          {item.title ?? item.sourceVideoId}
                        </p>
                        {item.errorMessage && (
                          <p className="text-xs text-rose-600 truncate">
                            {item.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-600 dark:text-ink-400">
                        {formatDate(item.publishedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <ImportStatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3">
                        <TranscriptStatusBadge status={item.transcriptStatus} />
                      </td>
                      <td className="px-4 py-3">
                        {/*
                         * Prefer the linked video's LIVE analysisStatus over the
                         * item's import-time snapshot: analysis is enqueued after
                         * the import completes and updates the Video, never the
                         * ImportJobItem, so the item field stays "pending" forever.
                         */}
                        <AnalysisStatusBadge
                          status={
                            item.video?.analysisStatus ?? item.analysisStatus
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.video && (
                          <Link
                            to={`/videos/${item.video.id}`}
                            className="text-brand-700 hover:underline text-xs"
                          >
                            {strings.common.open} →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {itemsQuery.data!.items.map((item) => (
                <div key={item.id} className="card card-pad">
                  <p className="font-medium text-ink-900 dark:text-ink-50">
                    {item.title ?? item.sourceVideoId}
                  </p>
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
                    {formatDate(item.publishedAt)}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <ImportStatusBadge status={item.status} />
                    <TranscriptStatusBadge status={item.transcriptStatus} />
                    <AnalysisStatusBadge
                      status={item.video?.analysisStatus ?? item.analysisStatus}
                    />
                  </div>
                  {item.errorMessage && (
                    <p className="text-xs text-rose-600 mt-2">
                      {item.errorMessage}
                    </p>
                  )}
                  {item.video && (
                    <Link
                      to={`/videos/${item.video.id}`}
                      className="text-brand-700 text-xs mt-3 inline-block"
                    >
                      {strings.importJob.openVideo} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
