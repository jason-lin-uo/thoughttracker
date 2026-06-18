import type { TrendLabel } from "@prisma/client";

/**
 * The dashboard's hero "featured insight" is backed by analyzed timelines
 * (CreatorTopicTimeline). The dashboard controller now prefers the latest
 * generated topic report when it maps to one of those timelines, which lets
 * the admin reset flow place a known featured report on the dashboard. When no
 * matching report exists, this helper chooses the strongest analyzed fallback.
 *
 * Linking: when a backing topic report EXISTS for the featured (creator,
 * topic) pair, toFeaturedInsight surfaces that report's title/summary and
 * the hero deep-links to the full report; the topic-analysis page (always
 * available for any analyzed topic) is the FALLBACK used only when no report
 * exists yet. See toFeaturedInsight + dashboard.controller.ts.
 */
export interface FeaturedInsight {
  creatorId: string;
  creatorName: string;
  topicId: string;
  topicName: string;
  trendLabel: TrendLabel;
  /* The report summary is preferred; falls back to the timeline summary. */
  summary: string | null;
  /*
   * The backing topic report id, so the hero deep-links to the full report
   * rather than the topic page. null when no report exists for this pair yet.
   */
  reportId: string | null;
  /*
   * The report title, so the hero headline matches the report it opens
   * instead of a templated headline. null means template.
   */
  reportTitle: string | null;
}

/** Minimal timeline shape the selector + mapper need (creator/topic joined in). */
export interface TimelineLike {
  creatorId: string;
  topicId: string;
  trendLabel: TrendLabel;
  summary: string | null;
  creator: { name: string };
  topic: { name: string };
  /** How many of the creator's videos discuss this topic (credibility signal). */
  videoCount: number;
}

/**
 * Minimum videos behind a shift for it to headline the hero. A "shift" computed
 * from 2-3 videos is noise, not a story; featuring it makes the showcase look
 * flimsy. Shifts below this bar are demoted beneath well-supported ones.
 */
export const MIN_VIDEOS_FOR_FEATURE = 8;

/**
 * Score a timeline for the hero slot. Higher is more featureworthy.
 *
 * Ranking intent:
 * 1. Sharp pivots (`abrupt_shift`) outrank gradual shifts outrank `mixed`
 * ("debated") outrank everything else. That is what "biggest" means.
 * 2. BUT only when backed by >= MIN_VIDEOS_FOR_FEATURE videos; an under-
 * supported shift is demoted below well-supported ones so we never
 * headline a 2-video "shift".
 * 3. Ties break by videoCount (more evidence = more convincing).
 */
function scoreTimeline(t: TimelineLike): number {
  const trendRank: Partial<Record<TrendLabel, number>> = {
    abrupt_shift: 3,
    gradual_shift: 2,
    mixed: 1,
  };
  const rank = trendRank[t.trendLabel] ?? 0;
  const credible = t.videoCount >= MIN_VIDEOS_FOR_FEATURE;
  /*
   * Credible, ranked timelines occupy the top band; under-supported ones fall
   * to a lower band (rank 0) so a well-supported stable topic can still beat a
   * flimsy 2-video "shift". videoCount is the within-band tiebreaker.
   */
  const band = credible ? rank : 0;
  return band * 1_000_000 + t.videoCount;
}

/**
 * Pick the timeline to feature from the analyzed set: the highest-scoring per
 * `scoreTimeline` (sharpest, best-supported shift; gracefully degrading to the
 * best-supported topic when nothing has shifted). Returns null only when there
 * is nothing analyzed at all, so the hero is otherwise always populated.
 */
export function selectFeaturedTimeline<T extends TimelineLike>(
  candidates: T[],
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const score = scoreTimeline(c);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Map a selected timeline (or null) to the dashboard's `featuredInsight` payload.
 * When the backing topic report exists, the hero shows that report's real
 * summary and deep-links to it; otherwise it falls back to the timeline summary
 * and (in the UI) the topic page.
 */
export function toFeaturedInsight(
  timeline: TimelineLike | null,
  report?: { id: string; title: string; summary: string | null } | null,
): FeaturedInsight | null {
  if (!timeline) return null;
  return {
    creatorId: timeline.creatorId,
    creatorName: timeline.creator.name,
    topicId: timeline.topicId,
    topicName: timeline.topic.name,
    trendLabel: timeline.trendLabel,
    summary: report?.summary ?? timeline.summary,
    reportId: report?.id ?? null,
    reportTitle: report?.title ?? null,
  };
}
