import { useTheme } from "../../theme/themeContext";
import { stanceFamilyColors } from "../../theme/tokens";
import { fillTemplate, formatDate, humanizeLabel } from "../../lib/format";
import type { Verdict, StancePoint } from "../../lib/topicAnalysis";
import { strings } from "../../i18n/en";

/**
 * The verdict-meta template with the leading "{pct}% " removed, so the hero
 * can render the percentage as its own bold span and the remainder ("of
 * {count} videos") as muted text. Derived from the i18n template (not
 * hardcoded) so translating `verdictMeta` keeps both halves in sync.
 */
const verdictMetaRemainder = strings.topicAnalysis.verdictMeta.replace(
  "{pct}% ",
  "",
);

/**
 * VerdictHero — the bold, prominent headline at the top of the analyst
 * console (the prototype's `.verdict` block).
 *
 * Reads at a glance: a colored LEFT BAR matching the dominant stance, an
 * uppercase "Verdict" eyebrow, then a big "Leans <stance>" line where the
 * stance word is colored by its family. On the right it shows the dominant
 * family's share of in-range videos and the in-range date span. Everything
 * RECOMPUTES with the date range because it renders the `verdict` + points
 * the page passes in (both already range-filtered).
 *
 * When the range holds no videos it degrades to "No data in range" with a
 * neutral bar and an em-dash meta — never a blank or broken hero.
 *
 * Accessibility: the stance is named in WORDS (not color alone, WCAG 1.4.1);
 * the left bar is purely decorative.
 *
 * @param props.verdict - The computed verdict for the in-range points.
 * @param props.points - The in-range points (for the date-span meta), sorted.
 */
export function VerdictHero({
  verdict,
  points,
}: {
  verdict: Verdict;
  points: StancePoint[];
}) {
  const { resolved } = useTheme();
  const colors = stanceFamilyColors(verdict.family, resolved);
  const hasData = verdict.count > 0;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="relative mb-3.5 flex items-center gap-4 overflow-hidden rounded-2xl border border-ink-200 bg-white px-5 py-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
      {/* Dominant-stance left bar (decorative). */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[5px]"
        style={{ backgroundColor: colors.dot }}
      />
      <div className="pl-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-500 dark:text-ink-400">
          {strings.topicAnalysis.verdictLabel}
        </p>
        <p className="mt-0.5 text-2xl font-extrabold leading-tight tracking-tight text-ink-900 dark:text-ink-50 sm:text-3xl">
          {hasData ? (
            <>
              {/* "Leans " prefix in ink; the stance word in its family color. */}
              {strings.topicAnalysis.verdictLeans.split("{stance}")[0]}
              <span style={{ color: colors.dot }} className="capitalize">
                {humanizeLabel(verdict.family)}
              </span>
            </>
          ) : (
            strings.topicAnalysis.verdictNoData
          )}
        </p>
      </div>
      <div className="ml-auto text-right text-[12.5px] leading-relaxed text-ink-500 dark:text-ink-400">
        {hasData ? (
          <>
            {/* "{pct}% of {count} videos" with the percentage bolded. The
 template's leading "{pct}% " is rendered as a bold span, then
 the remainder ("of N videos") follows as muted text. */}
            <span className="block">
              <b className="font-bold text-ink-900 dark:text-ink-50">
                {verdict.pct}%
              </b>{" "}
              {fillTemplate(verdictMetaRemainder, { count: verdict.count })}
            </span>
            <span className="block">
              {formatDate(first.date)} – {formatDate(last.date)}
            </span>
          </>
        ) : (
          <span>{strings.common.none}</span>
        )}
      </div>
    </div>
  );
}
