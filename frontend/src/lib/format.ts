/**
 * Utility: format date.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "—";
  /*
   * Render in UTC, not the viewer's local zone. The analyst console buckets,
   * filters, and date-input-bounds are all UTC-anchored (see topicAnalysis
   * isoDate/groupByMonth/presetRange and stanceTimeline yearOf), so a publish
   * date must display in UTC too — otherwise a boundary-date video (e.g.
   * 2026-02-01T02:00:00Z) reads as "Jan 31" for a UTC-negative viewer while
   * sitting in the February column and inside a February-anchored range.
   */
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Utility: format relative.
 */
export function formatRelative(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return formatDate(d);
}

/**
 * Utility: format duration.
 */
export function formatDuration(
  totalSeconds: number | null | undefined,
): string {
  if (!totalSeconds || totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Utility: humanize label.
 */
export function humanizeLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Utility: fill `{token}` placeholders in an i18n template from a values map.
 *
 * The one shared interpolator for the app's i18n templates (verdict copy,
 * the analyst console's subtitle / verdict / count strings, etc.). Keeps the
 * copy in the i18n dictionary while letting callers slot in computed
 * fragments. Unmatched tokens are left intact so a typo is visible, not silent.
 *
 * @param template - A string containing `{token}` placeholders.
 * @param values - Map of token name → replacement (string or number).
 * @returns The template with every matching token substituted.
 */
export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
