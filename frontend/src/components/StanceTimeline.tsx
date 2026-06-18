import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../theme/themeContext";
import { stanceColors, stanceFamilyColors } from "../theme/tokens";
import {
  deriveVerdict,
  sortMoments,
  type StanceMoment,
} from "../lib/stanceTimeline";
import { formatDate, humanizeLabel } from "../lib/format";
import { StanceBadge } from "./Badges";
import { strings } from "../i18n/en";

/**
 * StanceTimeline — the hero of the topic-analysis view.
 *
 * Reads like Ground News: a single plain-language VERDICT up top ("Leans
 * supportive — steady since 2021" / "Shifted: opposed → supportive in
 * 2023"), then a horizontal time axis of dots colored by stance. Selecting
 * a dot (click, Enter, or Space) reveals that moment's evidence quote and a
 * link to the source video, so the headline expands into provenance on
 * demand.
 *
 * Accessibility:
 * - Each dot is a real `<button>` (focusable, Enter/Space activated) with
 * an aria-label naming its date + stance, so a screen-reader or
 * keyboard user gets the same affordance as a mouse user.
 * - The dot strip is a `role="group"` labeled by the verdict, and the
 * selected dot is marked `aria-pressed` so assistive tech tracks state.
 * - Color is always paired with text (the verdict names the stance; the
 * detail panel shows a StanceBadge) so meaning never depends on hue
 * alone (WCAG 1.4.1).
 * - Stance hues come from the centralized `stanceColors` tokens, resolved
 * against the live theme, so the dots clear WCAG-AA in light AND dark.
 *
 * Responsive:
 * - ≥ sm: an SVG axis line with evenly-spaced dots positioned over it.
 * - < sm: the SVG axis is hidden and the same dots stack into a vertical,
 * scroll-friendly list — no horizontal scrolling on a phone.
 *
 * @param props.moments - The dated stance points to plot. Empty → a
 * friendly "not enough data" verdict with no axis.
 * @param props.topicName - Topic name, woven into the section heading +
 * aria labels for context.
 */
export function StanceTimeline({
  moments,
  topicName,
}: {
  moments: StanceMoment[];
  topicName: string;
}) {
  const { resolved } = useTheme();
  /* Oldest → newest so the axis reads left-to-right in time order. */
  const sorted = useMemo(() => sortMoments(moments), [moments]);
  /* The one-line headline derived from the (unsorted) moments. */
  const verdict = useMemo(() => deriveVerdict(moments), [moments]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const headingId = useId();

  /*
   * The verdict carries a family directly, so resolve its color via the
   * family-keyed token helper (no round-trip through a representative label).
   * This keeps a `mixed` verdict amber rather than collapsing it to neutral.
   */
  const verdictColor = stanceFamilyColors(verdict.family, resolved);

  /* The currently expanded moment (whose evidence panel is shown), if any. */
  const selected = sorted.find((m) => m.id === selectedId) ?? null;

  return (
    <section className="card card-pad-lg" aria-labelledby={headingId}>
      <p className="section-eyebrow">{strings.stanceTimeline.eyebrow}</p>
      <h2
        id={headingId}
        className="mt-1 text-xl sm:text-2xl font-semibold tracking-tight"
        style={{ color: verdictColor.text }}
      >
        {verdict.headline}
      </h2>
      <p className="body-muted mt-1">
        {strings.stanceTimeline.subtitle} {topicName}
      </p>

      {sorted.length === 0 ? (
        <p className="empty-msg mt-5">{strings.stanceTimeline.empty}</p>
      ) : (
        <>
          {/* Desktop axis: SVG line + evenly-spaced dots laid over it. */}
          <div
            className="relative mt-8 hidden sm:block"
            role="group"
            aria-labelledby={headingId}
          >
            <svg
              className="w-full"
              height="40"
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              aria-hidden
            >
              <line
                x1="2"
                y1="20"
                x2="98"
                y2="20"
                stroke={verdictColor.soft}
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="absolute inset-0">
              {sorted.map((moment, i) => {
                const left =
                  sorted.length === 1 ? 50 : 2 + (i / (sorted.length - 1)) * 96;
                const colors = stanceColors(moment.stance, resolved);
                const isSelected = moment.id === selectedId;
                return (
                  <button
                    key={moment.id}
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : moment.id)}
                    aria-pressed={isSelected}
                    aria-label={`${formatDate(moment.date)}: ${humanizeLabel(
                      moment.stance,
                    )} — ${moment.videoTitle}`}
                    title={`${formatDate(moment.date)} · ${humanizeLabel(moment.stance)}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition focus-visible:outline-offset-2"
                    style={{
                      left: `${left}%`,
                      top: "50%",
                      width: isSelected ? 20 : 14,
                      height: isSelected ? 20 : 14,
                      backgroundColor: colors.dot,
                      boxShadow: isSelected
                        ? `0 0 0 4px ${colors.soft}`
                        : "none",
                    }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs text-ink-500 dark:text-ink-400">
              <span>{formatDate(sorted[0].date)}</span>
              <span>{formatDate(sorted[sorted.length - 1].date)}</span>
            </div>
          </div>

          {/* Mobile: stack the same dots into a vertical, tap-friendly list. */}
          <ul className="mt-6 space-y-2 sm:hidden" aria-labelledby={headingId}>
            {sorted.map((moment) => {
              const colors = stanceColors(moment.stance, resolved);
              const isSelected = moment.id === selectedId;
              return (
                <li key={moment.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : moment.id)}
                    aria-pressed={isSelected}
                    aria-label={`${formatDate(moment.date)}: ${humanizeLabel(
                      moment.stance,
                    )} — ${moment.videoTitle}`}
                    className="flex w-full items-center gap-3 rounded-lg border border-ink-200 dark:border-ink-800 px-3 py-2 text-left hover:border-brand-300 transition"
                  >
                    <span
                      className="inline-block rounded-full shrink-0"
                      style={{
                        width: 12,
                        height: 12,
                        backgroundColor: colors.dot,
                      }}
                      aria-hidden
                    />
                    <span className="text-sm text-ink-700 dark:text-ink-300">
                      {formatDate(moment.date)}
                    </span>
                    <span className="ml-auto">
                      <StanceBadge stance={moment.stance} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Detail panel for the selected moment — quote + source link. */}
          {selected ? (
            <div className="mt-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-950/40 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StanceBadge stance={selected.stance} />
                <span className="meta-row">{formatDate(selected.date)}</span>
              </div>
              {selected.evidenceQuote ? (
                <blockquote
                  className="mt-3 border-l-4 pl-3 italic text-sm text-ink-800 dark:text-ink-200"
                  style={{
                    borderColor: stanceColors(selected.stance, resolved).soft,
                  }}
                >
                  “{selected.evidenceQuote}”
                </blockquote>
              ) : selected.summary ? (
                <p className="mt-3 text-sm text-ink-700 dark:text-ink-300">
                  {selected.summary}
                </p>
              ) : (
                <p className="mt-3 body-muted">
                  {strings.stanceTimeline.noQuote}
                </p>
              )}
              <Link
                to={selected.videoHref}
                className="link-brand mt-3 inline-block text-sm font-medium"
              >
                {strings.stanceTimeline.viewVideo} {selected.videoTitle} →
              </Link>
            </div>
          ) : (
            <p className="body-muted mt-6">
              {strings.stanceTimeline.selectHint}
            </p>
          )}
        </>
      )}
    </section>
  );
}
