import { useState } from "react";
import { useTheme } from "../../theme/themeContext";
import {
  STANCE_FAMILY_ORDER,
  stanceColors,
  type StanceFamily,
} from "../../theme/tokens";
import {
  filterAndSortEvidence,
  type EvidenceRow,
  type EvidenceSort,
} from "../../lib/topicAnalysis";
import { fillTemplate, formatDate } from "../../lib/format";
import { StanceBadge } from "../Badges";
import { strings } from "../../i18n/en";

/** The sort dropdown options, in display order; default is `date_desc`. */
const SORT_OPTIONS: Array<{ value: EvidenceSort; label: string }> = [
  { value: "date_desc", label: strings.topicAnalysis.sortNewest },
  { value: "date_asc", label: strings.topicAnalysis.sortOldest },
  { value: "conf_desc", label: strings.topicAnalysis.sortHighConf },
  { value: "conf_asc", label: strings.topicAnalysis.sortLowConf },
];

/** The stance-filter pills: "all" plus the four families, in canonical order. */
const FILTER_PILLS: Array<"all" | StanceFamily> = [
  "all",
  ...STANCE_FAMILY_ORDER,
];

/** Evidence rows shown per page — the list paginates instead of dumping/capping. */
const PAGE_SIZE = 10;

/**
 * EvidenceList — the compact, non-intrusive evidence rows at the bottom of
 * the console (the prototype's filters + `.evlist`).
 *
 * Each row is a collapsed bar: a stance square, a stance badge, the claim
 * text, the date, and a caret; clicking it expands the verbatim quote as a
 * pull-quote (the prototype's `.pq blockquote`). Above the list sit the
 * stance-filter pills (All / supportive / mixed / neutral / opposed) and a
 * sort dropdown (Newest [default] / Oldest / Highest conf / Lowest conf);
 * below it, pagination controls (Previous / Next + "Page X of Y") so the FULL
 * evidence set is browsable 10 rows at a time rather than truncated.
 *
 * Composition: the parent passes rows ALREADY filtered by the date range;
 * this component layers the stance filter + sort on top, then paginates the
 * result (all four compose). Changing the filter or sort resets to page 1.
 *
 * Accessibility: each row is a `<button>` with `aria-expanded` toggling the
 * quote; the pills are `aria-pressed` toggles; the sort is a labeled
 * `<select>`; the pager buttons disable at the ends. The stance is always
 * named (badge text), never color-only.
 *
 * @param props.rows - The date-range-filtered evidence rows (server order).
 */
export function EvidenceList({ rows }: { rows: EvidenceRow[] }) {
  const { resolved } = useTheme();
  const [filter, setFilter] = useState<"all" | StanceFamily>("all");
  const [sort, setSort] = useState<EvidenceSort>("date_desc");
  /* Which row id is expanded (one at a time, like the prototype's accordion). */
  const [openId, setOpenId] = useState<string | null>(null);
  /* Current 1-based page; changing the filter or sort resets it to 1. */
  const [page, setPage] = useState(1);

  const visible = filterAndSortEvidence(rows, filter, sort);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  /* Clamp in case the result set shrank (e.g. a filter) below the current page. */
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = visible.slice(pageStart, pageStart + PAGE_SIZE);

  /*
   * Filter/sort changes reset to the first page so the user sees the top of
   * the newly-ordered/filtered set rather than a now-out-of-range page.
   */
  function applyFilter(next: "all" | StanceFamily) {
    setFilter(next);
    setPage(1);
  }
  function applySort(next: EvidenceSort) {
    setSort(next);
    setPage(1);
  }

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {FILTER_PILLS.map((pill) => {
          const active = filter === pill;
          return (
            <button
              key={pill}
              type="button"
              aria-pressed={active}
              onClick={() => applyFilter(pill)}
              className={
                "rounded-full border px-3.5 py-1 text-xs capitalize transition " +
                (active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-ink-200 bg-white text-ink-700 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200")
              }
            >
              {pill === "all" ? strings.topicAnalysis.filterAll : pill}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
          <span className="sr-only">{strings.topicAnalysis.sortLabel}</span>
          <select
            aria-label={strings.topicAnalysis.sortLabel}
            value={sort}
            onChange={(e) => applySort(e.target.value as EvidenceSort)}
            className="cursor-pointer rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {strings.topicAnalysis.sortLabel}: {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-ink-500 dark:text-ink-400">
            {fillTemplate(strings.topicAnalysis.noEvidenceInRange, {
              stance: filter === "all" ? "" : `${filter} `,
            })}
          </p>
        ) : (
          pageRows.map((row) => {
            const open = openId === row.id;
            const colors = stanceColors(row.stance, resolved);
            return (
              <div
                key={row.id}
                className="border-t border-ink-200 first:border-t-0 dark:border-ink-800"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : row.id)}
                  className="evidence-row"
                >
                  <span
                    aria-hidden
                    className="stance-square"
                    style={{ backgroundColor: colors.dot }}
                  />
                  <StanceBadge stance={row.stance} />
                  <span className="flex-1 truncate text-ink-700 dark:text-ink-200">
                    {row.claim}
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-500 dark:text-ink-400">
                    {formatDate(row.date)}
                  </span>
                  <span
                    aria-hidden
                    className={
                      "text-ink-400 transition-transform " +
                      (open ? "rotate-90" : "")
                    }
                  >
                    ›
                  </span>
                </button>
                {open && (
                  <div className="px-[40px] pb-4 pt-1">
                    <blockquote
                      className="border-l-[3px] pl-4 font-serif text-[15px] leading-relaxed text-ink-900 dark:text-ink-100"
                      style={{ borderColor: colors.dot }}
                    >
                      “{row.quote}”
                    </blockquote>
                    <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                      — {row.title} · {formatDate(row.date)} ·{" "}
                      {Math.round(row.conf * 100)}%{" "}
                      {strings.topicAnalysis.confidenceSuffix}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pager — only when there's more than one page. */}
      {visible.length > PAGE_SIZE && (
        <div className="mt-2.5 flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
          <span>
            {fillTemplate(strings.topicAnalysis.evidenceShowing, {
              from: String(pageStart + 1),
              to: String(pageStart + pageRows.length),
              count: String(visible.length),
            })}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              className="rounded-full border border-ink-200 px-3 py-1 transition enabled:hover:border-brand-300 disabled:opacity-40 dark:border-ink-700"
            >
              {strings.topicAnalysis.evidencePrev}
            </button>
            <span className="font-mono">
              {fillTemplate(strings.topicAnalysis.evidencePageOf, {
                page: String(safePage),
                total: String(totalPages),
              })}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              className="rounded-full border border-ink-200 px-3 py-1 transition enabled:hover:border-brand-300 disabled:opacity-40 dark:border-ink-700"
            >
              {strings.topicAnalysis.evidenceNext}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
