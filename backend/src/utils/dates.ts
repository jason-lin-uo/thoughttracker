/**
 * Date utilities — the small handful of helpers used across the
 * services and controllers. Both functions are pure (no mutation, no
 * I/O) and run in UTC to keep month-bucket boundaries deterministic
 * across server timezones.
 */

/**
 * monthKey — derive the "YYYY-MM" bucket label for a Date in UTC.
 *
 * Used by every chart aggregator (stance-over-time, topic-frequency,
 * multi-creator overlay) to bucket video summaries into monthly bins.
 * UTC matters: if a server in PST bucketed by local time, a video
 * published at 7pm Dec 31 PST would land in "December" while the same
 * video on a UTC server lands in "January". Aligning everyone on UTC
 * means our charts never disagree based on where the request was served.
 *
 * @param date - any Date object; only the calendar month + year are read.
 * @returns the bucket label, e.g. `"2026-03"`. Padded to two-digit month.
 */
export function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Matches a bare calendar date with no time component, e.g. "2026-03-01". */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * parseDateParam — convert an unknown query-string value into a `Date`
 * if it looks like a valid ISO date string, else `undefined`.
 *
 * Used by every endpoint that takes optional `from`/`to` filters. We
 * accept anything `new Date(string)` can parse (ISO 8601, RFC 2822,
 * etc.) and reject:
 * - non-string types (numbers, booleans, undefined, null)
 * - empty strings
 * - strings that produce `NaN` from `Date.getTime()`
 *
 * The caller then guards on `if (date) { ... }` so an invalid filter
 * cleanly becomes "no filter" instead of throwing.
 *
 * Inclusive `to` handling (off-by-one fix): a bare date like "2026-03-01"
 * parses to `2026-03-01T00:00:00.000Z`. Used as an exclusive-feeling `lte`
 * upper bound, that EXCLUDES everything published later on March 1 — so a
 * `to=2026-03-01` filter dropped the entire requested final day. When
 * `boundary === "end"` and the value is date-only, we snap it to the END of
 * that UTC day (`23:59:59.999`) so the `to` bound is inclusive of the whole
 * day, matching user intent. A value that already carries an explicit time is
 * left exactly as given (the caller asked for a precise instant).
 *
 * @param value - unknown value from `req.query[someKey]`.
 * @param boundary - "start" (default) leaves the value as-is; "end" makes a
 * date-only value end-of-day inclusive.
 * @returns parsed Date, or undefined if invalid / absent.
 */
export function parseDateParam(
  value: unknown,
  boundary: "start" | "end" = "start",
): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return undefined;
  if (boundary === "end" && DATE_ONLY_RE.test(value)) {
    /*
     * Snap to the last millisecond of that UTC calendar day so a `lte` bound
     * includes the whole day rather than only its midnight instant.
     */
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}
