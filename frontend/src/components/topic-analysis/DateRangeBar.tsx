import { fillTemplate } from "../../lib/format";
import { isoDate, MS_PER_DAY, type DateRange } from "../../lib/topicAnalysis";
import { strings } from "../../i18n/en";

/** The four range presets, in display order; "custom" is implied by inputs. */
export type RangePreset = "all" | "90" | "60" | "30";

/** The preset buttons, paired with their i18n labels (display order). */
const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "all", label: strings.topicAnalysis.presetAll },
  { value: "90", label: strings.topicAnalysis.preset90 },
  { value: "60", label: strings.topicAnalysis.preset60 },
  { value: "30", label: strings.topicAnalysis.preset30 },
];

/**
 * DateRangeBar — the client-side date-range control that filters EVERY view
 * below it (verdict, trajectory, ribbon, heatmap, stats, evidence). This is
 * the prototype's `.rangebar`: two date inputs (start → end), four presets
 * (All / Last 90d / 60d / 30d), and a "showing N of M videos" counter.
 *
 * It is a CONTROLLED component — the parent owns the resolved `range` and the
 * active `preset`, and this component just reports edits via callbacks. The
 * date inputs are bounded to the data's `[min, max]` extent so a user can't
 * scroll to an empty window, and editing either input switches the active
 * preset to "custom" (clearing the preset highlight).
 *
 * Accessibility: native `<input type="date">` (keyboard-operable, with
 * `aria-label`s) + real `<button>`s for presets (`aria-pressed` marks the
 * active one). The counter is a polite live region so range changes are
 * announced.
 *
 * @param props.range - The resolved range (epoch millis) to display.
 * @param props.extent - The data's `{ min, max }` extent (input bounds).
 * @param props.preset - The active preset, or "custom" when inputs were edited.
 * @param props.shown - How many videos fall in the current range.
 * @param props.total - The total video count (denominator of the counter).
 * @param props.onPreset - Called with a preset value when a preset is clicked.
 * @param props.onRangeChange - Called with the new range when an input changes.
 */
export function DateRangeBar({
  range,
  extent,
  preset,
  shown,
  total,
  onPreset,
  onRangeChange,
}: {
  range: DateRange;
  extent: { min: number; max: number };
  preset: RangePreset | "custom";
  shown: number;
  total: number;
  onPreset: (preset: RangePreset) => void;
  onRangeChange: (range: DateRange) => void;
}) {
  const minIso = isoDate(extent.min);
  const maxIso = isoDate(extent.max);

  /*
   * Edit the START bound: parse the input date, fall back to the data min if
   * it's blank/unparseable, and report a new custom range.
   */
  function handleStart(value: string) {
    const parsed = Date.parse(value);
    onRangeChange({
      start: Number.isFinite(parsed) ? parsed : extent.min,
      end: range.end,
    });
  }

  /*
   * Edit the END bound: pad to end-of-day (inclusive) so a video published on
   * the chosen day stays in range, falling back to the data max when blank.
   */
  function handleEnd(value: string) {
    const parsed = Date.parse(value);
    const end = Number.isFinite(parsed)
      ? parsed + (MS_PER_DAY - 1000)
      : extent.max;
    onRangeChange({ start: range.start, end });
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-2.5 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-700 dark:text-ink-200">
        <span aria-hidden>📅</span> {strings.topicAnalysis.dateRange}
      </span>
      <input
        type="date"
        aria-label={strings.topicAnalysis.dateStartLabel}
        min={minIso}
        max={maxIso}
        value={isoDate(range.start)}
        onChange={(e) => handleStart(e.target.value)}
        className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 [color-scheme:light] dark:[color-scheme:dark]"
      />
      <span aria-hidden className="text-ink-400">
        →
      </span>
      <input
        type="date"
        aria-label={strings.topicAnalysis.dateEndLabel}
        min={minIso}
        max={maxIso}
        value={isoDate(range.end)}
        onChange={(e) => handleEnd(e.target.value)}
        className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 [color-scheme:light] dark:[color-scheme:dark]"
      />
      <div className="ml-1.5 flex gap-1.5">
        {PRESETS.map((p) => {
          const active = preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={active}
              onClick={() => onPreset(p.value)}
              className={
                "rounded-full border px-3 py-1 text-xs transition " +
                (active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-ink-200 bg-ink-50 text-ink-700 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200")
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <span
        role="status"
        aria-live="polite"
        className="ml-auto font-mono text-xs text-ink-500 dark:text-ink-400"
      >
        {fillTemplate(strings.topicAnalysis.showingCount, { shown, total })}
      </span>
    </div>
  );
}
