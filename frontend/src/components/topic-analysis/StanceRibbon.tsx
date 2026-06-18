import { useTheme } from "../../theme/themeContext";
import {
  STANCE_FAMILY_ORDER,
  stanceFamilyColors,
  type StanceFamily,
} from "../../theme/tokens";
import { fillTemplate } from "../../lib/format";
import { strings } from "../../i18n/en";

/**
 * StanceRibbon — the "Overall balance" proportional stance bar + legend
 * (the prototype's `.ribbon` row). One horizontal bar split into colored
 * segments sized by each stance family's share of the in-range videos,
 * followed by a legend that names each present family with its % and count.
 *
 * Segments and legend iterate `STANCE_FAMILY_ORDER` (supportive → opposed)
 * so the ribbon always reads in the same order, and only present families
 * (count > 0) get a segment/legend chip. When the range is empty the ribbon
 * shows a single muted track and an em-dash legend.
 *
 * Accessibility: an sr-only summary describes the ribbon for screen readers
 * (the colored bar itself is decorative), and the legend names every family
 * in words so meaning never depends on color alone (WCAG 1.4.1).
 *
 * @param props.counts - Per-family in-range video counts (all four families).
 * @param props.total - The in-range video total (the % denominator).
 */
export function StanceRibbon({
  counts,
  total,
}: {
  counts: Record<StanceFamily, number>;
  total: number;
}) {
  const { resolved } = useTheme();
  /* Present families in canonical order (those with at least one video). */
  const present = STANCE_FAMILY_ORDER.filter((f) => counts[f] > 0);

  return (
    <>
      <p className="sr-only">
        {fillTemplate(strings.topicAnalysis.ribbonAlt, { count: total })}
      </p>
      <div className="flex items-center gap-4">
        <div className="stance-ribbon" aria-hidden>
          {present.length > 0 ? (
            present.map((family) => (
              <div
                key={family}
                className="h-full"
                style={{
                  width: `${(counts[family] / total) * 100}%`,
                  backgroundColor: stanceFamilyColors(family, resolved).dot,
                }}
              />
            ))
          ) : (
            /* Empty-range placeholder: a single muted full-width track. */
            <div className="h-full w-full bg-ink-200 dark:bg-ink-700" />
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11.5px] text-ink-500 dark:text-ink-400">
        {present.length > 0 ? (
          present.map((family) => (
            <span key={family} className="inline-flex items-center">
              <span
                aria-hidden
                className="stance-square mr-1.5"
                style={{
                  backgroundColor: stanceFamilyColors(family, resolved).dot,
                }}
              />
              {family} · {Math.round((counts[family] / total) * 100)}% (
              {counts[family]})
            </span>
          ))
        ) : (
          <span>{strings.common.none}</span>
        )}
      </div>
    </>
  );
}
