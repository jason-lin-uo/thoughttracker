/**
 * Stance-aggregation helpers shared by the creators controller and
 * creatorComparison service.
 *
 * Both call sites collect per-topic stance tallies and need to resolve
 * the "dominant" stance (highest count, ties broken by encounter order
 * since `Array.prototype.sort` is stable as of ES2019). Extracted here
 * so the logic stays in one place — the previous copy in each file had
 * drifted slightly on the empty-tally fallback (one returned a typo
 * string, one returned "insufficient_evidence"). Single source of
 * truth = no drift.
 */

import type { StanceLabel } from "@prisma/client";

/**
 * STANCE_SCORE — map each stance label to a numeric value on a
 * supportive(+1) … opposed(-1) axis for averaging in time-series charts.
 *
 * `null` means "exclude from the mean": `unclear` / `insufficient_evidence`
 * carry no directional signal, so folding them in as 0 would drag every
 * average toward neutral and misrepresent the data. `mixed` is a genuine
 * 0 (balanced signal both ways), distinct from "no signal".
 *
 * Previously duplicated verbatim in `chartData.service.ts` and
 * `creatorComparison.service.ts`; centralized here so the two charts can
 * never disagree on what a stance is "worth" (a drift here would silently
 * skew one chart relative to the other).
 */
export const STANCE_SCORE: Record<StanceLabel, number | null> = {
  opposed: -1,
  neutral: 0,
  supportive: 1,
  mixed: 0,
  unclear: null,
  insufficient_evidence: null,
};

/**
 * Pick the most-frequent stance from a tally.
 *
 * Generic so callers using `Map<StanceLabel, number>` get back the
 * `StanceLabel` enum (not a widened `string`), while callers using a
 * plain `Record<string, number>` get a `string`.
 *
 * @param tally - either a `Map<K, number>` or `Record<string, number>`.
 * @returns the stance label with the highest count, or
 * `"insufficient_evidence"` if the tally is empty.
 */
/* Overload: a Map tally returns the narrow key type K (or the empty fallback). */
export function dominantStance<K extends string>(
  tally: Map<K, number>,
): K | "insufficient_evidence";
/* Overload: a plain record tally returns a widened string. */
export function dominantStance(tally: Record<string, number>): string;
/* Implementation backing both overloads above. */
export function dominantStance(
  tally: Map<string, number> | Record<string, number>,
): string {
  const entries: Array<[string, number]> =
    tally instanceof Map ? Array.from(tally.entries()) : Object.entries(tally);
  if (entries.length === 0) return "insufficient_evidence";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}
