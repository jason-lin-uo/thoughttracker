import { runLlm } from "../ai/llmClient";
import {
  VIDEO_TOPIC_SUMMARY_PROMPT_VERSION,
  VIDEO_TOPIC_SUMMARY_SYSTEM,
  buildVideoTopicSummaryUserPrompt,
} from "../ai/prompts/videoTopicSummary.prompt";
import { VideoTopicSummaryResponseSchema } from "../ai/schemas/videoTopicSummary.schema";

/**
 * summarizeVideoForTopic — roll up per-chunk classifications into a
 * single `VideoTopicSummary` row for one (video, topic) pair.
 *
 * Picks the dominant stance via weighted vote (weighted by confidence
 * score so a single high-confidence chunk can override several low-
 * confidence neutrals). Produces a one-paragraph natural-language
 * summary stitched together from the per-chunk claim summaries.
 */
export async function summarizeVideoForTopic(args: {
  topicName: string;
  videoTitle: string;
  chunkAnalyses: Array<{
    chunkIndex: number;
    relevanceScore: number;
    stanceLabel: string;
    confidenceScore: number;
    claimSummary: string;
    evidenceQuote: string;
  }>;
}) {
  const userPrompt = buildVideoTopicSummaryUserPrompt(args);
  const result = await runLlm({
    task: "video_topic_summary",
    system: VIDEO_TOPIC_SUMMARY_SYSTEM,
    userPrompt: userPrompt,
    responseFormat: "json",
    promptVersion: VIDEO_TOPIC_SUMMARY_PROMPT_VERSION,
    taskInput: args,
  });

  const parsed = VideoTopicSummaryResponseSchema.safeParse(result.json);
  if (parsed.success) return parsed.data;

  return {
    dominantStance: "insufficient_evidence" as const,
    confidenceScore: 0.2,
    confidenceLabel: "low" as const,
    mentionCount: 0,
    summary: `Across the chunks in this video, the data is insufficient to characterize a stance on ${args.topicName}.`,
    notableEvidence: [],
  };
}

export { VIDEO_TOPIC_SUMMARY_PROMPT_VERSION };
