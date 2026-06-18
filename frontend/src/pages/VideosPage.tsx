import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useFilters } from "../lib/useFilters";
import type { CreatorListItem, Page, Topic, Video } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/States";
import { VideoCard } from "../components/Cards";
import {
  VirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../components/VirtualizedList";
import {
  TranscriptStatusBadge,
  AnalysisStatusBadge,
} from "../components/Badges";
import { formatDate, humanizeLabel } from "../lib/format";
import { strings } from "../i18n/en";

const TRANSCRIPT_STATUSES = [
  "",
  "available",
  "manual",
  "pending",
  "unavailable",
  "failed",
];
const ANALYSIS_STATUSES = ["", "completed", "processing", "pending", "failed"];
const STANCES = [
  "",
  "supportive",
  "opposed",
  "neutral",
  "mixed",
  "unclear",
  "insufficient_evidence",
];
const CONFIDENCES = ["", "low", "medium", "high"];

/**
 * VideosPage — the videos index, route `/videos`.
 *
 * Provides a filter grid (creator / topic / search / transcript status /
 * analysis status / stance / confidence / from-date / to-date) and a
 * paginated grid of `VideoCard`s. Pagination is via `page` query param,
 * 12 videos per page server-side; the page tracks `filters.page` and
 * provides Prev/Next buttons disabled at the edges.
 *
 * Three parallel queries on mount: creators-for-filter, topics-for-
 * filter, and the videos list itself. The first two populate the filter
 * dropdowns; the third is keyed by the current filter state so changing
 * any filter triggers a re-fetch.
 */
export function VideosPage() {
  /*
   * Seed the creator/topic filters from the URL query string (read once on
   * mount) so deep links like `/videos?topicId=<id>` from the Topics index
   * land pre-filtered. useFilters keeps the state local afterward.
   */
  const [searchParams] = useSearchParams();
  const [filters, update] = useFilters({
    creatorId: searchParams.get("creatorId") ?? "",
    topicId: searchParams.get("topicId") ?? "",
    search: "",
    transcriptStatus: "",
    analysisStatus: "",
    stanceLabel: "",
    confidenceLabel: "",
    from: "",
    to: "",
    page: 1,
  });

  const creatorsQuery = useQuery({
    queryKey: ["creators-for-filter"],
    queryFn: () => api.get<{ items: CreatorListItem[] }>("/creators"),
  });
  const topicsQuery = useQuery({
    queryKey: ["topics-for-filter"],
    queryFn: () => api.get<{ items: Topic[] }>("/topics"),
  });

  /*
   * Explicit primitive key tuple (instead of `["videos", filters]`) so
   * the cache key is stable across re-renders where `filters` is a new
   * object reference but values are unchanged. React Query hashes
   * either form fine, but the explicit list is clearer at a glance.
   */
  const videosQuery = useQuery({
    queryKey: [
      "videos",
      filters.creatorId,
      filters.topicId,
      filters.search,
      filters.transcriptStatus,
      filters.analysisStatus,
      filters.stanceLabel,
      filters.confidenceLabel,
      filters.from,
      filters.to,
      filters.page,
    ],
    queryFn: ({ signal }) =>
      api.get<Page<Video>>(
        "/videos",
        {
          creatorId: filters.creatorId || undefined,
          topicId: filters.topicId || undefined,
          search: filters.search || undefined,
          transcriptStatus: filters.transcriptStatus || undefined,
          analysisStatus: filters.analysisStatus || undefined,
          stanceLabel: filters.stanceLabel || undefined,
          confidenceLabel: filters.confidenceLabel || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page: filters.page,
          pageSize: 24,
        },
        /*
         * Forward React Query's AbortSignal so rapid filter/page changes
         * cancel the superseded request instead of racing it.
         */
        signal,
      ),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.videos.title}
        subtitle={strings.videos.subtitle}
      />

      <div className="filter-grid">
        <div className="lg:col-span-2">
          <label className="label">{strings.videos.searchLabel}</label>
          <input
            aria-label={strings.videos.searchLabel}
            type="text"
            className="input"
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder={strings.videos.searchPlaceholder}
          />
        </div>
        <div>
          <label className="label">{strings.common.creator}</label>
          <select
            aria-label={strings.common.creator}
            className="input"
            value={filters.creatorId}
            onChange={(e) => update("creatorId", e.target.value)}
          >
            <option value="">{strings.common.all}</option>
            {creatorsQuery.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.common.topic}</label>
          <select
            aria-label={strings.common.topic}
            className="input"
            value={filters.topicId}
            onChange={(e) => update("topicId", e.target.value)}
          >
            <option value="">{strings.common.all}</option>
            {topicsQuery.data?.items.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.common.transcriptStatus}</label>
          <select
            aria-label={strings.common.transcriptStatus}
            className="input"
            value={filters.transcriptStatus}
            onChange={(e) => update("transcriptStatus", e.target.value)}
          >
            {TRANSCRIPT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? humanizeLabel(s) : strings.common.any}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.common.analysisStatus}</label>
          <select
            aria-label={strings.common.analysisStatus}
            className="input"
            value={filters.analysisStatus}
            onChange={(e) => update("analysisStatus", e.target.value)}
          >
            {ANALYSIS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? humanizeLabel(s) : strings.common.any}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.common.stance}</label>
          <select
            aria-label={strings.common.stance}
            className="input"
            value={filters.stanceLabel}
            onChange={(e) => update("stanceLabel", e.target.value)}
          >
            {STANCES.map((s) => (
              <option key={s} value={s}>
                {s ? humanizeLabel(s) : strings.common.any}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.common.confidence}</label>
          <select
            aria-label={strings.common.confidence}
            className="input"
            value={filters.confidenceLabel}
            onChange={(e) => update("confidenceLabel", e.target.value)}
          >
            {CONFIDENCES.map((s) => (
              <option key={s} value={s}>
                {s ? humanizeLabel(s) : strings.common.any}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.common.from}</label>
          <input
            aria-label={strings.common.from}
            type="date"
            className="input"
            value={filters.from}
            onChange={(e) => update("from", e.target.value)}
          />
        </div>
        <div>
          <label className="label">{strings.common.to}</label>
          <input
            aria-label={strings.common.to}
            type="date"
            className="input"
            value={filters.to}
            onChange={(e) => update("to", e.target.value)}
          />
        </div>
      </div>

      {videosQuery.isLoading ? (
        <LoadingState />
      ) : videosQuery.isError ? (
        <ErrorState
          message={(videosQuery.error as Error).message}
          onRetry={() => videosQuery.refetch()}
        />
      ) : videosQuery.data!.items.length === 0 ? (
        <EmptyState
          title={strings.videos.emptyTitle}
          description={strings.videos.emptyDescription}
        />
      ) : (
        <>
          {/* Desktop table — virtualizes via row-shaped <div>s once
 the list outgrows VIRTUALIZE_THRESHOLD. Below that, the
 native <table> stays — keeps semantics + a11y for the
 common page-size case (pageSize=24). */}
          <div className="hidden lg:block">
            {videosQuery.data!.items.length > VIRTUALIZE_THRESHOLD ? (
              <div className="card overflow-hidden">
                <div className="grid grid-cols-[1fr_180px_120px_120px_120px_60px] gap-4 px-4 py-3 bg-ink-50 dark:bg-ink-900 text-left text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  <div>{strings.videos.table.title}</div>
                  <div>{strings.videos.table.creator}</div>
                  <div>{strings.videos.table.published}</div>
                  <div>{strings.videos.table.transcript}</div>
                  <div>{strings.videos.table.analysis}</div>
                  <div></div>
                </div>
                <VirtualizedList
                  items={videosQuery.data!.items}
                  getKey={(v) => v.id}
                  estimateSize={56}
                  renderItem={(v) => (
                    <div className="grid grid-cols-[1fr_180px_120px_120px_120px_60px] gap-4 px-4 py-3 border-t border-ink-100 dark:border-ink-800 text-sm items-center">
                      <Link
                        to={`/videos/${v.id}`}
                        className="font-medium text-ink-900 dark:text-ink-50 hover:text-brand-700 truncate"
                      >
                        {v.title}
                      </Link>
                      {/*
                       * min-w-0 lets the grid cell shrink so truncation works;
                       * the truncate lives on the LINK (block) not this wrapper.
                       * A truncating wrapper has overflow:hidden, which clips the
                       * link's focus ring to a sliver — putting truncate on the
                       * link instead keeps its own ring intact (an element's
                       * overflow never clips its OWN outline).
                       */}
                      <div className="text-ink-700 dark:text-ink-300 min-w-0">
                        {v.creator && (
                          <Link
                            to={`/creators/${v.creator.id}`}
                            className="hover:text-brand-700 block truncate"
                          >
                            {v.creator.name}
                          </Link>
                        )}
                      </div>
                      <div className="text-ink-500 dark:text-ink-400 text-xs">
                        {formatDate(v.publishedAt)}
                      </div>
                      <div>
                        <TranscriptStatusBadge status={v.transcriptStatus} />
                      </div>
                      <div>
                        <AnalysisStatusBadge status={v.analysisStatus} />
                      </div>
                      <Link
                        to={`/videos/${v.id}`}
                        className="text-brand-700 hover:underline text-xs text-right"
                      >
                        {strings.common.open} →
                      </Link>
                    </div>
                  )}
                />
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 dark:bg-ink-900 text-left text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                    <tr>
                      <th className="px-4 py-3">
                        {strings.videos.table.title}
                      </th>
                      <th className="px-4 py-3">
                        {strings.videos.table.creator}
                      </th>
                      <th className="px-4 py-3">
                        {strings.videos.table.published}
                      </th>
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
                    {videosQuery.data!.items.map((v) => (
                      <tr key={v.id}>
                        <td className="px-4 py-3 max-w-lg">
                          <Link
                            to={`/videos/${v.id}`}
                            className="font-medium text-ink-900 dark:text-ink-50 hover:text-brand-700"
                          >
                            {v.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-ink-700 dark:text-ink-300">
                          {v.creator && (
                            <Link
                              to={`/creators/${v.creator.id}`}
                              className="hover:text-brand-700"
                            >
                              {v.creator.name}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-500 dark:text-ink-400 text-xs">
                          {formatDate(v.publishedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <TranscriptStatusBadge status={v.transcriptStatus} />
                        </td>
                        <td className="px-4 py-3">
                          <AnalysisStatusBadge status={v.analysisStatus} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/videos/${v.id}`}
                            className="text-brand-700 hover:underline text-xs"
                          >
                            {strings.common.open} →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden grid sm:grid-cols-2 gap-4">
            {videosQuery.data!.items.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>

          {videosQuery.data!.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="text-ink-500 dark:text-ink-400">
                {strings.common.page} {videosQuery.data!.page}{" "}
                {strings.common.of} {videosQuery.data!.totalPages} ·{" "}
                {videosQuery.data!.total} {strings.creators.cardVideos}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={filters.page <= 1}
                  onClick={() => update("page", filters.page - 1)}
                >
                  ← {strings.common.prev}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={filters.page >= videosQuery.data!.totalPages}
                  onClick={() => update("page", filters.page + 1)}
                >
                  {strings.common.next} →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
