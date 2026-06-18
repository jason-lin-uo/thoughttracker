import fs from "node:fs";
import path from "node:path";
import { prisma } from "../config/prisma";
import {
  predictTopicCandidates,
  predictTopicRelevance,
} from "../ai/mlClassifierClient";
import { runLlm } from "../ai/llmClient";
import {
  TOPIC_DETECTION_PROMPT_VERSION,
  TOPIC_DETECTION_SYSTEM,
  buildTopicDetectionUserPrompt,
} from "../ai/prompts/topicDetection.prompt";
import { TopicDetectionResponseSchema } from "../ai/schemas/topicDetection.schema";
import { slugify } from "../utils/slugify";
import { logger } from "../utils/logger";
import {
  CONTROLLED_TOPIC_TAXONOMY,
  DEFAULT_TOPIC_TAXONOMY,
  type TopicTaxonomyEntry,
} from "./topicTaxonomy";

/**
 * Service function: default topic taxonomy.
 */
export { CONTROLLED_TOPIC_TAXONOMY, DEFAULT_TOPIC_TAXONOMY };

export interface DetectedTopic {
  name: string;
  slug: string;
  description?: string;
  mentionCount: number;
  relevanceScore: number;
  evidenceQuote?: string;
}

interface CuratedRerankerRow {
  chunkId?: string;
  decision?: string;
  displayTier?: string;
  selectedTopics?: Array<{
    topicSlug?: string;
    topicName?: string;
    confidence?: number;
    evidenceQuote?: string;
  }>;
}

interface TopicSelectionPolicy {
  candidateTopK?: number;
  baselinePolicy?: {
    threshold?: number;
    maxSelected?: number;
    rankMode?: string;
    minRerankerMargin?: number;
    minRelevanceMargin?: number;
  };
  topicThresholds?: Record<string, number>;
  acceptedSuppressionRules?: Array<{
    removeTopicSlug?: string;
    whenCoPredictedWith?: string;
  }>;
}

interface ScoredTopicCandidate {
  topicSlug: string;
  topicName: string;
  topicDescription?: string;
  rerankerScore: number;
  relevanceScore: number;
}

/*
 * Both file-backed caches key on path AND mtimeMs so a same-path hot-swap of
 * the artifact (regenerated labels / a re-tuned policy at the configured path)
 * is picked up instead of serving the stale parse for the process lifetime.
 */
let curatedRerankerCache:
  | {
      path: string;
      mtimeMs: number;
      rowsByChunkId: Map<string, DetectedTopic[]>;
    }
  | undefined;
let topicSelectionPolicyCache:
  | {
      path: string;
      mtimeMs: number;
      policy: TopicSelectionPolicy;
    }
  | undefined;

/**
 * detectTopicsForTranscript  -  extract a list of `{ name, slug,
 * relevance }` topics for a chunk of text.
 *
 * The controlled-taxonomy detector handles clear high-signal matches first.
 * If that does not find anything, the configured real LLM provider receives
 * the taxonomy and transcript chunk. Malformed LLM JSON is treated as "no
 * topic" for this chunk instead of inventing a label.
 */
export async function detectTopicsForTranscript(
  transcriptText: string,
): Promise<DetectedTopic[]> {
  const controlledHits = detectControlledTopics(transcriptText);
  if (controlledHits.length > 0) return controlledHits;

  const userPrompt = buildTopicDetectionUserPrompt({
    transcript: transcriptText,
    taxonomy: CONTROLLED_TOPIC_TAXONOMY,
  });

  const result = await runLlm({
    task: "topic_detection",
    system: TOPIC_DETECTION_SYSTEM,
    userPrompt: userPrompt,
    responseFormat: "json",
    promptVersion: TOPIC_DETECTION_PROMPT_VERSION,
    /*
     * taskInput must mirror what the prompt actually sends so traces and
     * debugging snapshots match the exact shape the model received.
     */
    taskInput: {
      transcript: transcriptText,
      taxonomy: CONTROLLED_TOPIC_TAXONOMY,
    },
  });

  const parsed = TopicDetectionResponseSchema.safeParse(result.json);
  if (!parsed.success) return [];

  return parsed.data.topics.map((topic) => ({
    name: topic.name,
    slug: slugify(topic.slug ?? topic.name),
    description: topic.description,
    mentionCount: topic.mentionCount,
    /*
     * Defensively clamp to [0,1]  -  the schema already bounds it, but an
     * out-of-range or non-finite score from a hand-rolled provider response
     * shouldn't leak into thresholds/sorting downstream.
     */
    relevanceScore: clamp01(topic.relevanceScore),
  }));
}

/**
 * detectTopicsForChunk  -  assign topics to a single transcript chunk
 * using the configured topic-selection strategy.
 *
 * Tiers are tried in priority order; the first that produces a result
 * for the active `TOPIC_ASSIGNMENT_PROVIDER` wins:
 * 1. `curated_reranker`  -  replay hand-curated, pre-computed labels keyed
 * by chunkId (highest precision for the committed real-data snapshot).
 * 2. `final_policy`  -  run the gold-standard candidate->relevance->policy
 * pipeline (thresholds, margins, suppression rules) at request time.
 * 3. `custom_ml_reranker`  -  run only the ML candidate reranker and keep
 * its top scores.
 * Each tier returns null when its provider isn't selected, so control falls
 * through. When none apply, we ask the configured real LLM path to make the
 * best controlled-taxonomy decision it can.
 */
export async function detectTopicsForChunk(args: {
  chunkId: string;
  transcriptText: string;
}): Promise<DetectedTopic[]> {
  const curated = getCuratedRerankerTopicsForChunk(args.chunkId);
  if (curated) return curated;

  const finalPolicy = await getFinalPolicyTopicsForChunk(args.transcriptText);
  if (finalPolicy) return finalPolicy;

  const mlReranker = await getMlRerankerTopicsForChunk(args.transcriptText);
  if (mlReranker) return mlReranker;

  return detectTopicsForTranscript(args.transcriptText);
}

/**
 * getFinalPolicyTopicsForChunk  -  `final_policy` tier: select topics for a
 * chunk by running the candidate reranker, scoring each candidate's
 * relevance, then applying the gold-standard selection policy.
 *
 * Returns null unless `TOPIC_ASSIGNMENT_PROVIDER === "final_policy"`, so
 * it's a no-op under any other provider. When active, it loads the
 * gold-standard selection policy artifact (see loadTopicSelectionPolicy) and
 * throws if required ML endpoints or artifacts are unavailable. That keeps
 * final-policy failures visible instead of silently producing weaker labels:
 * 1. Fetch up to `candidateTopK` topic candidates from the reranker.
 * 2. For each candidate that maps to a controlled-taxonomy entry, score
 * its relevance and record both reranker and relevance scores.
 * 3. Sort by the policy's rankMode (see compareScoredTopics), then keep
 * candidates clearing the per-topic or global relevance threshold.
 * 4. Apply margin pruning (applyFinalPolicyMargins) and co-prediction
 * suppression (applyFinalPolicySuppression), then cap at `maxSelected`.
 */
async function getFinalPolicyTopicsForChunk(
  transcriptText: string,
): Promise<DetectedTopic[] | null> {
  if (
    (process.env.TOPIC_ASSIGNMENT_PROVIDER ?? "").toLowerCase() !==
    "final_policy"
  ) {
    return null;
  }

  const policy = loadTopicSelectionPolicy();
  const baseline = policy.baselinePolicy ?? {};
  const candidateLimit = clampInt(
    Number(policy.candidateTopK ?? topicRerankerLimit()),
    1,
    20,
    12,
  );
  const result = await predictTopicCandidates({
    text: transcriptText,
    limit: candidateLimit,
    minScore: topicRerankerMinScoreForFinalPolicy(),
  });

  if (!result.ok) {
    /*
     * The final policy is the committed gold-standard path. If its ML
     * candidate endpoint is down, fail loudly instead of silently switching to
     * a weaker topic source and making the product look healthier than it is.
     */
    logger.error("final_policy candidate endpoint unavailable", {
      error: result.error,
    });
    throw new Error(
      `final_policy_candidate_endpoint_unavailable:${result.error}`,
    );
  }

  /*
   * Index the controlled taxonomy by slug to resolve candidate slugs and
   * drop any the reranker returned that aren't in our taxonomy.
   */
  const taxonomyBySlug = new Map(
    CONTROLLED_TOPIC_TAXONOMY.map((topic) => [topic.slug, topic]),
  );
  /* Candidates that map to a known taxonomy entry (unknown slugs dropped). */
  const inTaxonomy = result.topics.flatMap((candidate) => {
    const taxonomyEntry = taxonomyBySlug.get(candidate.topicSlug);
    return taxonomyEntry ? [{ candidate, taxonomyEntry }] : [];
  });

  /*
   * Score relevance for each candidate with bounded concurrency instead of one
   * sequential await per candidate. A failed relevance response aborts the
   * final-policy path loudly so the caller knows the gold-standard analysis is
   * not actually available.
   */
  const relevances = await mapWithConcurrency(
    inTaxonomy,
    finalPolicyRelevanceConcurrency(),
    ({ taxonomyEntry }) =>
      predictTopicRelevance({
        topic: taxonomyEntry.name,
        text: transcriptText,
      }),
  );

  const scored: ScoredTopicCandidate[] = [];
  for (let i = 0; i < inTaxonomy.length; i += 1) {
    const { candidate, taxonomyEntry } = inTaxonomy[i];
    const relevance = relevances[i];
    if (!relevance.ok) {
      /*
       * Relevance scoring is part of the final policy contract. A partial
       * scorer outage should be visible to operators, not hidden by a lower
       * tier that changes product behavior.
       */
      logger.error("final_policy relevance endpoint unavailable", {
        error: relevance.error,
      });
      throw new Error(
        `final_policy_relevance_endpoint_unavailable:${relevance.error}`,
      );
    }

    const relevanceScore = clamp01(
      Number(
        relevance.labelScores.relevant ??
          (relevance.predictedLabel === "relevant"
            ? relevance.confidence
            : 1 - relevance.confidence),
      ),
    );
    scored.push({
      topicSlug: taxonomyEntry.slug,
      topicName: taxonomyEntry.name,
      topicDescription: taxonomyEntry.description,
      rerankerScore: clamp01(Number(candidate.confidence)),
      relevanceScore,
    });
  }

  const rankMode = String(baseline.rankMode ?? "combined");
  scored.sort((a, b) => compareScoredTopics(a, b, rankMode));

  const globalThreshold = clamp01(Number(baseline.threshold ?? 0.4));
  const topicThresholds = policy.topicThresholds ?? {};
  let selected = scored.filter(
    (candidate) =>
      candidate.relevanceScore >=
      clamp01(Number(topicThresholds[candidate.topicSlug] ?? globalThreshold)),
  );

  selected = applyFinalPolicyMargins(selected, baseline);
  selected = applyFinalPolicySuppression(selected, policy);

  const maxSelected = clampInt(Number(baseline.maxSelected ?? 5), 1, 5, 5);
  return selected.slice(0, maxSelected).map((candidate) => ({
    name: candidate.topicName,
    slug: candidate.topicSlug,
    description: candidate.topicDescription,
    mentionCount: 1,
    relevanceScore: candidate.relevanceScore,
  }));
}

/**
 * getMlRerankerTopicsForChunk  -  `custom_ml_reranker` tier: assign topics
 * purely from the ML candidate reranker's scores, with no policy layer.
 *
 * Returns null unless `TOPIC_ASSIGNMENT_PROVIDER === "custom_ml_reranker"`,
 * and also null (graceful fallback to the next tier) if the reranker
 * endpoint is unavailable. Otherwise it maps each candidate to its
 * controlled-taxonomy entry, uses the clamped reranker confidence as the
 * relevance score, sorts descending, and keeps the top `topicRerankerLimit()`.
 */
async function getMlRerankerTopicsForChunk(
  transcriptText: string,
): Promise<DetectedTopic[] | null> {
  if (
    (process.env.TOPIC_ASSIGNMENT_PROVIDER ?? "").toLowerCase() !==
    "custom_ml_reranker"
  ) {
    return null;
  }

  const result = await predictTopicCandidates({
    text: transcriptText,
    limit: topicRerankerLimit(),
    minScore: topicRerankerMinScore(),
  });

  if (!result.ok) {
    return null;
  }

  /*
   * Index the controlled taxonomy by slug so reranker candidates can be
   * resolved to taxonomy entries (unknown slugs are skipped below).
   */
  const taxonomyBySlug = new Map(
    CONTROLLED_TOPIC_TAXONOMY.map((topic) => [topic.slug, topic]),
  );
  const selected: DetectedTopic[] = [];
  for (const candidate of result.topics) {
    const taxonomyEntry = taxonomyBySlug.get(candidate.topicSlug);
    if (!taxonomyEntry) continue;
    selected.push({
      name: taxonomyEntry.name,
      slug: taxonomyEntry.slug,
      description: taxonomyEntry.description,
      mentionCount: 1,
      relevanceScore: clamp01(candidate.confidence),
    });
  }

  selected.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return selected.slice(0, topicRerankerLimit());
}

/**
 * topicRerankerLimit  -  max number of reranker candidates/selected topics,
 * read from `TOPIC_RERANKER_LIMIT` (default 12).
 *
 * Coerced to an integer and clamped to [1, 20]; a missing or non-finite
 * value falls back to 12.
 */
function topicRerankerLimit(): number {
  const parsed = Number(process.env.TOPIC_RERANKER_LIMIT ?? 12);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

/**
 * topicRerankerMinScore  -  minimum reranker confidence to request
 * candidates in the `custom_ml_reranker` tier, from
 * `TOPIC_RERANKER_MIN_SCORE` (default 0.2), clamped to [0, 1].
 */
function topicRerankerMinScore(): number {
  const parsed = Number(process.env.TOPIC_RERANKER_MIN_SCORE ?? 0.2);
  if (!Number.isFinite(parsed)) return 0.2;
  return Math.max(0, Math.min(1, parsed));
}

/**
 * topicRerankerMinScoreForFinalPolicy  -  minimum reranker confidence used
 * when requesting candidates in the `final_policy` tier.
 *
 * Reads the same `TOPIC_RERANKER_MIN_SCORE` var but defaults to 0 (no
 * pre-filtering), because the policy layer applies its own thresholds
 * and margins downstream and wants the full candidate set. Clamped to
 * [0, 1].
 */
function topicRerankerMinScoreForFinalPolicy(): number {
  const parsed = Number(process.env.TOPIC_RERANKER_MIN_SCORE ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

/**
 * resolveTopicSelectionPolicyPath  -  locate the `final_policy` selection
 * policy JSON artifact and report whether the location was explicitly
 * configured.
 *
 * Prefers an explicit `TOPIC_SELECTION_POLICY_PATH` override (returned
 * with `explicit: true`); otherwise
 * probes the sibling `thoughttracker-ml/models/...gold-standard/policy.json`
 * at one and two levels above cwd and returns the first existing candidate,
 * or null when none exist (`explicit: false`). Missing policy files are fatal
 * for the final-policy path because the product should run on the committed
 * gold artifact, not an implicit baseline.
 */
function resolveTopicSelectionPolicyPath(): {
  path: string | null;
  explicit: boolean;
} {
  const raw = process.env.TOPIC_SELECTION_POLICY_PATH?.trim();
  if (raw) return { path: path.resolve(raw), explicit: true };

  const policyParts = [
    "thoughttracker-ml",
    "models",
    "topic-selection-policy-gold-standard",
    "policy.json",
  ];
  const candidates = [
    path.resolve(process.cwd(), "..", ...policyParts),
    path.resolve(process.cwd(), "..", "..", ...policyParts),
  ];
  return {
    path: candidates.find((candidate) => fs.existsSync(candidate)) ?? null,
    explicit: false,
  };
}

/**
 * loadTopicSelectionPolicy \u2014 resolve the active `final_policy` selection
 * policy from the committed gold-standard artifact.
 *
 * Resolution order:
 * 1. Explicit `TOPIC_SELECTION_POLICY_PATH` set but the file is missing \u2192
 * throw.
 * 2. A policy file found on disk \u2192 read it, strip a leading UTF-8 BOM,
 * parse, and memoize by path + mtime.
 * 3. No explicit path and no discovered artifact \u2192 throw, because the real
 * product cannot claim final-policy accuracy without the artifact.
 */
function loadTopicSelectionPolicy(): TopicSelectionPolicy {
  const resolved = resolveTopicSelectionPolicyPath();

  if (resolved.explicit && (!resolved.path || !fs.existsSync(resolved.path))) {
    throw new Error(
      `Final topic-selection policy artifact is not available: ${resolved.path ?? ""}`,
    );
  }

  if (resolved.path && fs.existsSync(resolved.path)) {
    const mtimeMs = fs.statSync(resolved.path).mtimeMs;
    if (
      topicSelectionPolicyCache?.path === resolved.path &&
      topicSelectionPolicyCache.mtimeMs === mtimeMs
    ) {
      return topicSelectionPolicyCache.policy;
    }
    try {
      const rawPolicy = fs
        .readFileSync(resolved.path, "utf-8")
        .replace(/^\uFEFF/, "");
      const parsed = JSON.parse(rawPolicy) as TopicSelectionPolicy;
      topicSelectionPolicyCache = {
        path: resolved.path,
        mtimeMs,
        policy: parsed,
      };
      return parsed;
    } catch (err) {
      /*
       * A present-but-malformed artifact is always a misconfiguration. Fail
       * loud rather than proceeding with hidden, lower-quality behavior.
       */
      if (resolved.explicit) {
        throw new Error(
          `Final topic-selection policy artifact is malformed: ${resolved.path} - ${(err as Error).message}`,
        );
      }
      throw new Error(
        `Final topic-selection policy artifact is malformed: ${resolved.path} - ${(err as Error).message}`,
      );
    }
  }

  throw new Error(
    "Final topic-selection policy artifact is not available. Restore the gold-standard artifact before running final_policy analysis.",
  );
}

/**
 * scoreKey \u2014 build the lexicographic ranking key for a scored candidate
 * under the given rankMode.
 *
 * `combined` ranks primarily by relevance\u00D7reranker product, then by
 * relevance, then reranker (tie-breakers); any other mode ranks by
 * relevance then reranker (with a trailing 0). Returned as a fixed
 * 3-tuple so compareScoredTopics/scoreKeyLessThanOrEqual can compare
 * element-by-element.
 */
function scoreKey(
  candidate: ScoredTopicCandidate,
  rankMode: string,
): [number, number, number] {
  if (rankMode === "combined") {
    return [
      candidate.relevanceScore * candidate.rerankerScore,
      candidate.relevanceScore,
      candidate.rerankerScore,
    ];
  }
  return [candidate.relevanceScore, candidate.rerankerScore, 0];
}

/**
 * compareScoredTopics \u2014 Array.sort comparator that orders candidates
 * descending by their scoreKey (higher score first).
 *
 * Compares the key tuples component-by-component; ties fall back to a
 * stable alphabetical ordering on `topicSlug` so output is deterministic.
 */
function compareScoredTopics(
  a: ScoredTopicCandidate,
  b: ScoredTopicCandidate,
  rankMode: string,
): number {
  const aKey = scoreKey(a, rankMode);
  const bKey = scoreKey(b, rankMode);
  for (let index = 0; index < aKey.length; index += 1) {
    const delta = bKey[index] - aKey[index];
    if (delta !== 0) return delta;
  }
  return a.topicSlug.localeCompare(b.topicSlug);
}

/**
 * scoreKeyLessThanOrEqual \u2014 true when candidate `a`'s scoreKey is <= `b`'s
 * under lexicographic comparison of the key tuples (equal keys count as
 * <=).
 *
 * Used by suppression rules to decide whether the topic targeted for
 * removal is no stronger than the co-predicted trigger topic before
 * dropping it.
 */
function scoreKeyLessThanOrEqual(
  a: ScoredTopicCandidate,
  b: ScoredTopicCandidate,
  rankMode: string,
): boolean {
  const aKey = scoreKey(a, rankMode);
  const bKey = scoreKey(b, rankMode);
  for (let index = 0; index < aKey.length; index += 1) {
    if (aKey[index] < bKey[index]) return true;
    if (aKey[index] > bKey[index]) return false;
  }
  return true;
}

/**
 * applyFinalPolicyMargins \u2014 prune `final_policy` candidates that trail the
 * top-ranked candidate by more than the configured score margins.
 *
 * The first (top) candidate is always kept. Every other candidate is
 * retained only if it is within `minRerankerMargin` of the top reranker
 * score AND within `minRelevanceMargin` of the top relevance score. A
 * margin of <= 0 (or non-finite) disables that constraint; if both are
 * disabled the input is returned unchanged. Assumes `selected` is already
 * sorted so index 0 is the top candidate.
 */
function applyFinalPolicyMargins(
  selected: ScoredTopicCandidate[],
  baseline: TopicSelectionPolicy["baselinePolicy"],
): ScoredTopicCandidate[] {
  if (selected.length === 0) return selected;
  /*
   * Default both margins to 0 (= pruning disabled) when a policy omits them,
   * matching DEFAULT_TOPIC_SELECTION_POLICY and the documented "0 disables"
   * contract. A non-zero default here (it was 0.1 for the reranker margin only)
   * silently pruned candidates for any operator-supplied policy that left the
   * field out  -  diverging from the built-in default's behavior.
   */
  const minRerankerMargin = Number(baseline?.minRerankerMargin ?? 0);
  const minRelevanceMargin = Number(baseline?.minRelevanceMargin ?? 0);
  if (minRerankerMargin <= 0 && minRelevanceMargin <= 0) return selected;

  const top = selected[0];
  return selected.filter(
    (candidate, index) =>
      index === 0 ||
      ((!Number.isFinite(minRerankerMargin) ||
        minRerankerMargin <= 0 ||
        candidate.rerankerScore >= top.rerankerScore - minRerankerMargin) &&
        (!Number.isFinite(minRelevanceMargin) ||
          minRelevanceMargin <= 0 ||
          candidate.relevanceScore >= top.relevanceScore - minRelevanceMargin)),
  );
}

/**
 * applyFinalPolicySuppression  -  drop topics that the policy says should
 * be suppressed when a stronger, related topic was co-predicted.
 *
 * For each `acceptedSuppressionRules` entry (`removeTopicSlug` when
 * co-predicted with `whenCoPredictedWith`), if both topics are present in
 * the selection and the remove-target scores <= the trigger
 * (scoreKeyLessThanOrEqual under "combined"), the target is removed. This
 * de-duplicates near-synonym / parent-child topic pairs (e.g. keeping the
 * more specific one). No-op when fewer than two topics remain.
 */
function applyFinalPolicySuppression(
  selected: ScoredTopicCandidate[],
  policy: TopicSelectionPolicy,
): ScoredTopicCandidate[] {
  if (selected.length < 2) return selected;
  /*
   * Index selected candidates by slug so suppression rules can look up the
   * remove-target and its co-predicted trigger in O(1).
   */
  const bySlug = new Map(
    selected.map((candidate) => [candidate.topicSlug, candidate]),
  );
  const removed = new Set<string>();
  for (const rule of policy.acceptedSuppressionRules ?? []) {
    const removeTopic = rule.removeTopicSlug;
    const triggerTopic = rule.whenCoPredictedWith;
    if (!removeTopic || !triggerTopic || removed.has(removeTopic)) continue;
    const removeCandidate = bySlug.get(removeTopic);
    const triggerCandidate = bySlug.get(triggerTopic);
    if (!removeCandidate || !triggerCandidate) continue;
    if (
      scoreKeyLessThanOrEqual(removeCandidate, triggerCandidate, "combined")
    ) {
      removed.add(removeTopic);
    }
  }
  return selected.filter((candidate) => !removed.has(candidate.topicSlug));
}

/**
 * clampInt  -  coerce a number to an integer within [min, max], using
 * `fallback` when the value is not finite (e.g. parsed from a bad env
 * var or malformed policy field).
 */
function clampInt(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * finalPolicyRelevanceConcurrency  -  how many `predict-topic-relevance` calls
 * the final_policy tier issues in parallel, from
 * `FINAL_POLICY_RELEVANCE_CONCURRENCY` (default 4), clamped to [1, 12].
 *
 * Bounded so we parallelize the former serial-per-candidate N+1 without
 * stampeding the single ML service.
 */
function finalPolicyRelevanceConcurrency(): number {
  const parsed = Number(process.env.FINAL_POLICY_RELEVANCE_CONCURRENCY ?? 4);
  return clampInt(parsed, 1, 12, 4);
}

/**
 * mapWithConcurrency  -  run `fn` over `items` with at most `limit` promises
 * in flight at once, preserving input order in the returned results array.
 *
 * A tiny worker-pool: `limit` workers pull the next index off a shared
 * cursor until the input is exhausted. Used to bound parallel ML calls.
 */
async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  limit: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  /*
   * Spawn `workerCount` workers that each pull the next index off the shared
   * cursor until the input is exhausted.
   */
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * getCuratedRerankerTopicsForChunk  -  `curated_reranker` tier: return the
 * pre-computed, hand-curated topic labels for a specific chunkId.
 *
 * Returns null (so the dispatcher falls through to the next tier) unless
 * `TOPIC_ASSIGNMENT_PROVIDER === "curated_reranker"`, the labels file is
 * configured and exists, AND that file actually contains a row for this
 * chunkId. Note an *empty array* is a meaningful "curated: no topics"
 * answer and is returned as-is  -  only a genuinely absent chunkId yields
 * null. This tier is highest priority because the labels are gold,
 * deterministic, and require no model call (ideal for the demo dataset).
 */
function getCuratedRerankerTopicsForChunk(
  chunkId: string,
): DetectedTopic[] | null {
  if (
    (process.env.TOPIC_ASSIGNMENT_PROVIDER ?? "").toLowerCase() !==
    "curated_reranker"
  ) {
    return null;
  }

  const labelsPath = resolveCuratedRerankerLabelsPath();
  if (!labelsPath || !fs.existsSync(labelsPath)) {
    return null;
  }

  const cache = loadCuratedRerankerCache(labelsPath);
  return cache.rowsByChunkId.get(chunkId) ?? null;
}

/**
 * resolveCuratedRerankerLabelsPath  -  resolve the path to the curated
 * labels JSONL file from `TOPIC_RERANKER_LABELS_PATH`.
 *
 * Unlike the policy/script paths, there is no auto-probe default: returns
 * the resolved override path, or null when the var is unset (which makes
 * getCuratedRerankerTopicsForChunk fall through to the next tier).
 */
function resolveCuratedRerankerLabelsPath(): string | null {
  const raw = process.env.TOPIC_RERANKER_LABELS_PATH?.trim();
  if (raw) return path.resolve(raw);
  return null;
}

/**
 * loadCuratedRerankerCache  -  parse the curated labels JSONL file into a
 * `chunkId -> DetectedTopic[]` map, memoized by path.
 *
 * Returns the cached structure on a path hit. Otherwise it reads the file
 * line-by-line (each line is an independent JSON object; unparseable or
 * blank lines and rows without a chunkId are skipped) and, per row:
 * - records an empty topic list when the row's displayTier is not in the
 * allowed set or its decision is `no_topic`/`junk` (an explicit
 * "no topics" answer, distinct from an absent chunk);
 * - otherwise maps each selectedTopic to its controlled-taxonomy entry
 * (skipping unknown slugs), clamps confidence (default 0.95), attaches
 * the evidence quote when present, sorts by descending relevance, and
 * keeps the top 5.
 */
function loadCuratedRerankerCache(labelsPath: string) {
  const mtimeMs = fs.statSync(labelsPath).mtimeMs;
  if (
    curatedRerankerCache?.path === labelsPath &&
    curatedRerankerCache.mtimeMs === mtimeMs
  ) {
    return curatedRerankerCache;
  }

  /*
   * Index the controlled taxonomy by slug to resolve each curated row's
   * selectedTopics; unknown slugs are dropped when building the cache.
   */
  const taxonomyBySlug = new Map(
    CONTROLLED_TOPIC_TAXONOMY.map((topic) => [topic.slug, topic]),
  );
  const rowsByChunkId = new Map<string, DetectedTopic[]>();

  const lines = fs.readFileSync(labelsPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row: CuratedRerankerRow;
    try {
      row = JSON.parse(trimmed) as CuratedRerankerRow;
    } catch {
      continue;
    }

    const chunkId = row.chunkId?.trim();
    if (!chunkId) continue;
    if (!isAllowedCuratedDisplayTier(row.displayTier)) {
      rowsByChunkId.set(chunkId, []);
      continue;
    }
    if (row.decision === "no_topic" || row.decision === "junk") {
      rowsByChunkId.set(chunkId, []);
      continue;
    }

    const selected: DetectedTopic[] = [];
    for (const selectedTopic of row.selectedTopics ?? []) {
      const taxonomyEntry = taxonomyBySlug.get(selectedTopic.topicSlug ?? "");
      if (!taxonomyEntry) continue;
      const evidenceQuote = selectedTopic.evidenceQuote?.trim();
      selected.push({
        name: taxonomyEntry.name,
        slug: taxonomyEntry.slug,
        description: taxonomyEntry.description,
        mentionCount: 1,
        relevanceScore: clamp01(Number(selectedTopic.confidence ?? 0.95)),
        ...(evidenceQuote ? { evidenceQuote } : {}),
      });
    }

    selected.sort((a, b) => b.relevanceScore - a.relevanceScore);

    rowsByChunkId.set(chunkId, selected.slice(0, 5));
  }

  curatedRerankerCache = { path: labelsPath, mtimeMs, rowsByChunkId };
  return curatedRerankerCache;
}

/**
 * isAllowedCuratedDisplayTier  -  gate curated rows by their quality
 * `displayTier` against the allowed set in `TOPIC_RERANKER_DISPLAY_TIERS`
 * (default `showcase,usable`).
 *
 * Permissive by design: an empty allow-list (var blanked out) admits all
 * tiers, and a row with no displayTier is also admitted; otherwise the
 * row's tier must appear in the allow-list (case-insensitive). Lets the
 * demo surface only higher-quality curated labels without re-curating.
 */
function isAllowedCuratedDisplayTier(displayTier: string | undefined): boolean {
  const allowed = (
    process.env.TOPIC_RERANKER_DISPLAY_TIERS ?? "showcase,usable"
  )
    .split(",")
    .map((tier) => tier.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return true;
  if (!displayTier) return true;
  return allowed.includes(displayTier.toLowerCase());
}

/**
 * clamp01  -  constrain a score to [0, 1].
 *
 * Non-finite input (NaN / +/-Infinity  -  e.g. `Number("garbage")`) maps to 0,
 * NOT 0.95. A non-finite value means "no usable signal", so floor it to the
 * lowest score rather than fabricating a high-confidence 0.95 that could push
 * a junk candidate past a relevance threshold. Callers that genuinely want a
 * confident default for a MISSING field supply it explicitly via
 * `?? <default>` BEFORE calling clamp01 (so a real default still survives;
 * only truly unparseable values floor to 0).
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * isChunkRelevantToTopic  -  heuristic gate (no ML) for whether a chunk is
 * on-topic, used by the relevance service's heuristic path.
 *
 * Looks the topic up in the controlled taxonomy by slug or
 * case-insensitive name; topics outside the taxonomy are treated as
 * relevant (return true) so custom topics aren't dropped. For known
 * topics it requires at least one strong (weighted) alias mention and a
 * relevanceScore of >= 0.2.
 */
export function isChunkRelevantToTopic(
  topic: { slug: string; name: string },
  chunkText: string,
): boolean {
  const taxonomyEntry = CONTROLLED_TOPIC_TAXONOMY.find(
    (entry) =>
      entry.slug === topic.slug ||
      entry.name.toLowerCase() === topic.name.toLowerCase(),
  );

  if (!taxonomyEntry) return true;

  const match = scoreTopic(taxonomyEntry, chunkText);
  return match.strongMentionCount > 0 && match.relevanceScore >= 0.2;
}

/**
 * extractTopicEvidenceQuote  -  find a short supporting snippet from the
 * chunk that mentions the topic, for display as evidence in the UI.
 *
 * Builds a prioritized alias list (required anchors first, then taxonomy
 * aliases, then the topic name), dropping generic/blocked aliases and
 * ordering by alias weight then length so the most specific phrase is
 * tried first. Returns a sentence-bounded window (up to `maxChars`)
 * around the first alias match, or undefined when nothing matches.
 */
export function extractTopicEvidenceQuote(
  topic: { slug: string; name: string },
  chunkText: string,
  maxChars = 260,
): string | undefined {
  const taxonomyEntry = CONTROLLED_TOPIC_TAXONOMY.find(
    (entry) =>
      entry.slug === topic.slug ||
      entry.name.toLowerCase() === topic.name.toLowerCase(),
  );
  const topicSlug = taxonomyEntry?.slug ?? topic.slug;
  /*
   * Required anchors are CURATED (TOPIC_REQUIRED_ANCHORS) and trusted, so they
   * bypass the generic `isUsefulAlias` length heuristic. Otherwise a short but
   * legitimate single-word anchor like "gpt" / "llm" / "vo2" (<5 chars) would
   * be filtered out, and a topic whose only anchor is short could never seed an
   * evidence quote. The non-required aliases still go through `isUsefulAlias`.
   */
  const requiredAnchors = taxonomyEntry
    ? (TOPIC_REQUIRED_ANCHORS[taxonomyEntry.slug] ?? [])
    : [];
  const aliases = [
    ...requiredAnchors.filter(
      (alias) => !isBlockedTopicAlias(topicSlug, alias),
    ),
    ...[...(taxonomyEntry?.aliases ?? []), topic.name].filter(
      (alias) => isUsefulAlias(alias) && !isBlockedTopicAlias(topicSlug, alias),
    ),
  ].sort((a, b) => aliasWeight(b) - aliasWeight(a) || b.length - a.length);

  for (const alias of aliases) {
    const match = findAliasMatch(chunkText, alias);
    if (match)
      return quoteWindow(chunkText, match.index, match.length, maxChars);
  }

  return undefined;
}

/**
 * detectControlledTopics  -  score every controlled-taxonomy topic against
 * the text via keyword heuristics and return the strongest matches.
 *
 * Keeps only topics with at least one strong mention, filters to
 * relevanceScore >= 0.25, sorts by relevance then mention count, and caps
 * at 5. This is the deterministic first pass tried by
 * detectTopicsForTranscript before any LLM call.
 */
function detectControlledTopics(transcriptText: string): DetectedTopic[] {
  /*
   * Score every controlled topic; flatMap with [] acts as a filter that
   * drops topics with no strong (high-weight) keyword mention.
   */
  const scored = CONTROLLED_TOPIC_TAXONOMY.flatMap((topic) => {
    const match = scoreTopic(topic, transcriptText);
    if (match.strongMentionCount === 0) return [];
    return [
      {
        name: topic.name,
        slug: topic.slug,
        description: topic.description,
        mentionCount: match.mentionCount,
        relevanceScore: match.relevanceScore,
      },
    ];
  });

  return scored
    .filter((topic) => topic.relevanceScore >= 0.25)
    .sort(
      (a, b) =>
        b.relevanceScore - a.relevanceScore || b.mentionCount - a.mentionCount,
    )
    .slice(0, 5);
}

/**
 * scoreTopic  -  compute keyword-match statistics for one taxonomy topic
 * against the text: total mentions, strong (high-weight) mentions, and a
 * normalized relevanceScore.
 *
 * Returns all-zero immediately if the topic's required anchor terms are
 * absent (see hasRequiredAnchor), which prevents false positives from
 * generic aliases alone. Otherwise it counts each useful, non-blocked
 * alias, accumulates a weighted score, and normalizes it (divide by 4,
 * round to 2 dp, cap at 1) so scores are comparable across topics.
 */
function scoreTopic(
  topic: TopicTaxonomyEntry,
  transcriptText: string,
): {
  mentionCount: number;
  strongMentionCount: number;
  relevanceScore: number;
} {
  if (!hasRequiredAnchor(topic, transcriptText)) {
    return { mentionCount: 0, strongMentionCount: 0, relevanceScore: 0 };
  }

  let mentionCount = 0;
  let strongMentionCount = 0;
  let weightedScore = 0;

  for (const alias of topic.aliases) {
    if (!isUsefulAlias(alias)) continue;
    if (isBlockedTopicAlias(topic.slug, alias)) continue;
    const count = countAlias(transcriptText, alias);
    if (count === 0) continue;
    mentionCount += count;
    const weight = aliasWeight(alias);
    if (weight >= 1) strongMentionCount += count;
    weightedScore += count * weight;
  }

  return {
    mentionCount,
    strongMentionCount,
    relevanceScore: Math.min(1, Math.round((weightedScore / 4) * 100) / 100),
  };
}

/**
 * aliasWeight  -  weight an alias by specificity: longer multi-word phrases
 * are stronger signals than single words.
 *
 * 3+ words -> 1.6, 2 words -> 1.2, single word -> 1 (or 0.6 for very short
 * <=3-char words). A weight >= 1 is what scoreTopic counts as a "strong"
 * mention.
 */
function aliasWeight(alias: string): number {
  const words = alias.trim().split(/\s+/).length;
  if (words >= 3) return 1.6;
  if (words === 2) return 1.2;
  return alias.length <= 3 ? 0.6 : 1;
}

/**
 * TOPIC_REQUIRED_ANCHORS  -  per-topic gate terms. A topic only scores if
 * at least one of its anchor phrases appears in the text, so it can't be
 * matched on generic aliases alone (precision guard for ambiguous
 * topics). Topics absent from this map have no anchor requirement.
 */
const TOPIC_REQUIRED_ANCHORS: Record<string, string[]> = {
  ai_agents: [
    "ai agent",
    "ai agents",
    "agentic",
    "chatgpt",
    "claude",
    "copilot",
    "openai",
    "perplexity",
  ],
  ai_data_center_infrastructure: [
    "ai data center",
    "ai data centers",
    "data center",
    "data centers",
    "gpu",
    "gpus",
    "inference",
    "nvidia",
  ],
  ai_model_competition: [
    "ai model",
    "ai models",
    "anthropic",
    "chatgpt",
    "claude",
    "deepseek",
    "foundation model",
    "gemini",
    "gpt",
    "inference",
    "language model",
    "language models",
    "large language model",
    "llm",
    "llms",
    "mistral",
    "openai",
  ],
  ai_societal_impact: [
    "ai",
    "artificial intelligence",
    "automation",
    "large language model",
    "llm",
    "machine learning",
    "robot",
    "robotics",
    "robots",
  ],
  apple_ai_strategy_and_apple_intelligence: [
    "apple ai",
    "apple intelligence",
    "siri",
  ],
  blood_brain_barrier_and_cognitive_health: [
    "alzheimer",
    "blood brain barrier",
    "brain barrier",
    "cognitive function",
    "white matter",
  ],
  cardio_vo2max: [
    "cardio",
    "endurance",
    "exercise",
    "marathon",
    "running",
    "vo2",
    "vo2 max",
  ],
  chip_supply_chain: [
    "ai chip",
    "ai chips",
    "data center",
    "gpu",
    "gpus",
    "inference",
    "jensen",
    "nvidia",
    "semiconductor",
  ],
  cortisol_stress_and_burnout: [
    "ashwagandha",
    "burnout",
    "cortisol",
    "high cortisol",
  ],
  gene_therapy: [
    "crispr",
    "gene editing",
    "gene therapy",
    "genetic",
    "genetics",
    "mutation",
    "mutations",
  ],
  film_production_and_screenwriting: [
    "director",
    "directors",
    "film production",
    "hollywood",
    "movie production",
    "screenplay",
    "screenwriting",
    "script",
    "scripts",
    "writer",
    "writers",
  ],
  foldable_smartphone_reviews: [
    "foldable",
    "foldables",
    "folding phone",
    "folding phones",
    "galaxy fold",
  ],
  generative_ai_creativity: [
    "ai",
    "generative ai",
    "image model",
    "language model",
    "llm",
    "openai",
  ],
  healthcare_system_reform: [
    "doctor",
    "doctors",
    "health care",
    "healthcare",
    "hospital",
    "insurance",
    "medical",
    "patient",
    "patients",
    "universal",
  ],
  high_cortisol: ["ashwagandha", "cortisol", "high cortisol"],
  insulin_resistance: [
    "blood sugar",
    "diabetes",
    "glucose",
    "glucose monitor",
    "insulin",
    "metformin",
    "pancreas",
    "pancreatic",
  ],
  lactate_threshold_and_zone_2_training: [
    "aerobic threshold",
    "endurance",
    "lactate",
    "lactate threshold",
    "lactic acid",
    "vo2",
    "zone 2",
    "zone 2 training",
  ],
  oral_health_and_fluoride: [
    "brush",
    "cavities",
    "dental",
    "dentist",
    "dentists",
    "floss",
    "fluoride",
    "mouth",
    "oral health",
    "teeth",
    "tooth",
  ],
  open_source_ai_models: [
    "ai model",
    "ai models",
    "llama",
    "llm",
    "open source ai",
    "open weights",
  ],
  openai_company: ["chatgpt", "gpt", "openai", "sam altman"],
  psilocybin_therapy_and_psychedelic_experience: [
    "dmt",
    "ketamine",
    "mdma",
    "mushrooms",
    "psilocybin",
    "psychedelic",
    "psychedelics",
  ],
  psychedelic_therapy_and_clinical_trials: [
    "clinical trial",
    "clinical trials",
    "dmt",
    "ketamine",
    "mdma",
    "psilocybin",
    "psychedelic therapy",
    "psychedelic therapies",
  ],
  public_health_trust_and_science_policy: [
    "public health",
    "science policy",
    "scientific",
    "scientists",
    "vaccine",
    "vaccines",
  ],
  silicon_valley_bank_and_regional_banking_crisis: [
    "bank run",
    "depositor",
    "depositors",
    "deposits",
    "regional bank",
    "regional banking",
    "silicon valley bank",
    "svb",
    "unrealized losses",
  ],
  star_wars_disney_plus_series: [
    "andor",
    "jedi",
    "mandalorian",
    "rogue one",
    "star wars",
    "tony gilroy",
  ],
  legacy_media_and_journalism_bias: [
    "journalism bias",
    "legacy media",
    "media bias",
    "new york times",
    "washington post",
  ],
  oneplus_smartphone_reviews: ["oneplus", "oxygen os"],
  smartphone_battery_technology: [
    "battery case",
    "battery health",
    "battery life",
    "batteries",
    "charger",
    "charging",
    "fast charging",
    "mah",
    "milliamp",
    "phone battery",
    "smartphone battery",
    "usb-c",
    "watt",
    "watts",
  ],
  smartphone_awards: [
    "award",
    "awards",
    "best phone",
    "honorable mention",
    "phone of the year",
    "runner up",
    "runner-up",
    "smartphone awards",
    "winner",
  ],
};

/**
 * hasRequiredAnchor  -  true if the topic has no anchor requirement, or at
 * least one of its required anchor phrases occurs in the text. Used by
 * scoreTopic to short-circuit topics that lack their defining term.
 */
function hasRequiredAnchor(
  topic: TopicTaxonomyEntry,
  transcriptText: string,
): boolean {
  const anchors = TOPIC_REQUIRED_ANCHORS[topic.slug];
  if (!anchors) return true;
  return anchors.some((anchor) => countAlias(transcriptText, anchor) > 0);
}

/**
 * GENERIC_ALIASES  -  common words/phrases that are too generic to be
 * meaningful topic signals (e.g. "thing", "company", "model"). isUsefulAlias
 * filters these out so they don't inflate topic scores.
 */
const GENERIC_ALIASES = new Set([
  "able",
  "act",
  "action",
  "actually",
  "advice",
  "agency",
  "air",
  "amazing",
  "app",
  "apps",
  "area",
  "ask",
  "asset",
  "assets",
  "bad",
  "base",
  "basic",
  "best",
  "big",
  "biggest",
  "bit",
  "black",
  "book",
  "box",
  "business",
  "care",
  "case",
  "cause",
  "center",
  "change",
  "companies",
  "company",
  "context",
  "cool",
  "cost",
  "country",
  "currency",
  "day",
  "democratic",
  "different",
  "dollar",
  "dollars",
  "door",
  "early",
  "end",
  "episode",
  "episodes",
  "even",
  "example",
  "experience",
  "fact",
  "feel",
  "field",
  "film",
  "free",
  "good",
  "great",
  "group",
  "guide",
  "hard",
  "help",
  "high",
  "home",
  "hour",
  "hours",
  "idea",
  "important",
  "inch",
  "inside",
  "issue",
  "kind",
  "late",
  "level",
  "levels",
  "life",
  "line",
  "little",
  "live",
  "long",
  "look",
  "make",
  "market",
  "media",
  "men",
  "million",
  "money",
  "months",
  "morning",
  "move",
  "new",
  "night",
  "number",
  "option",
  "opening",
  "party",
  "partner",
  "people",
  "person",
  "phone",
  "political",
  "point",
  "power",
  "pretty",
  "problem",
  "product",
  "products",
  "program",
  "real",
  "reason",
  "right",
  "risk",
  "run",
  "say",
  "season",
  "seasons",
  "service",
  "set",
  "small",
  "somebody",
  "space",
  "state",
  "states",
  "stop",
  "store",
  "story",
  "structure",
  "sure",
  "system",
  "systems",
  "tech",
  "thing",
  "things",
  "thoughts",
  "time",
  "today",
  "tool",
  "type",
  "use",
  "value",
  "version",
  "walk",
  "want",
  "way",
  "week",
  "weekend",
  "win",
  "women",
  "work",
  "world",
  "year",
  "years",
  "agent",
  "agents",
  "assistant",
  "attachment",
  "attention",
  "brain",
  "browser",
  "called",
  "center",
  "centers",
  "compute",
  "computer",
  "design",
  "doctor",
  "doctors",
  "energy",
  "effects",
  "human",
  "humans",
  "information",
  "infrastructure",
  "intelligence",
  "intensity",
  "knowledge",
  "language",
  "learn",
  "learning",
  "machine",
  "minutes",
  "model",
  "models",
  "output",
  "patient",
  "patients",
  "particular",
  "reasoning",
  "setting",
  "social",
  "superman",
  "train",
  "training",
  "visual",
]);

/**
 * TOPIC_ALIAS_BLOCKLIST  -  per-topic aliases that cause false matches and
 * must be ignored (e.g. partial phrases like "new york" for the media
 * topic). Enforced by isBlockedTopicAlias.
 */
const TOPIC_ALIAS_BLOCKLIST: Record<string, Set<string>> = {
  blood_brain_barrier_and_cognitive_health: new Set([
    "blood brain",
    "regions brain",
  ]),
  legacy_media_and_journalism_bias: new Set(["new york", "york city"]),
  star_wars_disney_plus_series: new Set(["best star"]),
};

/**
 * isBlockedTopicAlias  -  true if `alias` is blocklisted for `slug`
 * (case-insensitive). Lets a topic exclude specific misleading aliases
 * without removing them from the taxonomy globally.
 */
function isBlockedTopicAlias(slug: string, alias: string): boolean {
  return TOPIC_ALIAS_BLOCKLIST[slug]?.has(alias.toLowerCase()) ?? false;
}

/**
 * isUsefulAlias  -  decide whether an alias is specific enough to count as
 * a topic signal.
 *
 * Normalizes the alias (lowercase, separators->spaces). Rejects: anything
 * under 3 chars or all-digits, exact generic words, single words shorter
 * than 5 chars, and multi-word phrases composed entirely of generic
 * words. Everything else is accepted.
 */
function isUsefulAlias(alias: string): boolean {
  const normalized = alias
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (normalized.length < 3 || /^\d+$/.test(normalized)) return false;
  if (GENERIC_ALIASES.has(normalized)) return false;
  if (words.length === 1) return normalized.length >= 5;
  if (words.every((word) => GENERIC_ALIASES.has(word))) return false;
  return true;
}

/**
 * aliasRegexCache  -  memoizes the compiled boundary-matching RegExp per alias.
 *
 * `detectControlledTopics` scans ~100 topics x many aliases against every
 * chunk; recompiling `new RegExp(...)` for each (alias x chunk) was the hot
 * cost. Aliases are a small, fixed taxonomy vocabulary, so caching the
 * compiled global regex once and resetting `lastIndex` before each use keeps
 * the scan allocation-free per call.
 */
const aliasRegexCache = new Map<string, RegExp>();

/**
 * aliasBoundaryRegex  -  get (or build + cache) the global, case-insensitive
 * RegExp that matches `alias` as a standalone token. `lastIndex` is reset to 0
 * by the caller before each stateful `.exec` loop so the cached instance is
 * safe to reuse.
 */
function aliasBoundaryRegex(alias: string): RegExp {
  let regex = aliasRegexCache.get(alias);
  if (!regex) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    /*
     * Trailing boundary is a LOOKAHEAD, not a consuming group: consuming it
     * ate the delimiter shared with the next token, so adjacent repeats
     * ("ai ai ai") under-counted (2 instead of 3) in the stateful `.exec`
     * loop. The leading group stays consuming (a zero-width-or-`^` start is
     * fine since the previous match's lookahead left the delimiter in place).
     */
    regex = new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, "gi");
    aliasRegexCache.set(alias, regex);
  }
  return regex;
}

/**
 * countAlias  -  count whole-token occurrences of `alias` in `text`,
 * case-insensitively.
 *
 * The alias is regex-escaped and wrapped in non-alphanumeric boundary
 * groups (rather than \b) so it matches as a standalone token without
 * firing on substrings (e.g. "ai" won't match inside "said"). Uses a
 * precompiled cached regex (reset to lastIndex 0) to avoid recompiling on
 * every chunk x alias scan.
 */
function countAlias(text: string, alias: string): number {
  const regex = aliasBoundaryRegex(alias);
  regex.lastIndex = 0;
  let count = 0;
  while (regex.exec(text) !== null) count += 1;
  return count;
}

/**
 * findAliasMatch  -  locate the first whole-token occurrence of `alias` in
 * `text`, returning the alias's own start index and length (excluding the
 * surrounding boundary characters captured by the regex).
 *
 * Used by extractTopicEvidenceQuote to anchor the evidence window on the
 * matched phrase. Returns undefined when there is no match.
 */
function findAliasMatch(
  text: string,
  alias: string,
): { index: number; length: number } | undefined {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^a-z0-9])(${escaped})([^a-z0-9]|$)`, "i");
  const match = regex.exec(text);
  if (!match) return undefined;
  const prefixLength = match[1]?.length ?? 0;
  return {
    index: match.index + prefixLength,
    length: match[2]?.length ?? alias.length,
  };
}

/**
 * quoteWindow  -  extract a readable evidence snippet of about `maxChars`
 * centered on the matched alias at [index, index+length).
 *
 * Starts with a symmetric half-window on each side, then snaps the
 * boundaries to nearby sentence punctuation (`.`/`!`/`?`) when one is
 * within reach so the quote reads as a clean sentence fragment. Collapses
 * whitespace and adds leading/trailing ellipses when the snippet is
 * clipped from the middle of the text.
 */
function quoteWindow(
  text: string,
  index: number,
  length: number,
  maxChars: number,
): string {
  const half = Math.max(60, Math.floor((maxChars - length) / 2));
  let start = Math.max(0, index - half);
  let end = Math.min(text.length, index + length + half);

  const previousBoundary = Math.max(
    text.lastIndexOf(".", index),
    text.lastIndexOf("!", index),
    text.lastIndexOf("?", index),
  );
  if (previousBoundary >= 0 && index - previousBoundary <= half) {
    start = previousBoundary + 1;
  }

  const nextBoundaries = [
    text.indexOf(".", index + length),
    text.indexOf("!", index + length),
    text.indexOf("?", index + length),
  ]
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);
  if (nextBoundaries[0] !== undefined && nextBoundaries[0] - index <= half) {
    end = nextBoundaries[0] + 1;
  }

  const quote = text.slice(start, end).replace(/\s+/g, " ").trim();
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";
  return `${prefix}${quote}${suffix}`;
}

/**
 * upsertTopicsBySlug  -  given a list of `{ name, slug }` pairs, create
 * any topics that don't yet exist and return the resolved
 * `{ id, slug, name }` for each.
 *
 * Used by the analysis pipeline after `detectTopicsForTranscript` so
 * detected topics become first-class taxonomy rows on first encounter.
 */
export async function upsertTopicsBySlug(
  topics: Array<{ name: string; slug: string; description?: string }>,
) {
  const out: Array<{ id: string; slug: string; name: string }> = [];
  for (const topic of topics) {
    const upserted = await prisma.topic.upsert({
      where: { slug: topic.slug },
      update: { name: topic.name, description: topic.description ?? null },
      create: {
        name: topic.name,
        slug: topic.slug,
        description: topic.description ?? null,
        source: "ai_detected",
      },
    });
    out.push({ id: upserted.id, slug: upserted.slug, name: upserted.name });
  }
  return out;
}

export { TOPIC_DETECTION_PROMPT_VERSION };
