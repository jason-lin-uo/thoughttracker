import { useContext } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import type { StancePoint, TopicFrequencyResponse } from "../lib/types";
import { strings } from "../i18n/en";
import { ThemeContext, type ResolvedTheme } from "../theme/themeContext";

const STANCE_COLOR = "#2563eb";
const CHART_LINE_PALETTE = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#9333ea",
  "#65a30d",
  "#ea580c",
  "#0ea5e9",
];

/**
 * Theme-resolved color set for chart chrome (grid lines, axis ticks, the
 * y=0 reference line). Each value is tuned to clear adequate contrast
 * against the card surface in its mode — the previous hardcoded light-mode
 * hues (#e2e8f0 grid, #64748b ticks) were nearly invisible on the dark
 * ink-900 card.
 */
const CHART_CHROME: Record<
  ResolvedTheme,
  { grid: string; tick: string; reference: string }
> = {
  light: { grid: "#e2e8f0", tick: "#64748b", reference: "#cbd5e1" },
  dark: { grid: "#334155", tick: "#94a3b8", reference: "#475569" },
};

/**
 * Read the resolved theme without requiring a `<ThemeProvider>` ancestor.
 *
 * Charts are sometimes rendered in isolation (notably unit tests) outside
 * the provider tree, so we read the context directly and fall back to
 * "light" when it's absent rather than throwing the way `useTheme()` would.
 *
 * @returns The currently painted theme, or "light" when no provider is mounted.
 */
function useChartTheme(): ResolvedTheme {
  return useContext(ThemeContext)?.resolved ?? "light";
}

/**
 * Substitute a `{count}` placeholder in an i18n template with a real value.
 *
 * Used to build the screen-reader text alternatives for each chart from the
 * `charts.*TextAlternative` strings so the wording stays in the i18n
 * dictionary rather than being concatenated inline.
 *
 * @param template - An i18n string containing the literal token `{count}`.
 * @param count - The number to interpolate.
 * @returns The template with `{count}` replaced by `count`.
 */
function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

/**
 * StanceOverTimeChart — a single-creator stance timeline.
 *
 * Renders one line on a [-1, 1] y-axis where:
 * - +1 = "always supportive" for that month bucket
 * - 0 = "balanced / neutral / no signal"
 * - -1 = "always opposed"
 *
 * The score is the mean of every dated video-topic-summary's stance for
 * the bucket, computed server-side in `chartData.service.ts` so the
 * frontend only renders the prepared points.
 *
 * A horizontal reference line at y=0 makes "above the line = net
 * supportive" / "below the line = net opposed" readable at a glance.
 *
 * Recharts' `ResponsiveContainer` makes the chart fill the parent div;
 * the parent must have an explicit height (`h-64` here) or Recharts
 * collapses to 0px tall.
 *
 * @param props.data - Sorted month buckets from the server, each carrying
 * `{ date, averageStance, count }`. An empty array
 * triggers the friendly empty state instead of an
 * empty chart.
 */
export function StanceOverTimeChart({ data }: { data: StancePoint[] }) {
  const chrome = CHART_CHROME[useChartTheme()];
  if (data.length === 0) {
    return (
      <div className="card card-pad text-sm text-ink-500 dark:text-ink-400 text-center py-10">
        {strings.charts.noStance}
      </div>
    );
  }
  return (
    <div className="card card-pad">
      <p className="font-semibold text-ink-900 dark:text-ink-50 mb-1">
        {strings.charts.stanceOverTime}
      </p>
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
        {strings.charts.stanceOverTimeHelp}
      </p>
      {/* SVG charts are opaque to screen readers; this sr-only paragraph gives
 assistive-tech users a textual summary of what the chart conveys. */}
      <p className="sr-only">
        {withCount(strings.charts.stanceTextAlternative, data.length)}
      </p>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: 16, bottom: 8, left: -10 }}
          >
            <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: chrome.tick }} />
            <YAxis
              domain={[-1, 1]}
              ticks={[-1, -0.5, 0, 0.5, 1]}
              tick={{ fontSize: 12, fill: chrome.tick }}
            />
            <ReferenceLine
              y={0}
              stroke={chrome.reference}
              strokeDasharray="4 4"
            />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="averageStance"
              stroke={STANCE_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * StanceOverlayChart — the cross-creator analog of StanceOverTimeChart.
 * One line per selected creator on the same [-1, 1] y-axis, so a viewer
 * can see e.g. "Atlas was supportive on AI all year while Nautilus
 * shifted from neutral to opposed in Q3".
 *
 * `points` carries `{ date, values }` where `values[creatorId]` is the
 * mean stance for that creator's videos in that month bucket (or null
 * if the creator published nothing). `series` is the picker's selected
 * `{ id, name }` pairs, in display order — colors are assigned by index
 * from `CHART_LINE_PALETTE` so adding a creator never reshuffles existing
 * line colors.
 *
 * Used exclusively on the Compare page (Milestone #5).
 *
 * @param props.points - Sorted month buckets with per-creator values.
 * @param props.series - Selected creators in display order; drives both
 * the lines rendered and the legend.
 */
export function StanceOverlayChart({
  points,
  series,
}: {
  points: Array<{ date: string; values: Record<string, number | null> }>;
  series: Array<{ id: string; name: string }>;
}) {
  const chrome = CHART_CHROME[useChartTheme()];
  if (points.length === 0 || series.length === 0) {
    return (
      <div className="card card-pad text-sm text-ink-500 dark:text-ink-400 text-center py-10">
        {strings.charts.noStance}
      </div>
    );
  }
  /*
   * Pivot the server's `{ date, values: { [creatorId]: stance } }` shape into
   * the flat per-date rows Recharts wants, keying each line by creator *id*
   * (the <Line dataKey>); the display name goes on <Line name> for the legend.
   * Keying by name collided when two creators shared a display name (one line
   * overwrote the other). Missing months become null so `connectNulls` can
   * bridge the gap rather than dropping to zero.
   */
  const chartRows = points.map((p) => {
    const row: Record<string, number | string | null> = { date: p.date };
    for (const s of series) row[s.id] = p.values[s.id] ?? null;
    return row;
  });
  return (
    <div className="card card-pad">
      <p className="font-semibold text-ink-900 dark:text-ink-50 mb-1">
        {strings.charts.stanceOverTime}
      </p>
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
        {strings.charts.stanceOverTimeHelp}
      </p>
      <p className="sr-only">
        {withCount(strings.charts.overlayTextAlternative, series.length)}
      </p>
      <div className="h-72" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartRows}
            margin={{ top: 10, right: 16, bottom: 8, left: -10 }}
          >
            <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: chrome.tick }} />
            <YAxis
              domain={[-1, 1]}
              ticks={[-1, -0.5, 0, 0.5, 1]}
              tick={{ fontSize: 12, fill: chrome.tick }}
            />
            <ReferenceLine
              y={0}
              stroke={chrome.reference}
              strokeDasharray="4 4"
            />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((creatorSeries, i) => (
              <Line
                key={creatorSeries.id}
                type="monotone"
                dataKey={creatorSeries.id}
                name={creatorSeries.name}
                stroke={CHART_LINE_PALETTE[i % CHART_LINE_PALETTE.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * TopicFrequencyChart — a stacked bar chart showing how often each topic
 * surfaced across a creator's videos in each month bucket.
 *
 * The stack-per-bar layout means a tall bar = "talked about lots of
 * topics that month", and the segments within the bar show which topics
 * dominated. We cap the legend at the top 6 topics so the visual doesn't
 * devolve into a 30-color rainbow on creators with broad coverage; less
 * frequent topics simply don't get their own bar segment.
 *
 * @param props.data - `{ points, topics }` from the server. `points` is
 * sorted month buckets each carrying a topic→count
 * map. `topics` is the legend dictionary, ordered
 * by overall frequency so the top 6 are the most
 * meaningful.
 */
export function TopicFrequencyChart({
  data,
}: {
  data: TopicFrequencyResponse;
}) {
  const chrome = CHART_CHROME[useChartTheme()];
  if (data.points.length === 0) {
    return (
      <div className="card card-pad text-sm text-ink-500 dark:text-ink-400 text-center py-10">
        {strings.charts.noTopicFrequency}
      </div>
    );
  }
  const series = data.topics.slice(0, 6);
  /*
   * Flatten each month bucket into one Recharts row: a `date` plus one numeric
   * column per top-6 topic (the stacked bar segments). Topics absent in a given
   * month default to 0 so the stack still renders a consistent set of segments.
   */
  const chartRows = data.points.map((p) => {
    const row: Record<string, number | string> = { date: p.date };
    for (const topic of series) row[topic.name] = p.topics[topic.name] ?? 0;
    return row;
  });
  return (
    <div className="card card-pad">
      <p className="font-semibold text-ink-900 dark:text-ink-50 mb-1">
        {strings.charts.topicFrequency}
      </p>
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
        {strings.charts.topicFrequencyHelp}
      </p>
      <p className="sr-only">
        {withCount(strings.charts.frequencyTextAlternative, data.points.length)}
      </p>
      <div className="h-72" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartRows}
            margin={{ top: 10, right: 16, bottom: 8, left: -10 }}
          >
            <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: chrome.tick }} />
            <YAxis
              tick={{ fontSize: 12, fill: chrome.tick }}
              allowDecimals={false}
            />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((topic, i) => (
              <Bar
                key={topic.id}
                dataKey={topic.name}
                stackId="a"
                fill={CHART_LINE_PALETTE[i % CHART_LINE_PALETTE.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * ChartState — a per-chart loading / error panel sized to slot into the
 * chart grid in place of a real chart.
 *
 * Chart queries fetch independently of the page body, so when one fails or
 * is still in flight we render this instead of silently dropping the chart
 * (which previously left an empty gap with no signal to the user). Mirrors
 * the visual rhythm of `LoadingState`/`ErrorState` but at the fixed chart
 * height so the surrounding layout doesn't jump.
 *
 * @param props.kind - "loading" shows the polite spinner copy; "error"
 * shows the rose alert + optional retry button.
 * @param props.message - Optional error detail appended under the headline
 * (only meaningful when `kind === "error"`).
 * @param props.onRetry - Optional retry callback; renders a "Try again"
 * button when provided on an error panel.
 */
export function ChartState({
  kind,
  message,
  onRetry,
}: {
  kind: "loading" | "error";
  message?: string;
  onRetry?: () => void;
}) {
  if (kind === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="card card-pad h-64 flex items-center justify-center text-sm text-ink-500 dark:text-ink-400"
      >
        <span className="animate-pulse">{strings.charts.loading}</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="card card-pad h-64 flex flex-col items-center justify-center gap-2 text-sm border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200"
    >
      <p className="font-semibold">{strings.charts.error}</p>
      {message && <p className="text-xs">{message}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary">
          {strings.common.tryAgain}
        </button>
      )}
    </div>
  );
}
