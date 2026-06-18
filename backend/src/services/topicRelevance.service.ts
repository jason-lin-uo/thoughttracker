import { predictTopicRelevance } from "../ai/mlClassifierClient";
import { logger } from "../utils/logger";
import { isChunkRelevantToTopic } from "./topicDetection.service";

type TopicRelevanceProvider =
  | "heuristic"
  | "custom_ml"
  | "curated_reranker"
  | "final_policy";
type TopicAssignmentProvider =
  | "default"
  | "curated_reranker"
  | "custom_ml_reranker"
  | "final_policy";

export interface TopicRelevanceDecision {
  relevant: boolean;
  relevanceScore: number;
  provider: TopicRelevanceProvider;
  predictedLabel?: "relevant" | "irrelevant";
  fallback?: boolean;
}

/**
 * getProvider — resolve the relevance-scoring backend from
 * `TOPIC_RELEVANCE_PROVIDER`.
 *
 * Only `custom_ml` opts into the ML classifier; any other value (or
 * unset) falls back to the deterministic keyword heuristic. This is the
 * relevance *gate* provider, distinct from the topic *assignment*
 * provider resolved by getTopicAssignmentProvider().
 */
function getProvider(): TopicRelevanceProvider {
  const raw = (
    process.env.TOPIC_RELEVANCE_PROVIDER ?? "heuristic"
  ).toLowerCase();
  return raw === "custom_ml" ? "custom_ml" : "heuristic";
}

/**
 * getTopicAssignmentProvider — resolve the active topic-assignment
 * strategy from `TOPIC_ASSIGNMENT_PROVIDER`.
 *
 * Recognizes the three model-backed tiers (`curated_reranker`,
 * `custom_ml_reranker`, `final_policy`) and otherwise returns `default`
 * (the LLM/heuristic path). Used here to decide whether per-chunk
 * relevance gating should be bypassed because the assignment provider
 * already chose the chunk's topics.
 */
function getTopicAssignmentProvider(): TopicAssignmentProvider {
  const raw = (
    process.env.TOPIC_ASSIGNMENT_PROVIDER ?? "default"
  ).toLowerCase();
  if (raw === "curated_reranker") return "curated_reranker";
  if (raw === "custom_ml_reranker") return "custom_ml_reranker";
  if (raw === "final_policy") return "final_policy";
  return "default";
}

/**
 * relevanceThreshold — minimum ML relevance score (default 0.6) at which
 * a chunk counts as relevant to a topic.
 *
 * Parsed from `TOPIC_RELEVANCE_THRESHOLD`; falls back to 0.6 when the
 * value is missing or non-numeric so a bad env var can't disable gating.
 */
function relevanceThreshold(): number {
  const parsed = Number(process.env.TOPIC_RELEVANCE_THRESHOLD ?? 0.6);
  return Number.isFinite(parsed) ? parsed : 0.6;
}

/**
 * isChunkRelevantForTopic — boolean convenience wrapper over
 * scoreChunkRelevanceForTopic that discards the score/provider metadata
 * and returns just the `relevant` verdict.
 */
export async function isChunkRelevantForTopic(args: {
  topic: { slug: string; name: string };
  chunkText: string;
}): Promise<boolean> {
  return (await scoreChunkRelevanceForTopic(args)).relevant;
}

/**
 * scoreChunkRelevanceForTopic — decide whether a transcript chunk is
 * relevant to a given topic, returning the verdict plus the score and
 * the provider that produced it.
 *
 * The decision depends on both the assignment provider and the relevance
 * provider:
 * - `curated_reranker` / `final_policy` assignment: these tiers select
 * topics themselves, so the chunk is already known-relevant — short
 * circuit to relevant with score 0 and skip gating entirely.
 * - Otherwise run the keyword heuristic. If it says "not relevant" and
 * we are not in `custom_ml_reranker` mode, reject immediately (the
 * reranker mode still lets the ML classifier overrule a heuristic miss).
 * - If the relevance provider is not `custom_ml`, return the heuristic
 * verdict as-is (score 1/0).
 * - With `custom_ml`, call the ML relevance classifier. On any failure
 * we log and fall back to the heuristic verdict (marked `fallback`) so
 * the pipeline degrades gracefully instead of throwing. On success we
 * require both a `relevant` predicted label and a score at/above
 * relevanceThreshold(), clamping the reported score to [0, 1].
 */
export async function scoreChunkRelevanceForTopic(args: {
  topic: { slug: string; name: string };
  chunkText: string;
}): Promise<TopicRelevanceDecision> {
  const assignmentProvider = getTopicAssignmentProvider();
  const relevanceProvider = getProvider();

  if (
    assignmentProvider === "curated_reranker" ||
    assignmentProvider === "final_policy"
  ) {
    return { relevant: true, relevanceScore: 0, provider: assignmentProvider };
  }

  const heuristicRelevant = isChunkRelevantToTopic(args.topic, args.chunkText);
  if (!heuristicRelevant && assignmentProvider !== "custom_ml_reranker") {
    return { relevant: false, relevanceScore: 0, provider: "heuristic" };
  }

  if (relevanceProvider !== "custom_ml") {
    return {
      relevant: heuristicRelevant,
      relevanceScore: heuristicRelevant ? 1 : 0,
      provider: "heuristic",
    };
  }

  const result = await predictTopicRelevance({
    topic: args.topic.name,
    text: args.chunkText,
  });

  if (!result.ok) {
    logger.warn(
      "ML topic relevance unavailable; falling back to heuristic gate",
      {
        error: result.error,
        message: result.message,
        topic: args.topic.name,
      },
    );
    return {
      relevant: heuristicRelevant,
      relevanceScore: heuristicRelevant ? 1 : 0,
      provider: "heuristic",
      fallback: true,
    };
  }

  const relevanceScore =
    result.labelScores.relevant ??
    (result.predictedLabel === "relevant"
      ? result.confidence
      : 1 - result.confidence);

  return {
    relevant:
      result.predictedLabel === "relevant" &&
      relevanceScore >= relevanceThreshold(),
    relevanceScore: clamp01(relevanceScore),
    provider: "custom_ml",
    predictedLabel: result.predictedLabel,
  };
}

/**
 * clamp01 — constrain a score to the [0, 1] range before it is reported
 * as a relevanceScore, guarding against out-of-range values from the ML
 * classifier.
 */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
