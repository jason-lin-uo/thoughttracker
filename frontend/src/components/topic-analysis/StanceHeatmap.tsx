import { useTheme } from "../../theme/themeContext";
import { stanceColors } from "../../theme/tokens";
import { groupByMonth, type StancePoint } from "../../lib/topicAnalysis";
import { fillTemplate, formatDate, humanizeLabel } from "../../lib/format";
import { strings } from "../../i18n/en";

/** Format a `YYYY-MM` group key as a short "Mon 'YY" month label. */
function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  /* Day 1 of the month, local time, formatted "Mon YY". */
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

/**
 * StanceHeatmap — the per-video stance heatmap (the prototype's `.heat`).
 *
 * Cells are grouped by calendar month (oldest → newest) and colored by the
 * video's dominant stance. Each cell is a real `<button>` so it is
 * keyboard-operable: hovering/focusing shows a native tooltip (title + date
 * + stance + confidence) and clicking/Enter opens the same episode modal the
 * trajectory dots use. When the range is empty it shows a friendly note.
 *
 * Accessibility: each cell carries an `aria-label` naming its episode + date
 * + stance (so meaning isn't color-only, WCAG 1.4.1), and an sr-only summary
 * describes the grid as a whole for screen-reader users.
 *
 * @param props.points - The in-range trajectory points (sorted oldest→newest).
 * @param props.onSelect - Called with the clicked point to open its modal.
 */
export function StanceHeatmap({
  points,
  onSelect,
}: {
  points: StancePoint[];
  onSelect: (point: StancePoint) => void;
}) {
  const { resolved } = useTheme();

  if (points.length === 0) {
    return (
      <p className="text-sm text-ink-500 dark:text-ink-400">
        {strings.topicAnalysis.noVideosInRange}
      </p>
    );
  }

  const groups = groupByMonth(points);

  return (
    <>
      <p className="sr-only">
        {fillTemplate(strings.topicAnalysis.heatmapAlt, {
          count: points.length,
        })}
      </p>
      <div className="flex flex-wrap gap-[18px]">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-ink-500 dark:text-ink-400">
              {monthLabel(group.key)}
            </span>
            <div className="flex max-w-[260px] flex-wrap gap-1.5">
              {group.points.map((p) => {
                const label = `${p.title}: ${formatDate(p.date)} · ${humanizeLabel(p.stance)} · ${Math.round(p.conf * 100)}%`;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={label}
                    title={label}
                    onClick={() => onSelect(p)}
                    className="heat-cell"
                    style={{
                      backgroundColor: stanceColors(p.stance, resolved).dot,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
