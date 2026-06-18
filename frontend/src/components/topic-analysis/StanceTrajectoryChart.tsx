import { useState } from "react";
import { useTheme } from "../../theme/themeContext";
import { stanceColors, type StanceFamily } from "../../theme/tokens";
import { fillTemplate, formatDate, humanizeLabel } from "../../lib/format";
import type { StancePoint } from "../../lib/topicAnalysis";
import { strings } from "../../i18n/en";

/** Geometry constants for the SVG (matches the prototype's proportions). */
const W = 940;
const H = 240;
const PAD = 46;

/**
 * Vertical position of each stance band, as a 0–1 fraction of the plot height
 * (0 = bottom, 1 = top). Mirrors the prototype's `yL`: supportive sits high,
 * opposed sits low, with mixed/neutral between. Keyed by family so a dot's y
 * is its family's lane.
 */
const BAND_Y: Record<StanceFamily, number> = {
  supportive: 0.86,
  mixed: 0.52,
  neutral: 0.4,
  opposed: 0.16,
};

/** The four bands, top→bottom, with their i18n labels (drawn as gridlines). */
const BANDS: Array<{ family: StanceFamily; label: string }> = [
  { family: "supportive", label: strings.topicAnalysis.bandSupportive },
  { family: "mixed", label: strings.topicAnalysis.bandMixed },
  { family: "neutral", label: strings.topicAnalysis.bandNeutral },
  { family: "opposed", label: strings.topicAnalysis.bandOpposed },
];

/** Map a stance label to its band family (the chart works in families). */
function bandFamily(stance: StancePoint["stance"]): StanceFamily {
  if (stance === "supportive") return "supportive";
  if (stance === "opposed") return "opposed";
  if (stance === "mixed") return "mixed";
  return "neutral";
}

/**
 * StanceTrajectoryChart — the hand-built SVG line chart at the heart of the
 * console (the prototype's `#chart`).
 *
 * Horizontal stance BANDS (supportive / mixed / neutral / opposed) are drawn
 * as dashed gridlines with left-edge labels; each in-range video is a DOT
 * placed at its publish date (x) and its stance band (y), colored by stance,
 * connected by a faint accent polyline. Hovering or focusing a dot shows a
 * tooltip (title + date + stance + confidence); clicking/Enter opens that
 * episode's modal (verbatim quotes), handled by the parent via `onSelect`.
 *
 * Each dot is a real `<button>` overlaid on the SVG so it is keyboard
 * focusable and screen-reader labeled — the SVG itself is `aria-hidden` and
 * an sr-only paragraph summarizes the chart.
 *
 * @param props.points - The in-range points, sorted oldest → newest.
 * @param props.onSelect - Called with the clicked/activated point (open modal).
 */
export function StanceTrajectoryChart({
  points,
  onSelect,
}: {
  points: StancePoint[];
  onSelect: (point: StancePoint) => void;
}) {
  const { resolved } = useTheme();
  /* The point whose tooltip is currently shown (hover or keyboard focus). */
  const [hovered, setHovered] = useState<StancePoint | null>(null);

  if (points.length === 0) {
    return (
      <p className="text-sm text-ink-500 dark:text-ink-400">
        {strings.topicAnalysis.noVideosInRange}
      </p>
    );
  }

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  /*
   * x maps a timestamp into the padded plot width; a single-point (t0===t1)
   * range divides by 1 so the lone dot lands at the left pad (not NaN).
   */
  const xOf = (t: number) => PAD + ((t - t0) / (t1 - t0 || 1)) * (W - PAD * 2);
  /* y maps a band fraction into the padded plot height (inverted: 1 = top). */
  const yOf = (stance: StancePoint["stance"]) =>
    H - PAD - BAND_Y[bandFamily(stance)] * (H - PAD * 2);

  /* The connecting polyline (only meaningful with ≥2 points). */
  const polyline =
    points.length > 1
      ? points
          .map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.stance).toFixed(1)}`)
          .join(" ")
      : "";

  /*
   * X-axis labels: first / middle / last (or just the single point), deduped
   * by id — with exactly two points the "middle" (index 1) IS the last, so
   * without the dedupe two identical date labels paint at the same x.
   */
  const labelPoints = (
    points.length > 1
      ? [
          points[0],
          points[Math.floor(points.length / 2)],
          points[points.length - 1],
        ]
      : [points[0]]
  ).filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);

  return (
    <div className="relative">
      <p className="sr-only">
        {fillTemplate(strings.topicAnalysis.trajectoryAlt, {
          count: points.length,
        })}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        aria-hidden
        className="overflow-visible"
      >
        {/* Stance bands: dashed gridlines + left-edge labels. */}
        {BANDS.map((band) => {
          const y = H - PAD - BAND_Y[band.family] * (H - PAD * 2);
          return (
            <g key={band.family}>
              <line
                x1={PAD}
                y1={y}
                x2={W - PAD}
                y2={y}
                className="stroke-ink-200 dark:stroke-ink-800"
                strokeDasharray="3 5"
              />
              <text
                x={PAD - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-ink-500 dark:fill-ink-400 text-[11px]"
              >
                {band.label}
              </text>
            </g>
          );
        })}
        {/* Connecting line (faint brand accent). */}
        {polyline && (
          <polyline
            points={polyline}
            fill="none"
            className="stroke-brand-600 dark:stroke-brand-400"
            strokeWidth={2.5}
            opacity={0.55}
          />
        )}
        {/* Dots, colored by stance, with a white/dark stroke ring. */}
        {points.map((p) => (
          <circle
            key={p.id}
            cx={xOf(p.t)}
            cy={yOf(p.stance)}
            r={6}
            fill={stanceColors(p.stance, resolved).dot}
            className="stroke-white dark:stroke-ink-900"
            strokeWidth={2}
          />
        ))}
        {/* X-axis date labels. */}
        {labelPoints.map((p, i) => (
          <text
            key={`xl-${p.id}-${i}`}
            x={xOf(p.t)}
            y={H - PAD + 20}
            textAnchor="middle"
            className="fill-ink-500 dark:fill-ink-400 text-[11px]"
          >
            {formatDate(p.date)}
          </text>
        ))}
      </svg>

      {/* Keyboard/mouse-operable dot buttons overlaid on the SVG. These carry
 the interaction (the SVG circles above are purely visual) so each
 point is focusable, labeled, and tooltip-bearing. Positioned as a %
 of the viewBox so they track the SVG as it scales responsively. */}
      <div className="pointer-events-none absolute inset-0">
        {points.map((p) => {
          const label = `${p.title}: ${formatDate(p.date)} · ${humanizeLabel(p.stance)} · ${Math.round(p.conf * 100)}%`;
          return (
            <button
              key={p.id}
              type="button"
              aria-label={label}
              onMouseEnter={() => setHovered(p)}
              onMouseLeave={() => setHovered((cur) => (cur === p ? null : cur))}
              onFocus={() => setHovered(p)}
              onBlur={() => setHovered((cur) => (cur === p ? null : cur))}
              onClick={() => onSelect(p)}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-offset-2"
              style={{
                left: `${(xOf(p.t) / W) * 100}%`,
                top: `${(yOf(p.stance) / H) * 100}%`,
                width: 18,
                height: 18,
              }}
            />
          );
        })}
      </div>

      {/* Hover/focus tooltip: floats just above the hovered point as an
 ABSOLUTELY-positioned layer (pointer-events-none, z-10) so it never
 affects document flow. Previously it rendered IN-FLOW below the chart,
 which grew/shrank the container on every hover and shifted the
 "Overall balance" section beneath it (the reported flicker). */}
      {hovered && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 max-w-[280px] -translate-x-1/2 -translate-y-full truncate rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-ink-100 dark:text-ink-900"
          style={{
            left: `${(xOf(hovered.t) / W) * 100}%`,
            top: `calc(${(yOf(hovered.stance) / H) * 100}% - 12px)`,
          }}
        >
          <span className="font-semibold">{hovered.title.slice(0, 60)}</span>
          {" — "}
          {formatDate(hovered.date)} · {humanizeLabel(hovered.stance)} ·{" "}
          {Math.round(hovered.conf * 100)}%
        </div>
      )}
    </div>
  );
}
