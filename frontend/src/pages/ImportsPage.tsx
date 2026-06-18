import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ImportJob } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/States";
import { ImportStatusBadge } from "../components/Badges";
import { formatRelative } from "../lib/format";
import { strings } from "../i18n/en";

/**
 * ImportsPage — the page where a user kicks off a new YouTube channel
 * import job and watches the list of recent jobs, route `/imports`.
 *
 * Top half is the new-import form (channel URL + video-count limit +
 * optional name override). Submitting it POSTs to
 * `/api/import-jobs/youtube-channel`, returns a `{ jobId }`, then
 * navigates to `/imports/:jobId` so the user lands on the detail page
 * with live progress.
 *
 * Bottom half lists existing jobs, auto-refreshing every 5 seconds via
 * React Query's `refetchInterval` so in-flight jobs visibly progress —
 * but polling stops once every job has reached a terminal state, so an
 * idle history page doesn't hammer the API forever.
 */

/** Job statuses that mean the import is done — used to halt polling. */
const TERMINAL_JOB_STATUSES = ["completed", "completed_with_errors", "failed"];

/** Imports landing page: new-import handoff + auto-refreshing job history. */
export function ImportsPage() {
  const jobsQuery = useQuery({
    queryKey: ["import-jobs"],
    queryFn: () => api.get<{ items: ImportJob[] }>("/import-jobs"),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      /*
       * Keep polling only while at least one job is still in flight; once
       * they're all terminal there's nothing left to update.
       */
      const anyActive = items.some(
        (job) => !TERMINAL_JOB_STATUSES.includes(job.status),
      );
      return anyActive ? 5000 : false;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title={strings.imports.title}
        subtitle={strings.imports.subtitle}
      />

      <section className="card card-pad">
        <h2 className="font-semibold text-ink-900 dark:text-ink-50">
          {strings.imports.startNew}
        </h2>
        <p className="text-sm text-ink-600 dark:text-ink-400 mt-1">
          {strings.imports.description}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-600 dark:text-ink-400">
            {strings.imports.adminHandoff}
          </p>
          <Link className="btn-primary" to="/add-creators">
            {strings.imports.openAddCreators}
          </Link>
        </div>
      </section>

      <section>
        <h2 className="section-h2">{strings.imports.recentJobs}</h2>
        {jobsQuery.isLoading ? (
          <LoadingState />
        ) : jobsQuery.isError ? (
          <ErrorState
            message={(jobsQuery.error as Error).message}
            onRetry={() => jobsQuery.refetch()}
          />
        ) : jobsQuery.data!.items.length === 0 ? (
          <EmptyState
            icon="⬇️"
            title={strings.imports.emptyTitle}
            description={strings.imports.emptyDescription}
          />
        ) : (
          <div className="card divide-y divide-ink-100 dark:divide-ink-800">
            {jobsQuery.data!.items.map((job) => (
              <Link
                key={job.id}
                to={`/imports/${job.id}`}
                className="flex flex-col md:flex-row md:items-center md:justify-between p-4 hover:bg-ink-50 dark:hover:bg-ink-800 dark:bg-ink-900"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900 dark:text-ink-50 truncate">
                    {job.creator?.name ?? job.channelUrl}
                  </p>
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5 truncate">
                    {job.channelUrl} · {formatRelative(job.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-2 md:mt-0">
                  <span className="meta-row">
                    {job.totalVideosImported}/
                    {job.totalVideosFound || job.requestedLimit}{" "}
                    {strings.creators.cardVideos}
                  </span>
                  <ImportStatusBadge status={job.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
