import { runLlm } from "../ai/llmClient";
import {
  STANCE_CLASSIFICATION_PROMPT_VERSION,
  STANCE_CLASSIFICATION_SYSTEM,
  buildStanceClassificationUserPrompt,
} from "../ai/prompts/stanceClassification.prompt";
import { StanceClassificationResponseSchema } from "../ai/schemas/stanceClassification.schema";
import type { StanceClassificationResponse } from "../ai/schemas/stanceClassification.schema";
import { predictStance, type MlStanceLabel } from "../ai/mlClassifierClient";
import { logger } from "../utils/logger";

type StanceProvider = "llm" | "custom_ml" | "hybrid";

function getProvider(): StanceProvider {
  const raw = (
    process.env.STANCE_ANALYSIS_PROVIDER ?? "custom_ml"
  ).toLowerCase();
  if (raw === "llm" || raw === "custom_ml" || raw === "hybrid") return raw;
  throw new Error(
    `Unsupported STANCE_ANALYSIS_PROVIDER="${raw}". Use llm, custom_ml, or hybrid.`,
  );
}

/**
 * Produce a stance classification for one `(chunk text, topic name)` pair.
 *
 * `custom_ml` uses the local ML service for label/confidence. `llm` uses the
 * configured real LLM provider. `hybrid` combines ML label/confidence with LLM
 * prose. If ML is unavailable, the real LLM path is used as the fallback; if
 * the LLM fails, the error is surfaced rather than replaced with fake output.
 */
export async function classifyChunkForTopic(args: {
  chunkText: string;
  topicName: string;
  topicDescription?: string;
}): Promise<StanceClassificationResponse> {
  const provider = getProvider();

  if (provider === "custom_ml" || provider === "hybrid") {
    const mlResult = await predictStance({
      topic: args.topicName,
      text: args.chunkText,
    });

    if (mlResult.ok) {
      if (provider === "custom_ml") {
        return buildCustomMlResult(mlResult, args);
      }
      return await buildHybridResult(mlResult, args);
    }

    logger.warn("ML classifier unavailable; falling back to LLM path", {
      error: mlResult.error,
      message: mlResult.message,
    });
  }

  return await runLlmStance(args);
}

async function runLlmStance(args: {
  chunkText: string;
  topicName: string;
  topicDescription?: string;
}): Promise<StanceClassificationResponse> {
  const userPrompt = buildStanceClassificationUserPrompt(args);
  const result = await runLlm({
    task: "stance_classification",
    system: STANCE_CLASSIFICATION_SYSTEM,
    userPrompt,
    responseFormat: "json",
    promptVersion: STANCE_CLASSIFICATION_PROMPT_VERSION,
    taskInput: { chunkText: args.chunkText, topicName: args.topicName },
  });

  const parsed = StanceClassificationResponseSchema.safeParse(result.json);
  if (parsed.success) return parsed.data;

  return unparseableStanceFallback(args);
}

/**
 * Safe insufficient-evidence result used when a real model returns malformed
 * JSON. This is a conservative "do not infer" result, not an inferred stance.
 */
function unparseableStanceFallback(args: {
  chunkText: string;
  topicName: string;
}): StanceClassificationResponse {
  return {
    relevanceScore: 0,
    stanceLabel: "insufficient_evidence",
    confidenceScore: 0.2,
    confidenceLabel: "low",
    claimSummary: `Could not parse stance for ${args.topicName}.`,
    rationale:
      "AI response failed schema validation; classified as insufficient_evidence.",
    evidenceQuote: args.chunkText.slice(0, 160),
  };
}

function buildCustomMlResult(
  ml: { predictedLabel: MlStanceLabel; confidence: number },
  args: { chunkText: string; topicName: string },
): StanceClassificationResponse {
  return {
    relevanceScore: clamp01(ml.confidence + 0.1),
    stanceLabel: mapMlLabelToDbLabel(ml.predictedLabel, ml.confidence),
    confidenceScore: ml.confidence,
    confidenceLabel: confidenceLabelFor(ml.confidence),
    claimSummary: `Speaker references ${args.topicName.toLowerCase()} in this segment.`,
    rationale:
      "Stance classified by the local ThoughtTracker ML model. No private beliefs are inferred.",
    evidenceQuote:
      firstSentence(args.chunkText) ?? args.chunkText.slice(0, 160),
  };
}

async function buildHybridResult(
  ml: { predictedLabel: MlStanceLabel; confidence: number },
  args: { chunkText: string; topicName: string; topicDescription?: string },
): Promise<StanceClassificationResponse> {
  const llmOut = await runLlmStance(args);
  return {
    relevanceScore: Math.max(
      llmOut.relevanceScore,
      clamp01(ml.confidence + 0.1),
    ),
    stanceLabel: mapMlLabelToDbLabel(ml.predictedLabel, ml.confidence),
    confidenceScore: ml.confidence,
    confidenceLabel: confidenceLabelFor(ml.confidence),
    claimSummary: llmOut.claimSummary,
    rationale: llmOut.rationale,
    evidenceQuote: llmOut.evidenceQuote,
  };
}

function mapMlLabelToDbLabel(
  ml: MlStanceLabel,
  confidence: number,
): StanceClassificationResponse["stanceLabel"] {
  if (ml === "unclear" && confidence < 0.4) return "insufficient_evidence";
  return ml;
}

function confidenceLabelFor(
  score: number,
): StanceClassificationResponse["confidenceLabel"] {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function clamp01(n: number): number {
  if (n > 1) return 1;
  return n;
}

function firstSentence(text: string): string | undefined {
  const m = text.match(/[^.!?]{20,220}[.!?]/);
  return m?.[0]?.trim();
}

export { STANCE_CLASSIFICATION_PROMPT_VERSION };
