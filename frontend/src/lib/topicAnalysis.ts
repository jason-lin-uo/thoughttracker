/**
 * Topic-analysis ("analyst console") data model + pure derivations.
 *
 * No React, no DOM — every computation the analyst-console page leans on
 * (building the trajectory points from summaries, filtering EVERYTHING by a
 * client-side date range, computing the verdict, grouping the heatmap by
 * month, and sorting/filtering the evidence list) lives here so it is
 * unit-testable in isolation and the page component stays a thin renderer.
 *
 * The console filters CLIENT-SIDE (the date range never hits the backend),
 * so these helpers are the single source of truth for "what's in range".
 *
 * Shapes are adapted from the API `TopicAnalysis` payload (`summaries[]` +
 * `topEvidence[]`) into the console's own `StancePoint` / `EvidenceRow`
 * models, exactly as the topic-analysis prototype builds its `pts` and
 * `evidence` arrays from real data.
 */

import type { StanceLabel, TopicAnalysis } from "./types";
import {
  stanceFamily,
  STANCE_FAMILY_ORDER,
  type StanceFamily,
} from "../theme/tokens";

/**
 * One dated point on the stance trajectory — one video summary, mapped to
 * its dominant stance, with the verbatim evidence quotes folded in so a
 * click can surface real pull-quotes (the prototype's `pts[i]`).
 */
export interface StancePoint {
  /** Stable id (the summary id) for React keys + dot identity. */
  id: string;
  /** Epoch millis of the video's publish date (the x-axis value). */
  t: number;
  /** ISO publish date string (kept for display formatting). */
  date: string;
  /** The video's dominant stance label for this topic. */
  stance: StanceLabel;
  /** Confidence in [0,1] for the dominant-stance call. */
  conf: number;
  /** Video title (tooltip + modal heading). */
  title: string;
  /** Source URL for the video (modal "watch" affordance). */
  sourceUrl: string | null;
  /** Verbatim notable-evidence quotes for this video (modal pull-quotes). */
  quotes: string[];
  /** One-line summary, used as a modal fallback when no quotes exist. */
  summary: string | null;
}

/**
 * One row in the evidence list — a single classified chunk, adapted from a
 * `topEvidence[]` entry (the prototype's `evidence[i]`).
 */
export interface EvidenceRow {
  /** Stable id (the analysis id) for React keys + expand state. */
  id: string;
  /** The chunk's stance label. */
  stance: StanceLabel;
  /** The verbatim evidence quote (the expandable pull-quote). */
  quote: string;
  /** The AI's one-line claim summary (the collapsed-row label). */
  claim: string;
  /** Video title for the row's source line. */
  title: string;
  /** ISO publish date of the source video. */
  date: string;
  /** Confidence in [0,1]. */
  conf: number;
}

/** A computed verdict for the in-range trajectory points. */
export interface Verdict {
  /** Dominant stance family across the range (drives the verdict bar color). */
  family: StanceFamily;
  /** The dominant family's share of in-range videos, 0–100 (rounded). */
  pct: number;
  /** How many videos fall in the range (0 ⇒ "no data in range"). */
  count: number;
}

/** The evidence-sort options, in dropdown order; default is `date_desc`. */
export type EvidenceSort = "date_desc" | "date_asc" | "conf_desc" | "conf_asc";

/**
 * A half-open-ish inclusive date range expressed in epoch millis. `end` is
 * treated as inclusive-of-day by the caller (it pads to end-of-day before
 * constructing the range), so a point is "in range" iff `start ≤ t ≤ end`.
 */
export interface DateRange {
  start: number;
  end: number;
}

/** Milliseconds in one day — used for preset windows + end-of-day padding. */
export const MS_PER_DAY = 86_400_000;

/**
 * Build the trajectory `StancePoint`s from a `TopicAnalysis` payload.
 *
 * Each dated summary becomes one point; the `quote` of each `notableEvidence`
 * entry (when present) is used as a modal pull-quote, and the matching `topEvidence`
 * quote for the same video is appended as a fallback so a dot click always
 * has at least one verbatim line when any exists. Summaries without a publish
 * date are dropped (an undated point can't sit on a time axis). The result is
 * sorted oldest → newest so the trajectory and heatmap read left-to-right.
 *
 * @param data - The bundled topic-analysis payload from the server.
 * @returns The trajectory points, oldest first.
 */
/**
 * Drop duplicate quote strings while preserving first-seen order.
 *
 * A single video's `notableEvidence` can contain the same verbatim line more
 * than once (overlapping chunks selected the same sentence, or the speaker
 * literally repeated it), which rendered the identical pull-quote twice in the
 * episode modal and read as a bug. Dedupe case-insensitively on trimmed text.
 */
function dedupeQuotes(quotes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of quotes) {
    const key = q.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

export function buildStancePoints(data: TopicAnalysis): StancePoint[] {
  /*
   * First-seen evidence quote per video, so a summary lacking notableEvidence
   * can still surface a real quote in its modal.
   */
  const quoteByVideo = new Map<string, string>();
  for (const ev of data.topEvidence) {
    const vid = ev.video?.id;
    if (vid && ev.evidenceQuote && !quoteByVideo.has(vid)) {
      quoteByVideo.set(vid, ev.evidenceQuote);
    }
  }

  return data.summaries
    .filter((s) => s.video.publishedAt)
    .map((s) => {
      /*
       * Prefer the summary's own notableEvidence; fall back to the topEvidence
       * quote for the same video. `notableEvidence` entries are
       * `{ quote, chunkIndex }` objects, so pull the verbatim string out (a
       * bare-string legacy shape is tolerated too) and drop empties — rendering
       * the raw object as a React child is what crashed the modal.
       */
      const notableQuotes = dedupeQuotes(
        (s.notableEvidence ?? [])
          .map((e) => e?.quote)
          .filter(
            (q): q is string => typeof q === "string" && q.trim().length > 0,
          ),
      );
      const fallback = quoteByVideo.get(s.videoId);
      const quotes =
        notableQuotes.length > 0 ? notableQuotes : fallback ? [fallback] : [];
      const date = s.video.publishedAt as string;
      return {
        id: s.id,
        t: new Date(date).getTime(),
        date,
        stance: s.dominantStance,
        conf: s.confidenceScore,
        title: s.video.title,
        sourceUrl: s.video.sourceUrl ?? null,
        quotes,
        summary: s.summary,
      };
    })
    .sort((a, b) => a.t - b.t);
}

/**
 * Build the evidence `EvidenceRow`s from a `TopicAnalysis` payload. Drops
 * rows without a quote (a row whose whole point is the verbatim quote can't
 * expand into anything) and rows without a dated video (they can't be
 * date-range filtered). Order is preserved from the server (relevance order);
 * the caller re-sorts per the chosen `EvidenceSort`.
 *
 * @param data - The bundled topic-analysis payload from the server.
 * @returns The evidence rows in server (relevance) order.
 */
export function buildEvidenceRows(data: TopicAnalysis): EvidenceRow[] {
  return data.topEvidence
    .filter((ev) => ev.evidenceQuote && ev.video?.publishedAt)
    .map((ev) => ({
      id: ev.id,
      stance: ev.stanceLabel,
      quote: ev.evidenceQuote as string,
      claim: ev.claimSummary ?? ev.video?.title ?? "",
      title: ev.video?.title ?? "",
      date: ev.video?.publishedAt as string,
      conf: ev.confidenceScore,
    }));
}

/**
 * The full epoch-millis extent of a set of points (min/max `t`). Returns a
 * null-ish pair when empty so callers can decide on a default range. Points
 * are assumed already sorted oldest → newest (as `buildStancePoints` returns
 * them), so the bounds are simply the first and last `t`.
 *
 * @param points - The trajectory points (sorted oldest → newest).
 * @returns `{ min, max }` epoch millis, or `null` when there are no points.
 */
export function pointsExtent(
  points: StancePoint[],
): { min: number; max: number } | null {
  if (points.length === 0) return null;
  return { min: points[0].t, max: points[points.length - 1].t };
}

/**
 * Compute a preset date range relative to the data's extent.
 *
 * `"all"` spans the entire extent; a numeric-day preset ("30" | "60" | "90")
 * ends at the data's max and starts that many days earlier (clamped to the
 * data's min so the start input never shows a date before the first video).
 *
 * @param preset - "all" or a day-count string ("30" | "60" | "90").
 * @param extent - The data's `{ min, max }` epoch-millis extent.
 * @returns The resolved `DateRange`.
 */
export function presetRange(
  preset: "all" | "30" | "60" | "90",
  extent: { min: number; max: number },
): DateRange {
  if (preset === "all") return { start: extent.min, end: extent.max };
  const days = Number(preset);
  /*
   * Snap the start to UTC midnight of the computed day so the WHOLE boundary
   * day is in range. The raw `max - Nd` carries the latest video's time-of-day,
   * which would silently exclude earlier-in-the-day videos on the start day even
   * though the date input displays (and the manual start-input parses to) that
   * day's midnight. Clamp to the data min so the start never precedes video #1.
   */
  const rawStart = extent.max - days * MS_PER_DAY;
  const startOfDay = new Date(rawStart);
  startOfDay.setUTCHours(0, 0, 0, 0);
  return { start: Math.max(startOfDay.getTime(), extent.min), end: extent.max };
}

/** Keep only the points whose timestamp falls within `[range.start, range.end]`. */
export function pointsInRange(
  points: StancePoint[],
  range: DateRange,
): StancePoint[] {
  return points.filter((p) => p.t >= range.start && p.t <= range.end);
}

/** Keep only the evidence rows whose video date falls within the range. */
export function evidenceInRange(
  rows: EvidenceRow[],
  range: DateRange,
): EvidenceRow[] {
  return rows.filter((r) => {
    const t = Date.parse(r.date);
    return Number.isFinite(t) && t >= range.start && t <= range.end;
  });
}

/**
 * Tally how many in-range points fall into each stance family.
 *
 * @param points - The (already range-filtered) trajectory points.
 * @returns A family → count record covering all four families.
 */
export function stanceCounts(
  points: StancePoint[],
): Record<StanceFamily, number> {
  const counts: Record<StanceFamily, number> = {
    supportive: 0,
    mixed: 0,
    neutral: 0,
    opposed: 0,
  };
  for (const p of points) counts[stanceFamily(p.stance)] += 1;
  return counts;
}

/**
 * Compute the verdict for a set of in-range points: the dominant stance
 * family, its share of videos, and the count. Ties resolve to the
 * earlier family in `STANCE_FAMILY_ORDER` (deterministic). An empty input
 * yields a neutral, 0%, count-0 verdict that the hero renders as
 * "No data in range".
 *
 * @param points - The (already range-filtered) trajectory points.
 * @returns The computed `Verdict`.
 */
export function computeVerdict(points: StancePoint[]): Verdict {
  if (points.length === 0) return { family: "neutral", pct: 0, count: 0 };
  const counts = stanceCounts(points);
  /*
   * Pick the strictly-most-frequent family, scanning in canonical order so a
   * tie keeps the earlier (more-supportive) family deterministically.
   */
  let best: StanceFamily = "neutral";
  let bestCount = -1;
  for (const family of STANCE_FAMILY_ORDER) {
    if (counts[family] > bestCount) {
      best = family;
      bestCount = counts[family];
    }
  }
  return {
    family: best,
    pct: Math.round((counts[best] / points.length) * 100),
    count: points.length,
  };
}

/**
 * Group points by calendar month for the heatmap, oldest month → newest.
 *
 * The month key is a stable `YYYY-MM` so grouping is timezone-stable and
 * sortable as a string; the caller formats the label for display. Each
 * group preserves the points' chronological order (since the input is
 * sorted oldest → newest).
 *
 * @param points - The (already range-filtered) trajectory points, sorted.
 * @returns An array of `{ key, points }` groups, oldest month first.
 */
export function groupByMonth(
  points: StancePoint[],
): Array<{ key: string; points: StancePoint[] }> {
  const groups = new Map<string, StancePoint[]>();
  for (const p of points) {
    const d = new Date(p.t);
    /*
     * `YYYY-MM` from the UTC date — stable, lexically sortable, AND consistent
     * with `isoDate` (UTC) and the range filter, so a video near a month
     * boundary lands in the same month the date inputs show. Local-time methods
     * here would bucket a 2024-01-31T23:30Z video into "2024-02" for UTC+ users.
     */
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, pts]) => ({ key, points: pts }));
}

/** Average confidence of a set of points as a 0–100 integer, or null when empty. */
export function averageConfidencePct(points: StancePoint[]): number | null {
  if (points.length === 0) return null;
  return Math.round(
    (points.reduce((sum, p) => sum + p.conf, 0) / points.length) * 100,
  );
}

/** Comparators for each evidence-sort option (pure; no list mutation). */
const EVIDENCE_COMPARATORS: Record<
  EvidenceSort,
  (a: EvidenceRow, b: EvidenceRow) => number
> = {
  date_desc: (a, b) => Date.parse(b.date) - Date.parse(a.date),
  date_asc: (a, b) => Date.parse(a.date) - Date.parse(b.date),
  conf_desc: (a, b) => b.conf - a.conf,
  conf_asc: (a, b) => a.conf - b.conf,
};

/**
 * Filter + sort the evidence rows for display — the composable pipeline the
 * console's stance pills + sort dropdown + date range all feed into.
 *
 * Composition order: caller passes ALREADY date-range-filtered rows, this
 * applies the stance pill filter ("all" keeps everything) then sorts a COPY
 * by the chosen comparator (never mutating the input).
 *
 * @param rows - The date-range-filtered evidence rows.
 * @param filter - "all" or a stance family to keep.
 * @param sort - The chosen sort option.
 * @returns A new, filtered + sorted array.
 */
export function filterAndSortEvidence(
  rows: EvidenceRow[],
  filter: "all" | StanceFamily,
  sort: EvidenceSort,
): EvidenceRow[] {
  const filtered =
    filter === "all"
      ? rows
      : rows.filter((r) => stanceFamily(r.stance) === filter);
  return [...filtered].sort(EVIDENCE_COMPARATORS[sort]);
}

/** ISO `YYYY-MM-DD` slice of an epoch-millis timestamp (for `<input type=date>`). */
export function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
