import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { CreatorComparison, CreatorListItem } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  AiNote,
} from "../components/States";
import { StatCard } from "../components/StatCard";
import { StanceBadge } from "../components/Badges";
import { StanceOverlayChart } from "../components/Charts";
import { strings } from "../i18n/en";

const MIN_CREATORS_TO_COMPARE = 2;
const MAX_CREATORS_TO_COMPARE = 5;

/**
 * Static map from creator count → the `lg:` grid-columns utility class.
 *
 * Tailwind's JIT compiler only emits classes it can find as complete
 * string literals in the source. A class built at runtime like
 * `"lg:grid-cols-" + n` is invisible to that scan, so the column count
 * silently fell back to one column for 3-5 creators. Spelling each class
 * out as a literal here guarantees Tailwind generates them, while the
 * lookup still picks the right one per the resolved creator count.
 */
const LG_GRID_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

/**
 * ComparePage — the multi-creator side-by-side comparison view, route `/compare`.
 * Implements Milestone #5 (cross-creator analysis).
 *
 * Workflow:
 * 1. User lands on the page and sees an empty picker plus a hint to
 * "Pick at least 2 creators".
 * 2. User toggles creator chips on/off. The picker enforces:
 * - At least 2 creators selected before the query fires
 * (`enabled: selected.length >= MIN_CREATORS_TO_COMPARE && selected.length <= MAX_CREATORS_TO_COMPARE`).
 * - At most 5 creators selected — additional chips become disabled
 * and visually de-emphasized.
 * 3. Once ≥2 selections exist, React Query hits
 * `GET /api/creators/compare?creatorIds=...` and the page renders
 * three sections side-by-side:
 * - "Coverage" — one card per creator with video/transcript/topic/
 * evidence counts.
 * - "Shared topics" — a table where each row is a topic shared by
 * ≥2 of the selected creators and each column shows that creator's
 * dominant stance + mention/video counts.
 * - "Stance over time" — a multi-line overlay chart, one line per
 * creator, on a unified time axis.
 *
 * Deep-link contract:
 * - The page accepts a `?creators=id1,id2[,...]` query parameter.
 * - When present (e.g. via the "Compare with…" button on the Creator
 * Overview page) the picker initializes with those IDs already
 * selected and the query fires immediately.
 * - The deep-link param is read once on mount AND on each
 * `searchParams` change so back/forward navigation re-syncs the picker.
 *
 * Order preservation: selections are stored in insertion order so the
 * stat cards and timeline lines appear in the order the user picked them.
 */
export function ComparePage() {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() => {
    const initial = searchParams.get("creators");
    if (!initial) return [];
    return initial
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_CREATORS_TO_COMPARE);
  });

  /*
   * If the deep-link param changes (e.g. via NavLink with a fresh query),
   * sync the picker so users don't see stale selections.
   */
  useEffect(() => {
    const fresh = searchParams.get("creators");
    /*
     * Param removed/empty → clear the selection (was an early `return`, which
     * left the previous selection stranded when the user cleared the URL).
     * Identity-stable: keep the same `[]` reference when already empty so the
     * `compareQuery` key doesn't churn and re-trigger this effect.
     */
    if (!fresh) {
      setSelected((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    /* Parse the comma-separated deep-link param the same way the initializer does. */
    const next = fresh
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_CREATORS_TO_COMPARE);
    /*
     * Identity-stable update: if the parsed param already matches the
     * current selection (same length, same IDs in the same order) we
     * return `prev` so the state reference is unchanged and React skips
     * the re-render. Returning a fresh `next` array on every run would
     * give `selected` a new reference each time, which feeds the
     * `compareQuery` key and would re-fetch on every render — and because
     * those re-renders re-run this effect, it would loop. The equality
     * check breaks that cycle while still adopting genuinely new params.
     */
    setSelected((prev) =>
      prev.length === next.length && prev.every((id, i) => id === next[i])
        ? prev
        : next,
    );
  }, [searchParams]);

  const creatorsQuery = useQuery({
    queryKey: ["creators-for-compare"],
    queryFn: () => api.get<{ items: CreatorListItem[] }>("/creators"),
  });

  const compareQuery = useQuery({
    queryKey: ["creator-compare", selected],
    queryFn: () =>
      api.get<CreatorComparison>("/creators/compare", {
        creatorIds: selected.join(","),
      }),
    enabled:
      selected.length >= MIN_CREATORS_TO_COMPARE &&
      selected.length <= MAX_CREATORS_TO_COMPARE,
  });

  /**
   * Toggle a creator chip in/out of the selection.
   * - Already selected → remove it (filtering preserves the insertion
   * order of the remaining IDs).
   * - Not selected and the cap is reached → no-op (return `prev`
   * unchanged). The UI also disables over-cap chips, so this is a
   * defensive guard against the cap being exceeded.
   * - Not selected and under the cap → append it, so the new pick lands
   * last and downstream stat cards / timeline lines stay in pick order.
   */
  function toggleCreatorSelection(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_CREATORS_TO_COMPARE
          ? prev
          : [...prev, id],
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={strings.compare.title}
        subtitle={strings.compare.subtitle}
      />

      <section className="card card-pad space-y-3">
        <h2 className="section-h2">{strings.compare.pickCreators}</h2>
        {creatorsQuery.isLoading ? (
          <LoadingState />
        ) : creatorsQuery.isError ? (
          <ErrorState
            message={(creatorsQuery.error as Error).message}
            onRetry={() => creatorsQuery.refetch()}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(creatorsQuery.data?.items ?? []).map((creator) => {
              const isSelected = selected.includes(creator.id);
              const disabled =
                !isSelected && selected.length >= MAX_CREATORS_TO_COMPARE;
              return (
                <button
                  key={creator.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleCreatorSelection(creator.id)}
                  aria-pressed={isSelected}
                  className={
                    "px-3 py-1.5 rounded-full border text-sm transition " +
                    (isSelected
                      ? "bg-brand-600 text-white border-brand-600"
                      : disabled
                        ? "bg-ink-50 text-ink-400 border-ink-200 cursor-not-allowed"
                        : "bg-white dark:bg-ink-900 text-ink-700 dark:text-ink-200 border-ink-200 dark:border-ink-700 hover:border-brand-300")
                  }
                >
                  {creator.name}
                </button>
              );
            })}
          </div>
        )}
        {selected.length < MIN_CREATORS_TO_COMPARE && (
          <p className="text-xs text-ink-500 dark:text-ink-400">
            {strings.compare.needAtLeastTwo}
          </p>
        )}
      </section>

      {selected.length < MIN_CREATORS_TO_COMPARE ? (
        <EmptyState
          title={strings.compare.pickCreators}
          description={strings.compare.needAtLeastTwo}
        />
      ) : compareQuery.isLoading ? (
        <LoadingState />
      ) : compareQuery.isError ? (
        <ErrorState
          message={(compareQuery.error as Error).message}
          onRetry={() => compareQuery.refetch()}
        />
      ) : compareQuery.data ? (
        <ComparisonResult data={compareQuery.data} />
      ) : null}
    </div>
  );
}

/**
 * ComparisonResult — renders the loaded `CreatorComparison` payload as the
 * three stacked sections of the Compare page: per-creator stat cards, the
 * shared-topics table (one column per creator, dominant stance + counts per
 * cell), and the multi-line stance-over-time overlay chart. Split out from
 * `ComparePage` so the page component only handles selection + fetch state.
 */
function ComparisonResult({ data }: { data: CreatorComparison }) {
  /* Map the comparison into the {id, name} series the overlay chart + legend need. */
  const series = data.creators.map((creator) => ({
    id: creator.creatorId,
    name: creator.name,
  }));
  return (
    <>
      {/* Shared-topic stances + the stance-over-time overlay are ML-derived. */}
      <AiNote className="mb-2" />
      <section>
        <h2 className="section-h2">{strings.compare.statsSection}</h2>
        <div
          className={
            "grid gap-4 grid-cols-1 sm:grid-cols-2 " +
            (LG_GRID_COLS[data.creators.length] ?? "lg:grid-cols-5")
          }
        >
          {data.creators.map((creator) => (
            <div key={creator.creatorId} className="card card-pad space-y-3">
              <div className="flex items-center gap-3">
                {creator.thumbnailUrl ? (
                  <img
                    src={creator.thumbnailUrl}
                    alt=""
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-ink-200 dark:bg-ink-700" />
                )}
                <Link
                  to={`/creators/${creator.creatorId}`}
                  className="font-semibold text-ink-900 dark:text-ink-50 hover:underline"
                >
                  {creator.name}
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label={strings.compare.statVideos}
                  value={creator.videoCount}
                />
                <StatCard
                  label={strings.compare.statTranscripts}
                  value={creator.transcriptCount}
                />
                <StatCard
                  label={strings.compare.statTopics}
                  value={creator.topicCount}
                />
                <StatCard
                  label={strings.compare.statEvidence}
                  value={creator.evidenceCount}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-h2">{strings.compare.sharedTopicsSection}</h2>
        {data.sharedTopics.length === 0 ? (
          <p className="empty-msg">{strings.compare.sharedTopicsEmpty}</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead className="data-table-head">
                <tr>
                  <th className="px-4 py-2 text-left">
                    {strings.compare.sharedTopicsSection}
                  </th>
                  {data.creators.map((creator) => (
                    <th key={creator.creatorId} className="px-4 py-2 text-left">
                      {creator.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="data-table-body">
                {data.sharedTopics.map((row) => (
                  <tr key={row.topicId}>
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    {row.perCreator.map((p) => (
                      <td key={p.creatorId} className="px-4 py-2">
                        <Link
                          to={`/creators/${p.creatorId}/topics/${row.topicId}`}
                          className="block rounded-md p-2 -m-2 transition hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-brand-950/30"
                          aria-label={`Open ${row.name} analysis`}
                        >
                          <span className="flex flex-col gap-1">
                            <StanceBadge stance={p.dominantStance} />
                            <span className="meta-row">
                              {p.mentionCount}{" "}
                              {strings.compare.mentionsCol.toLowerCase()} ·{" "}
                              {p.videoCount}{" "}
                              {strings.compare.videosCol.toLowerCase()}
                            </span>
                          </span>
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-h2">{strings.compare.timelineSection}</h2>
        {data.timeline.points.length === 0 ? (
          <p className="empty-msg">{strings.compare.timelineEmpty}</p>
        ) : (
          <StanceOverlayChart points={data.timeline.points} series={series} />
        )}
      </section>
    </>
  );
}
