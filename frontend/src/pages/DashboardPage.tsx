import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { DashboardResponse, FeaturedInsight } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  AiNote,
} from "../components/States";
import { StatCard } from "../components/StatCard";
import { ReportCard } from "../components/Cards";
import { ImportStatusBadge } from "../components/Badges";
import { fillTemplate, formatRelative } from "../lib/format";
import { featuredHeadline } from "../lib/dashboard";
import { strings } from "../i18n/en";

/**
 * ShiftGlyph — a small inline illustration for the hero when the featured topic
 * is a stance SHIFT: a trajectory that climbs, pivots at a marked point, and
 * arrows off in a new direction, with a sparkle for the "wait, they changed
 * their mind?" beat. Pure SVG (no asset pipeline), brand-tinted, decorative.
 */
function ShiftGlyph({ className = "" }: { className?: string }) {
  return (
    <div
      className={`place-items-center rounded-2xl bg-brand-50 dark:bg-brand-950/40 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 96 96"
        className="h-12 w-12 text-brand-600 dark:text-brand-400"
        fill="none"
      >
        {/* a path that rises, dips, then pivots sharply upward — a change of direction */}
        <polyline
          points="12,70 34,50 52,60 80,26"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* arrowhead on the new heading */}
        <path
          d="M64 26 L80 26 L80 42"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* the pivot point — where the view turned */}
        <circle cx="52" cy="60" r="5.5" fill="currentColor" />
        {/* surprise sparkle */}
        <path
          d="M74 58 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 z"
          fill="currentColor"
          className="opacity-60"
        />
      </svg>
    </div>
  );
}

/**
 * SpotlightGlyph — the hero illustration when the featured topic is NOT a stance
 * shift (a steady/contested "spotlight" topic). A central mark with radiating
 * rays — "this is the one worth your attention" — so non-shift heroes get the
 * same visual anchor as shift heroes instead of a bare text block. Pure SVG,
 * brand-tinted, decorative.
 */
function SpotlightGlyph({ className = "" }: { className?: string }) {
  return (
    <div
      className={`place-items-center rounded-2xl bg-brand-50 dark:bg-brand-950/40 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 96 96"
        className="h-12 w-12 text-brand-600 dark:text-brand-400"
        fill="none"
      >
        {/* the subject in focus */}
        <circle cx="48" cy="48" r="13" fill="currentColor" />
        <circle
          cx="48"
          cy="48"
          r="22"
          stroke="currentColor"
          strokeWidth="4"
          className="opacity-40"
        />
        {/* radiating rays — the spotlight on it */}
        <g stroke="currentColor" strokeWidth="6" strokeLinecap="round">
          <line x1="48" y1="8" x2="48" y2="20" />
          <line x1="48" y1="76" x2="48" y2="88" />
          <line x1="8" y1="48" x2="20" y2="48" />
          <line x1="76" y1="48" x2="88" y2="48" />
          <line x1="20" y1="20" x2="28" y2="28" />
          <line x1="68" y1="68" x2="76" y2="76" />
          <line x1="76" y1="20" x2="68" y2="28" />
          <line x1="28" y1="68" x2="20" y2="76" />
        </g>
      </svg>
    </div>
  );
}

/**
 * FeaturedShift - the dashboard's single hero highlight.
 *
 * Surfaces the server-selected insight. The backend prefers the latest topic
 * report when it maps to analyzed timeline data, which lets the featured
 * default report headline a fresh demo. Otherwise it falls back to the strongest analyzed
 * timeline. The card deep-links to the report when one exists, falling back to
 * the topic-analysis page otherwise.
 *
 * @param props.insight - The server-computed featured insight.
 */
function FeaturedShift({ insight }: { insight: FeaturedInsight }) {
  /* Prefer the report title so the hero headline matches the report it opens. */
  const { eyebrow, title: templatedTitle } = featuredHeadline(insight);
  const title = insight.reportTitle ?? templatedTitle;
  const isShift =
    insight.trendLabel === "abrupt_shift" ||
    insight.trendLabel === "gradual_shift";
  const to = insight.reportId
    ? `/reports/${insight.reportId}`
    : `/creators/${insight.creatorId}/topics/${insight.topicId}`;
  return (
    <Link
      to={to}
      className="card card-pad-lg block hover:border-brand-300 hover:shadow-md transition group"
    >
      <div className="flex items-start gap-5">
        {isShift ? (
          <ShiftGlyph className="hidden sm:grid h-20 w-20 shrink-0" />
        ) : (
          <SpotlightGlyph className="hidden sm:grid h-20 w-20 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="section-eyebrow">{eyebrow}</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-ink-900 dark:text-ink-50 group-hover:text-brand-700 dark:group-hover:text-brand-300">
            {title}
          </h2>
          <p className="mt-3 text-ink-600 dark:text-ink-400 line-clamp-3 max-w-2xl">
            {insight.summary || strings.dashboard.featured.fallbackBody}
          </p>
          <p className="meta-row mt-4">
            {insight.creatorName} · {insight.topicName}
          </p>
          <AiNote className="mt-3" />
        </div>
      </div>
    </Link>
  );
}

/**
 * DashboardPage - the app's home page, served at the route `/`.
 *
 * Job:
 * - Lead with a single FeaturedShift hero: latest topic report first, then the
 * strongest analyzed fallback, surfaced from the server's `featuredInsight`.
 * - Show the user a snapshot of the system in one screen: top-line
 * counts (creators / videos / topics / evidence; each stat tile is a
 * clickable drill-down into its list), the most recent import jobs, the
 * most recent creators, and the most recently generated reports.
 * - Surface an empty state with a CTA to start an import when no
 * creators exist yet, so a fresh deployment doesn't look broken.
 *
 * Data:
 * - One React Query hits `GET /api/dashboard` which returns the bundled
 * payload (server-side aggregation keeps the network round-trip
 * count to one).
 *
 * Loading / error states:
 * - Loading: full-page LoadingState.
 * - Error: full-page ErrorState with a retry button that refetches.
 * - Empty: centered EmptyState pointing at /imports.
 *
 * Why it's structured this way: the dashboard is the most common landing
 * page for a recruiter clicking through the demo, so it MUST work even
 * with no data, MUST surface a recognizable creator name on populated
 * databases, and MUST never blank-screen on a transient network error.
 */
export function DashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/dashboard"),
  });

  if (dashboardQuery.isLoading) return <LoadingState />;
  if (dashboardQuery.isError)
    return (
      <ErrorState
        message={(dashboardQuery.error as Error).message}
        onRetry={() => dashboardQuery.refetch()}
      />
    );
  const data = dashboardQuery.data!;
  const isEmpty = data.stats.creators === 0;
  const featured = data.featuredInsight;

  return (
    <div className="space-y-8">
      {/* Global actions live in the app chrome, so the dashboard title bar
 no longer duplicates them. */}
      <PageHeader
        title={strings.dashboard.title}
        subtitle={strings.dashboard.subtitle}
      />

      {isEmpty ? (
        <EmptyState
          icon="📊"
          title={strings.dashboard.emptyTitle}
          description={strings.dashboard.emptyDescription}
          cta={
            <Link to="/add-creators" className="btn-primary">
              {strings.dashboard.emptyCta}
            </Link>
          }
        />
      ) : (
        <>
          {featured && <FeaturedShift insight={featured} />}

          <div className="stats-grid">
            <StatCard
              label={strings.dashboard.statsCreators}
              value={data.stats.creators}
              icon="👤"
              to="/creators"
              tone="blue"
            />
            <StatCard
              label={strings.dashboard.statsVideos}
              value={data.stats.videos}
              icon="🎬"
              to="/videos"
              tone="teal"
            />
            <StatCard
              label={strings.dashboard.statsTopics}
              value={data.stats.topics}
              icon="🏷️"
              to="/topics"
              tone="violet"
            />
            <StatCard
              label={strings.dashboard.statsEvidence}
              value={data.stats.evidence}
              icon="📌"
              to="/evidence"
              tone="amber"
            />
          </div>

          <section>
            <div className="section-head">
              <h2 className="section-h2 mb-0">
                {strings.dashboard.recentCreators}
              </h2>
              <Link to="/creators" className="text-sm link-brand">
                {strings.common.viewAll}
              </Link>
            </div>
            {data.recentCreators.length === 0 ? (
              <p className="empty-msg">{strings.dashboard.noCreators}</p>
            ) : (
              <div className="card-grid">
                {data.recentCreators.map((creator) => (
                  <Link
                    key={creator.id}
                    to={`/creators/${creator.id}`}
                    className="card card-pad hover:border-brand-300 hover:shadow-md transition group"
                  >
                    <div className="flex items-center gap-3">
                      {creator.thumbnailUrl ? (
                        <img
                          src={creator.thumbnailUrl}
                          alt=""
                          className="w-11 h-11 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-ink-200 dark:bg-ink-700 grid place-items-center text-sm font-semibold text-ink-700 dark:text-ink-300">
                          {creator.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-900 dark:text-ink-50 truncate group-hover:text-brand-700 dark:group-hover:text-brand-300">
                          {creator.name}
                        </p>
                        <p className="meta-row">
                          {creator._count.videos} {strings.creators.cardVideos}
                        </p>
                      </div>
                    </div>
                    {creator.description && (
                      <p className="text-sm text-ink-600 dark:text-ink-400 mt-4 line-clamp-2">
                        {creator.description}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="section-head">
              <h2 className="section-h2 mb-0">
                {strings.dashboard.recentImports}
              </h2>
              <Link to="/imports" className="text-sm link-brand">
                {strings.common.viewAll}
              </Link>
            </div>
            <div className="card divide-y divide-ink-100 dark:divide-ink-800 overflow-hidden">
              {data.recentJobs.length === 0 ? (
                <p className="p-4 text-sm text-ink-500 dark:text-ink-400">
                  {strings.dashboard.noImportJobs}
                </p>
              ) : (
                data.recentJobs.map((job) => (
                  <Link
                    key={job.id}
                    to={`/imports/${job.id}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-ink-50 dark:hover:bg-ink-800 dark:bg-ink-900"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900 dark:text-ink-50 truncate">
                        {job.creator?.name ?? job.channelUrl}
                      </p>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                        {fillTemplate(strings.dashboard.videosImportedOf, {
                          imported: job.totalVideosImported,
                          found: job.totalVideosFound || job.requestedLimit,
                        })}
                        {" · "}
                        {formatRelative(job.createdAt)}
                      </p>
                    </div>
                    <div className="mt-2 sm:mt-0">
                      <ImportStatusBadge status={job.status} />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2 className="section-h2 mb-0">
                {strings.dashboard.recentReports}
              </h2>
              <Link to="/reports" className="text-sm link-brand">
                {strings.common.viewAll}
              </Link>
            </div>
            {data.recentReports.length === 0 ? (
              <p className="empty-msg">{strings.dashboard.noReports}</p>
            ) : (
              <>
                {/* Report summaries are AI-generated — one note for the grid. */}
                <AiNote className="mb-3" />
                <div className="grid sm:grid-cols-2 gap-5">
                  {data.recentReports.map((r) => (
                    <ReportCard key={r.id} report={r} />
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
