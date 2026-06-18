import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Topic } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/States";
import { fillTemplate } from "../lib/format";
import { strings } from "../i18n/en";

/**
 * A topic row from `GET /api/topics`, carrying the corpus-coverage counts the
 * list shows: `videoSummaries` (videos that discuss the topic) and
 * `chunkAnalyses` (individual classified mentions), plus `createdAt` so the
 * list can offer newest/oldest sorts.
 */
type TopicWithCounts = Topic & {
  createdAt: string;
  _count: { videoSummaries: number; chunkAnalyses: number };
};

/** The sort options offered by the dropdown, in display order. */
type TopicSort =
  | "alpha_asc"
  | "alpha_desc"
  | "videos_desc"
  | "videos_asc"
  | "mentions_desc"
  | "mentions_asc"
  | "newest"
  | "oldest";

const SORT_OPTIONS: Array<{ value: TopicSort; label: string }> = [
  { value: "alpha_asc", label: strings.topics.sortAlphaAsc },
  { value: "alpha_desc", label: strings.topics.sortAlphaDesc },
  { value: "videos_desc", label: strings.topics.sortMostVideos },
  { value: "videos_asc", label: strings.topics.sortFewestVideos },
  { value: "mentions_desc", label: strings.topics.sortMostMentions },
  { value: "mentions_asc", label: strings.topics.sortFewestMentions },
  { value: "newest", label: strings.topics.sortNewest },
  { value: "oldest", label: strings.topics.sortOldest },
];

/** Pure comparators for each sort option (no list mutation at the call site). */
const COMPARATORS: Record<
  TopicSort,
  (a: TopicWithCounts, b: TopicWithCounts) => number
> = {
  alpha_asc: (a, b) => a.name.localeCompare(b.name),
  alpha_desc: (a, b) => b.name.localeCompare(a.name),
  videos_desc: (a, b) => b._count.videoSummaries - a._count.videoSummaries,
  videos_asc: (a, b) => a._count.videoSummaries - b._count.videoSummaries,
  mentions_desc: (a, b) => b._count.chunkAnalyses - a._count.chunkAnalyses,
  mentions_asc: (a, b) => a._count.chunkAnalyses - b._count.chunkAnalyses,
  newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  oldest: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
};

/**
 * TopicsPage — the topic-taxonomy catalog, route `/topics`.
 *
 * Reached from the dashboard's "Topics" stat card. Lists every detected topic
 * with its coverage counts, a sort dropdown (alphabetical / by videos / by
 * mentions / by recency, each direction), and a combo filter that doubles as a
 * type-ahead AND a pick-from-list dropdown (native `<datalist>`). Each topic
 * links into the videos index pre-filtered to that topic, so the catalog is a
 * launchpad into the underlying transcripts rather than a dead end.
 */
export function TopicsPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TopicSort>("alpha_asc");
  const topicsQuery = useQuery({
    queryKey: ["topics-index"],
    queryFn: () => api.get<{ items: TopicWithCounts[] }>("/topics"),
  });

  /* Stable reference per fetched payload (keeps the filter/sort memo honest). */
  const allItems = useMemo(
    () => topicsQuery.data?.items ?? [],
    [topicsQuery.data],
  );

  /*
   * Filter (client-side, case-insensitive substring) then sort a COPY by the
   * chosen comparator. The taxonomy is bounded (server-capped), so doing this
   * in the browser is cheap and avoids a round-trip per keystroke.
   */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allItems.filter((t) => t.name.toLowerCase().includes(q))
      : allItems;
    return [...filtered].sort(COMPARATORS[sort]);
  }, [allItems, search, sort]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.topics.title}
        subtitle={strings.topics.subtitle}
      />

      {topicsQuery.isLoading ? (
        <LoadingState />
      ) : topicsQuery.isError ? (
        <ErrorState
          message={(topicsQuery.error as Error).message}
          onRetry={() => topicsQuery.refetch()}
        />
      ) : topicsQuery.data!.items.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title={strings.topics.emptyTitle}
          description={strings.topics.emptyDescription}
        />
      ) : (
        <>
          <div className="card card-pad flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="label" htmlFor="topics-search">
                {strings.topics.searchLabel}
              </label>
              {/*
               * Plain text filter (no native <datalist> dropdown — that combo
               * rendered an intrusive OS-styled popup). The filtered topic grid
               * below IS the pickable list, so a dropdown of names was redundant.
               */}
              <input
                id="topics-search"
                type="text"
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={strings.topics.searchPlaceholder}
              />
            </div>
            <div className="sm:w-56">
              <label className="label" htmlFor="topics-sort">
                {strings.topics.sortLabel}
              </label>
              <select
                id="topics-sort"
                className="input cursor-pointer"
                value={sort}
                onChange={(e) => setSort(e.target.value as TopicSort)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="meta-row">
            {fillTemplate(strings.topics.countLine, {
              shown: visible.length,
              total: allItems.length,
            })}
          </p>

          {visible.length === 0 ? (
            <p className="empty-msg">{strings.topics.noMatches}</p>
          ) : (
            <div className="card-grid">
              {visible.map((topic) => (
                <Link
                  key={topic.id}
                  to={`/videos?topicId=${topic.id}`}
                  className="card card-pad group block transition hover:border-brand-300 hover:shadow-md"
                >
                  <p className="font-semibold text-ink-900 dark:text-ink-50 group-hover:text-brand-700 dark:group-hover:text-brand-300">
                    {topic.name}
                  </p>
                  {topic.description && (
                    <p className="text-sm text-ink-600 dark:text-ink-400 mt-2 line-clamp-2">
                      {topic.description}
                    </p>
                  )}
                  <p className="meta-row mt-3">
                    {fillTemplate(strings.topics.coverage, {
                      videos: topic._count.videoSummaries,
                      mentions: topic._count.chunkAnalyses,
                    })}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
