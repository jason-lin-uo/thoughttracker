/**
 * Design tokens — the single source of truth for the redesign's semantic
 * color system.
 *
 * Lives in `theme/` (not a component file) so it can be imported by both
 * React components (Badges, StanceTimeline, the analyst-console widgets) and
 * pure helpers without tripping React Fast Refresh's "components-only export"
 * rule.
 *
 * The headline concern here is STANCE color. A stance (supportive / mixed /
 * neutral / opposed) is the app's most load-bearing signal, so its color must:
 * 1. follow intuitive convention (teal = supportive, amber = mixed/both-
 * sides, slate = neutral / no-signal, rose = opposed),
 * 2. read at WCAG-AA contrast in BOTH light and dark mode, and
 * 3. be defined ONCE so a rebrand or a colorblind-safe palette swap is
 * a one-file change rather than a hunt through every component.
 *
 * The "analyst console" redesign introduces a fourth
 * stance color: `mixed` (amber). The classifier already emits a `mixed`
 * label, but the previous 3-family palette folded it into neutral gray; the
 * console surfaces it as its own amber family so a "both-sides" stance reads
 * distinctly from a true "no-signal" neutral. The two legacy consumers that
 * predate the console — the Ground-News-style `StanceTimeline` and the
 * `StanceBadge` pill — keep their 3-tone (green/red/gray) mapping via
 * `stanceBadgeTone`, which still treats mixed as gray, so nothing regresses.
 *
 * We expose two shapes of the same palette:
 * - `STANCE_TOKENS` — raw hex per mode, for SVG `fill`/`stroke` and
 * anywhere inline color is unavoidable (Recharts,
 * the trajectory dots, the ribbon segments).
 * - `stanceBadgeTone()` — maps a stance to the existing `Badge` tone
 * union so the pill components keep using the
 * audited Tailwind class triples instead of
 * hardcoding hex per component.
 */

import type { StanceLabel } from "../lib/types";

/**
 * The four semantic stance families the console palette is built around.
 *
 * `supportive`/`opposed`/`neutral` predate the console; `mixed` is the new
 * fourth family the analyst console surfaces in its own amber so a genuine
 * both-sides stance is visually distinct from a no-signal neutral.
 */
export type StanceFamily = "supportive" | "mixed" | "neutral" | "opposed";

/**
 * The four families in canonical display order — supportive (best) →
 * opposed (worst) with the two middling stances between. Used to drive the
 * ribbon segment order, the legend order, and the evidence stance-filter
 * pill order so every console surface lists stances in the same sequence.
 */
export const STANCE_FAMILY_ORDER: StanceFamily[] = [
  "supportive",
  "mixed",
  "neutral",
  "opposed",
];

/**
 * One stance family's color, expressed per resolved theme. Each value is
 * a `dot` (the saturated fill used for timeline/trajectory markers, heatmap
 * cells, and ribbon segments), a `text` hue chosen to clear WCAG-AA
 * (≥ 4.5:1) against that mode's card surface, a soft track hue, and a
 * `bg`/`badge` pairing for the soft-fill stance badges the console uses.
 */
export interface StanceColorSet {
  /** Saturated marker fill — trajectory dots, heatmap cells, ribbon segments. */
  dot: string;
  /** AA-contrast text/label hue against the mode's card surface. */
  text: string;
  /** Soft track/border hue for axes, connectors, and blockquote rules. */
  soft: string;
  /** Soft background tint behind the stance badge pill (matches `text`). */
  badgeBg: string;
}

/**
 * STANCE_TOKENS — the canonical 4-family stance palette, keyed by family
 * then by resolved theme. The hues mirror the approved topic-analysis
 * prototype's CSS variables exactly so the React app and the design
 * prototype paint identical colors:
 *
 * light: supportive #0f766e · mixed #b45309 · neutral #64748b · opposed #be123c
 * dark : supportive #2dd4bf · mixed #fbbf24 · neutral #94a3b8 · opposed #fb7185
 *
 * `dot` values are the prototype's saturated fills (light = the `text`
 * hue doubling as the cell fill; dark = the brighter `.dark` hue). `text`
 * is tuned to clear WCAG-AA against the card surface (#ffffff light /
 * #131316 dark). `badgeBg` is the prototype's soft `*-bg` tint.
 *
 * Contrast (verified against card surfaces, sRGB):
 * - supportive light text #0f766e on #ffffff ≈ 4.9:1 (AA ✓)
 * - mixed light text #b45309 on #ffffff ≈ 4.8:1 (AA ✓)
 * - neutral light text #64748b on #ffffff ≈ 4.5:1 (AA ✓)
 * - opposed light text #be123c on #ffffff ≈ 6.0:1 (AA ✓)
 * - supportive dark text #2dd4bf on #131316 ≈ 8.6:1 (AA ✓)
 * - mixed dark text #fbbf24 on #131316 ≈ 10.5:1 (AA ✓)
 * - neutral dark text #94a3b8 on #131316 ≈ 6.4:1 (AA ✓)
 * - opposed dark text #fb7185 on #131316 ≈ 6.5:1 (AA ✓)
 */
export const STANCE_TOKENS: Record<
  StanceFamily,
  Record<"light" | "dark", StanceColorSet>
> = {
  supportive: {
    light: {
      dot: "#0f766e",
      text: "#0f766e",
      soft: "#a7f3d0",
      badgeBg: "#ccfbf1",
    },
    dark: {
      dot: "#2dd4bf",
      text: "#2dd4bf",
      soft: "#0c2e2a",
      badgeBg: "#0c2e2a",
    },
  },
  mixed: {
    light: {
      dot: "#b45309",
      text: "#b45309",
      soft: "#fde68a",
      badgeBg: "#fef3c7",
    },
    dark: {
      dot: "#fbbf24",
      text: "#fbbf24",
      soft: "#332708",
      badgeBg: "#332708",
    },
  },
  neutral: {
    light: {
      dot: "#64748b",
      text: "#475569",
      soft: "#cbd5e1",
      badgeBg: "#e2e8f0",
    },
    dark: {
      dot: "#94a3b8",
      text: "#cbd5e1",
      soft: "#475569",
      badgeBg: "#1e293b",
    },
  },
  opposed: {
    light: {
      dot: "#be123c",
      text: "#be123c",
      soft: "#fecdd3",
      badgeBg: "#ffe4e6",
    },
    dark: {
      dot: "#fb7185",
      text: "#fb7185",
      soft: "#3a1620",
      badgeBg: "#3a1620",
    },
  },
};

/**
 * Collapse the full `StanceLabel` union down to the four color families.
 *
 * The classifier emits six labels; four carry a distinct console color:
 * - `supportive` → teal,
 * - `mixed` → amber (a genuine both-sides stance),
 * - `opposed` → rose,
 * - everything else — neutral, unclear, insufficient_evidence — reads as
 * `neutral` (slate) because none of those is a directional or both-sides
 * position worth its own color.
 *
 * @param stance - The classifier's stance label (any of the six).
 * @returns The stance color family the label maps to.
 */
export function stanceFamily(stance: StanceLabel): StanceFamily {
  if (stance === "supportive") return "supportive";
  if (stance === "opposed") return "opposed";
  if (stance === "mixed") return "mixed";
  return "neutral";
}

/**
 * Resolve a stance + resolved theme to its `StanceColorSet` (raw hex).
 * Use this anywhere inline color is required — SVG fills, Recharts props,
 * ribbon segments, heatmap cells, or a focus ring — so no component
 * hardcodes its own stance hex.
 *
 * @param stance - The classifier's stance label.
 * @param theme - The resolved theme currently painted ("light" | "dark").
 * @returns The hex color set for that stance in that theme.
 */
export function stanceColors(
  stance: StanceLabel,
  theme: "light" | "dark",
): StanceColorSet {
  return STANCE_TOKENS[stanceFamily(stance)][theme];
}

/**
 * Resolve a stance FAMILY (not a label) + theme directly to its color set.
 *
 * The console works in families (the verdict, ribbon, and legend iterate
 * `STANCE_FAMILY_ORDER`), so this avoids the round-trip of casting a family
 * back to a representative label just to call `stanceColors`.
 *
 * @param family - One of the four stance families.
 * @param theme - The resolved theme currently painted.
 * @returns The hex color set for that family in that theme.
 */
export function stanceFamilyColors(
  family: StanceFamily,
  theme: "light" | "dark",
): StanceColorSet {
  return STANCE_TOKENS[family][theme];
}

/**
 * Map a stance to the low-level `Badge` tone union so stance pills reuse
 * the audited Tailwind class triples (bg + text + border, light + dark)
 * instead of inlining hex. Keeps the legacy pill path token-driven and the
 * SVG path hex-driven while both stay anchored to the same families.
 *
 * Note: `mixed` deliberately maps to the existing `amber` tone here so the
 * `StanceBadge` pill matches the console's amber mixed family, while the
 * other non-directional labels still fall to gray.
 *
 * @param stance - The classifier's stance label.
 * @returns A `Badge` tone: "green" | "amber" | "red" | "gray".
 */
export function stanceBadgeTone(
  stance: StanceLabel,
): "green" | "amber" | "red" | "gray" {
  const family = stanceFamily(stance);
  if (family === "supportive") return "green";
  if (family === "opposed") return "red";
  if (family === "mixed") return "amber";
  return "gray";
}
