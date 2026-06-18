/**
 * Cross-cutting numeric constants shared across services/controllers.
 *
 * These are values that were previously written as bare "magic numbers" in
 * several call sites; hoisting them here gives the threshold a name, a single
 * definition, and one place to document WHY it has the value it does. Keeping
 * the literal in one module also prevents the classic drift bug where one
 * query is bumped to 0.45 and three others silently keep 0.4, so "evidence"
 * means different things on different pages.
 */

/**
 * MIN_EVIDENCE_RELEVANCE — minimum per-chunk topic-relevance score for a
 * `ChunkTopicAnalysis` row to count as real "evidence".
 *
 * Chunks below this only glance off a topic (a passing mention, an ad read,
 * an intro) and should not feed stance tallies, dashboards, the Evidence
 * Explorer list, related-evidence lookups, or mention counts — including them
 * would let low-signal noise sway a creator's apparent stance. 0.4 is the
 * tuned cut-over between "this chunk is actually about the topic" and "the
 * topic is merely name-dropped here", matching the trained policy and
 * relevance distribution. Used by:
 * - dashboard.controller (evidence count)
 * - creators.controller (per-creator topic evidence)
 * - search.controller (search result filtering)
 * - evidence.service (list + related-evidence queries)
 * - creatorComparison.service (compare evidence filter)
 * and documented in the video-topic-summary prompt's `mentionCount` rule.
 */
export const MIN_EVIDENCE_RELEVANCE = 0.4;
