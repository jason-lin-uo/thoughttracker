import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";

/**
 * Soft accent tints for the stat tiles. The dashboard cluster assigns a
 * different tone per stat so the page carries real color/life (especially in
 * light mode, which was otherwise white-on-white) without leaning on the navy
 * brand alone. Each tone tints the card background + the big value to match.
 * Light tints + dark-mode-muted variants so neither theme is harsh.
 */
const TONES = {
  blue: {
    card: "bg-brand-50 border-brand-200 dark:bg-brand-950/40 dark:border-brand-900/60",
    value: "text-brand-700 dark:text-brand-300",
  },
  teal: {
    card: "bg-teal-50 border-teal-200 dark:bg-teal-950/30 dark:border-teal-900/60",
    value: "text-teal-700 dark:text-teal-300",
  },
  violet: {
    card: "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-900/60",
    value: "text-violet-700 dark:text-violet-300",
  },
  amber: {
    card: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60",
    value: "text-amber-700 dark:text-amber-300",
  },
  rose: {
    card: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/60",
    value: "text-rose-700 dark:text-rose-300",
  },
} as const;

export type StatTone = keyof typeof TONES;

/**
 * StatCard — the small "label + big number" tile used in the Dashboard,
 * Creator Overview, and Compare stat clusters.
 *
 * `value` is a ReactNode so callers can pass a formatted span/percentage.
 * When `to` is supplied the whole tile is a router `<Link>` drill-down with
 * hover affordances; otherwise it's a static `<div>`. `tone` adds a soft accent
 * tint (used by the dashboard cluster); omitting it keeps the neutral card.
 *
 * @param props.label - All-caps caption above the number.
 * @param props.value - The big number — typically a count or percentage.
 * @param props.hint - Optional small explanatory text below the number.
 * @param props.icon - Optional emoji decoration in the top-right corner.
 * @param props.to - Optional route; makes the whole card a clickable link.
 * @param props.tone - Optional accent tint (blue/teal/violet/amber/rose).
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: string;
  to?: string;
  tone?: StatTone;
}) {
  const valueClass = tone
    ? TONES[tone].value
    : "text-ink-900 dark:text-ink-50 group-hover:text-brand-700 dark:group-hover:text-brand-300";
  const body = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-ink-600 dark:text-ink-400 uppercase tracking-wide">
          {label}
        </p>
        {icon && (
          <span aria-hidden className="text-lg opacity-70">
            {icon}
          </span>
        )}
      </div>
      <p
        className={clsx("text-2xl sm:text-3xl font-semibold mt-2", valueClass)}
      >
        {value}
      </p>
      {hint && (
        <p className="text-xs text-ink-600 dark:text-ink-400 mt-1">{hint}</p>
      )}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className={clsx(
          "card card-pad group block transition hover:shadow-md",
          tone ? TONES[tone].card : "hover:border-brand-300",
        )}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={clsx("card card-pad", tone && TONES[tone].card)}>
      {body}
    </div>
  );
}
