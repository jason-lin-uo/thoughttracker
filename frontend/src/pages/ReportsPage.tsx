import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApiCall } from "../hooks/useApiCall";
import type { CreatorListItem, Page, Report, Topic } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  AiNote,
} from "../components/States";
import { ReportCard } from "../components/Cards";
import { fillTemplate, humanizeLabel } from "../lib/format";
import { strings } from "../i18n/en";

const TYPES = ["", "creator_summary", "topic_summary"];

/**
 * ReportsPage — the generated-reports index, route `/reports`.
 *
 * Filters by creator / topic / report type. Each result is a `ReportCard`
 * (clicking opens `/reports/:id`) wrapped with selection + delete affordances:
 * a per-card checkbox + delete button, plus a toolbar to select-all, delete the
 * selected set, or delete every report. All deletes funnel through
 * `POST /api/reports/bulk-delete`; "delete all" is confirmed first since it's
 * destructive. Generation still happens on the Creator/Topic analysis pages.
 */
const PAGE_SIZE = 12;

/** Sort dropdown options → the server-side `sort` key, in display order. */
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "date_desc", label: strings.reports.sortNewest },
  { value: "date_asc", label: strings.reports.sortOldest },
  { value: "title_asc", label: strings.reports.sortTitleAsc },
  { value: "title_desc", label: strings.reports.sortTitleDesc },
];

export function ReportsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    creatorId: "",
    topicId: "",
    reportType: "",
    sort: "date_desc",
    page: 1,
  });
  /* Ids the user has checked for a bulk delete (scoped to the current page). */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const creatorsQuery = useQuery({
    queryKey: ["creators-for-filter"],
    queryFn: () => api.get<{ items: CreatorListItem[] }>("/creators"),
  });
  const topicsQuery = useQuery({
    queryKey: ["topics-for-filter"],
    queryFn: () => api.get<{ items: Topic[] }>("/topics"),
  });

  const reportsQuery = useQuery({
    queryKey: [
      "reports",
      filters.creatorId,
      filters.topicId,
      filters.reportType,
      filters.sort,
      filters.page,
    ],
    queryFn: () =>
      api.get<Page<Report>>("/reports", {
        creatorId: filters.creatorId || undefined,
        topicId: filters.topicId || undefined,
        reportType: filters.reportType || undefined,
        sort: filters.sort,
        page: filters.page,
        pageSize: PAGE_SIZE,
      }),
  });

  const reports = useMemo(
    () => reportsQuery.data?.items ?? [],
    [reportsQuery.data],
  );
  const totalPages = reportsQuery.data?.totalPages ?? 1;

  const deleteMutation = useApiCall(
    (body: { ids: string[] } | { all: true }) =>
      api.post<{ deleted: number }>("/reports/bulk-delete", body),
    {
      successTitle: strings.toasts.reportsDeletedTitle,
      successMessage: strings.toasts.reportsDeletedBody,
      onSuccess: () => {
        setSelected(new Set());
        /* The dashboard's "recent reports" rail reads the same data. */
        queryClient.invalidateQueries({ queryKey: ["reports"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      },
    },
  );

  /* Update one filter, reset to page 1, and clear the (now-stale) selection. */
  function updateFilter(patch: Partial<typeof filters>) {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
    setSelected(new Set());
  }

  /* Move to another page; selection is per-page, so clear it on navigation. */
  function goToPage(page: number) {
    setFilters((f) => ({ ...f, page }));
    setSelected(new Set());
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected =
    reports.length > 0 && reports.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(reports.map((r) => r.id)));
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    deleteMutation.run({ ids: [...selected] });
  }
  function deleteAll() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        fillTemplate(strings.reports.confirmDeleteAll, {
          count: reports.length,
        }),
      )
    ) {
      return;
    }
    deleteMutation.run({ all: true });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.reports.title}
        subtitle={strings.reports.subtitle}
      />

      <div className="card card-pad grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="label">{strings.common.creator}</label>
          <select
            aria-label={strings.common.creator}
            className="input"
            value={filters.creatorId}
            onChange={(e) => updateFilter({ creatorId: e.target.value })}
          >
            <option value="">{strings.common.all}</option>
            {creatorsQuery.data?.items.map((creator) => (
              <option key={creator.id} value={creator.id}>
                {creator.name}
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
            onChange={(e) => updateFilter({ topicId: e.target.value })}
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
          <label className="label">{strings.reports.typeLabel}</label>
          <select
            aria-label={strings.reports.typeLabel}
            className="input"
            value={filters.reportType}
            onChange={(e) => updateFilter({ reportType: e.target.value })}
          >
            {TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp ? humanizeLabel(tp) : strings.common.any}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{strings.reports.sortLabel}</label>
          <select
            aria-label={strings.reports.sortLabel}
            className="input"
            value={filters.sort}
            onChange={(e) => updateFilter({ sort: e.target.value })}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {reportsQuery.isLoading ? (
        <LoadingState />
      ) : reportsQuery.isError ? (
        <ErrorState
          message={(reportsQuery.error as Error).message}
          onRetry={() => reportsQuery.refetch()}
        />
      ) : reports.length === 0 ? (
        <EmptyState
          title={strings.reports.emptyTitle}
          description={strings.reports.emptyDescription}
        />
      ) : (
        <>
          {/* Selection + bulk-delete toolbar. */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={allSelected}
                onChange={toggleAll}
              />
              {strings.reports.selectAll}
            </label>
            <span className="text-sm text-ink-500 dark:text-ink-400">
              {fillTemplate(strings.reports.selectedCount, {
                count: selected.size,
              })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={selected.size === 0 || deleteMutation.isPending}
                onClick={deleteSelected}
              >
                {strings.reports.deleteSelected}
              </button>
              <button
                type="button"
                className="btn-secondary text-rose-600 dark:text-rose-400"
                disabled={deleteMutation.isPending}
                onClick={deleteAll}
              >
                {deleteMutation.isPending
                  ? strings.reports.deleting
                  : strings.reports.deleteAll}
              </button>
            </div>
          </div>

          {/* Report summaries are AI-generated — one note for the grid. */}
          <AiNote />
          <div className="grid sm:grid-cols-2 gap-4">
            {reports.map((r) => (
              /*
               * Row = [checkbox] [card]. The checkbox sits OUTSIDE the card (to
               * its left) so it never overlaps the card's eyebrow/title; only the
               * delete "×" overlays the card, in the empty top-right corner.
               */
              <div key={r.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={fillTemplate(strings.reports.selectOne, {
                    title: r.title,
                  })}
                  className="mt-5 h-4 w-4 shrink-0 accent-brand-600"
                  checked={selected.has(r.id)}
                  onChange={() => toggleOne(r.id)}
                />
                <div className="relative min-w-0 flex-1">
                  <button
                    type="button"
                    aria-label={fillTemplate(strings.reports.deleteOne, {
                      title: r.title,
                    })}
                    className="absolute right-2 top-2 z-10 rounded-md px-2 py-0.5 text-lg leading-none text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.run({ ids: [r.id] })}
                  >
                    ×
                  </button>
                  <ReportCard report={r} />
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="text-ink-500 dark:text-ink-400">
                {strings.common.page} {reportsQuery.data!.page}{" "}
                {strings.common.of} {totalPages} · {reportsQuery.data!.total}{" "}
                {strings.reports.title.toLowerCase()}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={filters.page <= 1}
                  onClick={() => goToPage(filters.page - 1)}
                >
                  ← {strings.common.prev}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={filters.page >= totalPages}
                  onClick={() => goToPage(filters.page + 1)}
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
