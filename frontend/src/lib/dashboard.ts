/**
 * Dashboard derivations: pure helpers for the redesigned landing page.
 *
 * No React/DOM so the "what should we feature?" logic is unit-testable and
 * decoupled from the `DashboardResponse` rendering. The backend may feature
 * the latest topic report or an analyzed fallback, and this helper only turns
 * that server-selected `featuredInsight` into display text.
 */

import type { FeaturedInsight } from "./types";
import { fillTemplate } from "./format";
import { strings } from "../i18n/en";

/**
 * Build the hero's eyebrow + headline for a featured insight, adapting to the
 * topic's trend so the framing is honest: a sharp pivot / gradual shift reads
 * as "biggest stance shift", a `mixed` trend as "most debated", and an
 * otherwise-stable topic as a neutral "topic spotlight" (so we never label a
 * steady stance as a "shift").
 *
 * @param insight - The dashboard's featured insight.
 * @returns The `{ eyebrow, title }` strings to render in the hero.
 */
export function featuredHeadline(insight: FeaturedInsight): {
  eyebrow: string;
  title: string;
} {
  const vars = { creator: insight.creatorName, topic: insight.topicName };
  switch (insight.trendLabel) {
    case "abrupt_shift":
      return {
        eyebrow: strings.dashboard.featured.eyebrowShift,
        title: fillTemplate(strings.dashboard.featured.titleAbrupt, vars),
      };
    case "gradual_shift":
      return {
        eyebrow: strings.dashboard.featured.eyebrowShift,
        title: fillTemplate(strings.dashboard.featured.titleGradual, vars),
      };
    case "mixed":
      return {
        eyebrow: strings.dashboard.featured.eyebrowMixed,
        title: fillTemplate(strings.dashboard.featured.titleMixed, vars),
      };
    default:
      return {
        eyebrow: strings.dashboard.featured.eyebrowSteady,
        title: fillTemplate(strings.dashboard.featured.titleSteady, vars),
      };
  }
}
