import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useFilters } from "../lib/useFilters";
import type {
  ChunkTopicAnalysis,
  CreatorListItem,
  Page,
  Topic,
} from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  AiNote,
} from "../components/States";
import { EvidenceCard } from "../components/Cards";
import {
  VirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../components/VirtualizedList";
import { humanizeLabel } from "../lib/format";
import { strings } from "../i18n/en";

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
 * EvidencePage — the evidence explorer, route `/evidence`.
 *
 * The "show me the receipts" page: every row is one classified chunk of
 * transcript with a stance + confidence + topic + evidence quote. The
 * filter grid mirrors VideosPage's (creator / topic / search / stance /
 * confidence / date range) so a viewer can slice the evidence corpus
 * arbitrarily.
 *
 * Each result is rendered as an `EvidenceCard` and clicking "View
 * context" opens `/evidence/:analysisId` for the previous-chunk +
 * main-chunk + next-chunk view, which is the strongest argument we
 * have that the AI didn't hallucinate the citation.
 */
export function EvidencePage() {
  const [filters, update] = useFilters({
    creatorId: "",
    topicId: "",
    stanceLabel: "",
    confidenceLabel: "",
    search: "",
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
   * Explicit primitive key tuple — see note in VideosPage. Avoids
   * cache-key churn from same-shape-different-reference filter objects.
   */
  const evidenceQuery = useQuery({
    queryKey: [
      "evidence",
      filters.creatorId,
      filters.topicId,
      filters.stanceLabel,
      filters.confidenceLabel,
      filters.search,
      filters.from,
      filters.to,
      filters.page,
    ],
    queryFn: ({ signal }) =>
      api.get<Page<ChunkTopicAnalysis>>(
        "/evidence",
        {
          creatorId: filters.creatorId || undefined,
          topicId: filters.topicId || undefined,
          stanceLabel: filters.stanceLabel || undefined,
          confidenceLabel: filters.confidenceLabel || undefined,
          search: filters.search || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page: filters.page,
          pageSize: 12,
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
        title={strings.evidence.title}
        subtitle={strings.evidence.subtitle}
      />

      <AiNote />

      <div className="filter-grid">
        <div className="lg:col-span-2">
          <label className="label">{strings.evidence.searchLabel}</label>
          <input
            aria-label={strings.evidence.searchLabel}
            className="input"
            type="text"
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder={strings.evidence.searchPlaceholder}
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

      {evidenceQuery.isLoading ? (
        <LoadingState />
      ) : evidenceQuery.isError ? (
        <ErrorState
          message={(evidenceQuery.error as Error).message}
          onRetry={() => evidenceQuery.refetch()}
        />
      ) : evidenceQuery.data!.items.length === 0 ? (
        <EmptyState
          title={strings.evidence.emptyTitle}
          description={strings.evidence.emptyDescription}
        />
      ) : (
        <>
          {evidenceQuery.data!.items.length > VIRTUALIZE_THRESHOLD ? (
            /*
             * Large page: windowed rendering keeps DOM weight + paint
             * cost flat. Single-column layout (the virtualizer wants a
             * single scrollable axis); the grid below is the small-list
             * path that keeps the 2-col aesthetic.
             */
            <VirtualizedList
              items={evidenceQuery.data!.items}
              getKey={(ev) => ev.id}
              estimateSize={260}
              renderItem={(ev) => (
                <div className="pb-4">
                  <EvidenceCard evidence={ev} />
                </div>
              )}
            />
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              {evidenceQuery.data!.items.map((ev) => (
                <EvidenceCard key={ev.id} evidence={ev} />
              ))}
            </div>
          )}

          {evidenceQuery.data!.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="text-ink-500 dark:text-ink-400">
                {strings.common.page} {evidenceQuery.data!.page}{" "}
                {strings.common.of} {evidenceQuery.data!.totalPages} ·{" "}
                {evidenceQuery.data!.total} {strings.evidence.items}
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
                  disabled={filters.page >= evidenceQuery.data!.totalPages}
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
