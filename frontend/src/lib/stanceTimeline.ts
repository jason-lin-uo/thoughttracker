/**
 * Stance-timeline data model + verdict derivation.
 *
 * Pure (no React, no DOM) so the verdict logic — the "clear verdict up
 * top" that the redesign leans on — is unit-testable in isolation and
 * reusable by both the `StanceTimeline` component and the Dashboard's
 * "biggest stance shift" highlight.
 *
 * The shapes here are deliberately decoupled from the API types: callers
 * adapt their server payload (`TopicAnalysis.summaries` + `topEvidence`,
 * or a dashboard aggregate) into `StanceMoment`s, and everything
 * downstream — sorting, the verdict, the SVG — works off this one model.
 */

import type { StanceLabel } from "./types";
import { stanceFamily, type StanceFamily } from "../theme/tokens";
import { formatDate, humanizeLabel } from "./format";
import { strings } from "../i18n/en";

/**
 * Fill `{token}` placeholders in an i18n template from a values map.
 *
 * Keeps the verdict copy in the i18n dictionary (so it's translatable and
 * reviewable in one place) while still letting `deriveVerdict` slot in the
 * computed family / date / year fragments.
 *
 * @param template - A string containing `{token}` placeholders.
 * @param values - Map of token name → replacement text.
 * @returns The template with every matching token substituted.
 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

/**
 * One dated point on a creator's stance timeline for a single topic.
 * `evidenceQuote` and `videoUrl` are optional because not every dated
 * summary has a pulled quote or a resolvable source link.
 */
export interface StanceMoment {
  /** Stable id for React keys + focus management (usually the summary id). */
  id: string;
  /** ISO date the stance was expressed (the video's publish date). */
  date: string;
  /** The classifier's stance label for this moment. */
  stance: StanceLabel;
  /** The video's title, shown in the detail panel + aria-label. */
  videoTitle: string;
  /** In-app route to the source video detail page. */
  videoHref: string;
  /** Optional best evidence quote for this moment. */
  evidenceQuote?: string | null;
  /** Optional one-line summary of what was said. */
  summary?: string | null;
}

/**
 * A derived, human-readable verdict for the whole timeline — the
 * Ground-News-style "headline" that sits above the dots so a reviewer
 * understands the arc in one read.
 */
export interface StanceVerdict {
  /** The dominant stance family across the window (drives the verdict color). */
  family: StanceFamily;
  /** The one-line headline, e.g. "Leans supportive — steady since 2021". */
  headline: string;
  /** True when the stance flipped families across the window. */
  shifted: boolean;
}

/**
 * Sort moments oldest → newest. A copy is returned (the input is never
 * mutated) so callers can hold the original order if they need it.
 *
 * @param moments - The unsorted moments.
 * @returns A new array sorted ascending by date.
 */
export function sortMoments(moments: StanceMoment[]): StanceMoment[] {
  return [...moments].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

/**
 * Tally stance families and return the most frequent one. Ties resolve to
 * whichever family was seen first in iteration order (`supportive` →
 * `opposed` → `neutral`), which is deterministic and good enough since a
 * true tie has no "dominant" stance to report anyway.
 *
 * @param moments - The moments to tally (any order).
 * @returns The dominant stance family, defaulting to "neutral" when empty.
 */
export function dominantFamily(moments: StanceMoment[]): StanceFamily {
  const counts: Record<StanceFamily, number> = {
    supportive: 0,
    mixed: 0,
    opposed: 0,
    neutral: 0,
  };
  for (const m of moments) counts[stanceFamily(m.stance)] += 1;
  /*
   * Default to neutral (also the empty-set result) and only override when a
   * family is STRICTLY more frequent, so ties keep the earlier-seen family
   * and an all-zero (empty) tally stays neutral. `mixed` joins the iteration
   * order (after the directional families) now that it's its own console family.
   */
  const order: StanceFamily[] = ["supportive", "opposed", "mixed", "neutral"];
  let best: StanceFamily = "neutral";
  let bestCount = 0;
  for (const family of order) {
    if (counts[family] > bestCount) {
      best = family;
      bestCount = counts[family];
    }
  }
  return best;
}

/** Year string from an ISO date (UTC), or null when the date is unparseable. */
function yearOf(iso: string): string | null {
  const d = new Date(iso);
  /*
   * Use the UTC year so grouping is timezone-stable and consistent with the
   * ISO dates everywhere else (local getFullYear would bucket a Dec-31 /
   * Jan-1 boundary date into a different year for non-UTC viewers).
   */
  return Number.isFinite(d.getTime()) ? String(d.getUTCFullYear()) : null;
}

/** Sentence-case verb phrase for a stance family ("supportive" / "opposed" / "neutral"). */
function familyWord(family: StanceFamily): string {
  return family;
}

/**
 * Derive the one-line verdict for a set of moments.
 *
 * Logic:
 * - 0 moments → a flat "Not enough dated evidence yet" (neutral).
 * - 1 moment → "Supportive on <date>" (no trend to report).
 * - many, same family start→end → "Leans <family> — steady since <year>".
 * - many, family changed start→end → "Shifted: <from> → <to> in <year>".
 *
 * The verdict always names the stance in words (not just color) so it
 * survives colorblindness and grayscale printing (WCAG 1.4.1).
 *
 * @param moments - The timeline moments (any order; sorted internally).
 * @returns The derived `StanceVerdict`.
 */
export function deriveVerdict(moments: StanceMoment[]): StanceVerdict {
  const sorted = sortMoments(moments);
  if (sorted.length === 0) {
    return {
      family: "neutral",
      headline: strings.verdict.notEnough,
      shifted: false,
    };
  }

  const dominant = dominantFamily(sorted);

  if (sorted.length === 1) {
    const only = sorted[0];
    return {
      family: stanceFamily(only.stance),
      headline: fill(strings.verdict.onDate, {
        family: humanizeLabel(stanceFamily(only.stance)),
        date: formatDate(only.date),
      }),
      shifted: false,
    };
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstFamily = stanceFamily(first.stance);
  const lastFamily = stanceFamily(last.stance);

  if (firstFamily !== lastFamily) {
    const year = yearOf(last.date);
    const where = year ? fill(strings.verdict.inYear, { year }) : "";
    return {
      family: dominant,
      headline: fill(strings.verdict.shifted, {
        from: familyWord(firstFamily),
        to: familyWord(lastFamily),
        where,
      }),
      shifted: true,
    };
  }

  const sinceYear = yearOf(first.date);
  return {
    family: dominant,
    headline: sinceYear
      ? fill(strings.verdict.steadySince, {
          family: familyWord(dominant),
          year: sinceYear,
        })
      : fill(strings.verdict.steady, { family: familyWord(dominant) }),
    shifted: false,
  };
}
