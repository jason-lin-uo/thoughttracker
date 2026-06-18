import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApiCall } from "../hooks/useApiCall";
import type { CreatorOverview } from "../lib/types";
import {
  waitForAnalysisRun,
  type QueuedReportResponse,
} from "../lib/reportJobs";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  AiNote,
} from "../components/States";
import { StatCard } from "../components/StatCard";
import { TopicCard } from "../components/Cards";
import { formatDate, formatRelative } from "../lib/format";
import { ImportStatusBadge } from "../components/Badges";
import { strings } from "../i18n/en";
import { useToast } from "../toast/toastContext";

/**
 * CreatorOverviewPage — the drill-down view for one creator, route
 * `/creators/:creatorId`. Functions as the hub from which a user can
 * branch into per-topic analysis, the creator's videos, or the latest
 * report.
 *
 * Layout:
 * - PageHeader with the creator's name + bio + action cluster:
 * "Compare with…" deep-links to `/compare?creators=<id>`, "Re-run
 * analysis" kicks off a creator-wide re-analysis job, "Generate
 * creator report" enqueues a report job and surfaces it under the
 * Reports tab when ready.
 * - Stat cards: video / transcript / topic / evidence counts.
 * - Latest import status (optional, only when a job exists).
 * - "Top topics" grid — clickable TopicCards that navigate to the
 * Topic Analysis page for the (creator, topic) pair.
 * - "Recent videos" grid — clickable VideoCards.
 * - "Latest report" preview if one exists, otherwise an empty hint.
 *
 * Data flow:
 * - `GET /api/creators/:id/overview` returns the bundled payload
 * (creator, stats, top topics, recent videos, latest report, recent
 * import) so the entire page renders from one round-trip.
 * - Two mutations: report generation and re-analysis. On success they
 * invalidate the overview query so the latest state is reflected.
 */
export function CreatorOverviewPage() {
  const { creatorId } = useParams<{ creatorId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [pendingReportRunId, setPendingReportRunId] = useState<string | null>(
    null,
  );
  const overviewQuery = useQuery({
    queryKey: ["creator-overview", creatorId],
    queryFn: () => api.get<CreatorOverview>(`/creators/${creatorId}/overview`),
    /*
     * Guard against a missing route param: without this the query would
     * fire against `/creators/undefined/overview` on a brief render where
     * `creatorId` hasn't resolved yet.
     */
    enabled: !!creatorId,
  });

  /*
   * Both mutations route through useApiCall so success/failure surface a
   * toast — previously these fired silently with no user feedback.
   */
  const reportMutation = useApiCall<QueuedReportResponse>(
    () => api.post(`/reports/creator/${creatorId}/generate`),
    {
      successTitle: strings.toasts.reportQueuedTitle,
      successMessage: strings.toasts.reportQueuedBody,
      onSuccess: ({ analysisRunId }) => {
        setPendingReportRunId(analysisRunId);
        void waitForAnalysisRun(analysisRunId)
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: ["creator-overview", creatorId],
            });
            void queryClient.invalidateQueries({ queryKey: ["reports"] });
            showToast({
              kind: "success",
              title: strings.toasts.reportReadyTitle,
              message: strings.toasts.reportReadyBody,
            });
          })
          .catch((error: Error) => {
            showToast({
              kind: "error",
              title: strings.toasts.reportFailedTitle,
              message: error.message,
            });
          })
          .finally(() => setPendingReportRunId(null));
      },
    },
  );

  /* Kicks off a creator-wide re-analysis job; toasts on success/failure. */
  const reanalyzeMutation = useApiCall(
    () => api.post(`/analysis/creators/${creatorId}/run`),
    {
      successTitle: strings.toasts.reanalysisQueuedTitle,
      successMessage: strings.toasts.reanalysisQueuedBody,
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: ["creator-overview", creatorId],
        }),
    },
  );

  /*
   * `!data` also covers the `enabled: false` (missing creatorId) case, where
   * the query is pending-but-not-fetching and never resolves.
   */
  if (overviewQuery.isLoading || !overviewQuery.data) {
    if (overviewQuery.isError)
      return (
        <ErrorState
          message={(overviewQuery.error as Error).message}
          onRetry={() => overviewQuery.refetch()}
        />
      );
    return <LoadingState />;
  }
  const data = overviewQuery.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title={data.creator.name}
        subtitle={data.creator.description ?? undefined}
        actions={
          <>
            <Link
              to={`/compare?creators=${data.creator.id}`}
              className="btn-secondary"
            >
              ⚖️ {strings.creatorOverview.compareWith}
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => reanalyzeMutation.run()}
              disabled={reanalyzeMutation.isPending}
            >
              ↻ {strings.creatorOverview.rerunAnalysis}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => reportMutation.run()}
              disabled={reportMutation.isPending || pendingReportRunId !== null}
            >
              {reportMutation.isPending || pendingReportRunId !== null
                ? strings.creatorOverview.generating
                : `📑 ${strings.creatorOverview.generateReport}`}
            </button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label={strings.creatorOverview.statsVideos}
          value={data.stats.videoCount}
          icon="🎬"
        />
        <StatCard
          label={strings.creatorOverview.statsTranscripts}
          value={data.stats.transcriptCount}
          icon="📝"
        />
        <StatCard
          label={strings.creatorOverview.statsTopics}
          value={data.stats.topicCount}
          icon="🏷️"
        />
        <StatCard
          label={strings.creatorOverview.statsEvidence}
          value={data.stats.evidenceCount}
          icon="📌"
        />
      </div>

      {data.recentImport && (
        <section className="card card-pad flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="section-eyebrow">
              {strings.creatorOverview.latestImport}
            </p>
            <p className="body-strong">
              {data.recentImport.totalVideosImported}{" "}
              {strings.creatorOverview.videosImported} ·{" "}
              {formatRelative(data.recentImport.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ImportStatusBadge status={data.recentImport.status} />
            <Link
              to={`/imports/${data.recentImport.id}`}
              className="btn-ghost text-sm"
            >
              {strings.creatorOverview.viewJob} →
            </Link>
          </div>
        </section>
      )}

      <section>
        <h2 className="section-h2">{strings.creatorOverview.topTopics}</h2>
        {data.topTopics.length === 0 ? (
          <p className="empty-msg">{strings.creatorOverview.noTopics}</p>
        ) : (
          <>
            <AiNote className="mb-3" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.topTopics.map((tp) => (
                <TopicCard
                  key={tp.topicId}
                  topic={{ id: tp.topicId, name: tp.name, slug: tp.slug }}
                  videoCount={tp.videoCount}
                  mentionCount={tp.mentionCount}
                  dominantStance={tp.dominantStance}
                  to={`/creators/${data.creator.id}/topics/${tp.topicId}`}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="section-h2">{strings.creatorOverview.recentVideos}</h2>
        {data.recentVideos.length === 0 ? (
          <p className="empty-msg">{strings.creatorOverview.noVideos}</p>
        ) : (
          /*
           * A plain list of transcript links (no thumbnail) — these go to the
           * in-app transcript page, NOT YouTube, so a video-thumbnail card was
           * misleading. Each row links to /videos/:id.
           */
          <ul className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">
            {data.recentVideos.map((v) => (
              <li
                key={v.id}
                className="border-t border-ink-200 first:border-t-0 dark:border-ink-800"
              >
                <Link
                  to={`/videos/${v.id}`}
                  className="focus-inset flex items-center justify-between gap-4 px-4 py-3 hover:bg-ink-50 dark:hover:bg-ink-900 transition"
                >
                  <span className="min-w-0 flex-1 truncate text-ink-800 dark:text-ink-100">
                    {v.title}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-500 dark:text-ink-400">
                    {v.publishedAt ? formatDate(v.publishedAt) : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-h2">{strings.creatorOverview.latestReport}</h2>
        {data.latestReport ? (
          <Link
            to={`/reports/${data.latestReport.id}`}
            className="card card-pad block hover:border-brand-300 transition"
          >
            <p className="font-semibold text-ink-900 dark:text-ink-50">
              {data.latestReport.title}
            </p>
            <p className="text-sm text-ink-600 dark:text-ink-400 mt-2 line-clamp-3">
              {data.latestReport.summary}
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400 mt-3">
              {formatDate(data.latestReport.createdAt)}
            </p>
            {/* The report title + summary above are AI-generated prose. */}
            <AiNote className="mt-2" />
          </Link>
        ) : (
          <p className="empty-msg">{strings.creatorOverview.noReport}</p>
        )}
      </section>
    </div>
  );
}
